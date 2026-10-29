// V32 2 정산(플랫폼 운영 /platform → 정산): 결제 장부(건별 공급가·VAT·PG 수수료 추정·정산 예정일·정산 상태) · 일/월 집계 · 엑셀 ·
// 입금 대사(나이스페이 정산 내역 엑셀/CSV 올리면 TID/주문번호/승인번호/날짜+금액으로 맞춤) · 미수(던닝) 목록 · 세금계산서 요청(고객이 올리고 운영자가 발행 체크).
// 수수료·정산일은 계약마다 달라 "추정"으로 표시한다(PG_FEE_CARD_PCT·PG_FEE_BANK_PCT·PG_FEE_VBANK_KRW·PG_SETTLE_DAYS 로 조정). 실제 값은 대사 파일로 들어온다.
import { z } from 'zod';
import { DateTime } from 'luxon';
import { db, type Sql } from '../db';
import { badRequest, notFound } from '../errors';
import { isAdmin } from '../access';
import { audit } from '../log';
import { tenantOf, type SessionUser } from '../types';

const TZ = 'Asia/Seoul';
const requirePlatform = (u: SessionUser) => { if (!u.platformAdmin) throw notFound(); };
export const FEE = {
  cardPct: Number(process.env.PG_FEE_CARD_PCT) || 3.3,     // 카드 결제 수수료(%, VAT 포함 추정)
  bankPct: Number(process.env.PG_FEE_BANK_PCT) || 1.8,     // 계좌이체
  vbankKrw: Number(process.env.PG_FEE_VBANK_KRW) || 300,    // 가상계좌 건당
  settleDays: Number(process.env.PG_SETTLE_DAYS) || 5,     // 정산 주기(영업일, 나이스페이 기본 D+5)
};
export const PM_LABEL: Record<string, string> = { CARD: '카드', BANK: '계좌이체', VBANK: '가상계좌' };

/** 수수료 추정(원) — 순매출 기준 */
export function estimateFee(method: string, net: number) {
  if (net <= 0) return 0;
  if (method === 'VBANK') return FEE.vbankKrw;
  return Math.round((net * (method === 'BANK' ? FEE.bankPct : FEE.cardPct)) / 100);
}
/** 결제일 + 영업일(주말·공휴일 제외) */
export async function settlementDate(paidAt: Date, sql: Sql = db(), days = FEE.settleDays) {
  let d = DateTime.fromJSDate(paidAt).setZone(TZ).startOf('day');
  const hol = new Set((await sql<{ date: string }[]>`select to_char(date, 'YYYY-MM-DD') as date from holidays where date between ${d.toISODate()} and ${d.plus({ days: days * 3 + 10 }).toISODate()}`).map((r) => r.date));
  let n = 0;
  while (n < days) { d = d.plus({ days: 1 }); if (d.weekday <= 5 && !hol.has(d.toISODate()!)) n++; }
  return d.toISODate()!;
}

const monthRange = (month: string) => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('월은 YYYY-MM 형식으로');
  const s = DateTime.fromISO(`${month}-01`, { zone: TZ });
  return { from: s.toJSDate(), to: s.plus({ months: 1 }).toJSDate(), prevFrom: s.minus({ months: 1 }).toJSDate() };
};
export const thisMonth = () => DateTime.now().setZone(TZ).toFormat('yyyy-MM');

type Row = { id: string; tenant: string; tenant_name: string; is_test: boolean; kind: string; plan_code: string | null; addon_code: string | null; pay_method: string; amount: number; canceled_amount: number; status: string;
  paid_at: Date | null; created_at: Date; tid: string | null; moid: string; card_name: string | null; test: boolean; s_status: string | null; expected_on: string | null; settled_on: string | null; settled_amount: number | null; pg_fee: number | null; s_note: string | null; s_source: string | null };

async function rows(sql: Sql, f: { from: Date; to: Date; tenant?: string; includeTest?: boolean }) {
  return sql<Row[]>`select p.id, p.tenant, t.name as tenant_name, t.is_test, p.kind, p.plan_code, p.addon_code, coalesce(p.meta->>'payMethod', 'CARD') as pay_method, p.amount, p.canceled_amount, p.status,
      p.paid_at, p.created_at, p.tid, p.moid, p.card_name, (t.is_test or (p.meta->>'test') = 'true' or (p.meta->>'liveSmoke') = 'true') as test,
      s.status as s_status, to_char(s.expected_on, 'YYYY-MM-DD') as expected_on, to_char(s.settled_on, 'YYYY-MM-DD') as settled_on, s.settled_amount, s.pg_fee, s.note as s_note, s.source as s_source
    from payments p join tenants t on t.id = p.tenant left join payment_settlements s on s.payment_id = p.id
    where p.status in ('paid', 'partial_canceled', 'canceled') and coalesce(p.paid_at, p.created_at) >= ${f.from} and coalesce(p.paid_at, p.created_at) < ${f.to}
      ${f.tenant ? sql`and p.tenant = ${f.tenant}` : sql``}
      ${f.includeTest ? sql`` : sql`and not t.is_test and coalesce(p.meta->>'test', '') <> 'true' and coalesce(p.meta->>'liveSmoke', '') <> 'true'`}
    order by coalesce(p.paid_at, p.created_at) desc`;
}
/** 장부 한 줄: 순매출·공급가·VAT·수수료(실제 있으면 실제, 없으면 추정)·입금 예정액·정산 상태 */
function enrich(r: Row) {
  const net = r.amount - r.canceled_amount;
  const supply = Math.round(net / 1.1), vat = net - supply;
  const feeEst = estimateFee(r.pay_method, net);
  const fee = r.pg_fee ?? feeEst;
  const sStatus = r.s_status ?? (net <= 0 ? 'canceled' : 'pending');
  return { ...r, net, supply, vat, fee, feeEstimated: r.pg_fee === null || r.pg_fee === undefined, deposit: Math.max(0, net - fee), settlement: sStatus, pay_method_label: PM_LABEL[r.pay_method] ?? r.pay_method,
    what: r.kind === 'addon' ? `추가 팩 ${r.addon_code ?? ''}` : `${r.plan_code ?? ''} ${r.kind === 'annual' ? '1년' : '1개월'}` };
}
type Enriched = ReturnType<typeof enrich>;
function aggregate(list: Enriched[]) {
  const sum = (k: keyof Enriched) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const by = (key: (r: Enriched) => string) => {
    const m = new Map<string, { key: string; count: number; gross: number; canceled: number; net: number; fee: number; deposit: number }>();
    for (const r of list) { const k = key(r); const o = m.get(k) ?? { key: k, count: 0, gross: 0, canceled: 0, net: 0, fee: 0, deposit: 0 }; o.count++; o.gross += r.amount; o.canceled += r.canceled_amount; o.net += r.net; o.fee += r.fee; o.deposit += r.deposit; m.set(k, o); }
    return [...m.values()].sort((a, b) => b.net - a.net);
  };
  return { count: list.length, gross: sum('amount'), canceled: sum('canceled_amount'), net: sum('net'), supply: sum('supply'), vat: sum('vat'), fee: sum('fee'), deposit: sum('deposit'),
    settled: list.filter((r) => r.settlement === 'settled').length, pending: list.filter((r) => r.settlement === 'pending').length, mismatch: list.filter((r) => r.settlement === 'mismatch').length,
    byMethod: by((r) => r.pay_method_label), byPlan: by((r) => (r.kind === 'addon' ? `팩 ${r.addon_code ?? ''}` : `${r.plan_code ?? '?'}${r.kind === 'annual' ? '(연)' : ''}`)) };
}

/** 월 장부 + 집계 + 전월 비교 + 날짜별 + 미수 */
export async function settlementOverview(u: SessionUser, f: { month?: string; tenant?: string; includeTest?: boolean } = {}) {
  requirePlatform(u);
  const sql = db(); const month = f.month ?? thisMonth();
  const { from, to, prevFrom } = monthRange(month);
  const [cur, prev, late, taxOpen] = await Promise.all([
    rows(sql, { from, to, tenant: f.tenant, includeTest: f.includeTest }), rows(sql, { from: prevFrom, to: from, tenant: f.tenant, includeTest: f.includeTest }),
    sql<any[]>`select s.tenant, t.name, s.plan_code, s.billing_amount, s.past_due_since, s.retry_count, s.next_retry_on, s.billing_lock, s.billing_grace_until, ow.email as owner_email
      from tenant_subscriptions s join tenants t on t.id = s.tenant left join users ow on ow.id = t.owner_user_id where s.past_due_since is not null and t.deleted_at is null order by s.past_due_since`,
    sql<{ n: number }[]>`select count(*)::int n from tax_invoice_requests where status = 'requested'`,
  ]);
  const ledger = cur.map(enrich);
  const daily = new Map<string, { day: string; count: number; net: number; deposit: number }>();
  for (const r of ledger) { const day = DateTime.fromJSDate(r.paid_at ?? r.created_at).setZone(TZ).toISODate()!; const o = daily.get(day) ?? { day, count: 0, net: 0, deposit: 0 }; o.count++; o.net += r.net; o.deposit += r.deposit; daily.set(day, o); }
  return { month, fee: FEE, summary: aggregate(ledger), prev: aggregate(prev.map(enrich)), daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    ledger: ledger.slice(0, 500), late: late.map((l) => ({ ...l, unpaid: l.billing_amount ?? 0, days: Math.floor(DateTime.now().diff(DateTime.fromJSDate(new Date(l.past_due_since)), 'days').days) })), taxOpen: taxOpen[0].n };
}

/** 엑셀: 장부 · 월 집계(수단별·요금제별) · 날짜별 — 세무 자료 */
export async function exportSettlement(u: SessionUser, f: { month?: string; includeTest?: boolean } = {}) {
  const o = await settlementOverview(u, f);
  const { writeXlsx } = await import('../xlsx');
  const dt = (d: Date | null) => (d ? DateTime.fromJSDate(d).setZone(TZ).toFormat('yyyy-MM-dd HH:mm') : '');
  const S: Record<string, string> = { pending: '대기', settled: '정산 완료', mismatch: '차이', canceled: '취소' };
  const data = writeXlsx([
    { name: '장부', rows: [['결제일시', '회사', '내용', '결제 수단', '카드사', '결제금액', '취소금액', '순매출', '공급가', '부가세', 'PG 수수료', '수수료 구분', '입금 예정액', '정산 예정일', '정산 상태', '정산일', '입금액', 'TID', '주문번호'],
      ...o.ledger.map((r) => [dt(r.paid_at ?? r.created_at), r.tenant_name, r.what, r.pay_method_label, r.card_name ?? '', r.amount, r.canceled_amount, r.net, r.supply, r.vat, r.fee, r.feeEstimated ? '추정' : '실제', r.deposit, r.expected_on ?? '', S[r.settlement] ?? r.settlement, r.settled_on ?? '', r.settled_amount ?? '', r.tid ?? '', r.moid])], widths: [16, 14, 16, 8, 10, 10, 10, 10, 10, 8, 10, 8, 10, 11, 8, 11, 10, 22, 26] },
    { name: '월 집계', rows: [['항목', `${o.month}`, '전월'], ['결제 건수', o.summary.count, o.prev.count], ['총결제', o.summary.gross, o.prev.gross], ['취소', o.summary.canceled, o.prev.canceled], ['순매출', o.summary.net, o.prev.net], ['공급가', o.summary.supply, o.prev.supply], ['부가세', o.summary.vat, o.prev.vat], ['PG 수수료(추정 포함)', o.summary.fee, o.prev.fee], ['입금 예정액', o.summary.deposit, o.prev.deposit], [],
      ['결제 수단', '건수', '총결제', '취소', '순매출', '수수료', '입금 예정'], ...o.summary.byMethod.map((b) => [b.key, b.count, b.gross, b.canceled, b.net, b.fee, b.deposit]), [],
      ['요금제', '건수', '총결제', '취소', '순매출', '수수료', '입금 예정'], ...o.summary.byPlan.map((b) => [b.key, b.count, b.gross, b.canceled, b.net, b.fee, b.deposit])] },
    { name: '날짜별', rows: [['날짜', '건수', '순매출', '입금 예정'], ...o.daily.map((d) => [d.day, d.count, d.net, d.deposit])] },
  ]);
  return { fileName: `정산_${o.month}.xlsx`, data };
}

/** 정산 예정일 채우기(결제 완료 뒤 없는 건) — 장부를 열 때·정기 실행에서 */
export async function fillExpected(sql: Sql = db()) {
  const list = await sql<{ id: string; paid_at: Date }[]>`select p.id, p.paid_at from payments p left join payment_settlements s on s.payment_id = p.id where p.status in ('paid', 'partial_canceled') and p.paid_at is not null and s.payment_id is null limit 200`;
  for (const p of list) await sql`insert into payment_settlements (payment_id, expected_on) values (${p.id}, ${await settlementDate(p.paid_at, sql)}) on conflict (payment_id) do nothing`;
  return list.length;
}

// ---------------- 입금 대사 ----------------
export const reconcileInput = z.object({ fileName: z.string().max(200), data: z.string().max(4_400_000) });
const H = {
  tid: /^(tid|거래\s*번호|거래\s*id|pg\s*거래번호)$/i, auth: /^(승인\s*번호|auth\s*code)$/i, moid: /^(moid|주문\s*번호|주문\s*id|가맹점\s*주문번호)$/i,
  amount: /^(거래\s*금액|결제\s*금액|승인\s*금액|amount)$/i, settled: /^(정산\s*금액|입금\s*금액|지급\s*금액|입금액|정산액)$/i, fee: /^(수수료|pg\s*수수료|fee)$/i,
  settledOn: /^(정산\s*일|입금\s*일|지급\s*일|정산\s*예정일|정산일자)$/i, paidOn: /^(거래\s*일|결제\s*일|승인\s*일|거래일시|승인일시|결제일시)$/i,
};
const num = (s: string) => { const n = Number(String(s ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? Math.round(n) : null; };
const day = (s: string) => { const m = String(s ?? '').match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
/** 나이스페이(가맹점 관리자) 정산 내역 엑셀/CSV → 장부와 맞춤. 같은 TID → 주문번호 → 승인번호 → (거래일+금액) 순 */
export async function reconcile(u: SessionUser, i: z.infer<typeof reconcileInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const buf = Buffer.from(i.data, 'base64');
  if (buf.length > 3 * 1024 * 1024) throw badRequest('파일이 너무 큽니다(3MB 까지)');
  const ext = i.fileName.toLowerCase().split('.').pop();
  if (ext === 'xls') throw badRequest('예전 엑셀 파일(.xls)은 열 수 없습니다. .xlsx나 CSV로 다시 저장해 주세요');
  const { parseCsv, parseXlsx } = await import('../taskImport');
  const all = (ext === 'xlsx' ? parseXlsx(buf) : parseCsv(buf)).map((r) => r.map((c) => String(c ?? '').trim())).filter((r) => r.some((c) => c));
  if (all.length < 2) throw badRequest('파일에 내용이 없습니다(첫 줄 = 머리글)');
  // 머리글 줄 찾기(위쪽 몇 줄은 제목일 수 있음)
  let hi = all.findIndex((r) => r.some((c) => H.tid.test(c) || H.moid.test(c) || H.auth.test(c)));
  if (hi < 0) hi = 0;
  const head = all[hi].map((h) => h.replace(/\s*\(.*\)\s*$/, '').trim());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const c = { tid: col(H.tid), auth: col(H.auth), moid: col(H.moid), amount: col(H.amount), settled: col(H.settled), fee: col(H.fee), settledOn: col(H.settledOn), paidOn: col(H.paidOn) };
  if (c.tid < 0 && c.moid < 0 && c.auth < 0 && !(c.paidOn >= 0 && c.amount >= 0)) throw badRequest('TID·주문번호·승인번호 열(또는 거래일+금액)이 없습니다 — 나이스페이 가맹점 관리자 › 정산 내역 엑셀을 그대로 올려 주세요');
  const body = all.slice(hi + 1).filter((r) => r.some((x) => x) && !/^(합계|총계|소계)/.test(r[0] ?? ''));
  if (body.length > 5000) throw badRequest('한 번에 5,000줄까지');
  const pays = await sql<{ id: string; tid: string | null; moid: string; auth_code: string | null; amount: number; canceled_amount: number; paid_on: string | null }[]>`select p.id, p.tid, p.moid, p.auth_code, p.amount, p.canceled_amount, to_char(p.paid_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as paid_on
    from payments p where p.status in ('paid', 'partial_canceled', 'canceled')`;
  const byTid = new Map(pays.filter((p) => p.tid).map((p) => [p.tid!, p])), byMoid = new Map(pays.map((p) => [p.moid, p])), byAuth = new Map(pays.filter((p) => p.auth_code).map((p) => [p.auth_code!, p]));
  const uploadId = (await sql<{ id: string }[]>`insert into settlement_uploads (file_name, created_by) values (${i.fileName}, ${u.id}) returning id`)[0].id;
  const result: { row: number; status: 'settled' | 'mismatch' | 'unmatched'; paymentId?: string; tid?: string; moid?: string; amount: number | null; settled: number | null; note?: string }[] = [];
  const used = new Set<string>();
  for (let k = 0; k < body.length; k++) {
    const r = body[k]; const g = (idx: number) => (idx >= 0 ? r[idx] ?? '' : '');
    const tid = g(c.tid), moid = g(c.moid), auth = g(c.auth), amount = num(g(c.amount)), settled = c.settled >= 0 ? num(g(c.settled)) : null, fee = c.fee >= 0 ? num(g(c.fee)) : null, settledOn = day(g(c.settledOn)), paidOn = day(g(c.paidOn));
    let p = (tid && byTid.get(tid)) || (moid && byMoid.get(moid)) || (auth && byAuth.get(auth)) || null;
    if (!p && paidOn && amount !== null) p = pays.find((x) => !used.has(x.id) && x.paid_on === paidOn && (x.amount === amount || x.amount - x.canceled_amount === amount)) ?? null; // 거래일 + 결제금액(또는 순매출)
    if (!p) { result.push({ row: hi + k + 2, status: 'unmatched', tid, moid, amount, settled, note: '장부에 없는 거래' }); continue; }
    used.add(p.id);
    const net = p.amount - p.canceled_amount;
    const amtOk = amount === null || amount === p.amount || amount === net;
    const actualFee = fee ?? (settled !== null ? Math.max(0, net - settled) : null);
    const settledOk = settled === null || (settled <= net && settled >= net - Math.max(estimateFee('CARD', net) * 2, 1000));
    const status: 'settled' | 'mismatch' = amtOk && settledOk ? 'settled' : 'mismatch';
    const note = status === 'mismatch' ? [!amtOk ? `금액 다름(장부 ${p.amount}·파일 ${amount})` : null, !settledOk ? `입금액 이상(순매출 ${net}·입금 ${settled})` : null].filter(Boolean).join(' · ') : null;
    await sql`insert into payment_settlements (payment_id, expected_on, status, settled_on, settled_amount, pg_fee, source, note, upload_id, updated_by, updated_at)
      values (${p.id}, ${settledOn ?? null}, ${status}, ${settledOn}, ${settled}, ${actualFee}, 'upload', ${note}, ${uploadId}, ${u.id}, now())
      on conflict (payment_id) do update set status = excluded.status, settled_on = coalesce(excluded.settled_on, payment_settlements.settled_on), settled_amount = coalesce(excluded.settled_amount, payment_settlements.settled_amount),
        pg_fee = coalesce(excluded.pg_fee, payment_settlements.pg_fee), expected_on = coalesce(payment_settlements.expected_on, excluded.expected_on), source = 'upload', note = excluded.note, upload_id = excluded.upload_id, updated_by = excluded.updated_by, updated_at = now()`;
    result.push({ row: hi + k + 2, status, paymentId: p.id, tid: p.tid ?? tid, moid: p.moid, amount, settled, note: note ?? undefined });
  }
  const counts = { rows: body.length, matched: result.filter((r) => r.status === 'settled').length, mismatched: result.filter((r) => r.status === 'mismatch').length, unmatched: result.filter((r) => r.status === 'unmatched').length };
  await sql`update settlement_uploads set rows = ${counts.rows}, matched = ${counts.matched}, mismatched = ${counts.mismatched}, unmatched = ${counts.unmatched}, unmatched_rows = ${sql.json(result.filter((r) => r.status === 'unmatched').slice(0, 200) as never)} where id = ${uploadId}`;
  await audit(sql, u.id, 'settlement.reconcile', 'settlement_upload', uploadId, { file: i.fileName, ...counts }, ip);
  return { uploadId, counts, rows: result.slice(0, 300) };
}
export async function listUploads(u: SessionUser) {
  requirePlatform(u);
  return { uploads: await db()`select su.id, su.file_name, su.rows, su.matched, su.mismatched, su.unmatched, su.created_at, us.name as by from settlement_uploads su left join users us on us.id = su.created_by order by su.created_at desc limit 20` };
}

/** 운영자가 직접 정산 완료·대기로 표시 */
export const markInput = z.object({ status: z.enum(['pending', 'settled', 'mismatch']), settledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(), settledAmount: z.number().int().min(0).optional().nullable(), pgFee: z.number().int().min(0).optional().nullable(), note: z.string().max(300).optional().nullable() });
export async function markSettlement(u: SessionUser, paymentId: string, i: z.infer<typeof markInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [p] = await sql<{ id: string; paid_at: Date | null }[]>`select id, paid_at from payments where id = ${paymentId}`;
  if (!p) throw notFound();
  const expected = p.paid_at ? await settlementDate(p.paid_at, sql) : null;
  await sql`insert into payment_settlements (payment_id, expected_on, status, settled_on, settled_amount, pg_fee, source, note, updated_by, updated_at)
    values (${paymentId}, ${expected}, ${i.status}, ${i.settledOn ?? null}, ${i.settledAmount ?? null}, ${i.pgFee ?? null}, 'manual', ${i.note ?? null}, ${u.id}, now())
    on conflict (payment_id) do update set status = excluded.status, settled_on = excluded.settled_on, settled_amount = excluded.settled_amount, pg_fee = coalesce(excluded.pg_fee, payment_settlements.pg_fee), source = 'manual', note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'settlement.mark', 'payment', paymentId, { status: i.status, settledOn: i.settledOn ?? null }, ip);
  return { ok: true };
}

// ---------------- 세금계산서 요청 ----------------
export const taxRequestInput = z.object({ paymentId: z.string().uuid(), companyName: z.string().trim().min(1).max(120), bizNo: z.string().trim().regex(/^\d{3}-?\d{2}-?\d{5}$/, '사업자등록번호는 000-00-00000 형식'), ceo: z.string().trim().max(60).optional(), address: z.string().trim().max(200).optional(), email: z.string().trim().email('이메일 형식이 아닙니다').max(120) });
/** 고객 회사(사용량·요금제 편집 권한): 결제 건에 세금계산서 요청. 사업자 정보 기본값은 회사 정보(company_profiles 기본) */
export async function requestTaxInvoice(u: SessionUser, i: z.infer<typeof taxRequestInput>, ip: string | null) {
  const { requireTenantAdmin } = await import('../plans');
  await requireTenantAdmin(u, 'edit');
  const sql = db(); const t = tenantOf(u);
  const [p] = await sql<{ id: string; amount: number; canceled_amount: number; status: string }[]>`select id, amount, canceled_amount, status from payments where id = ${i.paymentId} and tenant = ${t}`;
  if (!p) throw notFound('결제 건을 찾을 수 없습니다');
  if (!['paid', 'partial_canceled'].includes(p.status)) throw badRequest('결제 완료된 건만 요청할 수 있습니다');
  const [dup] = await sql<{ id: string; status: string }[]>`select id, status from tax_invoice_requests where payment_id = ${p.id} and status <> 'canceled'`;
  if (dup) throw badRequest(dup.status === 'issued' ? '이미 발행된 결제 건입니다' : '이미 요청한 결제 건입니다 — 운영자가 확인 중입니다');
  const bizNo = i.bizNo.replace(/\D/g, '').replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3');
  const [r] = await sql<{ id: string }[]>`insert into tax_invoice_requests (tenant, payment_id, company_name, biz_no, ceo, address, email, amount, requested_by)
    values (${t}, ${p.id}, ${i.companyName}, ${bizNo}, ${i.ceo ?? null}, ${i.address ?? null}, ${i.email.toLowerCase()}, ${p.amount - p.canceled_amount}, ${u.id}) returning id`;
  await audit(sql, u.id, 'tax_invoice.request', 'payment', p.id, { bizNo }, ip);
  return { id: r.id };
}
/** 고객 화면: 내 회사 요청 목록 + 회사 정보 기본값 */
export async function myTaxInvoices(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  if (!isAdmin(u)) return { requests: [], defaults: null };
  const [prof] = await sql<any[]>`select name, biz_no, ceo, address, email from company_profiles where tenant = ${t} order by is_default desc, updated_at desc limit 1`;
  const requests = await sql`select id, payment_id, company_name, biz_no, email, amount, status, issued_at, created_at from tax_invoice_requests where tenant = ${t} order by created_at desc limit 50`;
  return { requests, defaults: prof ? { companyName: prof.name, bizNo: prof.biz_no, ceo: prof.ceo, address: prof.address, email: prof.email || u.email } : { companyName: '', bizNo: '', ceo: '', address: '', email: u.email } };
}
export async function listTaxInvoices(u: SessionUser, status?: string) {
  requirePlatform(u);
  return { requests: await db()`select r.id, r.tenant, t.name as tenant_name, r.payment_id, r.company_name, r.biz_no, r.ceo, r.address, r.email, r.amount, r.status, r.issued_at, r.note, r.created_at, us.name as requested_by_name,
      p.paid_at, p.plan_code, p.kind from tax_invoice_requests r join tenants t on t.id = r.tenant left join users us on us.id = r.requested_by left join payments p on p.id = r.payment_id
    where ${status ? db()`r.status = ${status}` : db()`true`} order by (r.status = 'requested') desc, r.created_at desc limit 200` };
}
export const taxMarkInput = z.object({ status: z.enum(['requested', 'issued', 'canceled']), note: z.string().max(300).optional().nullable() });
export async function markTaxInvoice(u: SessionUser, id: string, i: z.infer<typeof taxMarkInput>, ip: string | null) {
  requirePlatform(u);
  const sql = db();
  const [r] = await sql<{ id: string }[]>`update tax_invoice_requests set status = ${i.status}, issued_at = ${i.status === 'issued' ? new Date() : null}, note = coalesce(${i.note ?? null}, note), updated_at = now() where id = ${id} returning id`;
  if (!r) throw notFound();
  await audit(sql, u.id, 'tax_invoice.mark', 'tax_invoice', id, { status: i.status }, ip);
  return { ok: true };
}
