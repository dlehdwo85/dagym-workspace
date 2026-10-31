import { z } from 'zod';
import { db } from './db';
import { audit } from './log';
import { assertSpace } from './spaces';
import { isAdmin } from './access';
import { badRequest, forbidden, notFound } from './errors';
import { notify } from './notifications';
import { addDays, todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

/**
 * 297차 #836(대표 10/31 '사진이나 자료를 업로드하는 걸 요청하는 요청 페이지 — AI 마케터가 요청할 자료가 있으면 더 높은 퀄리티가 나올 수 있도록',
 * '촬영해서 자료 받는 데 1주일 정도'): 마케팅 › 자료 요청.
 *  - AI 마케터(자동): 단색 표지로 막힌 글이 생기면 그 브랜드에 '필요한 자료' 카드 1장(브랜드·종류마다 열린 것 하나만) — 브랜드 키트 '시안에 쓸 사진'이
 *    앱 화면이면 화면 녹화·캡처, 아니면 실사. 담당 = 마케팅 알림 받는 사람 첫째(없으면 글 만든 사람·대표), 기한 7일.
 *  - 사람: [자료 요청 만들기](관리자) — 브랜드·종류·제목·설명·몇 장·담당·기한.
 *  - 올리기: 카드에서 바로 → 자료실 '마케팅/브랜드 자료/{브랜드}'(브랜드 이름·'자료 요청' 태그) → 받음 → 사진 설명(AI, 기존 자동 설명과 같은 비용) →
 *    그 브랜드의 단색 표지 글을 다시 그림 → 받은 자료가 시안에 쓰이면 '사용함'.
 *  - 글은 수정 요청(표지 사진 필요)에 남음 — 자료가 오면 다시 그려 승인 대기로.
 */
export const KINDS = ['photo', 'video', 'screen', 'other'] as const;
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = { photo: '사진', video: '영상', screen: '앱 화면', other: '기타' };
export const materialInput = z.object({
  brandId: z.string().uuid(),
  contentId: z.string().uuid().nullable().optional(),
  kind: z.enum(KINDS).default('photo'),
  title: z.string().trim().min(2).max(120),
  detail: z.string().trim().max(2000).default(''),
  wanted: z.number().int().min(1).max(50).default(5),
  assigneeId: z.string().uuid().nullable().optional(),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const receiveInput = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(50) });
export const materialPatch = z.object({ status: z.enum(['canceled', 'requested']).optional(), assigneeId: z.string().uuid().nullable().optional(), dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

const brandName = (n: string | null | undefined) => String(n ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
export const brandFolder = (brand: string) => `마케팅/브랜드 자료/${brand || '브랜드 없음'}`;

/** AI 마케터 요청 문구 — 브랜드 키트 '시안에 쓸 사진' 규칙에 맞춰(AI 호출 없음) */
export function aiAsk(brand: string, src: string, why: string) {
  if (src === 'screen') return { kind: 'screen' as const, wanted: 5, title: `${brand} 앱 화면 캡처 5장 + 화면 녹화 30초`,
    detail: `${why}\n· 실제로 쓰는 화면(가짜 데이터·시험 회사 화면) — 홈·업무·일정·알림 등 기능이 보이게\n· 휴대폰 세로 캡처 3장 + PC 가로 캡처 2장, 녹화는 30초 안\n· 이름·전화번호 같은 개인정보는 가리거나 시험 데이터로` };
  if (src === 'scenes') return { kind: 'photo' as const, wanted: 5, title: `${brand} 출입·업무 장면 실사 5장`,
    detail: `${why}\n· 얼굴 인식 출입·게이트 통과·키오스크·컴퓨터나 휴대폰으로 업무 보는 장면\n· 얼굴이 정면으로 보이지 않게(뒷모습·손·옆모습), 밝고 흔들리지 않게, 글자 없는 사진` };
  return { kind: 'photo' as const, wanted: 5, title: `${brand} 실사 5장 — 시설·입구·이용 장면`,
    detail: `${why}\n· 시설 전경·입구·운동/이용 장면·소품 클로즈업을 골고루\n· 얼굴이 정면으로 보이지 않게(뒷모습·손·옆모습), 밝고 흔들리지 않게, 글자 없는 사진(홍보물·포스터 말고)` };
}

/** AI 마케터 자동 요청 — 단색 표지로 막힌 글(피드·스토리)에서. 같은 브랜드·종류의 열린 AI 요청이 있으면 만들지 않음 */
export async function needMaterial(c: { id: string; tenant: string; brand_id: string | null; created_by?: string | null; is_test?: boolean | null }, why = '표지에 쓸 사진·화면이 없어 단색 바탕 표지만 나옵니다') {
  if (!c.brand_id || c.is_test) return null;
  const sql = db();
  const [b] = await sql<{ name: string; video: any }[]>`select name, video from mkt_brands where id = ${c.brand_id}`;
  if (!b) return null;
  const brand = brandName(b.name);
  const ask = aiAsk(brand, String(b.video?.photoSource ?? 'brand'), why);
  const [open] = await sql`select 1 from mkt_material_requests where tenant = ${c.tenant} and brand_id = ${c.brand_id} and kind = ${ask.kind} and status = 'requested' and source = 'ai'`;
  if (open) return null;
  const S = await (await import('./mktAuto')).settingsOf(c.tenant);
  const [owner] = await sql<{ id: string }[]>`select id from users where tenant = ${c.tenant} and status = 'active' and role = 'owner' and not is_demo order by created_at limit 1`;
  const assignee = (S.notify_user_ids ?? [])[0] ?? c.created_by ?? owner?.id ?? null;
  const due = addDays(todaySeoul(), 7);
  const [r] = await sql<{ id: string }[]>`insert into mkt_material_requests (tenant, brand_id, content_id, kind, title, detail, wanted, assignee_id, due_on, source)
    values (${c.tenant}, ${c.brand_id}, ${c.id}, ${ask.kind}, ${ask.title}, ${ask.detail}, ${ask.wanted}, ${assignee}, ${due}::date, 'ai')
    on conflict do nothing returning id`;
  if (!r) return null;
  if (assignee) await notify(sql, { userIds: [assignee], type: 'task_assigned', title: `자료 요청: ${ask.title}`, body: `AI 마케터 — 기한 ${due.slice(5).replace('-', '/')} · ${why}`,
    link: `/s/marketing/materials?r=${r.id}`, entityType: 'mkt_material', entityId: r.id, space: 'marketing', dedupeKey: `mktmat:${r.id}` }).catch(() => {});
  return r.id;
}

/** 목록 — 요청 중·받음·사용함·취소 + 브랜드별 '표지 사진 필요' 글 수. 받은 자료가 시안에 쓰였으면 '사용함'으로 바꿔 보여 줌 */
export async function listMaterials(u: SessionUser, q: { status?: string } = {}) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  // 받은 자료가 시안(표지·4분할·카드 장·붙은 파일)에 쓰였으면 사용함
  await sql`update mkt_material_requests r set status = 'used', used_at = now(), updated_at = now()
    where r.tenant = ${t} and r.status = 'received' and exists (select 1 from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version
      where c.tenant = r.tenant and (v.media_ids && r.file_ids or (c.quality->'visual'->>'photoId')::text = any(r.file_ids::text[])
        or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(c.quality->'pages') = 'array' then c.quality->'pages' else '[]'::jsonb end) p where p->>'photoId' = any(r.file_ids::text[]))))`;
  const rows = await sql<any[]>`select r.id, r.brand_id, coalesce(b.name, '') as brand, r.content_id, c.title as content_title, r.kind, r.title, r.detail, r.wanted, r.assignee_id, a.name as assignee,
      r.due_on::text as due_on, r.status, r.file_ids, r.source, r.created_at, r.received_at, r.used_at,
      (select count(*)::int from mkt_contents x where x.tenant = r.tenant and x.brand_id = r.brand_id and x.status in ('pending', 'changes') and x.quality->'visual'->>'plain' = 'true') as blocked
    from mkt_material_requests r left join mkt_brands b on b.id = r.brand_id left join mkt_contents c on c.id = r.content_id left join users a on a.id = r.assignee_id
    where r.tenant = ${t} ${q.status && q.status !== 'all' ? sql`and r.status = ${q.status}` : sql``}
    order by (r.status = 'requested') desc, r.due_on, r.created_at desc limit 200`;
  const ids = [...new Set(rows.flatMap((r) => r.file_ids ?? []))];
  const files = ids.length ? await sql<{ id: string; title: string; mime_type: string }[]>`select id, coalesce(nullif(title, ''), file_name) as title, mime_type from library_files where id = any(${ids}::uuid[]) and deleted_at is null` : [];
  const fm = new Map(files.map((f) => [f.id, f]));
  const [brands, people, counts] = await Promise.all([
    sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} and name not like '[시험]%' order by name`,
    sql<{ id: string; name: string }[]>`select id, name from users where tenant = ${t} and status = 'active' and not is_demo order by name`,
    sql<{ status: string; n: number }[]>`select status, count(*)::int as n from mkt_material_requests where tenant = ${t} group by status`,
  ]);
  return {
    rows: rows.map((r) => ({ ...r, brand: brandName(r.brand), files: (r.file_ids ?? []).map((id: string) => fm.get(id)).filter(Boolean) })),
    brands: brands.map((b) => ({ id: b.id, name: brandName(b.name) })), people, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), canEdit: isAdmin(u),
  };
}

/** 사람이 만드는 요청(관리자) */
export async function createMaterial(u: SessionUser, i: z.infer<typeof materialInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('자료 요청은 관리자만 만들 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<{ name: string }[]>`select name from mkt_brands where id = ${i.brandId} and tenant = ${t}`;
  if (!b) throw notFound();
  if (i.contentId && !(await sql`select 1 from mkt_contents where id = ${i.contentId} and tenant = ${t}`).length) throw notFound();
  if (i.assigneeId && !(await sql`select 1 from users where id = ${i.assigneeId} and tenant = ${t} and status = 'active'`).length) throw badRequest('담당자를 찾을 수 없습니다');
  const due = i.dueOn ?? addDays(todaySeoul(), 7);
  const [r] = await sql<{ id: string }[]>`insert into mkt_material_requests (tenant, brand_id, content_id, kind, title, detail, wanted, assignee_id, due_on, source, created_by)
    values (${t}, ${i.brandId}, ${i.contentId ?? null}, ${i.kind}, ${i.title}, ${i.detail}, ${i.wanted}, ${i.assigneeId ?? null}, ${due}::date, 'manual', ${u.id}) returning id`;
  await audit(sql, u.id, 'mkt.material_request', 'mkt_material', r.id, { brand: brandName(b.name), kind: i.kind });
  if (i.assigneeId) await notify(sql, { userIds: [i.assigneeId], actorId: u.id, type: 'task_assigned', title: `자료 요청: ${i.title}`, body: `${u.name} — 기한 ${due.slice(5).replace('-', '/')}`,
    link: `/s/marketing/materials?r=${r.id}`, entityType: 'mkt_material', entityId: r.id, space: 'marketing', dedupeKey: `mktmat:${r.id}` }).catch(() => {});
  return { id: r.id };
}

/** 취소·다시 요청·담당·기한 바꾸기(관리자 또는 담당) */
export async function patchMaterial(u: SessionUser, id: string, i: z.infer<typeof materialPatch>) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const [r] = await sql<{ assignee_id: string | null; status: string }[]>`select assignee_id, status from mkt_material_requests where id = ${id} and tenant = ${t}`;
  if (!r) throw notFound();
  if (!isAdmin(u) && r.assignee_id !== u.id) throw forbidden('관리자나 담당자만 바꿀 수 있습니다');
  await sql`update mkt_material_requests set status = coalesce(${i.status ?? null}, status), assignee_id = ${i.assigneeId !== undefined ? i.assigneeId : r.assignee_id},
    due_on = coalesce(${i.dueOn ?? null}::date, due_on), updated_at = now() where id = ${id}`;
  return { ok: true };
}

/** 받음 — 올린 파일(자료실)을 이 요청에 붙이고 브랜드 폴더·태그로 → 사진 설명 → 그 브랜드의 단색 표지 글 다시 그리기(응답 뒤) */
export async function receiveMaterial(u: SessionUser, id: string, i: z.infer<typeof receiveInput>) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const [r] = await sql<{ brand_id: string | null; brand: string | null; status: string; file_ids: string[] }[]>`select r.brand_id, b.name as brand, r.status, r.file_ids from mkt_material_requests r left join mkt_brands b on b.id = r.brand_id where r.id = ${id} and r.tenant = ${t}`;
  if (!r) throw notFound();
  if (r.status === 'canceled') throw badRequest('취소된 요청입니다');
  const files = await sql<{ id: string; tags: string[] | null; mime_type: string; described: boolean }[]>`select id, tags, mime_type, (vision ? 'caption') as described from library_files where id = any(${i.fileIds}::uuid[]) and tenant = ${t} and deleted_at is null`;
  if (files.length !== new Set(i.fileIds).size) throw badRequest('올린 파일을 찾을 수 없습니다');
  const brand = brandName(r.brand);
  for (const f of files) {
    const tags = [...new Set([...(f.tags ?? []), ...(brand ? [brand] : []), '자료 요청'])].slice(0, 20);
    await sql`update library_files set space = 'marketing', folder = ${brandFolder(brand)}, tags = ${tags}, updated_at = now() where id = ${f.id}`;
  }
  await sql`update mkt_material_requests set file_ids = array(select distinct unnest(file_ids || ${i.fileIds}::uuid[])), status = case when status = 'used' then status else 'received' end,
    received_at = coalesce(received_at, now()), updated_at = now() where id = ${id}`;
  await audit(sql, u.id, 'mkt.material_received', 'mkt_material', id, { files: i.fileIds.length });
  const photos = files.filter((f) => f.mime_type.startsWith('image/') && !f.described).map((f) => f.id); // 이미 설명이 있는 자료실 사진은 다시 설명하지 않음(AI 비용)
  if (r.brand_id) {
    const brandId = r.brand_id;
    (await import('./later')).runLater('mktMaterial', async () => {
      // 막 올린 마케팅 사진은 자료실이 올리기 끝에 이미 설명을 시작함 — 20초까지 기다렸다가 아직 없는 것만 설명(두 번 내지 않게)
      let left = photos;
      for (let k = 0; k < 10 && left.length; k++) {
        await new Promise((ok) => setTimeout(ok, 2000));
        left = (await sql<{ id: string }[]>`select id from library_files where id = any(${left}::uuid[]) and not (coalesce(vision, '{}'::jsonb) ? 'caption')`).map((x) => x.id);
      }
      const described = left.length ? await (await import('./mktPhotos')).describeBatch(t, { ids: left, limit: left.length, budgetMs: 60e3, actorId: u.id }).catch(() => null) : { done: 0, waited: photos.length };
      const redrawn = await (await import('./mktAutoVisual')).redrawPlainForBrand(t, brandId).catch(() => []);
      return { tenant: t, described, redrawn };
    });
  }
  return { ok: true, files: files.length };
}
