// #1139(대표 11/24 '업무관리는 별도의 상담 없이, 영업·마케팅은 문의 → 상담 후 사용(잠금 표기)'):
// · 회사가 켜지 않은 영업·마케팅은 사이드바에 자물쇠 + '상담 후 사용' → 소개 + [상담 신청](관리자, 연락처 미리 채움, 같은 공간 중복 신청 없음)
// · 상담 신청은 플랫폼 운영자에게 알림(앱 + 메일) → 운영자가 회사 상세에서 [영업 열기]·[마케팅 열기](닫기도, 감사 기록) — 회사 관리자는 직접 켜지 못함
// · 예외(직접 켜기 허용): 우리 회사(default)·앱 심사용 demo·검수용 시험 회사(is_test)·결제 시험 test_* — 화면 시험·심사·배포 확인이 막히지 않게
// · 서버 차단은 기존 assertSpace(회사가 켜지 않은 공간 = 404) 그대로 · 화면에 금액은 쓰지 않음(요금은 상담에서)
import { z } from 'zod';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { badRequest, forbidden } from './errors';
import { audit } from './log';
import { notify } from './notifications';
import { tenantSpaces, type Space } from './spaces';
import { tenantOf, type SessionUser } from './types';

export const LOCKABLE = ['sales', 'marketing'] as const;
export type Lockable = (typeof LOCKABLE)[number];
const LABEL: Record<Lockable, string> = { sales: '영업', marketing: '마케팅' };

/** 관리자가 직접 공간을 켜도 되는 회사(상담 없이) */
export async function consultFree(tenant: string, sql: Sql = db()) {
  if (['default', 'demo'].includes(tenant) || tenant.startsWith('test_')) return true;
  if (process.env.SPACES_SELF_SERVE === '1') return true; // 시험 서버 전용(tests/helpers.mjs) — 운영에는 넣지 않음
  const [t] = await sql<{ is_test: boolean | null }[]>`select is_test from tenants where id = ${tenant}`;
  return !!t?.is_test;
}

/** 회사가 켜지 않은 영업·마케팅(잠김) */
export async function lockedSpaces(tenant: string, sql: Sql = db()): Promise<Lockable[]> {
  const on = await tenantSpaces(tenant, sql);
  return LOCKABLE.filter((s) => !(on as Space[]).includes(s));
}

/** 잠긴 공간 안내 화면: 잠긴 공간·열린 상담 신청·신청 가능 여부·미리 채울 연락처 */
export async function consultView(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const locked = await lockedSpaces(t, sql);
  const open = await sql<{ id: string; spaces: string[]; created_at: Date; name: string | null }[]>`
    select c.id, c.spaces, c.created_at, us.name from space_consults c left join users us on us.id = c.user_id where c.tenant = ${t} and c.status = 'requested' order by c.created_at desc limit 5`;
  const [me] = await sql<{ name: string; email: string; phone: string | null }[]>`select name, email, phone from users where id = ${u.id}`;
  return {
    locked, canRequest: isAdmin(u) && !u.isDemo, free: await consultFree(t, sql),
    requested: open.map((r) => ({ id: r.id, spaces: r.spaces, at: r.created_at.toISOString(), by: r.name })),
    contact: isAdmin(u) ? { name: me?.name ?? u.name, email: me?.email ?? u.email, phone: me?.phone ?? '' } : null,
  };
}

export const consultInput = z.object({
  spaces: z.array(z.enum(LOCKABLE)).min(1, '영업·마케팅 중 하나 이상 골라 주세요').max(2),
  name: z.string().trim().min(1, '이름을 적어 주세요').max(50),
  phone: z.string().trim().max(30).optional().default(''),
  email: z.string().trim().email('이메일 형식이 아닙니다').max(200),
  memo: z.string().trim().max(1000).optional().default(''),
});
/** [상담 신청] — 회사 관리자. 이미 열린 신청에 같은 공간이 있으면 새로 만들지 않고 그 신청을 돌려줌 */
export async function requestConsult(u: SessionUser, i: z.infer<typeof consultInput>, ip: string | null) {
  if (!isAdmin(u) || u.isDemo) throw forbidden('회사 관리자만 상담을 신청할 수 있습니다');
  const sql = db(); const t = tenantOf(u);
  const locked = await lockedSpaces(t, sql);
  const want = [...new Set(i.spaces)].filter((s) => locked.includes(s));
  if (!want.length) throw badRequest('이미 사용 중인 공간입니다');
  const [dup] = await sql<{ id: string; created_at: Date; spaces: string[] }[]>`select id, created_at, spaces from space_consults where tenant = ${t} and status = 'requested' and spaces && ${want}::text[] order by created_at desc limit 1`;
  if (dup) return { id: dup.id, already: true, at: dup.created_at.toISOString(), spaces: dup.spaces };
  const [c] = await sql<{ id: string; created_at: Date }[]>`insert into space_consults (tenant, user_id, spaces, name, phone, email, memo)
    values (${t}, ${u.id}, ${want}, ${i.name}, ${i.phone || null}, ${i.email}, ${i.memo || null}) returning id, created_at`;
  await audit(sql, u.id, 'space.consult_request', 'tenant', null, { spaces: want }, ip);
  const [tn] = await sql<{ name: string }[]>`select name from tenants where id = ${t}`;
  const what = want.map((s) => LABEL[s]).join('·');
  const { platformAdminIds } = await import('./superAdmin');
  const ops = await platformAdminIds(sql);
  if (ops.length) {
    await notify(sql, { userIds: ops, type: 'signup_request', title: `상담 신청: ${tn?.name ?? t} — ${what}`, body: `${i.name}${i.phone ? ` · ${i.phone}` : ''} · ${i.email}${i.memo ? `\n${i.memo.slice(0, 200)}` : ''}`,
      link: `/platform?tenant=${encodeURIComponent(t)}`, entityType: 'tenant', entityId: null, actorId: u.id, dedupeKey: `space-consult:${c.id}` } as never).catch(() => {});
    // 메일도(운영자가 앱을 안 보고 있어도) — 신청한 사람의 연락처는 운영자에게만
    const { sendMail } = await import('./mail');
    const to = await sql<{ email: string }[]>`select email from users where id = any(${ops}::uuid[])`;
    for (const r of to) await sendMail(r.email, `[워크인] 상담 신청 — ${tn?.name ?? t} (${what})`,
      `${tn?.name ?? t} 에서 ${what} 상담을 신청했습니다.\n\n이름: ${i.name}\n연락처: ${i.phone || '-'}\n이메일: ${i.email}\n메모: ${i.memo || '-'}\n\n플랫폼 운영 › 고객사 › 회사 상세에서 상담 뒤 [${what} 열기]를 누르면 바로 쓸 수 있습니다.`).catch(() => {});
  }
  return { id: c.id, already: false, at: c.created_at.toISOString(), spaces: want };
}

/** 플랫폼 운영자가 회사 상세에서 공간을 켜고 끈 뒤(setTenantSpacesByPlatform): 새로 연 공간이 든 열린 상담 신청은 '열림'으로, 회사 관리자에게 알림 */
export async function afterPlatformSpaces(sql: Sql, u: SessionUser, tenant: string, before: string[], after: string[]) {
  const opened = LOCKABLE.filter((s) => after.includes(s) && !before.includes(s));
  const closed = LOCKABLE.filter((s) => before.includes(s) && !after.includes(s));
  if (opened.length) await sql`update space_consults set status = 'opened', handled_by = ${u.id}, handled_at = now() where tenant = ${tenant} and status = 'requested' and spaces && ${opened}::text[]`;
  if (!opened.length && !closed.length) return;
  const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and role in ('owner', 'admin') and status = 'active' and not coalesce(is_demo, false)`).map((x) => x.id);
  for (const [list, on] of [[opened, true], [closed, false]] as const) for (const sp of list) if (admins.length)
    await notify(sql, { userIds: admins, type: 'announcement', title: on ? `${LABEL[sp]} 공간을 열었습니다` : `${LABEL[sp]} 공간을 닫았습니다`,
      body: on ? `이제 ${LABEL[sp]}을(를) 쓸 수 있습니다. 직원 배정은 관리 › 사용자 › 공간에서 합니다.` : `${LABEL[sp]} 공간이 닫혔습니다. 자료는 그대로 남아 있고, 다시 열면 이어서 쓸 수 있습니다.`,
      link: on ? `/s/${sp}` : '/', entityType: 'tenant', entityId: null, actorId: u.id, dedupeKey: `space-toggle:${tenant}:${sp}:${on}:${Date.now()}` } as never).catch(() => {});
}
