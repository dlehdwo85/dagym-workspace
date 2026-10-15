import { createCipheriv, createHash, randomInt } from 'node:crypto';

/**
 * 18차 NICEPAY(나이스페이) 웹API 클라이언트 — 공개 문서(developers.nicepay.co.kr) 기준.
 *  - 인증결제: 결제창(goPay) → 인증 응답 → NextAppURL 로 승인
 *  - 비인증 빌링: billing_regist(빌키 발급) · billing_approve(승인) · billkey_remove(삭제)
 *  - 취소: cancel_process (전체/부분)
 * 키는 환경변수로만(NICEPAY_*). NICEPAY_API_BASE 로 주소를 바꿀 수 있다(시험용 가짜 서버).
 */
export type NpConf = { mode: 'test' | 'live'; mid: string; key: string; billingMid: string; billingKey: string; base: string; cancelBase: string };
// 나이스페이 공개 시험 상점(결제창 nictest00m · 빌링 nictest04m) — 실제 청구되지 않음(당일 자동 취소). 값이 다르면 NICEPAY_TEST_* 로 덮어씀
const PUBLIC_TEST = { payMid: 'nictest00m', payKey: 'EYzu8jGGMfqaDEp76gSckuvnaHHu+bC4opsSN6lHv3b2lurNYkVXrZ7Z1AoqQnXI3eLuaUFyoRNC6FkrzVjceg==',
  billMid: 'nictest04m', billKey: 'b+zhZ4yOZ7FsH8pm5lhDfHZEb79tIwnjsdA0FBXh86yLc6BJeFVrZFXhAoJ3gEWgrWwN+lJMV0W4hvDdbe4Sjw==' };
export function npConf(): NpConf | null {
  // V29: 결제창 MID(walkin001m) = NICEPAY_PAY_MID/KEY, 빌링 MID(walkin002m) = NICEPAY_BILL_MID/KEY — 예전 이름(NICEPAY_MID·MERCHANT_KEY·BILLING_*)도 읽음
  const mid = process.env.NICEPAY_PAY_MID || process.env.NICEPAY_MID, key = process.env.NICEPAY_PAY_KEY || process.env.NICEPAY_MERCHANT_KEY;
  const billingMid = process.env.NICEPAY_BILL_MID || process.env.NICEPAY_BILLING_MID || mid, billingKey = process.env.NICEPAY_BILL_KEY || process.env.NICEPAY_BILLING_KEY || key;
  if (!mid || !key || !billingMid || !billingKey) return null; // 실제 키가 들어와야 결제 칸이 열림(준비 신호)
  const base = (process.env.NICEPAY_API_BASE ?? 'https://webapi.nicepay.co.kr').replace(/\/$/, '');
  const cancelBase = (process.env.NICEPAY_API_BASE ?? 'https://pg-api.nicepay.co.kr').replace(/\/$/, '');
  if (process.env.NICEPAY_MODE === 'live') return { mode: 'live', mid, key, billingMid, billingKey, base, cancelBase };
  // 2026-10-16 로컬 요청: 시험 모드는 실제 MID·키를 절대 쓰지 않는다 — 공개 시험 상점(또는 NICEPAY_TEST_*)으로만. 실 키는 그대로 두고 NICEPAY_MODE=live 로만 전환
  return npTestConf();
}
/** V32 1: 시험 상점 설정 — 운영(live)이어도 결제 시험 회사는 늘 이것만 쓴다(실 MID·키를 쓰지 않음) */
export function npTestConf(): NpConf {
  const base = (process.env.NICEPAY_API_BASE ?? 'https://webapi.nicepay.co.kr').replace(/\/$/, '');
  const cancelBase = (process.env.NICEPAY_API_BASE ?? 'https://pg-api.nicepay.co.kr').replace(/\/$/, '');
  return { mode: 'test', base, cancelBase,
    mid: process.env.NICEPAY_TEST_PAY_MID || PUBLIC_TEST.payMid, key: process.env.NICEPAY_TEST_PAY_KEY || PUBLIC_TEST.payKey,
    billingMid: process.env.NICEPAY_TEST_BILL_MID || PUBLIC_TEST.billMid, billingKey: process.env.NICEPAY_TEST_BILL_KEY || PUBLIC_TEST.billKey };
}
export const npEnabled = () => !!npConf();

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** YYYYMMDDHHMISS (서울) */
export function ediDate(d = new Date()) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)!.value;
  return `${g('year')}${g('month')}${g('day')}${g('hour') === '24' ? '00' : g('hour')}${g('minute')}${g('second')}`;
}
/** 빌링 TID: MID(10) + 01(카드) + 16(빌링) + YYMMDDHHMISS(12) + 랜덤 4 */
export const billingTid = (mid: string) => `${mid}0116${ediDate().slice(2)}${String(randomInt(0, 10000)).padStart(4, '0')}`;
/** 카드정보 암호화: AES128/ECB/PKCS5, 키 = MerchantKey 앞 16자리, Hex */
export function encCard(key: string, plain: string) {
  const c = createCipheriv('aes-128-ecb', Buffer.from(key.slice(0, 16), 'utf8'), null);
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex');
}

async function post(url: string, form: Record<string, string>): Promise<Record<string, string>> {
  const body = new URLSearchParams({ ...form, CharSet: 'utf-8', EdiType: 'JSON' }).toString();
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 30_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: ctl.signal });
    const text = await r.text();
    try { return JSON.parse(text); } catch { return { ResultCode: 'HTTP', ResultMsg: `응답을 읽을 수 없습니다 (${r.status})` }; }
  } finally { clearTimeout(t); }
}

/** 빌키 발급 (F100 성공). 카드 정보는 이 함수 밖으로 나가지 않는다 */
export async function registerBillKey(c: NpConf, i: { moid: string; cardNo: string; expYear: string; expMonth: string; idNo?: string; cardPw?: string; buyerEmail?: string }) {
  const edi = ediDate();
  const plain = `CardNo=${i.cardNo}&ExpYear=${i.expYear}&ExpMonth=${i.expMonth}&IDNo=${i.idNo ?? ''}&CardPw=${i.cardPw ?? ''}`;
  const r = await post(`${c.base}/webapi/billing/billing_regist.jsp`, { MID: c.billingMid, EdiDate: edi, Moid: i.moid, EncData: encCard(c.billingKey, plain),
    SignData: sha(c.billingMid + edi + i.moid + c.billingKey), ...(i.buyerEmail ? { BuyerEmail: i.buyerEmail } : {}) });
  return { ok: r.ResultCode === 'F100', code: r.ResultCode, msg: r.ResultMsg, bid: r.BID, cardName: r.CardName, cardCode: r.CardCode, tid: r.TID };
}
/** 빌키 승인 (3001 성공) */
export async function approveBilling(c: NpConf, i: { bid: string; moid: string; amount: number; goodsName: string; buyerEmail?: string }) {
  const edi = ediDate();
  const tid = billingTid(c.billingMid);
  const r = await post(`${c.base}/webapi/billing/billing_approve.jsp`, { BID: i.bid, TID: tid, MID: c.billingMid, EdiDate: edi, Moid: i.moid, Amt: String(i.amount), GoodsName: i.goodsName,
    SignData: sha(c.billingMid + edi + i.moid + String(i.amount) + i.bid + c.billingKey), CardInterest: '0', CardQuota: '00', ...(i.buyerEmail ? { BuyerEmail: i.buyerEmail } : {}) });
  return { ok: r.ResultCode === '3001' && Number(r.Amt) === i.amount, code: r.ResultCode, msg: r.ResultMsg, tid: r.TID ?? tid, authCode: r.AuthCode, cardName: r.CardName, cardNo: r.CardNo, amount: Number(r.Amt ?? 0) };
}
/** 빌키 삭제 (F101 성공) */
export async function removeBillKey(c: NpConf, bid: string, moid: string) {
  const edi = ediDate();
  const r = await post(`${c.base}/webapi/billing/billkey_remove.jsp`, { BID: bid, MID: c.billingMid, EdiDate: edi, Moid: moid, SignData: sha(c.billingMid + edi + moid + bid + c.billingKey) });
  return { ok: r.ResultCode === 'F101', code: r.ResultCode, msg: r.ResultMsg };
}
/** 결제창(goPay) 파라미터 — SignData 는 서버에서만 */
export type PayMethod = 'CARD' | 'BANK' | 'VBANK';
export function windowParams(c: NpConf, i: { moid: string; amount: number; goodsName: string; returnUrl: string; buyerEmail?: string; buyerName?: string; payMethod?: PayMethod }) {
  const edi = ediDate();
  const pm = i.payMethod ?? 'CARD';
  // 가상계좌: 입금 기한 3일(서울)
  const vexp = pm === 'VBANK' ? new Date(Date.now() + 3 * 86400_000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(/-/g, '') : null;
  return { PayMethod: pm, ...(vexp ? { VbankExpDate: vexp } : {}), GoodsName: i.goodsName, Amt: String(i.amount), MID: c.mid, Moid: i.moid, EdiDate: edi, SignData: sha(edi + c.mid + String(i.amount) + c.key),
    ReturnURL: i.returnUrl, CharSet: 'utf-8', ...(i.buyerEmail ? { BuyerEmail: i.buyerEmail } : {}), ...(i.buyerName ? { BuyerName: i.buyerName } : {}) };
}
const NICE_HOST = /^https:\/\/(dc1-api|dc2-api|pg-api|webapi)\.nicepay\.co\.kr\//;
/** 인증 응답 → 승인. 인증 Signature 검증, 승인 URL 은 나이스페이 도메인(시험 가짜 서버 제외)만 */
export async function approveAuth(c: NpConf, a: Record<string, string>, expectAmount: number) {
  if (a.AuthResultCode !== '0000') return { ok: false, code: a.AuthResultCode, msg: a.AuthResultMsg || '인증에 실패했습니다' };
  if (a.Signature !== sha(a.AuthToken + c.mid + a.Amt + c.key)) return { ok: false, code: 'SIGN', msg: '인증 응답 위변조 검증 실패' };
  if (Number(a.Amt) !== expectAmount) return { ok: false, code: 'AMT', msg: '금액이 주문과 다릅니다' };
  const next = a.NextAppURL ?? '';
  if (!NICE_HOST.test(next) && !next.startsWith(c.base + '/')) return { ok: false, code: 'URL', msg: '승인 주소가 올바르지 않습니다' };
  const edi = ediDate();
  const r = await post(next, { TID: a.TxTid, AuthToken: a.AuthToken, MID: c.mid, Amt: a.Amt, EdiDate: edi, SignData: sha(a.AuthToken + c.mid + a.Amt + edi + c.key) });
  const sigOk = !r.Signature || r.Signature === sha((r.TID ?? '') + c.mid + (r.Amt ?? '') + c.key);
  // 성공 코드: 카드 3001 · 계좌이체 4000 · 가상계좌 발급 4100(입금 전 — 입금 통보 4110 에서 결제 완료)
  const okCode = r.ResultCode === '3001' || r.ResultCode === '4000' || r.ResultCode === '4100';
  const vbank = r.ResultCode === '4100' ? { bank: r.VbankBankName ?? '', num: r.VbankNum ?? '', exp: r.VbankExpDate ?? '', holder: r.VbankAccountName ?? '' } : null;
  return { ok: okCode && sigOk && Number(r.Amt) === expectAmount, code: r.ResultCode, msg: sigOk ? r.ResultMsg : '승인 응답 위변조 검증 실패', tid: r.TID ?? a.TxTid, authCode: r.AuthCode,
    cardName: r.CardName ?? r.BankName, cardNo: r.CardNo, netCancelUrl: a.NetCancelURL, payMethod: (r.PayMethod ?? a.PayMethod ?? 'CARD') as string, vbank };
}
/** 취소 (2001·2211 성공). partial = 부분취소 */
export async function cancelPayment(c: NpConf, i: { tid: string; moid: string; amount: number; partial: boolean; reason: string; billing?: boolean }) {
  const edi = ediDate();
  const mid = i.billing ? c.billingMid : c.mid, key = i.billing ? c.billingKey : c.key;
  const r = await post(`${c.cancelBase}/webapi/cancel_process.jsp`, { TID: i.tid, MID: mid, Moid: i.moid, CancelAmt: String(i.amount), CancelMsg: i.reason,
    PartialCancelCode: i.partial ? '1' : '0', EdiDate: edi, SignData: sha(mid + String(i.amount) + edi + key) });
  return { ok: r.ResultCode === '2001' || r.ResultCode === '2211', code: r.ResultCode, msg: r.ErrorMsg || r.ResultMsg };
}

/** 나이스페이가 보내는 form(EUC-KR 퍼센트 인코딩 가능)을 읽는다 */
export function parseNiceForm(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const dec = (s: string) => {
    const bytes: number[] = [];
    const t = s.replace(/\+/g, ' ');
    for (let k = 0; k < t.length; k++) {
      if (t[k] === '%' && /^[0-9a-fA-F]{2}$/.test(t.slice(k + 1, k + 3))) { bytes.push(parseInt(t.slice(k + 1, k + 3), 16)); k += 2; }
      else bytes.push(...Buffer.from(t[k], 'utf8'));
    }
    const b = Uint8Array.from(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { return new TextDecoder('euc-kr').decode(b); }
  };
  for (const part of raw.split('&')) { if (!part) continue; const [k, v = ''] = part.split('='); out[dec(k)] = dec(v); }
  return out;
}
