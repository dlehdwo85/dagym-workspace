import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

/** 183차 #177(로컬 10/23 요청 · 대표 "비슷한 글은 하나만 남기고 나머지 삭제"): 마케팅 콘텐츠 휴지통(mig 208).
 *  지우기 = status 'canceled' + deleted_at·deleted_by·deleted_from — 승인함·캘린더·게시 실행기·하루 2건 검사가 모두 status 로 거르므로 그 자리에서 빠짐.
 *  열린 제작 요청·대기 중 게시 작업은 취소. 30일 안에 [되살리기] = 원래 상태(deleted_from)로. 30일 지나면 정기 실행(purgeTrash)이 행을 지움(버전·결정·게시 작업·제작 요청은 외래키로 함께)
 *  + 이 글에만 쓰인 자동 시안 그림('마케팅/자동 시안' 폴더)은 자료실 휴지통으로(복구 가능).
 *  매체에 살아 있는 게시된 글은 지우지 않음(매체에서 먼저 지워 '게시 삭제됨'이 된 뒤에). 관리자만 · 감사 기록 건별. */
export const TRASH_DAYS = 30;
export const trashInput = z.object({ ids: z.array(zUuid).min(1).max(200) });
const adminOnly = (u: SessionUser) => { if (!isAdmin(u)) throw forbidden('콘텐츠는 관리자만 지우거나 되살릴 수 있습니다'); };
export const purgeAt = (deletedAt: string | Date) => new Date(new Date(deletedAt).getTime() + TRASH_DAYS * 864e5);
const LIVE_REASON = '게시된 글은 지울 수 없습니다 — 매체에서 먼저 지우면 됩니다';

/** 여러 건 휴지통으로(승인함 '수정 요청·보류'·'초안 보관' 칸 [골라서 지우기]) — 게시된 글은 건너뛰고 사유를 돌려줌 */
export async function trashContents(u: SessionUser, i: z.infer<typeof trashInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<{ id: string; title: string; status: string; published_deleted_at: string | null }[]>`select id, title, status, published_deleted_at from mkt_contents where tenant = ${t} and id = any(${i.ids}::uuid[]) and deleted_at is null`;
  const live = (r: { status: string; published_deleted_at: string | null }) => r.status === 'published' && !r.published_deleted_at;
  const ok = rows.filter((r) => !live(r));
  const skipped = rows.filter(live).map((r) => ({ id: r.id, title: r.title, reason: LIVE_REASON }));
  const ids = ok.map((r) => r.id);
  if (ids.length) await sql.begin(async (tx) => {
    await tx`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now() where content_id = any(${ids}::uuid[]) and status in ('open', 'needs_approval')`;
    await tx`update mkt_publish_jobs set status = 'canceled', last_error = '휴지통으로 옮긴 글' where content_id = any(${ids}::uuid[]) and status = 'queued'`;
    await tx`update mkt_contents set deleted_at = now(), deleted_by = ${u.id}, deleted_from = status, status = 'canceled', reminded_at = null, updated_at = now()
      where tenant = ${t} and id = any(${ids}::uuid[]) and deleted_at is null`;
    for (const r of ok) await audit(tx, u.id, 'mkt_content.trash', 'mkt_content', r.id, { from: r.status, title: r.title, batch: ids.length });
  });
  return { count: ids.length, ids, skipped, missing: i.ids.length - rows.length, purgeAt: ids.length ? purgeAt(new Date()).toISOString() : null, days: TRASH_DAYS };
}

/** 상세 창 [휴지통으로]: 한 건 — 못 지우는 사유는 400, 없거나 이미 휴지통이면 404 */
export async function trashContent(u: SessionUser, id: string) {
  if (!zUuid.safeParse(id).success) throw notFound('콘텐츠를 찾을 수 없습니다');
  const r = await trashContents(u, { ids: [id] });
  if (r.count) return { ok: true, id, purgeAt: r.purgeAt, days: TRASH_DAYS };
  if (r.skipped.length) throw badRequest(r.skipped[0].reason);
  throw notFound('콘텐츠를 찾을 수 없습니다(이미 휴지통에 있을 수 있습니다)');
}

/** [되살리기]: 원래 상태(deleted_from)로 — 취소했던 게시 작업은 되살리지 않음(필요하면 상세에서 다시 게시) */
export async function restoreContents(u: SessionUser, i: z.infer<typeof trashInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<{ id: string; title: string; status: string }[]>`update mkt_contents set status = coalesce(deleted_from, 'draft'), deleted_at = null, deleted_by = null, deleted_from = null, updated_at = now()
    where tenant = ${t} and id = any(${i.ids}::uuid[]) and deleted_at is not null returning id, title, status`;
  for (const r of rows) await audit(sql, u.id, 'mkt_content.restore', 'mkt_content', r.id, { to: r.status, title: r.title }).catch(() => {});
  if (!rows.length) throw notFound('휴지통에 그 글이 없습니다 — 이미 되살렸거나 영구 삭제되었습니다');
  return { count: rows.length, items: rows };
}

/** 휴지통 목록(관리자): 지운 사람·시각·원래 상태·영구 삭제 예정일 */
export async function listTrash(u: SessionUser) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  const items = await sql<any[]>`select c.id, c.title, c.channel, c.kind, c.scheduled_at, c.deleted_at, c.deleted_from, c.is_test, c.auto, b.name as brand, b.color as brand_color, du.name as deleted_by_name,
      coalesce(cardinality(v.media_ids), 0) as media_count
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id left join users du on du.id = c.deleted_by
    left join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${t} and c.deleted_at is not null order by c.deleted_at desc limit 300`;
  return { days: TRASH_DAYS, items: items.map((r) => ({ ...r, purge_at: purgeAt(r.deleted_at).toISOString() })) };
}

/** 정기 실행: 30일 지난 휴지통 글 영구 삭제 — 이 글에만 쓰인 자동 시안 그림은 자료실 휴지통으로, 글 행은 삭제(버전·결정·게시 작업·제작 요청은 외래키로 함께) · 회사별 감사 기록 */
export async function purgeTrash(now = new Date()) {
  const sql = db();
  const cutoff = new Date(now.getTime() - TRASH_DAYS * 864e5).toISOString();
  const gone = await sql<{ id: string; tenant: string; title: string }[]>`select id, tenant, title from mkt_contents where deleted_at is not null and deleted_at < ${cutoff}::timestamptz`;
  if (!gone.length) return { purged: 0, files: 0 };
  const ids = gone.map((g) => g.id);
  const files = await sql<{ id: string }[]>`update library_files f set deleted_at = now(), updated_at = now()
    where f.deleted_at is null and f.folder = '마케팅/자동 시안'
      and exists (select 1 from mkt_versions v where v.content_id = any(${ids}::uuid[]) and f.id = any(v.media_ids))
      and not exists (select 1 from mkt_versions v2 where f.id = any(v2.media_ids) and not (v2.content_id = any(${ids}::uuid[])))
    returning f.id`;
  await sql`delete from mkt_contents where id = any(${ids}::uuid[])`;
  const byTenant = new Map<string, string[]>();
  for (const g of gone) byTenant.set(g.tenant, [...(byTenant.get(g.tenant) ?? []), g.title]);
  for (const [tenant, titles] of byTenant) await audit(sql, null, 'mkt.trash_purge', 'tenant', tenant, { count: titles.length, titles: titles.slice(0, 20), files: files.length, days: TRASH_DAYS }).catch(() => {});
  return { purged: ids.length, files: files.length };
}
