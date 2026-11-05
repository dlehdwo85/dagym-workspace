import { z } from 'zod';
import { db, type Sql } from './db';
import { HttpError, badRequest, notFound } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/**
 * 359차(대표 11/04 저녁 결정 #965): 승인제 가입.
 * - 공개 가입(이메일·소셜 4종)으로 새 회사가 생기면 '승인 대기'(tenants.signup_status = pending) — 체험은 아직 시작하지 않음(trial_ends_at 없음)
 * - 승인 대기 회사는 로그인하면 '가입 신청이 접수됐습니다. 24시간 안에 연락드립니다' 화면, 서버는 쓰기·초대를 막음(plans.assertWritable)
 * - 슈퍼관리자(플랫폼 운영)가 [승인] → 14일 체험 시작 = 승인 시각 · 환영 메일 / [거절](사유) → 안내 메일, 로그인하면 거절 안내만
 * - 그대로: 초대받은 직원 가입(기존 회사에 들어감) · 이미 승인된 회사 · 플랫폼 [고객사 추가] · 입찰 메일 구독(/landing/bid-alerts)
 * 스위치: SIGNUP_APPROVAL=0 이면 예전처럼 바로 시작(시험 서버 기본값 — 승인 시험만 1)
 */
export const signupApprovalOn = () => process.env.SIGNUP_APPROVAL !== '0';
export const PENDING_TEXT = '가입 신청이 접수됐습니다. 24시간 안에 연락드립니다.';
export type SignupVia = 'email' | 'google' | 'kakao' | 'naver' | 'apple';
export type SignupInfo = { company: string | null; name: string; email: string; contact: string | null; size: string | null; industry: string | null; industries: string[]; mode: string;
  utm: Record<string, string | undefined> | null; via: SignupVia; at: string };

/** 연락처: 국내 전화(휴대폰·일반) 숫자 9~11자리. 없으면 null */
export function contactPhone(raw: string | undefined | null) {
  const d = String(raw ?? '').replace(/[\s()-]/g, '');
  if (!d) return null;
  if (!/^0\d{8,10}$/.test(d)) throw badRequest('연락받을 전화번호를 확인해 주세요(예: 010-1234-5678)');
  return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d.startsWith('02') ? `${d.slice(0, 2)}-${d.slice(2, d.length - 4)}-${d.slice(-4)}` : `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
function mailHtml(title: string, lines: string[], button?: { label: string; url: string }) {
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:0;background:#f4f6fa">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#111827">
<tr><td style="padding:24px 24px 8px;font-size:13px;color:#0f766e;font-weight:700">워크인</td></tr>
<tr><td style="padding:0 24px 12px;font-size:20px;font-weight:700;line-height:1.4">${esc(title)}</td></tr>
<tr><td style="padding:0 24px ${button ? 16 : 24}px;font-size:15px;line-height:1.6;color:#374151">${lines.map(esc).join('<br>')}</td></tr>
${button ? `<tr><td align="center" style="padding:0 24px 24px"><a href="${esc(button.url)}" style="display:block;background:#0f766e;color:#ffffff;text-decoration:none;font-size:17px;font-weight:700;padding:16px 12px;border-radius:10px;text-align:center">${esc(button.label)}</a></td></tr>` : ''}
</table></td></tr></table></body></html>`;
}
async function mailTo(to: string, title: string, lines: string[], button?: { label: string; url: string }) {
  const { sendMail } = await import('./mail');
  const text = [title, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : [])].join('\n');
  try { await sendMail(to, `[워크인] ${title}`, text, mailHtml(title, lines, button)); return true; }
  catch (e) { await (await import('./log')).logError('signup_mail', e).catch(() => {}); return false; }
}

/** 새 신청을 슈퍼관리자에게(앱 알림·푸시 + 메일) — 회사당 한 번. 이메일 가입은 확인 링크를 누른 뒤, 소셜은 회사를 만든 바로 뒤 */
export async function notifyNewSignup(tenant: string, sql: Sql = db()) {
  if (!signupApprovalOn()) return 0;
  const [t] = await sql<{ id: string; name: string; signup_info: SignupInfo | null; owner_user_id: string | null }[]>`update tenants set signup_notified_at = now()
    where id = ${tenant} and signup_status = 'pending' and signup_notified_at is null returning id, name, signup_info, owner_user_id`;
  if (!t) return 0;
  const [ow] = t.owner_user_id ? await sql<{ signup_pending: boolean }[]>`select signup_pending from users where id = ${t.owner_user_id}` : [];
  const { platformAdminIds } = await import('./superAdmin');
  const ids = await platformAdminIds(sql);
  if (!ids.length) return 0;
  const i = t.signup_info;
  const line = [i?.company ?? t.name, i?.name, i?.size ? `${i.size}명` : null, i?.industry, i?.via && i.via !== 'email' ? `${i.via} 가입` : null].filter(Boolean).join(' · ');
  const { notify } = await import('./notifications');
  await notify(sql, { userIds: ids, type: 'signup_request', title: `새 체험 신청: ${line}`, body: '24시간 안에 연락드린다고 안내했습니다 — 플랫폼 운영 › 회사에서 [승인]·[거절]', link: '/platform?tab=company#signup-requests', actorId: null, dedupeKey: `signup:${t.id}` });
  const admins = await sql<{ email: string }[]>`select email from users where id = any(${ids}::uuid[])`;
  const { appUrl } = await import('./mail');
  for (const a of admins) await mailTo(a.email, `새 체험 신청 — ${i?.company ?? t.name}`, [
    `회사: ${i?.company ?? t.name}`, `신청한 사람: ${i?.name ?? ''} (${i?.email ?? ''})`, `연락처: ${i?.contact ?? '없음'}`,
    `인원: ${i?.size ?? '-'} · 업종: ${[i?.industry, ...(i?.industries ?? [])].filter(Boolean).join(', ') || '-'}`,
    `가입 경로: ${i?.via ?? 'email'}${i?.utm && Object.values(i.utm).some(Boolean) ? ` · 유입 ${Object.entries(i.utm).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join(' ')}` : ''}`,
    ...(ow?.signup_pending ? ['메일 주소 확인: 아직 — 승인하면 환영 메일의 링크가 메일 확인을 겸합니다'] : []),
    '신청자에게는 24시간 안에 연락드린다고 안내했습니다.'], { label: '가입 신청 보기', url: `${appUrl()}/platform?tab=company#signup-requests` });
  return ids.length;
}

/** 회사의 가입 상태(승인 대기·거절) — 화면·쓰기 막기에 씀. 승인된 회사는 null */
export async function signupGate(tenant: string, sql: Sql = db()) {
  if (tenant === 'default' || tenant === 'demo') return null;
  const [t] = await sql<{ signup_status: string; signup_reason: string | null; name: string }[]>`select signup_status, signup_reason, name from tenants where id = ${tenant}`;
  if (!t || t.signup_status === 'approved') return null;
  return { status: t.signup_status as 'pending' | 'rejected', reason: t.signup_reason, company: t.name };
}

function requirePlatform(u: SessionUser) { if (!u.platformAdmin || u.support) throw notFound(); }
async function pendingTenant(sql: Sql, tenant: string) {
  if (!/^t_[a-z0-9]{3,40}$/.test(tenant)) throw notFound('없는 신청입니다');
  const [t] = await sql<{ id: string; name: string; signup_status: string; owner_user_id: string | null }[]>`select id, name, signup_status, owner_user_id from tenants where id = ${tenant}`;
  if (!t) throw notFound('없는 신청입니다');
  return t;
}

/** [승인]: 14일 체험 시작 = 지금 · 환영 메일 · 알림톡(동의한 대표만) */
export async function approveSignup(u: SessionUser, tenant: string) {
  requirePlatform(u);
  const sql = db();
  const t = await pendingTenant(sql, tenant);
  if (t.signup_status === 'approved') throw new HttpError(409, 'already_approved', '이미 승인된 회사입니다');
  await sql.begin(async (tx) => {
    await tx`update tenants set signup_status = 'approved', signup_decided_at = now(), signup_decided_by = ${u.id}, signup_reason = null where id = ${tenant}`;
    await tx`update tenant_subscriptions set status = 'trial', trial_ends_at = now() + interval '14 days', period_end = ((now() + interval '14 days') at time zone 'Asia/Seoul')::date, trial_notified = '{}'::jsonb, updated_at = now()
      where tenant = ${tenant} and plan_code = 'trial'`;
    await audit(tx, u.id, 'signup.approve', 'tenant', null, { tenant, from: t.signup_status }, null);
  });
  (await import('./plans')).clearReadOnlyCache(tenant);
  const [o] = t.owner_user_id ? await sql<{ id: string; email: string; name: string; signup_pending: boolean }[]>`select id, email, name, signup_pending from users where id = ${t.owner_user_id}` : [];
  const [s] = await sql<{ trial_ends_at: Date | null }[]>`select trial_ends_at from tenant_subscriptions where tenant = ${tenant}`;
  const ends = s?.trial_ends_at ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' }).format(s.trial_ends_at) : null;
  let mailed = false;
  if (o) {
    const { appUrl } = await import('./mail');
    // 360차: 신청 때 메일 확인을 안 눌렀으면 [시작하기] = 메일 확인 링크(7일, 누르면 바로 로그인)
    const start = o.signup_pending ? (await (await import('./signup')).verificationLink(sql, o.id, 24 * 7)).url : `${appUrl()}/login`;
    mailed = await mailTo(o.email, '체험 신청이 승인됐습니다', [`${o.name}님, ${t.name} 워크인 체험 신청이 승인됐습니다.`, `지금부터 14일 동안 모든 기능을 쓸 수 있어요${ends ? `(${ends}까지)` : ''}.`,
      o.signup_pending ? '아래 [워크인 시작하기]를 누르면 메일 주소 확인과 로그인이 한 번에 됩니다(7일 유효).' : '로그인하면 회사 설정과 동료 초대 안내가 이어집니다.'], { label: '워크인 시작하기', url: start });
    await (await import('./alimtalk')).alimtalkSignup(o.id); // 304차 #871: 동의한 대표에게만(체험 종료일이 생긴 지금)
  }
  return { ok: true, trialEndsAt: s?.trial_ends_at ?? null, mailed };
}

export const rejectInput = z.object({ reason: z.string().trim().min(2, '거절 사유를 적어 주세요').max(300) });
/** [거절](사유): 안내 메일 · 로그인하면 거절 안내만(쓰기·보기 막힘). 다시 승인할 수 있음 */
export async function rejectSignup(u: SessionUser, tenant: string, i: z.infer<typeof rejectInput>) {
  requirePlatform(u);
  const sql = db();
  const t = await pendingTenant(sql, tenant);
  if (t.signup_status === 'approved') throw new HttpError(409, 'already_approved', '이미 승인된 회사는 거절할 수 없습니다 — 필요하면 회사 [차단]');
  await sql`update tenants set signup_status = 'rejected', signup_decided_at = now(), signup_decided_by = ${u.id}, signup_reason = ${i.reason} where id = ${tenant}`;
  await audit(sql, u.id, 'signup.reject', 'tenant', null, { tenant, reason: i.reason }, null);
  (await import('./plans')).clearReadOnlyCache(tenant);
  const [o] = t.owner_user_id ? await sql<{ email: string; name: string }[]>`select email, name from users where id = ${t.owner_user_id}` : [];
  const mailed = o ? await mailTo(o.email, '체험 신청 결과를 알려 드립니다', [`${o.name}님, ${t.name} 워크인 체험 신청을 이번에는 승인하지 못했습니다.`, `사유: ${i.reason}`,
    '궁금한 점은 워크인 소개 사이트의 [문의하기]로 남겨 주세요.']) : false;
  return { ok: true, mailed };
}
