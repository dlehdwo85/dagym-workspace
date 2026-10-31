import { z } from 'zod';
import { DateTime } from 'luxon';
import { db, type Sql } from '../db';
import { decrypt, encrypt, newToken } from '../crypto';
import { HttpError, badRequest, notFound } from '../errors';
import { audit, logError } from '../log';
import { notify } from '../notifications';
import { tenantOf, type SessionUser } from '../types';
import { TERMS_VERSION } from '../signup';
import { EASY_PAYS, approveAuth, approveBilling, cancelPayment, easyPaysOn, npConf, npLiveConf, npTestConf, parseNiceForm, registerBillKey, removeBillKey, windowParams, type NpConf } from './nicepay';

/**
 * 18차 결제(나이스페이). 금액은 VAT 별도 요금 × 1.1 (원 단위 반올림).
 * - 정기(월): 카드 빌키로 매달 자동 승인. 실패하면 1·3·5일 뒤 재시도, 첫 실패 7일 뒤 읽기 전용(expired).
 * - 연간·팩: 결제창(인증결제) 단건. 연간은 1년 뒤 같은 카드로 갱신(카드가 없으면 만료).
 * - 해지: 다음 결제일에 끝(그때 읽기 전용). 데이터는 지우지 않는다.
 */
const TZ = 'Asia/Seoul';
const today = () => DateTime.now().setZone(TZ).toISODate()!;
const VAT = 1.1;
const conf = () => { const c = npConf(); if (!c) throw new HttpError(503, 'billing_off', '결제가 아직 설정되지 않았습니다(NICEPAY 환경변수)'); return c; };
/** V32 1: 결제 시험 회사의 결제는 늘 시험 상점으로(운영이 live 여도) */
const confFor = (p: { meta?: { test?: boolean; liveSmoke?: boolean } | null }) => {
  if (p.meta?.liveSmoke) { const c = npLiveConf(); if (!c) throw new HttpError(503, 'billing_off', '실 상점 키가 없습니다'); return c; } // V36 8 실결제 소액 시험
  return p.meta?.test ? npTestConf() : conf();
};
const moid = (kind: string) => `WK${kind[0].toUpperCase()}${DateTime.now().setZone(TZ).toFormat('yyMMddHHmmss')}${newToken(6).replace(/[^A-Za-z0-9]/g, '').slice(0, 6)}`;

async function requireBillingAdmin(u: SessionUser) {
  const t = tenantOf(u);
  if (t === 'default' || t === 'demo') throw notFound(); // 우리 회사(내부 요금제)·체험 조직은 결제 없음
  if (!['owner', 'admin'].includes(u.role)) throw new HttpError(403, 'forbidden', '결제는 공간 대표·관리자만 할 수 있습니다');
  return t;
}

/** 요금 견적: 1인 요금 × max(최소 인원, 활성 인원) — 월 또는 연간(12개월), VAT 포함 */
export async function quote(tenant: string, planCode: string, cycle: 'monthly' | 'annual', sql: Sql = db()) {
  const [p] = await sql<any[]>`select code, name, monthly_krw, per_user_krw, annual_monthly_krw, annual_per_user_krw, min_users from plans
    where code = ${planCode} and public and active and code not in ('trial', 'free', 'team_free', 'w_free')`;
  if (!p) throw badRequest('결제할 수 없는 요금제입니다');
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from users where tenant = ${tenant} and status = 'active'`;
  const seats = p.per_user_krw ? Math.max(p.min_users ?? 1, n) : 1;
  const unit = cycle === 'annual' ? (p.per_user_krw ? p.annual_per_user_krw ?? p.per_user_krw : p.annual_monthly_krw ?? p.monthly_krw) : (p.per_user_krw ?? p.monthly_krw);
  // V27(대표 10/17): 30인 이상 10% 할인
  const list = Math.round(unit * seats * (cycle === 'annual' ? 12 : 1) * (p.per_user_krw && seats >= 30 ? 0.9 : 1));
  // #656 회사별 할인(플랫폼 운영자가 건 것, 기한 안) — 공급가에 적용. 다음 결제부터 반영
  const [ds] = await sql<{ discount_pct: number; discount_until: string | null }[]>`select discount_pct, to_char(discount_until, 'YYYY-MM-DD') as discount_until from tenant_subscriptions where tenant = ${tenant}`;
  const discountPct = ds && Number(ds.discount_pct) > 0 && (!ds.discount_until || ds.discount_until >= today()) ? Number(ds.discount_pct) : 0;
  const supply = Math.round(list * (1 - discountPct / 100));
  return { plan: p, seats, unit, supply, listSupply: list, discountPct, amount: Math.round(supply * VAT), cycle, goodsName: `Workin ${p.code} ${cycle}` };
}

export async function billingOverview(u: SessionUser) {
  // 점검 2026-10-16 ⑥: 우리 회사·체험 조직은 404 대신 "결제 없음"(화면 콘솔 오류 방지)
  if (['default', 'demo'].includes(tenantOf(u))) return { enabled: false, internal: true };
  const t = await requireBillingAdmin(u);
  const sql = db();
  const [[card], [sub], payments, plans, addons, [consent]] = await Promise.all([
    sql`select card_name, card_last4, created_at from billing_cards where tenant = ${t} and removed_at is null`,
    sql`select plan_code, status, billing_cycle, next_billing_on, billing_amount, cancel_at_period_end, past_due_since, next_retry_on, trial_ends_at, billing_lock, billing_grace_until from tenant_subscriptions where tenant = ${t}`,
    sql`select id, kind, plan_code, addon_code, amount, status, canceled_amount, result_msg, card_name, card_no, paid_at, created_at, tid, meta->>'payMethod' as pay_method, meta->>'easyPay' as easy_pay, meta->'vbank' as vbank from payments where tenant = ${t} order by created_at desc limit 30`,
    sql<{ code: string }[]>`select code from plans where public and active and code not in ('trial', 'free', 'team_free', 'w_free') order by sort`,
    sql`select code, name, monthly_krw from plan_addons where active order by sort`,
    sql`select plan_code, amount_krw, cycle, created_at from billing_consents where tenant = ${t} order by created_at desc limit 1`, // V34-B 마지막 정기결제 동의
  ]);
  const quotes = [];
  for (const p of plans) for (const cy of ['monthly', 'annual'] as const) { const q = await quote(t, p.code, cy, sql); quotes.push({ planCode: p.code, name: q.plan.name, cycle: cy, seats: q.seats, supply: q.supply, amount: q.amount }); }
  return { enabled: !!npConf(), mode: npConf()?.mode ?? null, card: card ?? null, sub: sub ?? null, payments, quotes, autoRenewConsent: consent ?? null, addons: addons.map((a: any) => ({ ...a, amount: Math.round(a.monthly_krw * VAT) })),
    easyPays: easyPaysOn().map((k) => ({ key: k, label: EASY_PAYS[k].label })) /* 200차 #706 켠 간편결제만 */ };
}

export const cardInput = z.object({
  cardNo: z.string().regex(/^\d{14,16}$/, '카드번호 14~16자리 숫자'), expYear: z.string().regex(/^\d{2}$/, '유효기간 년 YY'), expMonth: z.string().regex(/^(0[1-9]|1[0-2])$/, '유효기간 월 MM'),
  idNo: z.string().regex(/^(\d{6}|\d{10})$/, '생년월일 6자리 또는 사업자번호 10자리').optional(), cardPw: z.string().regex(/^\d{2}$/, '비밀번호 앞 2자리').optional(),
});
/** 카드 등록 → 빌키. 카드번호·비밀번호는 저장하지 않고 끝 4자리만 */
export async function registerCard(u: SessionUser, i: z.infer<typeof cardInput>, ip: string | null) {
  const t = await requireBillingAdmin(u);
  const c = conf(); const sql = db();
  const r = await registerBillKey(c, { moid: moid('card'), cardNo: i.cardNo, expYear: i.expYear, expMonth: i.expMonth, idNo: i.idNo, cardPw: i.cardPw, buyerEmail: u.email });
  if (!r.ok || !r.bid) { await audit(sql, u.id, 'billing.card_failed', 'tenant', null, { tenant: t, code: r.code }, ip); throw badRequest(`카드를 등록하지 못했습니다: ${r.msg ?? r.code}`); }
  const [old] = await sql<{ bid_enc: string }[]>`select bid_enc from billing_cards where tenant = ${t} and removed_at is null`;
  await sql`insert into billing_cards (tenant, bid_enc, card_name, card_last4, card_code, registered_by) values (${t}, ${encrypt(r.bid)}, ${r.cardName ?? null}, ${i.cardNo.slice(-4)}, ${r.cardCode ?? null}, ${u.id})
    on conflict (tenant) do update set bid_enc = excluded.bid_enc, card_name = excluded.card_name, card_last4 = excluded.card_last4, card_code = excluded.card_code,
      registered_by = excluded.registered_by, created_at = now(), removed_at = null`;
  if (old) removeBillKey(c, decrypt(old.bid_enc), moid('rm')).catch(() => {}); // 예전 빌키는 나이스페이에서도 삭제
  await audit(sql, u.id, 'billing.card_registered', 'tenant', null, { tenant: t, last4: i.cardNo.slice(-4) }, ip);
  return { ok: true, card: { card_name: r.cardName ?? null, card_last4: i.cardNo.slice(-4) } };
}

async function chargeCard(sql: Sql, c: NpConf, tenant: string, kind: 'subscription' | 'annual', planCode: string, amount: number, goodsName: string, actor: string | null) {
  const [card] = await sql<{ bid_enc: string; card_name: string | null }[]>`select bid_enc, card_name from billing_cards where tenant = ${tenant} and removed_at is null`;
  if (!card) return { ok: false, msg: '등록된 카드가 없습니다', paymentId: null as string | null };
  const m = moid(kind);
  const [p] = await sql<{ id: string }[]>`insert into payments (tenant, kind, plan_code, moid, amount, created_by, meta) values (${tenant}, ${kind}, ${planCode}, ${m}, ${amount}, ${actor}, ${sql.json({ billing: true })}) returning id`;
  const r = await approveBilling(c, { bid: decrypt(card.bid_enc), moid: m, amount, goodsName });
  await sql`update payments set status = ${r.ok ? 'paid' : 'failed'}, tid = ${r.tid ?? null}, result_code = ${r.code ?? null}, result_msg = ${r.msg ?? null},
    card_name = ${r.cardName ?? card.card_name}, card_no = ${r.cardNo ?? null}, auth_code = ${r.authCode ?? null}, paid_at = ${r.ok ? new Date() : null}, updated_at = now() where id = ${p.id}`;
  if (r.ok) await sendReceipt(sql, p.id);
  return { ok: r.ok, msg: r.msg, paymentId: p.id };
}
const addPeriod = (d: string, cycle: 'monthly' | 'annual') => DateTime.fromISO(d, { zone: TZ }).plus(cycle === 'annual' ? { years: 1 } : { months: 1 }).toISODate()!;

async function activate(sql: Sql, tenant: string, planCode: string, cycle: 'monthly' | 'annual', amount: number) {
  await sql`update tenant_subscriptions set plan_code = ${planCode}, status = 'active', billing_cycle = ${cycle}, billing_amount = ${amount}, next_billing_on = ${addPeriod(today(), cycle)},
    period_start = current_date, period_end = ${addPeriod(today(), cycle)}, cancel_at_period_end = false, past_due_since = null, retry_count = 0, next_retry_on = null,
    billing_lock = null, billing_grace_until = null, updated_at = now() where tenant = ${tenant}`;
  const P = await import('../plans');
  P.clearReadOnlyCache(tenant); // B2: 결제되면 읽기 전용·이용 중지 즉시 복구
  await P.liftPartnerIfPaid(tenant, planCode, sql); // #667 설계 파트너가 결제하면 파트너 기본값(AI 월 5,000원·마케팅 크레딧 0)을 걷고 요금제 한도로
}

const PM_LABEL: Record<string, string> = { CARD: '카드', BANK: '계좌이체', VBANK: '가상계좌' };
/** V29 결제 완료 → 결제한 사람(없으면 회사 대표)에게 영수증 메일(나이스페이 영수증 링크). 실패해도 결제는 그대로 */
async function sendReceipt(sql: Sql, paymentId: string) {
  try {
    const [p] = await sql<any[]>`select p.*, t.name as tenant_name, coalesce(u.email, o.email) as email from payments p join tenants t on t.id = p.tenant
      left join users u on u.id = p.created_by left join users o on o.id = t.owner_user_id where p.id = ${paymentId} and p.status = 'paid'`;
    if (!p?.email) return;
    const pm = PM_LABEL[p.meta?.payMethod ?? 'CARD'] ?? '카드';
    const what = p.meta?.liveSmoke ? '실결제 소액 시험(1시간 뒤 자동 취소)' : p.kind === 'addon' ? `추가 팩 ${p.addon_code}` : `${p.plan_code} ${p.kind === 'annual' ? '1년' : '1개월'}`;
    const when = new Date(p.paid_at ?? Date.now()).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
    const receipt = p.tid ? `https://npg.nicepay.co.kr/issue/IssueLoader.do?TID=${encodeURIComponent(p.tid)}&type=0` : '';
    const { sendMail } = await import('../mail');
    await sendMail(p.email, `[워크인] 결제 영수증 (${p.amount.toLocaleString('ko-KR')}원)`,
      `${p.tenant_name}\n\n상품: ${what}\n금액: ${p.amount.toLocaleString('ko-KR')}원 (VAT 포함)\n결제 수단: ${pm}${p.card_name ? ` · ${p.card_name}` : ''}${p.card_no ? ` ${p.card_no}` : ''}\n결제 일시: ${when}\n주문번호: ${p.moid}${p.tid ? `\n거래번호: ${p.tid}` : ''}\n\n${receipt ? `영수증(나이스페이): ${receipt}\n` : ''}결제 내역: ${process.env.APP_URL ?? ''}/admin/usage`);
    await sql`update payments set meta = meta || ${sql.json({ receiptSentAt: new Date().toISOString() })} where id = ${p.id}`;
  } catch (e) { await logError('billing-receipt', e); }
}

/** V34-B (#282) 정기결제 별도 동의 문구 — 화면과 서버가 같은 문구를 쓰고, 동의 당시 문구·금액·주기를 billing_consents 에 남긴다 */
export function autoRenewConsentText(planName: string, amount: number, cycle: 'monthly' | 'annual') {
  return `${planName} 요금제를 ${cycle === 'monthly' ? '매월' : '매년'} ${amount.toLocaleString('ko-KR')}원(VAT 포함, 인원이 바뀌면 다음 결제부터 반영)씩 등록한 카드로 자동 결제합니다. 설정에서 언제든 해지를 예약할 수 있고, 해지하면 이미 결제한 기간까지 쓴 뒤 자동 결제가 멈춥니다.`;
}
export const subscribeInput = z.object({ planCode: z.string().max(40), consent: z.literal(true, { errorMap: () => ({ message: '자동 결제 조건에 동의해 주세요' }) }) });
/** 월 구독 시작(또는 요금제 변경): 등록한 카드로 바로 첫 달 결제 */
export async function subscribeMonthly(u: SessionUser, i: z.infer<typeof subscribeInput>, ip: string | null) {
  const t = await requireBillingAdmin(u);
  const c = conf(); const sql = db();
  const q = await quote(t, i.planCode, 'monthly', sql);
  const r = await chargeCard(sql, c, t, 'subscription', i.planCode, q.amount, q.goodsName, u.id);
  if (!r.ok) throw badRequest(`결제하지 못했습니다: ${r.msg ?? '카드사 거절'}`);
  await activate(sql, t, i.planCode, 'monthly', q.amount);
  await sql`insert into billing_consents (tenant, user_id, plan_code, amount_krw, cycle, text, terms_version, ip) values (${t}, ${u.id}, ${i.planCode}, ${q.amount}, 'monthly', ${autoRenewConsentText(q.plan.name, q.amount, 'monthly')}, ${TERMS_VERSION}, ${ip})`;
  await audit(sql, u.id, 'billing.subscribed', 'tenant', null, { tenant: t, plan: i.planCode, amount: q.amount, consent: true }, ip);
  return { ok: true, amount: q.amount, paymentId: r.paymentId };
}

const payMethod = z.enum(['CARD', 'BANK', 'VBANK']).default('CARD');
// 200차 #706: 간편결제 직접 호출(easyPay) — 나이스페이 결제창이 생략되므로 결제 대행 약관 동의(agree)가 있어야 열림
const easy = { easyPay: z.enum(['naverpay', 'kakaopay', 'tosspay']).optional(), agree: z.boolean().optional() };
export const windowInput = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('annual'), planCode: z.string().max(40), payMethod, ...easy }),
  z.object({ kind: z.literal('addon'), addonCode: z.string().max(40), payMethod, ...easy }),
  // V29: 첫 결제·요금제 변경을 결제창으로(카드 등록 없이) — 다음 달부터 자동 결제는 카드 등록 필요
  z.object({ kind: z.literal('monthly'), planCode: z.string().max(40), payMethod, ...easy }),
]);
/** 200차 #706 간편결제 직접 호출 때 우리 화면에서 받는 결제 대행 약관 동의(나이스페이 공개 약관) — 결제 기록 meta 에 문구·시각을 남김 */
export const EASY_PAY_TERMS = '나이스페이(나이스정보통신) 전자금융거래 기본약관·개인정보처리방침에 동의하고 간편결제 창을 바로 엽니다';
/** 연간·팩: 결제창 파라미터(서명 포함) — 결제 기록은 대기(pending)로 먼저 남긴다 */
export async function startWindow(u: SessionUser, i: z.infer<typeof windowInput>, origin: string) {
  const t = await requireBillingAdmin(u);
  return openWindow(t, u, i, origin, conf(), false);
}
/** 결제창 열기(회사 관리자 · V32 1 플랫폼 시험). 취소 때 되돌릴 수 있게 결제 전 구독 상태를 함께 남긴다 */
async function openWindow(t: string, u: SessionUser, i: z.infer<typeof windowInput>, origin: string, c: NpConf, test: boolean) {
  const sql = db();
  // 플랫폼 결제 시험(test)은 켜기 전 확인용이라 NICEPAY_EASY_PAY 와 관계없이 열 수 있음
  if (i.easyPay && !test && !easyPaysOn().includes(i.easyPay)) throw badRequest(`${EASY_PAYS[i.easyPay].label}는 아직 열리지 않았습니다`);
  if (i.easyPay && !i.agree) throw badRequest('간편결제는 결제 대행 약관(나이스페이)에 동의해야 열 수 있습니다');
  let amount: number, goodsName: string, plan: string | null = null, addon: string | null = null;
  if (i.kind === 'annual' || i.kind === 'monthly') { const q = await quote(t, i.planCode, i.kind, sql); amount = q.amount; goodsName = q.goodsName; plan = i.planCode; }
  else {
    const [a] = await sql<{ code: string; monthly_krw: number }[]>`select code, monthly_krw from plan_addons where code = ${i.addonCode} and active`;
    if (!a) throw badRequest('없는 팩입니다');
    amount = Math.round(a.monthly_krw * VAT); goodsName = `Workin pack ${a.code}`; addon = a.code;
  }
  const kind = i.kind === 'monthly' ? 'subscription' : i.kind;
  const m = moid(kind);
  const [prev] = await sql`select plan_code, status, billing_cycle, billing_amount, next_billing_on::text, period_start::text, period_end::text, trial_ends_at, addons from tenant_subscriptions where tenant = ${t}`;
  const [pay] = await sql<{ id: string }[]>`insert into payments (tenant, kind, plan_code, addon_code, moid, amount, created_by, meta)
    values (${t}, ${kind}, ${plan}, ${addon}, ${m}, ${amount}, ${u.id}, ${sql.json({ window: true, payMethod: i.easyPay ? 'CARD' : i.payMethod, prev: prev ?? null, ...(test ? { test: true } : {}),
      ...(i.easyPay ? { easyPay: i.easyPay, easyPayAgree: { text: EASY_PAY_TERMS, at: new Date().toISOString(), by: u.id } } : {}) } as never)}) returning id`;
  const base = process.env.APP_URL || origin;
  return { paymentId: pay.id, mode: c.mode, script: 'https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js', params: windowParams(c, { moid: m, amount, goodsName, returnUrl: `${base}/api/billing/nicepay/return`, buyerEmail: u.email, payMethod: i.payMethod, easyPay: i.easyPay }) };
}
/** V32 1 플랫폼: 결제 시험 회사로 결제창(시험 상점 강제) */
export async function platformTestWindow(u: SessionUser, tenant: string, i: z.infer<typeof windowInput>, origin: string) {
  if (!u.platformAdmin || u.support) throw notFound();
  const [t] = await db()<{ is_test: boolean }[]>`select is_test from tenants where id = ${tenant} and deleted_at is null`;
  if (!t?.is_test) throw badRequest('결제 시험 회사에서만 열 수 있습니다');
  return openWindow(tenant, u, i, origin, npTestConf(), true);
}

/**
 * V36 8 실결제 소액 시험(대표 승인): 플랫폼 운영자 + 결제 시험 회사 + 100원 고정 + 확인 문구 + 하루 3회. 실 상점 MID 로 결제창을 열고,
 * 요금제는 바꾸지 않으며 승인 1시간 뒤 정기 실행이 자동 취소한다(시험 결제 자동 취소와 같은 경로). 감사 기록.
 */
export const LIVE_SMOKE_AMOUNT = 100;
export const liveSmokeInput = z.object({ confirm: z.string(), payMethod: z.enum(['CARD', 'BANK']).default('CARD'), easyPay: easy.easyPay /* 200차 #706 실 상점에서 간편결제 창이 열리는지 확인(켜기 전) */ });
export async function platformLiveSmoke(u: SessionUser, tenant: string, i: z.infer<typeof liveSmokeInput>, origin: string, ip: string | null) {
  if (!u.platformAdmin || u.support) throw notFound();
  if (i.confirm.trim() !== '실결제 100원') throw badRequest('확인 문구 "실결제 100원"을 그대로 입력하세요');
  const sql = db();
  const [t] = await sql<{ is_test: boolean }[]>`select is_test from tenants where id = ${tenant} and deleted_at is null`;
  if (!t?.is_test) throw badRequest('결제 시험 회사에서만 열 수 있습니다');
  const c = npLiveConf();
  if (!c) throw new HttpError(503, 'billing_off', '실 상점 키(NICEPAY_PAY_MID/KEY)가 없습니다');
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from payments where meta->>'liveSmoke' = 'true' and created_at > now() - interval '1 day'`;
  if (n >= 3) throw new HttpError(429, 'too_many', '실결제 소액 시험은 하루 3번까지입니다');
  const m = moid('addon');
  const [pay] = await sql<{ id: string }[]>`insert into payments (tenant, kind, moid, amount, created_by, meta)
    values (${tenant}, 'addon', ${m}, ${LIVE_SMOKE_AMOUNT}, ${u.id}, ${sql.json({ window: true, payMethod: i.easyPay ? 'CARD' : i.payMethod, liveSmoke: true, ...(i.easyPay ? { easyPay: i.easyPay } : {}) } as never)}) returning id`;
  await audit(sql, u.id, 'platform.live_smoke_started', 'payment', pay.id, { tenant, amount: LIVE_SMOKE_AMOUNT, mid: c.mid }, ip);
  const base = process.env.APP_URL || origin;
  return { paymentId: pay.id, mode: c.mode, script: 'https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js',
    params: windowParams(c, { moid: m, amount: LIVE_SMOKE_AMOUNT, goodsName: 'Workin live smoke', returnUrl: `${base}/api/billing/nicepay/return`, buyerEmail: u.email, payMethod: i.payMethod, easyPay: i.easyPay }) };
}

/** 전체 취소된 결제가 요금제를 바꿨다면 결제 전 상태로 되돌림 */
async function revertPlan(sql: Sql, p: any) {
  const prev = p.meta?.prev;
  if (!prev) return false;
  if (p.meta?.liveSmoke) return false; // 요금제를 바꾸지 않았으므로 되돌릴 것 없음
  if (p.kind === 'addon' && p.addon_code) {
    await sql`update tenant_subscriptions set addons = jsonb_set(addons, ${[p.addon_code]}, to_jsonb(greatest(coalesce((addons->>${p.addon_code})::int, 0) - 1, 0))), updated_at = now() where tenant = ${p.tenant}`;
  } else {
    await sql`update tenant_subscriptions set plan_code = ${prev.plan_code}, status = ${prev.status}, billing_cycle = ${prev.billing_cycle}, billing_amount = ${prev.billing_amount},
      next_billing_on = ${prev.next_billing_on}, period_start = ${prev.period_start}, period_end = ${prev.period_end}, trial_ends_at = ${prev.trial_ends_at}, updated_at = now() where tenant = ${p.tenant}`;
  }
  (await import('../plans')).clearReadOnlyCache(p.tenant);
  return true;
}

async function applyPaid(sql: Sql, p: { id: string; tenant: string; kind: string; plan_code: string | null; addon_code: string | null; amount: number; meta?: { liveSmoke?: boolean } | null }) {
  if (p.meta?.liveSmoke) return; // 실결제 소액 시험: 요금제·팩 반영 없음(1시간 뒤 자동 취소)
  if (p.kind === 'annual' && p.plan_code) await activate(sql, p.tenant, p.plan_code, 'annual', p.amount);
  if (p.kind === 'subscription' && p.plan_code) await activate(sql, p.tenant, p.plan_code, 'monthly', p.amount); // 결제창 월 결제(빌링 결제는 여기로 오지 않음)
  if (p.kind === 'addon' && p.addon_code) {
    await sql`update tenant_subscriptions set addons = jsonb_set(addons, ${[p.addon_code]}, to_jsonb(coalesce((addons->>${p.addon_code})::int, 0) + 1)), updated_at = now() where tenant = ${p.tenant}`;
  }
}

/** 결제창 → 인증 응답(나이스페이가 브라우저로 POST). 승인 후 결제 화면으로 돌려보낸다 */
export async function handleReturn(raw: string) {
  const a = parseNiceForm(raw);
  const sql = db();
  const [p] = await sql<any[]>`select * from payments where moid = ${a.Moid ?? ''}`;
  if (!p) return { ok: false, msg: '주문을 찾을 수 없습니다' };
  if (p.status === 'paid') return { ok: true, msg: '이미 결제되었습니다' }; // 새로고침·중복 제출
  if (p.status !== 'pending') return { ok: false, msg: '처리할 수 없는 주문입니다' };
  const c = confFor(p);
  const r = await approveAuth(c, a, p.amount);
  // 가상계좌: 계좌 발급만 된 상태 — 입금 통보(4110)가 오면 결제 완료
  if (r.ok && 'vbank' in r && r.vbank) {
    await sql`update payments set tid = ${r.tid ?? null}, result_code = ${r.code ?? null}, result_msg = '입금 대기', meta = meta || ${sql.json({ payMethod: 'VBANK', vbank: r.vbank })}, updated_at = now() where id = ${p.id} and status = 'pending'`;
    return { ok: true, vbank: true, msg: `${r.vbank.bank} ${r.vbank.num} 으로 입금하면 바로 적용됩니다`, paymentId: p.id as string, test: !!(p.meta?.test || p.meta?.liveSmoke) };
  }
  const upd = await sql`update payments set status = ${r.ok ? 'paid' : 'failed'}, tid = ${('tid' in r ? r.tid : a.TxTid) ?? null}, result_code = ${r.code ?? null}, result_msg = ${r.msg ?? null},
    card_name = ${('cardName' in r ? r.cardName : null) ?? null}, card_no = ${('cardNo' in r ? r.cardNo : null) ?? null}, auth_code = ${('authCode' in r ? r.authCode : null) ?? null},
    paid_at = ${r.ok ? new Date() : null}, meta = meta || ${sql.json({ payMethod: ('payMethod' in r ? r.payMethod : 'CARD') ?? 'CARD' })}, updated_at = now() where id = ${p.id} and status = 'pending' returning id`;
  if (r.ok && upd.length) { await applyPaid(sql, p); await sendReceipt(sql, p.id); }
  return { ok: r.ok, vbank: false, msg: r.msg, paymentId: p.id as string, test: !!(p.meta?.test || p.meta?.liveSmoke) };
}

const NOTI_IPS = ['121.133.126.10', '121.133.126.11', '211.33.136.39'];
/**
 * 결제통보(웹훅). 통보에는 서명이 없으므로 ① 운영 모드는 나이스페이 발신 IP 만 ② 우리 주문번호·금액·상점 아이디가 맞을 때만 반영 ③ (TID, 상태) 로 한 번만.
 * 성공 응답은 "OK".
 */
export async function handleNotification(raw: string, ip: string | null) {
  const c = npConf();
  const a = parseNiceForm(raw);
  if (c?.mode === 'live' && (!ip || !NOTI_IPS.includes(ip))) throw new HttpError(403, 'forbidden', 'not allowed');
  // 빈·형식이 다른 요청(주소 확인 등)은 운영자 알림 없이 로그만
  if (!(a.MOID ?? a.Moid) || !a.TID) { console.warn('[nicepay-noti] 형식이 다른 요청 무시', ip); return 'OK'; }
  const sql = db();
  const amount = Number(a.Amt ?? 0);
  const state = a.StateCd ?? '0';
  const ins = await sql`insert into payment_notifications (tid, moid, state, result_code, amount, payload) values (${a.TID ?? null}, ${a.MOID ?? a.Moid ?? null}, ${state}, ${a.ResultCode ?? null}, ${amount},
    ${sql.json(Object.fromEntries(Object.entries(a).filter(([k]) => !/CardNo|BuyerAuthNum/i.test(k))) as never)}) on conflict (tid, state) do nothing returning id`;
  if (!ins.length) return 'OK'; // 같은 통보 재전송
  const [p] = await sql<any[]>`select * from payments where moid = ${a.MOID ?? a.Moid ?? ''}`;
  const tc = npTestConf();
  const lc = npLiveConf();
  const midOk = p?.meta?.liveSmoke ? (!!lc && a.MID === lc.mid) : p?.meta?.test ? (a.MID === tc.mid || a.MID === tc.billingMid) : (!c || a.MID === c.mid || a.MID === c.billingMid);
  if (!p || !midOk || p.amount !== amount) { await logError('nicepay-noti', new Error(`맞지 않는 통보: moid=${a.MOID} amt=${amount}`)); return 'OK'; }
  await sql`update payment_notifications set matched = true where id = ${ins[0].id}`;
  // 카드 3001 · 계좌이체 4000 · 가상계좌 입금 4110
  if (state === '0' && ['3001', '4000', '4110'].includes(a.ResultCode ?? '') && p.status === 'pending') {
    const msg = a.ResultCode === '4110' ? '가상계좌 입금 확인' : '결제통보로 확인';
    const upd = await sql`update payments set status = 'paid', tid = ${a.TID ?? p.tid}, auth_code = ${a.AuthCode ?? null}, paid_at = now(), result_msg = ${msg}, updated_at = now() where id = ${p.id} and status = 'pending' returning id`;
    if (upd.length) { await applyPaid(sql, p); await sendReceipt(sql, p.id); }
  } else if ((state === '1' || state === '2') && p.status === 'paid') {
    await sql`update payments set status = 'canceled', canceled_amount = amount, updated_at = now() where id = ${p.id}`;
  }
  return 'OK';
}

/** 해지(다음 결제일에 종료) / 해지 취소 */
export async function setAutoRenew(u: SessionUser, renew: boolean, ip: string | null) {
  const t = await requireBillingAdmin(u);
  const sql = db();
  await sql`update tenant_subscriptions set cancel_at_period_end = ${!renew}, updated_at = now() where tenant = ${t}`;
  await audit(sql, u.id, renew ? 'billing.resumed' : 'billing.canceled', 'tenant', null, { tenant: t }, ip);
  return { ok: true };
}

/**
 * 정기 실행: 결제일 도래 → 자동 결제. V28 B2 미납 처리(던닝):
 * 실패 즉시 관리자 알림·메일 → 3일·7일 뒤 재시도 → 첫 실패 7일 지나도 미납이면 읽기 전용(보기·내보내기·결제만) → 30일 미납이면 이용 중지(로그인해도 결제 안내만).
 * 결제되면 즉시 복구(activate·자동 결제 성공). 플랫폼 운영자가 준 유예(billing_grace_until) 동안은 잠그지 않는다. 데이터는 지우지 않는다.
 */
export async function billingJob() {
  const c = npConf();
  const sql = db();
  const d = today();
  const due = await sql<any[]>`select s.*, t.name from tenant_subscriptions s join tenants t on t.id = s.tenant
    where s.billing_cycle is not null and s.status = 'active' and t.deleted_at is null and not t.is_test
      and ((s.past_due_since is null and s.next_billing_on <= ${d}) or (s.past_due_since is not null and s.next_retry_on <= ${d}))`;
  let charged = 0, failed = 0, ended = 0, locked = 0;
  const admins = async (t: string) => sql<{ id: string; email: string }[]>`select id, email from users where tenant = ${t} and status = 'active' and role in ('owner','admin')`;
  const tell = async (t: string, name: string, title: string, body: string, key: string) => {
    const a = await admins(t);
    // 298차 #861: 알림함·푸시(앱에도 뜸)에는 결제 권유 없이 — 결제 안내·웹 주소는 관리자 이메일로만
    await notify(sql, { userIds: a.map((x) => x.id), type: 'usage_alert', title, body: '자세한 안내를 관리자 이메일로 보냈습니다. 데이터는 그대로 남아 있습니다.', link: '/admin/usage', dedupeKey: key });
    const { sendMail } = await import('../mail');
    for (const x of a) await sendMail(x.email, `[워크인] ${title}`, `${name}\n${body}\n${process.env.APP_URL ?? ''}/admin/usage`).catch(() => {});
  };
  for (const s of due) {
    if (s.cancel_at_period_end) {
      await sql`update tenant_subscriptions set status = 'expired', billing_cycle = null, updated_at = now() where tenant = ${s.tenant}`;
      (await import('../plans')).clearReadOnlyCache(s.tenant); ended++;
      await tell(s.tenant, s.name, '구독이 해지되어 읽기 전용이 되었습니다', '다시 결제하면 바로 쓸 수 있어요', `bill-end:${s.tenant}:${d}`);
      continue;
    }
    if (!c) continue;
    const q = await quote(s.tenant, s.plan_code, s.billing_cycle, sql).catch(() => null);
    const amount = q?.amount ?? s.billing_amount;
    const r = await chargeCard(sql, c, s.tenant, s.billing_cycle === 'annual' ? 'annual' : 'subscription', s.plan_code, amount, q?.goodsName ?? `Workin ${s.plan_code}`, null);
    if (r.ok) {
      await sql`update tenant_subscriptions set next_billing_on = ${addPeriod(s.next_billing_on ? DateTime.fromJSDate(new Date(s.next_billing_on)).setZone(TZ).toISODate()! : d, s.billing_cycle)},
        billing_amount = ${amount}, past_due_since = null, retry_count = 0, next_retry_on = null, billing_lock = null, billing_grace_until = null, updated_at = now() where tenant = ${s.tenant}`;
      (await import('../plans')).clearReadOnlyCache(s.tenant);
      charged++;
      continue;
    }
    failed++;
    const first = s.past_due_since ? DateTime.fromJSDate(new Date(s.past_due_since)).setZone(TZ) : DateTime.now().setZone(TZ);
    const n = s.past_due_since ? s.retry_count + 1 : 0; // 0 = 결제일 실패, 1 = 3일 재시도, 2 = 7일 재시도
    const nextDay = [3, 7][n]; // 첫 실패 기준 3일·7일 뒤
    await sql`update tenant_subscriptions set past_due_since = ${first.toJSDate()}, retry_count = ${n}, next_retry_on = ${nextDay ? first.plus({ days: nextDay }).toISODate() : null}, updated_at = now() where tenant = ${s.tenant}`;
    await tell(s.tenant, s.name, '구독 결제에 실패했습니다',
      `${r.msg ?? '카드사 거절'} — ${nextDay ? `${first.plus({ days: nextDay }).toFormat('M/d')}에 다시 시도합니다. ` : ''}카드를 확인해 주세요. 미납 7일이 지나면 읽기 전용, 30일이 지나면 이용이 중지됩니다(데이터는 그대로).`, `bill-fail:${s.tenant}:${d}`);
  }
  // 미납 단계 올리기: 7일 → 읽기 전용, 30일 → 이용 중지 (유예 중이면 건너뜀)
  const late = await sql<any[]>`select s.tenant, s.past_due_since, s.billing_lock, t.name from tenant_subscriptions s join tenants t on t.id = s.tenant
    where s.past_due_since is not null and t.deleted_at is null and (s.billing_grace_until is null or s.billing_grace_until < now())`;
  for (const s of late) {
    const days = DateTime.now().diff(DateTime.fromJSDate(new Date(s.past_due_since)), 'days').days;
    const want = days >= 30 ? 'suspended' : days >= 7 ? 'read_only' : null;
    if (!want || want === s.billing_lock || (s.billing_lock === 'suspended' && want === 'read_only')) continue;
    await sql`update tenant_subscriptions set billing_lock = ${want}, updated_at = now() where tenant = ${s.tenant}`;
    (await import('../plans')).clearReadOnlyCache(s.tenant); locked++;
    await tell(s.tenant, s.name, want === 'suspended' ? '30일 미납으로 워크인 이용이 중지되었습니다' : '7일 미납으로 보기만 할 수 있습니다',
      want === 'suspended' ? '관리자가 결제하면 바로 다시 쓸 수 있습니다. 데이터는 지우지 않았습니다.' : '보기·내보내기는 됩니다. 결제하면 바로 복구됩니다(30일 미납이면 이용 중지).', `bill-lock:${s.tenant}:${want}:${d}`);
  }
  const testCanceled = await (await import('./payTest')).autoCancelTestPayments().catch(() => 0); // V32 1 시험 결제 자동 취소
  return { due: due.length, charged, failed, ended, locked, testCanceled };
}

export const graceInput = z.object({ action: z.enum(['grace', 'unlock']), days: z.number().int().min(1).max(60).optional() });
/** 플랫폼: 미납 유예 연장(그동안 잠금 풀림) · 잠금 바로 해제 */
export async function platformBillingAction(u: SessionUser, tenant: string, i: z.infer<typeof graceInput>, ip: string | null) {
  if (!u.platformAdmin || u.support) throw notFound();
  const sql = db();
  const r = i.action === 'grace'
    ? await sql`update tenant_subscriptions set billing_grace_until = now() + make_interval(days => ${i.days ?? 7}), billing_lock = null, updated_at = now() where tenant = ${tenant} returning tenant`
    : await sql`update tenant_subscriptions set billing_lock = null, updated_at = now() where tenant = ${tenant} returning tenant`;
  if (!r.length) throw notFound('없는 회사입니다');
  (await import('../plans')).clearReadOnlyCache(tenant);
  await audit(sql, u.id, `platform.billing_${i.action}`, 'tenant', null, { tenant, days: i.days ?? null }, ip);
  return { ok: true };
}

// ---- 플랫폼 운영 ----
export async function platformPayments(u: SessionUser) {
  if (!u.platformAdmin) throw notFound();
  return { payments: await db()`select p.id, p.tenant, t.name as tenant_name, p.kind, p.plan_code, p.addon_code, p.amount, p.status, p.canceled_amount, p.result_msg, p.card_name, p.card_no, p.paid_at, p.created_at, t.is_test
    from payments p join tenants t on t.id = p.tenant order by p.created_at desc limit 200`, enabled: !!npConf(), mode: npConf()?.mode ?? null };
}
export const refundInput = z.object({ amount: z.number().int().positive().optional(), reason: z.string().trim().min(1).max(100), revertPlan: z.boolean().optional() });
/** 환불(전체·부분 취소) */
export async function refundPayment(u: SessionUser, id: string, i: z.infer<typeof refundInput>, ip: string | null) {
  if (!u.platformAdmin) throw notFound();
  const sql = db();
  const [p] = await sql<any[]>`select * from payments where id = ${id}`;
  if (!p) throw notFound();
  const c = confFor(p);
  if (!['paid', 'partial_canceled'].includes(p.status) || !p.tid) throw badRequest('환불할 수 있는 결제가 아닙니다');
  const left = p.amount - p.canceled_amount;
  const amt = i.amount ?? left;
  if (amt > left) throw badRequest(`환불 가능 금액은 ${left}원입니다`);
  const r = await cancelPayment(c, { tid: p.tid, moid: `${p.moid}C${Date.now().toString().slice(-6)}`, amount: amt, partial: amt < p.amount, reason: i.reason, billing: p.meta?.billing === true });
  if (!r.ok) throw badRequest(`환불하지 못했습니다: ${r.msg ?? r.code}`);
  const canceled = p.canceled_amount + amt;
  await sql`update payments set canceled_amount = ${canceled}, status = ${canceled >= p.amount ? 'canceled' : 'partial_canceled'}, updated_at = now() where id = ${id}`;
  // V32 1: 전체 취소면 요금제 원복(시험 결제는 늘, 실제 결제는 고른 경우만)
  const reverted = canceled >= p.amount && (i.revertPlan ?? !!p.meta?.test) ? await revertPlan(sql, p) : false;
  await audit(sql, u.id, 'billing.refund', 'payment', id, { tenant: p.tenant, amount: amt, reason: i.reason, reverted }, ip);
  return { ok: true, canceled, reverted };
}
