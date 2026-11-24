import { z } from 'zod';
import { DateTime } from 'luxon';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/**
 * #1163(대표 11/24 'D-20 고객사 관리 고도화 전부 구현', 순서 ①→③→②→⑤→④→⑥) — 플랫폼 운영자(슈퍼관리자) 전용.
 * ① 고객사 목록 월 매출·다음 결제·미납(platformAdmin.tenantDirectory 가 riskOf·monthPaid 를 씀)
 * ③ 회사 타임라인 · ② 해지 위험 · ④ 여러 고객사 메일·공지 · ⑥ 환불 사유 통계(⑤ 세금계산서 상태는 billing/settlement)
 * 시험 회사(is_test)는 숫자·목록에서 기본 제외.
 */
const requireOp = (u: SessionUser) => { if (!u.platformAdmin || u.support) throw notFound(); };
const INTERNAL = ['default', 'demo'];

// ---------------- ② 해지 위험 ----------------
/** 기준값(대표 보고용): 최근 14일을 바로 앞 14일과 견줘 절반 이하로 줄면 '급감'. 앞 14일이 너무 작으면(사용자 2명·업무 5건 미만) 보지 않음 */
export const RISK_RULE = { days: 14, minPrevUsers: 2, minPrevTasks: 5, dropTo: 0.5 } as const;
export type Risk = { code: 'cancel' | 'card' | 'users' | 'tasks'; label: string };
/**
 * 회사별 해지 위험 사유. 활동 사용자 = 그 기간에 업무를 만들었거나·메신저에 글을 썼거나·로그인한 사람(중복 없이).
 * - 해지 예약(cancel_at_period_end) · 카드 결제 실패(미납 중, 또는 최근 30일 마지막 자동 결제가 실패)
 */
export async function riskOf(sql: Sql, ids: string[]): Promise<Map<string, Risk[]>> {
  const out = new Map<string, Risk[]>();
  const list = ids.filter((x) => !INTERNAL.includes(x));
  if (!list.length) return out;
  const d = RISK_RULE.days;
  const add = (t: string, r: Risk) => out.set(t, [...(out.get(t) ?? []), r]);
  const [subs, users, tasks] = await Promise.all([
    sql<{ tenant: string; cancel: boolean; next_on: string | null; past_due_since: Date | null; last_status: string | null }[]>`select s.tenant, s.cancel_at_period_end as cancel, s.next_billing_on::text as next_on, s.past_due_since,
        (select p.status from payments p where p.tenant = s.tenant and p.meta->>'billing' = 'true' and p.created_at > now() - interval '30 days' order by p.created_at desc limit 1) as last_status
      from tenant_subscriptions s where s.tenant = any(${list})`,
    sql<{ tenant: string; now: number; prev: number }[]>`with ev as (
        select o.tenant, t.created_by as uid, t.created_at as at from tasks t join org_units o on o.id = t.org_unit_id
          where o.tenant = any(${list}) and t.created_by is not null and t.created_at >= now() - make_interval(days => ${d * 2})
        union all select r.tenant, m.author_id, m.created_at from chat_messages m join chat_rooms r on r.id = m.room_id
          where r.tenant = any(${list}) and m.author_id is not null and m.created_at >= now() - make_interval(days => ${d * 2})
        union all select us.tenant, a.actor_id, a.created_at from audit_logs a join users us on us.id = a.actor_id
          where a.action = 'auth.login' and us.tenant = any(${list}) and a.created_at >= now() - make_interval(days => ${d * 2}))
      select tenant, count(distinct uid) filter (where at >= now() - make_interval(days => ${d}))::int as now,
        count(distinct uid) filter (where at < now() - make_interval(days => ${d}))::int as prev from ev group by tenant`,
    sql<{ tenant: string; now: number; prev: number }[]>`select o.tenant, count(*) filter (where t.created_at >= now() - make_interval(days => ${d}))::int as now,
        count(*) filter (where t.created_at < now() - make_interval(days => ${d}))::int as prev
      from tasks t join org_units o on o.id = t.org_unit_id where o.tenant = any(${list}) and t.created_at >= now() - make_interval(days => ${d * 2}) group by o.tenant`,
  ]);
  for (const s of subs) {
    if (s.cancel) add(s.tenant, { code: 'cancel', label: `해지 예약${s.next_on ? `(${s.next_on.slice(0, 10)}에 끝)` : ''}` });
    if (s.past_due_since) add(s.tenant, { code: 'card', label: `카드 결제 실패 — 미납 ${Math.max(0, Math.floor((Date.now() - new Date(s.past_due_since).getTime()) / 86_400_000))}일` });
    else if (s.last_status === 'failed') add(s.tenant, { code: 'card', label: '최근 자동 결제 실패' });
  }
  for (const r of users) if (r.prev >= RISK_RULE.minPrevUsers && r.now <= r.prev * RISK_RULE.dropTo) add(r.tenant, { code: 'users', label: `활동 사용자 ${r.prev}명 → ${r.now}명(최근 ${d}일, 앞 ${d}일과 비교)` });
  for (const r of tasks) if (r.prev >= RISK_RULE.minPrevTasks && r.now <= r.prev * RISK_RULE.dropTo) add(r.tenant, { code: 'tasks', label: `업무 만들기 ${r.prev}건 → ${r.now}건(최근 ${d}일, 앞 ${d}일과 비교)` });
  return out;
}

// ---------------- ③ 회사 타임라인 ----------------
export const TIMELINE_KINDS = { pay: '결제', refund: '환불', consult: '상담 신청', space: '공간', contact: '연락', memo: '메모', plan: '요금제', cancel: '해지 예약' } as const;
type TlKind = keyof typeof TIMELINE_KINDS;
const AUDIT_KIND: Record<string, TlKind> = {
  'billing.refund': 'refund', 'platform.tenant_spaces': 'space', 'space.plan_open': 'space', 'space.plan_lock': 'space', 'platform.mkt_billing': 'space',
  'platform.tenant_memo': 'memo', 'platform.subscription': 'plan', 'billing.subscribed': 'plan', 'platform.billing_stop': 'plan', 'platform.partner_set': 'plan',
  'platform.tenant_discount': 'plan', 'platform.plan_trial': 'plan', 'billing.canceled': 'cancel', 'billing.resumed': 'cancel',
};
const won = (n: unknown) => `${Number(n ?? 0).toLocaleString('ko-KR')}원`;
const SPACE = (x: unknown) => (Array.isArray(x) ? x : x ? [x] : []).map((s) => (s === 'sales' ? '영업' : s === 'marketing' ? '마케팅' : String(s))).join('·');
function auditTitle(action: string, d: Record<string, any>): string {
  switch (action) {
    case 'billing.refund': return `환불 ${won(d.amount)}${d.reason ? ` · 사유 ${d.reason}` : ''}${d.reverted ? ' · 요금제 되돌림' : ''}`;
    case 'platform.tenant_spaces': return `공간 바꿈${d.spaces ? ` → 업무${SPACE((d.spaces as string[]).filter((s) => s !== 'work')) ? `·${SPACE((d.spaces as string[]).filter((s) => s !== 'work'))}` : ''}` : ''}`;
    case 'space.plan_open': return `${SPACE(d.space ?? d.spaces) || '공간'} 열림(결제)`;
    case 'space.plan_lock': return `${SPACE(d.space ?? d.spaces) || '공간'} 잠김(결제 끝)`;
    case 'platform.mkt_billing': return d.planCode ? `마케팅 요금제 ${d.planCode} 결제에 합침` : '마케팅 요금제 결제에서 뺌';
    case 'platform.tenant_memo': return `운영 메모 바꿈${d.memo ? ` — ${String(d.memo).slice(0, 60)}` : ''}`;
    case 'platform.subscription': return `요금제 ${d.planCode ?? ''}(${d.status ?? ''}) 운영자가 정함`;
    case 'billing.subscribed': return `정기결제 시작 ${d.plan ?? ''} ${d.amount ? won(d.amount) : ''}`.trim();
    case 'platform.billing_stop': return `정기결제 멈춤${d.removeCard ? ' · 카드 지움' : ''}${d.toTrial ? ' · 체험으로' : ''}${d.reason ? ` — ${d.reason}` : ''}`;
    case 'platform.partner_set': return `설계 파트너 지정${d.days ? ` ${d.days}일` : ''}`;
    case 'platform.tenant_discount': return Number(d.pct) > 0 ? `할인 ${d.pct}%${d.until ? ` ~${d.until}` : ''}` : '할인 해제';
    case 'billing.canceled': return '해지 예약(다음 결제일에 끝)';
    case 'billing.resumed': return '해지 예약 취소';
    default: return action;
  }
}
const KIND_PAY: Record<string, string> = { subscription: '월 구독', annual: '연간', addon: '팩', live_smoke: '실결제 시험' };
const PAY_ST: Record<string, string> = { paid: '성공', pending: '대기', failed: '실패', canceled: '취소', partial_canceled: '부분 취소', vbank_ready: '입금 대기' };
const CONTACT: Record<string, string> = { call: '전화', mail: '메일', meeting: '미팅', kakao: '카카오톡', memo: '메모' };

export async function companyTimeline(u: SessionUser, tenant: string, kinds?: string | null) {
  requireOp(u);
  const sql = db();
  if (!(await sql`select 1 from tenants where id = ${tenant}`).length) throw notFound('없는 회사입니다');
  const want = new Set((kinds ?? '').split(',').map((x) => x.trim()).filter((x): x is TlKind => x in TIMELINE_KINDS));
  const on = (k: TlKind) => !want.size || want.has(k);
  const actions = Object.entries(AUDIT_KIND).filter(([, k]) => on(k)).map(([a]) => a);
  const [pays, audits, consults, contacts] = await Promise.all([
    on('pay') ? sql<any[]>`select id, kind, plan_code, addon_code, amount, status, canceled_amount, coalesce(paid_at, created_at) as at from payments where tenant = ${tenant} order by created_at desc limit 100` : [],
    actions.length ? sql<any[]>`select a.action, a.detail, a.created_at as at, ac.name as by from audit_logs a left join users ac on ac.id = a.actor_id
        where a.action = any(${actions}) and (a.tenant = ${tenant} or a.detail->>'tenant' = ${tenant} or (a.target_type = 'tenant' and a.target_id = ${tenant}))
        order by a.created_at desc limit 200` : [],
    on('consult') ? sql<any[]>`select c.spaces, c.memo, c.status, c.created_at as at, us.name as by from space_consults c left join users us on us.id = c.user_id where c.tenant = ${tenant} order by c.created_at desc limit 50` : [],
    on('contact') || on('memo') ? sql<any[]>`select l.kind, l.summary, l.at, l.next_at::text, us.name as by from tenant_contact_logs l left join users us on us.id = l.created_by where l.tenant = ${tenant} order by l.at desc limit 100` : [],
  ]);
  type Item = { at: string; kind: TlKind; title: string; by: string | null; ref?: string | null };
  const items: Item[] = [];
  for (const p of pays) items.push({ at: new Date(p.at).toISOString(), kind: 'pay', ref: p.id, by: null,
    title: `${KIND_PAY[p.kind] ?? p.kind} ${p.plan_code ?? p.addon_code ?? ''} ${won(p.amount)} · ${PAY_ST[p.status] ?? p.status}${Number(p.canceled_amount) > 0 ? `(취소 ${won(p.canceled_amount)})` : ''}`.replace(/\s+/g, ' ') });
  for (const a of audits) items.push({ at: new Date(a.at).toISOString(), kind: AUDIT_KIND[a.action], title: auditTitle(a.action, a.detail ?? {}), by: a.by ?? null });
  for (const c of consults) items.push({ at: new Date(c.at).toISOString(), kind: 'consult', by: c.by ?? null,
    title: `${SPACE(c.spaces) || '공간'} 상담 신청 · ${({ requested: '대기', opened: '열어 줌', closed: '닫음' } as Record<string, string>)[c.status] ?? c.status}${c.memo ? ` — ${String(c.memo).slice(0, 60)}` : ''}` });
  for (const l of contacts) {
    const k: TlKind = l.kind === 'memo' ? 'memo' : 'contact';
    if (!on(k)) continue;
    items.push({ at: new Date(l.at).toISOString(), kind: k, by: l.by ?? null, title: `${CONTACT[l.kind] ?? l.kind} — ${String(l.summary).slice(0, 120)}${l.next_at ? ` · 다음 ${l.next_at.slice(0, 10)}` : ''}` });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  return { kinds: TIMELINE_KINDS, items: items.slice(0, 300) };
}

// ---------------- ⑥ 환불 사유 ----------------
export const REFUND_REASONS = { customer: '고객 요청', duplicate: '중복 결제', unhappy: '서비스 불만', test: '시험', other: '기타' } as const;
export type RefundReason = keyof typeof REFUND_REASONS;
/** 예전 기록(사유 고르기 전)은 글로 나눔: '시험'이 들어 있으면 시험, 아니면 기타 */
export const refundCodeOf = (d: { reasonCode?: string | null; reason?: string | null }): RefundReason =>
  d.reasonCode && d.reasonCode in REFUND_REASONS ? (d.reasonCode as RefundReason) : /시험/.test(d.reason ?? '') ? 'test' : 'other';
export const refundStatsQuery = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), hideTest: z.enum(['0', '1']).optional() });
export async function refundStats(u: SessionUser, f: z.infer<typeof refundStatsQuery> = {}) {
  requireOp(u);
  const sql = db(); const hideTest = f.hideTest !== '0';
  const today = DateTime.now().setZone('Asia/Seoul');
  const from = f.from ?? today.minus({ months: 6 }).startOf('month').toISODate()!; const to = f.to ?? today.toISODate()!;
  const rows = await sql<{ at: Date; detail: any; is_test: boolean }[]>`select a.created_at as at, a.detail, t.is_test from audit_logs a
      join payments p on p.id::text = a.target_id join tenants t on t.id = p.tenant
    where a.action = 'billing.refund' and a.created_at >= (${from}::date::timestamp at time zone 'Asia/Seoul') and a.created_at < ((${to}::date + 1)::timestamp at time zone 'Asia/Seoul')
      and (${!hideTest} or not t.is_test) order by a.created_at`;
  const by: Record<string, { code: RefundReason; label: string; count: number; amount: number }> = {};
  const months: Record<string, { month: string; count: number; amount: number }> = {};
  const others: { at: string; reason: string; amount: number }[] = [];
  for (const r of rows) {
    const code = refundCodeOf(r.detail ?? {}); const amt = Number(r.detail?.amount ?? 0);
    (by[code] ??= { code, label: REFUND_REASONS[code], count: 0, amount: 0 }); by[code].count++; by[code].amount += amt;
    const m = DateTime.fromJSDate(new Date(r.at)).setZone('Asia/Seoul').toFormat('yyyy-MM');
    (months[m] ??= { month: m, count: 0, amount: 0 }); months[m].count++; months[m].amount += amt;
    if (code === 'other' && r.detail?.reason) others.push({ at: new Date(r.at).toISOString(), reason: String(r.detail.reason).slice(0, 100), amount: amt });
  }
  const reasons = (Object.keys(REFUND_REASONS) as RefundReason[]).map((c) => by[c] ?? { code: c, label: REFUND_REASONS[c], count: 0, amount: 0 });
  return { from, to, hideTest, total: { count: rows.length, amount: reasons.reduce((s, r) => s + r.amount, 0) }, reasons, months: Object.values(months), others: others.slice(-30).reverse() };
}

// ---------------- ④ 여러 고객사 메일·공지 ----------------
/**
 * 받는 사람 = 고른 회사의 대표·관리자(사용 중). 시험 회사·우리 회사는 늘 뺌.
 * - 메일: 하루 상한(SEND_CAP_BROADCAST, 기본 300통 — 상용화 B5 와 같은 생각, 운영자가 보내는 묶음 메일만 셈).
 *   광고성(새 기능·혜택 소개 등)이면 제목 앞 '(광고)' + 수신 동의한 사람만 + 아래에 수신 거부 방법(정보통신망법 제50조).
 * - 공지: 앱 알림함으로만(메일·알림톡 없음). 금액·결제 권유는 넣지 않는다(앱 결제 정책 — 302차 #861 과 같음).
 * - 미리 보기(send = false)로 받는 회사·사람 수와 실제 문구를 먼저 보여 준다. 받는 메일 주소는 기록에 남기지 않는다.
 */
export const broadcastInput = z.object({
  tenants: z.array(z.string().min(1).max(80)).min(1).max(500),
  channel: z.enum(['mail', 'notice']),
  ad: z.boolean().default(false),
  title: z.string().trim().min(2).max(80),
  body: z.string().trim().min(2).max(4000),
  send: z.boolean().default(false),
});
export const broadcastCap = () => { const n = Number(process.env.SEND_CAP_BROADCAST); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300; };
const MONEY = /\d[\d,]*\s*(원|만원|만 원)|₩\s*\d|결제|요금|가격|구독료/;
async function sentToday(sql: Sql) {
  const day = DateTime.now().setZone('Asia/Seoul').toISODate()!;
  const [r] = await sql<{ n: number }[]>`select coalesce(sum((detail->>'sent')::int), 0)::int n from audit_logs where action = 'platform.broadcast' and detail->>'channel' = 'mail'
    and created_at >= (${day}::date::timestamp at time zone 'Asia/Seoul')`;
  return r?.n ?? 0;
}
function mailText(i: z.infer<typeof broadcastInput>) {
  const sender = process.env.COMPANY_NAME ? `${process.env.COMPANY_NAME}(워크인)` : '워크인';
  const subject = `${i.ad ? '(광고) ' : ''}[워크인] ${i.title}`;
  const foot = i.ad
    ? ['', `전송자: ${sender}`, "수신 거부: 워크인 › 설정 › '새 기능·혜택 소식(광고성 정보) 받기'를 끄면 더 이상 받지 않습니다."]
    : ['', `이 메일은 워크인을 쓰는 회사의 대표·관리자에게 보내는 서비스 안내입니다. 전송자: ${sender}`];
  return { subject, lines: [...i.body.split(/\r?\n/), ...foot] };
}
export async function broadcast(u: SessionUser, i: z.infer<typeof broadcastInput>, ip: string | null) {
  requireOp(u);
  const sql = db();
  if (i.channel === 'notice' && MONEY.test(`${i.title}\n${i.body}`)) throw badRequest('앱 알림함 공지에는 금액·결제·요금 이야기를 넣지 않습니다 — 메일로 보내 주세요');
  if (i.channel === 'notice' && i.ad) throw badRequest('광고성 내용은 앱 공지로 보내지 않습니다 — 메일(광고 표기)로 보내 주세요');
  const ts = await sql<{ id: string; name: string }[]>`select id, name from tenants where id = any(${[...new Set(i.tenants)]}) and not is_test and deleted_at is null and status <> 'deleted' and id <> all(${INTERNAL})`;
  const skippedTenants = new Set(i.tenants).size - ts.length;
  const people = ts.length ? await sql<{ id: string; email: string; tenant: string; consent: boolean | null }[]>`select u.id, u.email, u.tenant,
      (select c.agreed from consents c where c.user_id = u.id and c.kind = 'marketing' order by c.created_at desc limit 1) as consent
    from users u where u.tenant = any(${ts.map((t) => t.id)}) and u.status = 'active' and u.role in ('owner', 'admin') and u.deleted_at is null` : [];
  const to = i.channel === 'mail' && i.ad ? people.filter((p) => p.consent === true) : people;
  const noConsent = people.length - to.length;
  const cap = broadcastCap(); const today = i.channel === 'mail' ? await sentToday(sql) : 0;
  const m = mailText(i);
  const preview = { companies: ts.length, skippedTenants, recipients: to.length, noConsent, cap: i.channel === 'mail' ? cap : null, todaySent: today,
    sample: i.channel === 'mail' ? { subject: m.subject, text: m.lines.join('\n') } : { title: i.title, body: i.body } };
  if (!i.send) return { preview, sent: null };
  if (!to.length) throw badRequest('받을 사람이 없습니다');
  if (i.channel === 'mail' && today + to.length > cap) throw badRequest(`오늘 묶음 메일 한도(${cap}통)를 넘습니다 — 오늘 ${today}통 보냄, 이번 ${to.length}통. 받는 회사를 줄이거나 내일 보내 주세요`);
  if (i.channel === 'notice') {
    const N = await import('./notifications');
    await N.notify(sql, { userIds: to.map((p) => p.id), type: 'announcement', title: i.title, body: i.body.slice(0, 500), link: '/notifications', actorId: null,
      dedupeKey: `broadcast:${DateTime.now().toMillis()}:${i.title.slice(0, 40)}` });
    await audit(sql, u.id, 'platform.broadcast', null, null, { channel: 'notice', ad: false, title: i.title, companies: ts.length, tenants: ts.map((t) => t.id), sent: to.length }, ip);
    return { preview, sent: to.length };
  }
  // 상한은 보내기 전에 잡아 둔다(같은 날 두 번 눌러도 넘지 않게) — 실제 발송은 응답 뒤(수백 통이면 함수 시간이 길어짐), 실패 수는 끝난 뒤 기록
  await audit(sql, u.id, 'platform.broadcast', null, null, { channel: 'mail', ad: i.ad, title: i.title, companies: ts.length, tenants: ts.map((t) => t.id), sent: to.length, noConsent }, ip);
  const emails = to.map((p) => p.email);
  const { runLater } = await import('./later');
  runLater('platform_broadcast', async () => {
    const { sendFramedMail } = await import('./mail');
    let ok = 0, failed = 0;
    for (const e of emails) { try { await sendFramedMail(e, i.title, m.lines, undefined, m.subject); ok++; } catch { failed++; } }
    await audit(db(), u.id, 'platform.broadcast_done', null, null, { title: i.title, ok, failed }, null);
    return { ok, failed };
  });
  return { preview, sent: to.length };
}
