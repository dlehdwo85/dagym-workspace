// V19 2장: 견적서 — 회사(공급자 = company_profiles)별 양식(JSON 배치) → A4 1페이지 PDF(pdf-lib + Noto Sans KR, 외부 서비스 없음).
// AI 는 초안(ai_proposals draft_quote)만 만들고 금액은 서버가 다시 계산해 덮는다. 만들기·보내기(공유·메일·문자 시안)는 사람이 누른다. 보낸 것은 outbox·업무 활동에 기록.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { isAdmin, denyDemo } from './access';
import { activity, audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { companyProfiles, type CompanyProfile } from './companyProfiles';
import { todaySeoul } from './time';
import { pdfFonts as fonts } from './pdfFonts';
import { wrapText } from './textFit';

export type QuoteItem = { name: string; spec?: string; qty: number; unitPrice: number; amount: number };
export type QuoteLayout = { title?: string; columns: { key: 'name' | 'spec' | 'qty' | 'unitPrice' | 'amount'; label: string; width: number }[]; terms: string[]; footer?: string; accent?: string; showStamp?: boolean };
export const DEFAULT_LAYOUT: QuoteLayout = {
  title: '견 적 서',
  columns: [{ key: 'name', label: '품목', width: 0.34 }, { key: 'spec', label: '규격', width: 0.2 }, { key: 'qty', label: '수량', width: 0.1 }, { key: 'unitPrice', label: '단가', width: 0.16 }, { key: 'amount', label: '공급가액', width: 0.2 }],
  terms: ['견적 유효기간: {validUntil} 까지', '결제 조건: 협의', '부가세(10%)는 별도 표기, 합계는 부가세 포함 금액'],
  footer: '위와 같이 견적합니다.',
};

export const quoteItemInput = z.object({ name: z.string().trim().min(1).max(120), spec: z.string().trim().max(120).optional(), qty: z.coerce.number().positive().max(1_000_000), unitPrice: z.coerce.number().min(0).max(1e12) });
export const quoteInput = z.object({
  company: z.string().regex(/^[a-z0-9_-]{2,30}$/, '회사 키'),
  templateId: z.string().uuid().optional(),
  to: z.object({ name: z.string().trim().min(1).max(120), contact: z.string().trim().max(60).optional(), phone: z.string().trim().max(40).optional(), email: z.string().trim().max(200).optional() }),
  items: z.array(quoteItemInput).min(1).max(60),
  validDays: z.coerce.number().int().min(1).max(365).optional(),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().trim().max(1000).optional(),
  taskId: z.string().uuid().optional(),
  leadId: z.string().uuid().optional(),
});
export type QuoteInput = z.infer<typeof quoteInput>;
export const layoutInput = z.object({
  title: z.string().trim().max(40).optional(),
  columns: z.array(z.object({ key: z.enum(['name', 'spec', 'qty', 'unitPrice', 'amount']), label: z.string().trim().min(1).max(20), width: z.number().min(0.05).max(0.8) })).min(2).max(6).optional(),
  terms: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
  footer: z.string().trim().max(200).optional(),
  accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  showStamp: z.boolean().optional(),
});
export const templateInput = z.object({ company: z.string().regex(/^[a-z0-9_-]{2,30}$/), name: z.string().trim().min(1).max(60), layout: layoutInput.default({}), sourceFileId: z.string().uuid().optional(), isDefault: z.boolean().optional() });

/** 금액은 서버가 계산: 공급가액 = Σ(수량×단가, 원 단위 반올림), 부가세 10%, 합계 */
export function computeQuote(items: z.infer<typeof quoteItemInput>[]) {
  const rows: QuoteItem[] = items.map((it) => ({ name: it.name, spec: it.spec || undefined, qty: it.qty, unitPrice: Math.round(it.unitPrice), amount: Math.round(it.qty * it.unitPrice) }));
  const supply = rows.reduce((n, r) => n + r.amount, 0);
  const vat = Math.round(supply * 0.1);
  return { items: rows, supply, vat, total: supply + vat };
}
export const won = (n: number) => n.toLocaleString('ko-KR');
const DIGIT = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], UNIT = ['', '십', '백', '천'], BIG = ['', '만', '억', '조', '경'];
/** 일금 금액 한글 표기: 1234567 → 일백이십삼만사천오백육십칠 */
export function koreanNumber(n: number) {
  if (!Number.isFinite(n) || n <= 0) return '영';
  let s = '', g = 0, v = Math.floor(n);
  while (v > 0 && g < BIG.length) {
    const chunk = v % 10000; v = Math.floor(v / 10000);
    if (chunk) {
      let c = '';
      for (let i = 3; i >= 0; i--) { const d = Math.floor(chunk / 10 ** i) % 10; if (d) c += (d === 1 && i > 0 ? '' : DIGIT[d]) + UNIT[i]; }
      s = c + BIG[g] + s;
    }
    g++;
  }
  return s;
}
export function validUntilOf(i: { validDays?: number; validUntil?: string }) {
  if (i.validUntil) return i.validUntil;
  const d = new Date(`${todaySeoul()}T00:00:00+09:00`); d.setUTCDate(d.getUTCDate() + (i.validDays ?? 30));
  return d.toISOString().slice(0, 10);
}
const mergeLayout = (l: Partial<QuoteLayout> | null | undefined): QuoteLayout => ({ ...DEFAULT_LAYOUT, ...(l ?? {}), columns: l?.columns?.length ? l.columns : DEFAULT_LAYOUT.columns, terms: l?.terms ?? DEFAULT_LAYOUT.terms });

// ---------------- PDF ----------------
const hex = (c: string) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c); return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] as const : [0.05, 0.58, 0.53] as const; };

export type RenderQuote = { quoteNo: string; date: string; to: QuoteInput['to']; items: QuoteItem[]; supply: number; vat: number; total: number; validUntil: string; note?: string };
/**
 * A4 1페이지 고정: 글자 9.5 → 8.5 → 7.5 로 줄여 보고 그래도 넘치면 overflow(2페이지로 넘기지 않음). 공급자는 넘겨받은 회사 정보만 쓴다.
 */
export async function renderQuotePdf(profile: CompanyProfile, layout0: Partial<QuoteLayout> | null | undefined, q: RenderQuote): Promise<{ pdf: Buffer; fontSize: number } | { overflow: true }> {
  const { PDFDocument, rgb } = await import('pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const layout = mergeLayout(layout0);
  const f = await fonts();
  const W = 595.28, H = 841.89, M = 40;
  const accent = hex(layout.accent ?? profile.brand_color ?? '#0d9488');
  for (const fs of [9.5, 8.5, 7.5]) {
    const rowH = fs * 2.1, lineH = fs * 1.45;
    const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
    const reg = await doc.embedFont(f.regular, { subset: true }), bold = await doc.embedFont(f.bold, { subset: true });
    const page = doc.addPage([W, H]);
    const text = (s: string, x: number, y: number, size: number, o: { bold?: boolean; color?: readonly [number, number, number]; align?: 'left' | 'right' | 'center'; maxW?: number } = {}) => {
      const font = o.bold ? bold : reg;
      let str = s ?? '';
      if (o.maxW) while (str.length > 1 && font.widthOfTextAtSize(str, size) > o.maxW) str = str.slice(0, -2) + '…';
      const w = font.widthOfTextAtSize(str, size);
      const px = o.align === 'right' ? x - w : o.align === 'center' ? x - w / 2 : x;
      page.drawText(str, { x: px, y, size, font, color: rgb(...(o.color ?? [0.1, 0.1, 0.12])) });
      return w;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, th = 0.6, color: readonly [number, number, number] = [0.75, 0.78, 0.82]) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: th, color: rgb(...color) });
    let y = H - M;
    // 제목
    text(layout.title ?? '견 적 서', W / 2, y - 22, 22, { bold: true, align: 'center' }); y -= 34;
    line(M, y, W - M, y, 1.2, accent); y -= 14;
    // 왼쪽: 수신 · 오른쪽: 공급자
    const colR = W / 2 + 10; const top = y;
    const L: [string, string][] = [['수신', `${q.to.name} 귀하`], ...(q.to.contact ? [['담당', q.to.contact] as [string, string]] : []), ...(q.to.phone || q.to.email ? [['연락처', [q.to.phone, q.to.email].filter(Boolean).join(' · ')] as [string, string]] : []),
      ['견적번호', q.quoteNo], ['견적일', q.date], ['유효기간', `${q.validUntil} 까지`]];
    let ly = y;
    for (const [k, v] of L) { text(k, M, ly - fs, fs, { color: [0.4, 0.42, 0.45] }); text(v, M + 50, ly - fs, fs, { maxW: W / 2 - M - 60 }); ly -= lineH; }
    const R: [string, string][] = [['상호', profile.name], ...(profile.ceo ? [['대표', profile.ceo] as [string, string]] : []), ...(profile.biz_no ? [['사업자번호', profile.biz_no] as [string, string]] : []),
      ...(profile.address ? [['주소', profile.address] as [string, string]] : []), ...(profile.phone ? [['전화', profile.phone] as [string, string]] : []), ...(profile.email ? [['이메일', profile.email] as [string, string]] : [])];
    // 로컬 10/25 15:45: 긴 주소는 '…'로 자르지 않고 두 줄까지(셋째 줄부터는 둘째 줄 끝 '…') — 상자 높이도 줄 수만큼
    const RW = W - M - colR - 62;
    const RL = R.map(([k, v]) => { const ls = k === '주소' ? wrapText(v, RW, (x) => reg.widthOfTextAtSize(x, fs)) : [v]; /* 띄어쓰기 자리에서 줄바꿈(textFit) */ return [k, ls.length > 2 ? [ls[0], ls.slice(1).join('')] : ls] as const; });
    const rn = RL.reduce((n, [, ls]) => n + ls.length, 0);
    page.drawRectangle({ x: colR - 6, y: top - rn * lineH - 6, width: W - M - colR + 6, height: rn * lineH + 10, borderColor: rgb(...accent), borderWidth: 0.8 });
    page.drawRectangle({ x: colR - 2, y: top + 1, width: bold.widthOfTextAtSize('공급자', fs - 1) + 4, height: fs, color: rgb(1, 1, 1) }); // 147차: 이름표 뒤 테두리 선을 지움(글자가 선에 겹치지 않게)
    text('공급자', colR, top + 2, fs - 1, { bold: true, color: accent });
    let ry = top;
    for (const [k, ls] of RL) { text(k, colR, ry - fs, fs, { color: [0.4, 0.42, 0.45] }); ls.forEach((v, n) => text(v, colR + 58, ry - fs - n * lineH, fs, { maxW: RW })); ry -= ls.length * lineH; }
    y = Math.min(ly, ry) - 16;
    // 합계 한 줄
    text(`합계 금액: 일금 ${koreanNumber(q.total)}원정 (₩ ${won(q.total)}) · 부가세 포함`, M, y - fs - 1, fs + 1.5, { bold: true });
    y -= fs * 2.4;
    // 표
    const tableW = W - 2 * M; const cols = layout.columns; const sumW = cols.reduce((n, c) => n + c.width, 0);
    const xs: number[] = []; let acc = M; for (const c of cols) { xs.push(acc); acc += (c.width / sumW) * tableW; } xs.push(W - M);
    const cell = (i: number, s: string, yy: number, o: { bold?: boolean; align?: 'left' | 'right' | 'center'; color?: readonly [number, number, number] } = {}) => {
      const pad = 4; const x0 = xs[i] + pad, x1 = xs[i + 1] - pad;
      text(s, o.align === 'right' ? x1 : o.align === 'center' ? (x0 + x1) / 2 : x0, yy, fs, { ...o, maxW: x1 - x0 });
    };
    page.drawRectangle({ x: M, y: y - rowH, width: tableW, height: rowH, color: rgb(...accent) });
    cols.forEach((c, i) => cell(i, c.label, y - rowH + (rowH - fs) / 2, { bold: true, color: [1, 1, 1], align: 'center' }));
    y -= rowH;
    const rows = [...q.items.map((it) => cols.map((c) => c.key === 'qty' ? won(it.qty) : c.key === 'unitPrice' ? won(it.unitPrice) : c.key === 'amount' ? won(it.amount) : c.key === 'spec' ? it.spec ?? '' : it.name))];
    for (const r of rows) {
      line(M, y - rowH, W - M, y - rowH);
      cols.forEach((c, i) => cell(i, r[i], y - rowH + (rowH - fs) / 2, { align: c.key === 'name' || c.key === 'spec' ? 'left' : 'right' }));
      y -= rowH;
    }
    for (let i = 0; i <= cols.length; i++) line(xs[i], y + rows.length * rowH + rowH, xs[i], y, 0.6);
    // 합계 3줄
    for (const [k, v, b] of [['공급가액', won(q.supply), false], ['부가세(10%)', won(q.vat), false], ['합계(부가세 포함)', won(q.total), true]] as const) {
      line(M, y - rowH, W - M, y - rowH);
      text(k, xs[xs.length - 2] - 6, y - rowH + (rowH - fs) / 2, fs, { bold: !!b, align: 'right' });
      text(v, W - M - 4, y - rowH + (rowH - fs) / 2, fs, { bold: !!b, align: 'right' });
      y -= rowH;
    }
    y -= 14;
    for (const t of layout.terms) { text(`· ${t.replace('{validUntil}', q.validUntil)}`, M, y - fs, fs); y -= lineH; }
    if (q.note) { y -= 4; for (const ln of wrap(q.note, (s) => reg.widthOfTextAtSize(s, fs), tableW)) { text(ln, M, y - fs, fs, { color: [0.3, 0.32, 0.35] }); y -= lineH; } }
    if (layout.footer) { y -= 10; text(layout.footer, W / 2, y - fs, fs + 1, { align: 'center' }); y -= lineH; text(`${q.date}   ${profile.name}${profile.ceo ? `  대표 ${profile.ceo}` : ''}  (인)`, W / 2, y - fs - 4, fs, { align: 'center' }); y -= lineH + 4; }
    if (y < M) continue; // 넘침 → 글자 줄여 다시
    text(`${q.quoteNo} · 1 / 1`, W - M, M - 14, 7, { align: 'right', color: [0.6, 0.62, 0.65] });
    return { pdf: Buffer.from(await doc.save()), fontSize: fs };
  }
  return { overflow: true };
}
function wrap(s: string, width: (x: string) => number, maxW: number) {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let cur = '';
    for (const ch of para) { if (width(cur + ch) > maxW && cur) { out.push(cur); cur = ch; } else cur += ch; }
    out.push(cur);
  }
  return out.slice(0, 12);
}

// ---------------- 양식 ----------------
export async function listTemplates(u: SessionUser, company?: string) {
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select id, company_key, name, layout, source_file_id, is_default, created_at from quote_templates where tenant = ${t} ${company ? sql`and company_key = ${company}` : sql``} order by company_key, is_default desc, created_at`;
  const profiles = await companyProfiles(t);
  return { templates: rows.map((r) => ({ id: r.id, company: r.company_key, name: r.name, layout: r.layout, sourceFileId: r.source_file_id, isDefault: r.is_default, createdAt: r.created_at })),
    companies: profiles.map((p) => ({ key: p.key, name: p.name, isDefault: p.is_default })) };
}
export async function saveTemplate(u: SessionUser, i: z.infer<typeof templateInput>, ip: string | null) {
  denyDemo(u);
  const { requireAnyMenu } = await import('./menuPerms');
  await requireAnyMenu(u, ['company', 'ops'], 'edit');
  const sql = db(); const t = tenantOf(u);
  await loadProfile(t, i.company);
  if (i.sourceFileId) { const [f] = await sql`select 1 from library_files where id = ${i.sourceFileId} and tenant = ${t} and deleted_at is null`; if (!f) throw notFound('참고 양식 파일이 없습니다'); }
  const first = !(await sql`select 1 from quote_templates where tenant = ${t} and company_key = ${i.company}`).length;
  const [r] = await sql.begin(async (tx) => {
    if (i.isDefault || first) await tx`update quote_templates set is_default = false where tenant = ${t} and company_key = ${i.company}`;
    return tx<{ id: string }[]>`insert into quote_templates (tenant, company_key, name, layout, source_file_id, is_default, created_by) values (${t}, ${i.company}, ${i.name}, ${sql.json(i.layout as never)}, ${i.sourceFileId ?? null}, ${i.isDefault || first}, ${u.id}) returning id`;
  });
  await audit(sql, u.id, 'quote_template.save', null, r.id, { company: i.company, name: i.name }, ip);
  return { id: r.id };
}
async function loadProfile(t: string, key: string) {
  const p = (await companyProfiles(t)).find((x) => x.key === key);
  if (!p) throw badRequest(`회사 정보(공급자) "${key}" 가 없습니다 — 회사 정보·디자인에서 등록해 주세요`);
  return p;
}
async function loadTemplate(t: string, key: string, id?: string) {
  const sql = db();
  const [r] = id ? await sql<any[]>`select * from quote_templates where id = ${id} and tenant = ${t}` : await sql<any[]>`select * from quote_templates where tenant = ${t} and company_key = ${key} order by is_default desc, created_at limit 1`;
  if (id && !r) throw notFound('견적서 양식이 없습니다');
  return r ?? null;
}

// ---------------- 견적서 ----------------
async function access(u: SessionUser, q: { task_id: string | null; created_by: string | null }) {
  if (q.task_id) { const { loadTaskForUser } = await import('./access'); await loadTaskForUser(u, q.task_id).catch(() => { throw notFound('견적서가 없습니다'); }); }
}
/** 미리보기(저장 없음): 제안 카드 [PDF 미리보기]·화면 입력 검토 */
export async function previewQuote(u: SessionUser, i: QuoteInput) {
  const t = tenantOf(u);
  if (i.taskId) { const { loadTaskForUser } = await import('./access'); await loadTaskForUser(u, i.taskId); }
  const profile = await loadProfile(t, i.company); const tpl = await loadTemplate(t, i.company, i.templateId);
  const c = computeQuote(i.items);
  const r = await renderQuotePdf(profile, tpl?.layout, { quoteNo: `Q-${todaySeoul().replace(/-/g, '')}-미리보기`, date: todaySeoul(), to: i.to, ...c, validUntil: validUntilOf(i), note: i.note });
  return { ...c, profile: { key: profile.key, name: profile.name }, template: tpl ? { id: tpl.id, name: tpl.name } : null, validUntil: validUntilOf(i), ...(('overflow' in r) ? { overflow: true as const, pdf: null } : { overflow: false as const, pdf: r.pdf, fontSize: r.fontSize }) };
}
async function nextQuoteNo(sql: Sql, t: string, company: string) {
  const day = todaySeoul().replace(/-/g, '');
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from quotes where tenant = ${t} and company_key = ${company} and quote_no like ${`Q-${day}-%`}`;
  return `Q-${day}-${String(r.n + 1).padStart(3, '0')}`;
}
export async function createQuote(u: SessionUser, i: QuoteInput, ip: string | null) {
  denyDemo(u);
  const sql = db(); const t = tenantOf(u);
  const pv = await previewQuote(u, i);
  if (pv.overflow || !pv.pdf) throw badRequest('1페이지 초과 — 품목을 묶어 주세요(A4 한 장 고정)');
  const profile = await loadProfile(t, i.company);
  const no = await nextQuoteNo(sql, t, i.company);
  // 번호를 찍어 다시 그린다(미리보기 번호 → 실제 번호)
  const tpl = await loadTemplate(t, i.company, i.templateId);
  const r = await renderQuotePdf(profile, tpl?.layout, { quoteNo: no, date: todaySeoul(), to: i.to, items: pv.items, supply: pv.supply, vat: pv.vat, total: pv.total, validUntil: pv.validUntil, note: i.note });
  if ('overflow' in r) throw badRequest('1페이지 초과 — 품목을 묶어 주세요');
  const { saveGeneratedFile, attachLibraryToTask } = await import('./library');
  const safeTo = i.to.name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const file = await saveGeneratedFile(u, { fileName: `견적서_${no}_${safeTo}.pdf`, mime: 'application/pdf', data: r.pdf, title: `견적서 ${no} ${i.to.name}`, folder: '견적서', tags: ['견적서', profile.name], description: `${i.to.name} · 합계 ${won(pv.total)}원(VAT 포함) · 유효 ${pv.validUntil}`, source: 'quote', security: 'internal' });
  const [q] = await sql<{ id: string }[]>`insert into quotes (tenant, company_key, template_id, quote_no, to_name, to_contact, to_phone, to_email, items, supply, vat, total, valid_until, note, task_id, lead_id, file_id, created_by)
    values (${t}, ${i.company}, ${tpl?.id ?? null}, ${no}, ${i.to.name}, ${i.to.contact ?? null}, ${i.to.phone ?? null}, ${i.to.email ?? null}, ${sql.json(pv.items as never)}, ${pv.supply}, ${pv.vat}, ${pv.total}, ${pv.validUntil}, ${i.note ?? null}, ${i.taskId ?? null}, ${i.leadId ?? null}, ${file.id}, ${u.id}) returning id`;
  if (i.taskId) { await attachLibraryToTask(u, file.id, i.taskId).catch(() => null); await activity(sql, 'task', i.taskId, u.id, 'quote_created', { no, total: pv.total, to: i.to.name }); }
  await audit(sql, u.id, 'quote.create', 'quote', q.id, { no, company: i.company, total: pv.total }, ip);
  return { id: q.id, no, fileId: file.id, total: pv.total, link: `/quotes/${q.id}` };
}
export async function listQuotes(u: SessionUser, f: { company?: string; taskId?: string; limit?: number } = {}) {
  const sql = db(); const t = tenantOf(u);
  if (f.taskId) { const { loadTaskForUser } = await import('./access'); await loadTaskForUser(u, f.taskId); }
  const rows = await sql<any[]>`select q.id, q.company_key, q.quote_no, q.to_name, q.total, q.valid_until, q.status, q.sent_via, q.sent_at, q.created_at, q.task_id, q.file_id, us.name as created_by_name, tk.title as task_title
    from quotes q left join users us on us.id = q.created_by left join tasks tk on tk.id = q.task_id
    where q.tenant = ${t} ${f.company ? sql`and q.company_key = ${f.company}` : sql``} ${f.taskId ? sql`and q.task_id = ${f.taskId}` : sql``} order by q.created_at desc limit ${f.limit ?? 100}`;
  const profiles = await companyProfiles(t);
  return { quotes: rows.map((r) => ({ ...r, company_name: profiles.find((p) => p.key === r.company_key)?.name ?? r.company_key })), canSend: await (await import('./mailbox')).canSend(u) };
}
export async function getQuote(u: SessionUser, id: string) {
  const sql = db();
  const [q] = await sql<any[]>`select q.*, us.name as created_by_name, tk.title as task_title, f.file_name, f.storage_key from quotes q left join users us on us.id = q.created_by left join tasks tk on tk.id = q.task_id
    left join library_files f on f.id = q.file_id where q.id = ${id} and q.tenant = ${tenantOf(u)}`;
  if (!q) throw notFound('견적서가 없습니다');
  await access(u, q);
  const profile = (await companyProfiles(tenantOf(u))).find((p) => p.key === q.company_key);
  const { canSend } = await import('./mailbox');
  const { storage_key: _k, ...rest } = q;
  return { quote: { ...rest, company_name: profile?.name ?? q.company_key, items: q.items }, canSend: await canSend(u), hasEmail: !!q.to_email, hasPhone: !!q.to_phone };
}
export async function quotePdf(u: SessionUser, id: string) {
  const q = await getQuote(u, id);
  const sql = db();
  const [f] = await sql<{ storage_key: string | null; file_name: string }[]>`select storage_key, file_name from library_files where id = ${q.quote.file_id}`;
  if (!f?.storage_key) throw notFound('PDF 가 없습니다');
  const { getObject } = await import('./storage');
  return { data: await getObject(f.storage_key), fileName: f.file_name };
}
export const sentInput = z.object({ via: z.enum(['share', 'mail', 'sms', 'download', 'kakao']), to: z.string().trim().max(200).optional() });
/** 사람이 [보냈어요]를 누른 것만 기록 — 외부 발송 권한 */
export async function markQuoteSent(u: SessionUser, id: string, i: z.infer<typeof sentInput>, ip: string | null) {
  const { quote } = await getQuote(u, id);
  const { canSend } = await import('./mailbox');
  if (!(await canSend(u))) throw forbidden('견적서 보내기 권한이 없습니다 — 대표에게 요청하세요(설정 > 메뉴 권한 > 외부 발송)');
  const sql = db(); const oid = randomUUID();
  const to = i.to || quote.to_email || quote.to_phone || quote.to_name;
  await sql`update quotes set status = 'sent', sent_via = ${i.via}, sent_to = ${to}, sent_at = now() where id = ${id}`;
  await sql`insert into outbox (id, tenant, channel, status, task_id, created_by, to_addrs, subject, body_text, message_id, sent_at)
    values (${oid}, ${tenantOf(u)}, ${`quote:${i.via}`}, 'sent', ${quote.task_id}, ${u.id}, ${[to]}, ${`견적서 ${quote.quote_no}`}, ${`${quote.to_name} · 합계 ${won(Number(quote.total))}원`}, ${`quote-${oid}`}, now())`;
  if (quote.task_id) await activity(sql, 'task', quote.task_id, u.id, 'quote_sent', { no: quote.quote_no, via: i.via, to });
  await audit(sql, u.id, 'quote.sent', 'quote', id, { via: i.via }, ip);
  try { await (await import('./contacts')).rememberContacts(sql, tenantOf(u), u.id, [{ name: quote.to_contact || quote.to_name, organization: quote.to_contact ? quote.to_name : null, phone: quote.to_phone, email: quote.to_email }], { source: 'quote', taskId: quote.task_id }); } catch {} // V31 ① 견적 받는 사람 → 연락처
  return { ok: true, via: i.via };
}
/** 문자 시안: 업무에 연결돼 있으면 14일 보기 링크를 넣는다(없으면 링크 없이, PDF 는 파일로) */
export async function quoteSmsText(u: SessionUser, id: string) {
  const { quote } = await getQuote(u, id);
  let url: string | null = null;
  if (quote.task_id && quote.file_id) {
    const { createTaskShare } = await import('./mailbox');
    url = (await createTaskShare(u, { taskId: quote.task_id, attachmentIds: [], libraryFileIds: [quote.file_id], company: quote.company_key })).url;
  }
  const body = [`[${quote.company_name}] ${quote.to_name} 견적서(${quote.quote_no})를 보내드립니다.`, `합계 ${won(Number(quote.total))}원(부가세 포함) · 유효기간 ${quote.valid_until} 까지`, url ? `견적서 보기(14일): ${url}` : null].filter(Boolean).join('\n');
  return { body, to: quote.to_phone ?? '', shareUrl: url };
}
export const quoteMailInput = z.object({ to: z.string().trim().email('받는 사람 메일 형식이 아닙니다'), subject: z.string().trim().max(200).optional(), body: z.string().max(5000).optional() });
export async function quoteMail(u: SessionUser, id: string, i: z.infer<typeof quoteMailInput>, ip: string | null) {
  const { quote } = await getQuote(u, id);
  if (!quote.task_id) throw badRequest('업무에 연결된 견적서만 메일로 보낼 수 있습니다 — 업무에서 견적서를 만들거나 PDF 를 내려받아 보내 주세요');
  const { queueMail } = await import('./mailbox');
  const r = await queueMail(u, { taskId: quote.task_id, company: quote.company_key, to: [i.to], subject: i.subject || `[${quote.company_name}] ${quote.to_name} 견적서 (${quote.quote_no})`,
    body: i.body || `안녕하세요, ${quote.company_name}입니다.\n요청하신 견적서(${quote.quote_no})를 첨부해 드립니다.\n합계 ${won(Number(quote.total))}원(부가세 포함), 유효기간은 ${quote.valid_until} 까지입니다.\n확인 부탁드립니다.`, libraryFileIds: [quote.file_id] }, ip);
  await markQuoteSent(u, id, { via: 'mail', to: i.to }, ip);
  return r;
}
