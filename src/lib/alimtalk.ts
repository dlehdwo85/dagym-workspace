import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden, notFound } from './errors';
import type { SessionUser } from './types';
import { tenantOf } from './types';

/**
 * 304차 #871 카카오 알림톡 — 대표 11/01 결정: "결제할 때·이용약관 동의할 때만", 관리자에게만, 모두 정보성.
 * - 보내는 때 5가지: 체험 종료 3일 전 · 체험 종료 당일 · 결제 완료 · 정기 결제 실패 · 가입(약관 동의) 완료
 * - 받는 사람: 그 회사 대표·관리자 중 '알림톡 안내 받기'에 동의하고 휴대폰을 적은 사람(명함 전화와 따로)
 * - 꺼짐 기본: 운영 설정(ALIMTALK_*)이 다 들어와야 켜짐. 템플릿 번호가 없는 종류는 그 종류만 안 보냄
 * - 실패해도 메일은 그대로(메일은 원래 경로로 이미 감) · 문자 대체 발송은 비용이라 끔(disableSms)
 * - 발송 업체: 솔라피(REST v4, HMAC-SHA256) — 업체 비교·추천은 docs/research/ALIMTALK_871_2026-11-01.md
 * - 보낸 기록에는 전화번호를 남기지 않음(종류·성공·사유·메시지 번호만)
 */
export type AlimKind = 'trial_d3' | 'trial_d0' | 'pay_ok' | 'pay_fail' | 'signup';
export const ALIM_KINDS: AlimKind[] = ['trial_d3', 'trial_d0', 'pay_ok', 'pay_fail', 'signup'];

/** 카카오 검수에 올릴 템플릿 초안(문서와 같은 글) — 변수는 #{이름} */
export const ALIM_TEMPLATES: Record<AlimKind, { name: string; vars: string[]; body: string }> = {
  trial_d3: {
    name: '무료 체험 종료 3일 전 안내',
    vars: ['회사명', '종료일', '남은일수'],
    body: '[워크인] 무료 체험 종료 안내\n\n#{회사명}의 워크인 무료 체험이 #{종료일}에 끝납니다(#{남은일수}일 남음).\n\n체험이 끝나면 보기와 내보내기만 할 수 있습니다. 계속 쓰시려면 관리자 화면 > 사용량·요금제에서 요금제를 골라 주세요. 데이터는 그대로 남습니다.\n\n※ 이 메시지는 알림톡 안내 받기에 동의한 관리자께만 보내는 정보성 안내입니다.',
  },
  trial_d0: {
    name: '무료 체험 종료 당일 안내',
    vars: ['회사명', '종료일'],
    body: '[워크인] 무료 체험 종료 안내\n\n#{회사명}의 워크인 무료 체험이 오늘(#{종료일}) 끝납니다.\n\n오늘이 지나면 보기와 내보내기만 할 수 있습니다. 결제하면 바로 다시 쓸 수 있고, 데이터는 지우지 않습니다.\n\n※ 이 메시지는 알림톡 안내 받기에 동의한 관리자께만 보내는 정보성 안내입니다.',
  },
  pay_ok: {
    name: '결제 완료 안내',
    vars: ['회사명', '상품', '금액', '결제일시'],
    body: '[워크인] 결제 완료 안내\n\n#{회사명}의 결제가 완료되었습니다.\n\n상품: #{상품}\n금액: #{금액}원 (VAT 포함)\n결제 일시: #{결제일시}\n\n영수증은 관리자 이메일로 보내 드렸습니다.\n\n※ 이 메시지는 알림톡 안내 받기에 동의한 관리자께만 보내는 정보성 안내입니다.',
  },
  pay_fail: {
    name: '정기 결제 실패 안내',
    vars: ['회사명', '사유', '다음시도'],
    body: '[워크인] 정기 결제 실패 안내\n\n#{회사명}의 워크인 정기 결제가 실패했습니다.\n\n사유: #{사유}\n다음 시도: #{다음시도}\n\n등록한 카드를 확인해 주세요. 미납 7일이 지나면 보기 전용, 30일이 지나면 이용이 멈춥니다. 데이터는 지우지 않습니다.\n\n※ 이 메시지는 알림톡 안내 받기에 동의한 관리자께만 보내는 정보성 안내입니다.',
  },
  signup: {
    name: '가입·약관 동의 완료 안내',
    vars: ['이름', '회사명', '동의일시', '체험종료일'],
    body: '[워크인] 가입 완료 안내\n\n#{이름}님, 워크인 가입과 이용약관·개인정보 수집·이용 동의가 완료되었습니다.\n\n회사: #{회사명}\n동의 일시: #{동의일시}\n무료 체험: #{체험종료일}까지\n\n동의 내용은 설정 > 계정에서 언제든 확인할 수 있습니다.\n\n※ 이 메시지는 알림톡 안내 받기에 동의한 관리자께만 보내는 정보성 안내입니다.',
  },
};

type Conf = { provider: 'solapi'; apiKey: string; apiSecret: string; pfId: string; from: string | null; base: string; templates: Partial<Record<AlimKind, string>> };
export function alimtalkConf(): Conf | null {
  const e = process.env;
  if ((e.ALIMTALK_PROVIDER ?? '').toLowerCase() !== 'solapi' || !e.ALIMTALK_API_KEY || !e.ALIMTALK_API_SECRET || !e.ALIMTALK_PF_ID) return null;
  let templates: Partial<Record<AlimKind, string>> = {};
  try { const t = JSON.parse(e.ALIMTALK_TEMPLATES ?? '{}'); if (t && typeof t === 'object') templates = Object.fromEntries(ALIM_KINDS.filter((k) => typeof t[k] === 'string' && t[k]).map((k) => [k, t[k]])); } catch { /* 잘못된 값이면 템플릿 없음 = 안 보냄 */ }
  return { provider: 'solapi', apiKey: e.ALIMTALK_API_KEY, apiSecret: e.ALIMTALK_API_SECRET, pfId: e.ALIMTALK_PF_ID, from: e.ALIMTALK_FROM || null, base: (e.ALIMTALK_API_BASE || 'https://api.solapi.com').replace(/\/$/, ''), templates };
}
/** 화면용(비밀값 없음) */
export function alimtalkState() {
  const c = alimtalkConf();
  return { on: !!c, provider: c?.provider ?? null, kinds: Object.fromEntries(ALIM_KINDS.map((k) => [k, !!c?.templates[k]])) as Record<AlimKind, boolean> };
}

/** 국내 휴대폰(010·011·016·017·018·019)만 — 숫자만 남김 */
export function normalizePhone(s: string | null | undefined): string | null {
  const d = String(s ?? '').replace(/[^0-9]/g, '').replace(/^82(?=1)/, '0');
  return /^01[016789]\d{7,8}$/.test(d) ? d : null;
}
export const maskPhone = (p: string | null) => (p ? `${p.slice(0, 3)}-****-${p.slice(-4)}` : null);

async function sendSolapi(c: Conf, to: string, templateId: string, vars: Record<string, string>): Promise<{ ok: boolean; id?: string; error?: string }> {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const signature = createHmac('sha256', c.apiSecret).update(date + salt).digest('hex');
  const variables = Object.fromEntries(Object.entries(vars).map(([k, v]) => [`#{${k}}`, String(v ?? '')]));
  const message = { to, ...(c.from ? { from: c.from } : {}), type: 'ATA', kakaoOptions: { pfId: c.pfId, templateId, variables, disableSms: true } };
  try {
    const r = await fetch(`${c.base}/messages/v4/send`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { 'content-type': 'application/json', authorization: `HMAC-SHA256 apiKey=${c.apiKey}, date=${date}, salt=${salt}, signature=${signature}` },
      body: JSON.stringify({ message }),
    });
    const j = await r.json().catch(() => ({} as any));
    const code = String(j?.statusCode ?? '');
    if (!r.ok || (code && !code.startsWith('2'))) return { ok: false, error: String(j?.errorMessage ?? j?.statusMessage ?? j?.errorCode ?? `HTTP ${r.status}`).slice(0, 200) };
    return { ok: true, id: j?.messageId ?? j?.groupId ?? undefined };
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e).slice(0, 200) }; }
}

type Target = { id: string; tenant: string; phone: string };
async function deliver(t: Target, kind: AlimKind, vars: Record<string, string>, dedupeKey: string | null) {
  const sql = db(); const c = alimtalkConf();
  const templateId = c?.templates[kind];
  if (!c || !templateId) return 'off' as const;
  if (dedupeKey && (await sql`select 1 from alimtalk_logs where dedupe_key = ${dedupeKey} and user_id = ${t.id} and ok limit 1`).length) return 'dup' as const;
  const r = await sendSolapi(c, t.phone, templateId, vars);
  await sql`insert into alimtalk_logs (tenant, user_id, kind, ok, error, provider, message_id, dedupe_key) values (${t.tenant}, ${t.id}, ${kind}, ${r.ok}, ${r.error ?? null}, ${c.provider}, ${r.id ?? null}, ${dedupeKey})
    on conflict do nothing`.catch(() => {});
  if (!r.ok) await (await import('./log')).logError('alimtalk', new Error(`${kind}: ${r.error}`)).catch(() => {});
  return r.ok ? ('sent' as const) : ('failed' as const);
}

/** 회사 관리자(대표·관리자) 중 동의한 사람에게 — 실패해도 throw 하지 않음(메일은 따로 감) */
export async function alimtalkAdmins(tenant: string, kind: AlimKind, vars: Record<string, string>, dedupeKey: string | null) {
  const out = { sent: 0, failed: 0, skipped: 0 };
  try {
    if (!alimtalkConf()?.templates[kind]) return out;
    const sql = db();
    const rows = await sql<{ id: string; tenant: string; alimtalk_phone: string | null }[]>`select id, tenant, alimtalk_phone from users
      where tenant = ${tenant} and status = 'active' and role in ('owner', 'admin') and alimtalk_ok and alimtalk_phone is not null and deleted_at is null`;
    for (const u of rows) {
      const phone = normalizePhone(u.alimtalk_phone); if (!phone) { out.skipped++; continue; }
      const r = await deliver({ id: u.id, tenant: u.tenant, phone }, kind, vars, dedupeKey);
      if (r === 'sent') out.sent++; else if (r === 'failed') out.failed++; else out.skipped++;
    }
  } catch (e) { await (await import('./log')).logError('alimtalk', e).catch(() => {}); }
  return out;
}

const kst = (d: Date | string, time = true) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}) }).format(new Date(d));
export const alimDate = kst;

/** 가입(약관 동의) 완료 — 이메일 확인이 끝났을 때(소셜 가입은 바로). 동의한 본인에게만 한 번 */
export async function alimtalkSignup(userId: string) {
  try {
    if (!alimtalkConf()?.templates.signup) return;
    const sql = db();
    const [u] = await sql<any[]>`select u.id, u.tenant, u.name, u.alimtalk_phone, u.alimtalk_ok, u.role, t.name as company, s.trial_ends_at,
        (select max(c.created_at) from consents c where c.user_id = u.id and c.kind = 'terms' and c.agreed) as agreed_at
      from users u join tenants t on t.id = u.tenant left join tenant_subscriptions s on s.tenant = u.tenant where u.id = ${userId}`;
    const phone = normalizePhone(u?.alimtalk_phone);
    if (!u?.alimtalk_ok || !phone || !['owner', 'admin'].includes(u.role)) return;
    await deliver({ id: u.id, tenant: u.tenant, phone }, 'signup', { 이름: u.name, 회사명: u.company, 동의일시: kst(u.agreed_at ?? new Date()), 체험종료일: u.trial_ends_at ? kst(u.trial_ends_at, false) : '-' }, `signup:${u.id}`);
  } catch (e) { await (await import('./log')).logError('alimtalk', e).catch(() => {}); }
}

// ---------------- 관리자 본인 설정(사용량·요금제 화면 카드) ----------------
const isAdmin = (u: SessionUser) => u.role === 'owner' || u.role === 'admin';
export async function myAlimtalk(u: SessionUser) {
  if (!isAdmin(u) || u.personal) throw forbidden('회사 관리자만 설정할 수 있습니다');
  const [r] = await db()<{ alimtalk_phone: string | null; alimtalk_ok: boolean; alimtalk_ok_at: Date | null }[]>`select alimtalk_phone, alimtalk_ok, alimtalk_ok_at from users where id = ${u.id}`;
  const st = alimtalkState();
  return { service: st.on, phone: r?.alimtalk_phone ?? '', ok: !!r?.alimtalk_ok, okAt: r?.alimtalk_ok_at ?? null, canTest: !!u.platformAdmin && !u.support && st.on,
    kinds: ALIM_KINDS.map((k) => ({ kind: k, name: ALIM_TEMPLATES[k].name, ready: st.kinds[k] })) };
}
export const myAlimtalkInput = z.object({ phone: z.string().trim().max(20).nullable().optional(), ok: z.boolean() });
export async function saveMyAlimtalk(u: SessionUser, i: z.infer<typeof myAlimtalkInput>, ip: string | null) {
  if (!isAdmin(u) || u.personal) throw forbidden('회사 관리자만 설정할 수 있습니다');
  if (u.support) throw forbidden('지원 모드에서는 바꿀 수 없습니다');
  const phone = i.phone ? normalizePhone(i.phone) : null;
  if (i.phone && !phone) throw badRequest('휴대폰 번호를 확인해 주세요 (예: 010-1234-5678)');
  if (i.ok && !phone) throw badRequest('알림톡을 받으려면 휴대폰 번호를 적어 주세요');
  const sql = db();
  const [prev] = await sql<{ alimtalk_ok: boolean }[]>`select alimtalk_ok from users where id = ${u.id}`;
  await sql`update users set alimtalk_phone = ${phone}, alimtalk_ok = ${i.ok}, alimtalk_ok_at = ${i.ok ? (prev?.alimtalk_ok ? sql`alimtalk_ok_at` : sql`now()`) : null}, updated_at = now() where id = ${u.id}`;
  if (!!prev?.alimtalk_ok !== i.ok) {
    const { TERMS_VERSION } = await import('./signup');
    await sql`insert into consents (user_id, kind, version, agreed) values (${u.id}, 'alimtalk', ${TERMS_VERSION}, ${i.ok})
      on conflict (user_id, kind, version) do update set agreed = excluded.agreed, created_at = now()`; // 바뀐 이력은 감사 기록(account.alimtalk)
  }
  await (await import('./log')).audit(sql as never, u.id, 'account.alimtalk', 'user', u.id, { ok: i.ok, phone: maskPhone(phone) }, ip).catch(() => {});
  return myAlimtalk(u);
}

// ---------------- 플랫폼 운영: 상태·시험 발송 ----------------
export async function alimtalkPlatform(u: SessionUser) {
  if (!u.platformAdmin || u.support) throw notFound();
  const [s] = await db()<{ sent: number; failed: number; last_error: string | null }[]>`select count(*) filter (where ok)::int sent, count(*) filter (where not ok)::int failed,
      (select error from alimtalk_logs where not ok order by created_at desc limit 1) last_error from alimtalk_logs where created_at > now() - interval '30 days'`;
  return { ...alimtalkState(), sent30d: s?.sent ?? 0, failed30d: s?.failed ?? 0, lastError: s?.last_error ?? null };
}
export const alimtalkTestInput = z.object({ kind: z.enum(['trial_d3', 'trial_d0', 'pay_ok', 'pay_fail', 'signup']) });
/** 운영자 본인 휴대폰(알림톡 동의)으로 예시 값 1건 — 같은 안내 막기(dedupe) 없이, 기록은 남김 */
export async function alimtalkTest(u: SessionUser, i: z.infer<typeof alimtalkTestInput>) {
  if (!u.platformAdmin || u.support) throw notFound();
  const c = alimtalkConf();
  if (!c) throw badRequest('알림톡 운영 설정(ALIMTALK_*)이 아직 없습니다');
  if (!c.templates[i.kind]) throw badRequest(`'${ALIM_TEMPLATES[i.kind].name}' 템플릿 번호가 아직 없습니다(ALIMTALK_TEMPLATES)`);
  const [me] = await db()<{ alimtalk_phone: string | null; alimtalk_ok: boolean }[]>`select alimtalk_phone, alimtalk_ok from users where id = ${u.id}`;
  const phone = normalizePhone(me?.alimtalk_phone);
  if (!me?.alimtalk_ok || !phone) throw badRequest('사용량·요금제 화면에서 내 휴대폰과 알림톡 받기 동의를 먼저 저장해 주세요');
  const now = new Date();
  const sample: Record<AlimKind, Record<string, string>> = {
    trial_d3: { 회사명: '시험 회사', 종료일: kst(new Date(now.getTime() + 3 * 864e5), false), 남은일수: '3' },
    trial_d0: { 회사명: '시험 회사', 종료일: kst(now, false) },
    pay_ok: { 회사명: '시험 회사', 상품: '스탠다드 1개월', 금액: '49,500', 결제일시: kst(now) },
    pay_fail: { 회사명: '시험 회사', 사유: '카드 한도 초과(시험)', 다음시도: kst(new Date(now.getTime() + 3 * 864e5), false) },
    signup: { 이름: u.name, 회사명: '시험 회사', 동의일시: kst(now), 체험종료일: kst(new Date(now.getTime() + 14 * 864e5), false) },
  };
  const r = await deliver({ id: u.id, tenant: tenantOf(u), phone }, i.kind, sample[i.kind], null);
  const [last] = await db()<{ ok: boolean; error: string | null }[]>`select ok, error from alimtalk_logs where user_id = ${u.id} order by id desc limit 1`;
  return { result: r, to: maskPhone(phone), error: r === 'failed' ? last?.error ?? null : null };
}
