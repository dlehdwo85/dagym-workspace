import { INDUSTRY_PRESETS } from './industries';
import { z } from 'zod';
import { db, type Sql } from './db';
import { HttpError, badRequest, notFound } from './errors';
import { hashPassword, newToken, sha256 } from './crypto';
import { audit } from './log';
import { appUrl, mailConfigured, mailDevMode, sendMail } from './mail';
import { ensurePersonalCalendar } from './access';

/**
 * V15 공개 가입: 이메일+비밀번호 → 확인 메일 → 로그인. "개인으로 시작"(1인 공간) / "팀(회사)으로 시작".
 * 가입하면 새 회사(tenant)가 생기고 가입한 사람이 그 회사의 대표(owner). 다른 회사 데이터는 서버에서 전부 막힌다.
 * PUBLIC_SIGNUP=1 일 때만 열린다(회사 간 분리 시험 통과 후 운영에서 켬).
 */
export const signupEnabled = () => process.env.PUBLIC_SIGNUP === '1';
export const TERMS_VERSION = '2026-10-21';

export const signupInput = z.object({
  email: z.string().trim().toLowerCase().email('이메일 형식이 아닙니다').max(200),
  password: z.string().min(8, '비밀번호는 8자 이상').max(200),
  name: z.string().trim().min(1, '이름을 입력하세요').max(50),
  mode: z.enum(['personal', 'team']),
  company: z.string().trim().max(60).optional(),
  agree: z.object({ terms: z.literal(true, { errorMap: () => ({ message: '이용약관에 동의해 주세요' }) }), age14: z.literal(true, { errorMap: () => ({ message: '만 14세 이상만 가입할 수 있습니다' }) }), privacy: z.literal(true, { errorMap: () => ({ message: '개인정보 처리방침에 동의해 주세요' }) }), ai: z.boolean().default(false), marketing: z.boolean().default(false), ads: z.boolean().default(false) }),
  /** 봇 방지: 사람에게 안 보이는 칸(채워져 있으면 봇) · 화면을 연 시각(너무 빨리 제출하면 봇) */
  website: z.string().max(200).optional(),
  openedAt: z.number().optional(),
  /** 유입 경로(첫 방문 UTM) — 마케팅 퍼널 집계용, 개인정보 아님 */
  utm: z.object({ source: z.string().max(80), medium: z.string().max(80), campaign: z.string().max(120) }).partial().optional(),
  /** V29 가입 2단계: 인원 규모·업종(선택) */
  size: z.enum(['1', '2-10', '11-30', '31-100', '100+']).optional(),
  industry: z.string().trim().max(40).optional(),
  /** 대표 10/20: 추가 업종(여러 개) */
  industries: z.array(z.string().trim().max(40)).max(5).optional(),
});
export const SIZE_LABEL: Record<string, string> = { '1': '혼자', '2-10': '2~10명', '11-30': '11~30명', '31-100': '31~100명', '100+': '100명 넘게' };

type OwnerSpace = { email: string; name: string; mode: 'personal' | 'team'; company?: string; size?: string; industry?: string; industries?: string[]; utm?: Record<string, string | undefined>;
  agree: Record<string, boolean>; passwordHash: string | null; pending: boolean; ip: string | null; workEmail?: string | null };
/** 새 회사(또는 개인 공간) + 대표 계정 + 기본 조직·달력·동의 기록 — 이메일 가입·소셜 가입 공통 */
export async function createOwnerSpace(tx: Sql, i: OwnerSpace) {
  const tenant = `t_${newToken(9).replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 12)}`;
  const orgName = i.mode === 'personal' ? `${i.name}의 공간` : i.company!;
  const utm = i.utm && Object.values(i.utm).some(Boolean) ? i.utm : null;
  const inds = [...new Set([i.industry, ...(i.industries ?? [])].map((x) => (x ?? '').trim()).filter(Boolean))];
  await tx`insert into tenants (id, name, kind, created_ip, signup_utm, size_band, industry, industries) values (${tenant}, ${orgName}, ${i.mode === 'personal' ? 'personal' : 'company'}, ${i.ip},
    ${utm ? tx.json(utm as never) : null}, ${i.size ?? null}, ${inds[0] ?? null}, ${inds})`;
  // 17차: 무료 요금제 대신 14일 무료 체험(비즈니스 기능 전부, 카드 없음)
  await tx`insert into tenant_subscriptions (tenant, plan_code, status, trial_ends_at, period_end)
    values (${tenant}, 'trial', 'trial', now() + interval '14 days', (now() + interval '14 days')::date)`;
  const [u] = await tx<{ id: string }[]>`insert into users (email, name, role, status, password_hash, tenant, signup_pending, email_verified_at, work_email)
    values (${i.email}, ${i.name}, 'owner', 'active', ${i.passwordHash}, ${tenant}, ${i.pending}, ${i.pending ? null : new Date()}, ${i.workEmail ?? null}) returning id`;
  await tx`update tenants set owner_user_id = ${u.id} where id = ${tenant}`;
  const [o] = await tx<{ id: string }[]>`insert into org_units (type, name, sort, tenant) values ('hq', ${orgName}, 0, ${tenant}) returning id`;
  await tx`insert into memberships (user_id, org_unit_id) values (${u.id}, ${o.id})`;
  await tx`insert into calendars (type, org_unit_id, name, color, tenant) values ('org_unit', ${o.id}, ${orgName + ' 일정'}, '#475569', ${tenant})`;
  if (i.mode === 'team') await tx`insert into calendars (type, name, color, tenant) values ('company', ${i.company + ' 공용'}, '#0F766E', ${tenant})`;
  // 상용화: AI 비서는 빈 상태에서 이 회사 기준으로 — 회사 정보(상호) 1건 + 업종별 시작 템플릿(다른 회사 데이터는 복사하지 않음)
  if (i.mode === 'team') await tx`insert into company_profiles (tenant, key, name, is_default, updated_by) values (${tenant}, 'main', ${i.company!}, true, ${u.id}) on conflict do nothing`;
  for (const s of (i.industry && INDUSTRY_PRESETS[i.industry]?.starters) || []) {
    await tx`insert into templates (name, description, payload, org_unit_id, created_by, personal, tenant)
      values (${s.name}, ${s.description}, ${tx.json({ title: s.name, checklist: s.checklist, ...(s.dueInDays !== undefined ? { dueInDays: s.dueInDays } : {}) } as never)}, null, ${u.id}, false, ${tenant})`;
  }
  await ensurePersonalCalendar(u.id, i.name, tx);
  for (const [kind, agreed] of Object.entries(i.agree)) await tx`insert into consents (user_id, kind, version, agreed) values (${u.id}, ${kind}, ${TERMS_VERSION}, ${agreed})`;
  await audit(tx, u.id, 'auth.signup', 'user', u.id, { mode: i.mode, tenant, social: !i.passwordHash }, i.ip);
  return u.id;
}

const LIMIT = { ipPerHour: Number(process.env.SIGNUP_IP_PER_HOUR ?? 10), ipSignupsPerDay: Number(process.env.SIGNUP_IP_PER_DAY ?? 3), totalPerDay: Number(process.env.SIGNUP_TOTAL_PER_DAY ?? 300) };
const GENERIC = '확인 메일을 보냈습니다. 메일의 링크를 누르면 가입이 끝납니다(24시간 유효).';

async function attempt(sql: Sql, ip: string | null, email: string, ok: boolean, reason: string | null) {
  await sql`insert into signup_attempts (ip, email, ok, reason) values (${ip}, ${email}, ${ok}, ${reason})`;
}

async function issueVerification(sql: Sql, userId: string, email: string) {
  const token = newToken();
  await sql`insert into email_verifications (token_hash, user_id, expires_at) values (${sha256(token)}, ${userId}, now() + interval '24 hours')`;
  const link = `${appUrl()}/verify/${token}`;
  const r = await sendMail(email, '[워크인] 이메일 확인', `워크인 가입을 마치려면 아래 링크를 눌러 주세요 (24시간 유효).\n\n${link}\n\n본인이 가입하지 않았다면 이 메일을 무시하세요.`);
  return r === 'dev' ? `/verify/${token}` : undefined;
}

export async function signup(i: z.infer<typeof signupInput>, ip: string | null) {
  if (!signupEnabled()) throw notFound();
  if (!mailConfigured() && !mailDevMode()) throw new HttpError(503, 'mail_not_configured', '지금은 가입을 받을 수 없습니다(메일 발송 준비 중). 잠시 후 다시 시도해 주세요.');
  const sql = db();
  // 봇: 조용히 성공처럼 응답(아무것도 만들지 않음)
  if (i.website || (i.openedAt && Date.now() - i.openedAt < 2500)) { await attempt(sql, ip, i.email, false, 'bot'); return { ok: true, message: GENERIC }; }
  const [{ h }] = await sql<{ h: number }[]>`select count(*)::int h from signup_attempts where ip is not distinct from ${ip} and created_at > now() - interval '1 hour'`;
  const [{ d }] = await sql<{ d: number }[]>`select count(*)::int d from signup_attempts where ip is not distinct from ${ip} and ok and created_at > now() - interval '1 day'`;
  const [{ t }] = await sql<{ t: number }[]>`select count(*)::int t from signup_attempts where ok and created_at > now() - interval '1 day'`;
  if (h >= LIMIT.ipPerHour || d >= LIMIT.ipSignupsPerDay || t >= LIMIT.totalPerDay) {
    await attempt(sql, ip, i.email, false, 'rate');
    throw new HttpError(429, 'too_many', '가입 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (i.mode === 'team' && !i.company) throw badRequest('회사(팀) 이름을 입력하세요');
  const [ex] = await sql<{ id: string; signup_pending: boolean }[]>`select id, signup_pending from users where lower(email) = ${i.email}`;
  if (ex) {
    // 이미 있는 이메일: 가입 대기 중이면 확인 메일만 다시, 아니면 같은 안내(가입 여부를 드러내지 않음)
    await attempt(sql, ip, i.email, false, 'exists');
    const devLink = ex.signup_pending ? await issueVerification(sql, ex.id, i.email) : undefined;
    return { ok: true, message: GENERIC, ...(devLink ? { devLink } : {}) };
  }
  const hash = await hashPassword(i.password);
  const userId = await sql.begin((tx) => createOwnerSpace(tx, { email: i.email, name: i.name, mode: i.mode, company: i.company, size: i.size, industry: i.industry, industries: i.industries, utm: i.utm, agree: i.agree, passwordHash: hash, pending: true, ip }));
  await attempt(sql, ip, i.email, true, null);
  const { recordStep } = await import('./funnel');
  const [{ tenant }] = await sql<{ tenant: string }[]>`select tenant from users where id = ${userId}`;
  await recordStep('submitted', { tenant }, sql);
  const devLink = await issueVerification(sql, userId, i.email);
  return { ok: true, message: GENERIC, ...(devLink ? { devLink } : {}) };
}

/** 확인 링크 → 가입 완료. 로그인 세션은 호출한 라우트에서 만든다 */
export async function verifyEmail(token: string) {
  const sql = db();
  return sql.begin(async (tx) => {
    const [v] = await tx<{ user_id: string; expires_at: Date; used_at: Date | null }[]>`select user_id, expires_at, used_at from email_verifications where token_hash = ${sha256(token)} for update`;
    if (!v || v.used_at || v.expires_at < new Date()) throw badRequest('링크가 만료되었거나 이미 사용되었습니다. 로그인 화면에서 확인 메일을 다시 받으세요.');
    await tx`update email_verifications set used_at = now() where token_hash = ${sha256(token)}`;
    const [u] = await tx<{ id: string; status: string }[]>`update users set signup_pending = false, email_verified_at = now() where id = ${v.user_id} returning id, status`;
    if (!u || u.status !== 'active') throw badRequest('사용할 수 없는 계정입니다');
    await audit(tx, u.id, 'auth.email_verified', 'user', u.id, {}, null);
    const [own] = await tx<{ id: string }[]>`select id from tenants where owner_user_id = ${u.id}`;
    if (own) await (await import('./funnel')).recordStep('verified', { tenant: own.id }, tx as unknown as Sql);
    return u.id;
  });
}

/** 확인 메일 다시 받기 (가입 대기 중인 계정만, 응답은 항상 같음) */
export async function resendVerification(email: string, ip: string | null) {
  if (!signupEnabled()) throw notFound();
  const sql = db();
  const [{ h }] = await sql<{ h: number }[]>`select count(*)::int h from signup_attempts where ip is not distinct from ${ip} and created_at > now() - interval '1 hour'`;
  if (h >= LIMIT.ipPerHour) throw new HttpError(429, 'too_many', '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  await attempt(sql, ip, email, false, 'resend');
  const [u] = await sql<{ id: string }[]>`select id from users where lower(email) = ${email} and signup_pending and status = 'active'`;
  const devLink = u ? await issueVerification(sql, u.id, email) : undefined;
  return { ok: true, message: GENERIC, ...(devLink ? { devLink } : {}) };
}
