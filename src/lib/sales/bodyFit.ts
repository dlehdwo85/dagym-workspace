// 대표 11/27(로컬 6~9·14 — "공고 제목으로만 확인해서 판단하지 말고 공고문 내용까지 읽고 분석"): 강화 서희스타힐스 공고는 제목에 '입주민 편의시설 운영업체'뿐이었지만
// 공고문 첫 줄이 "주민공동시설 위탁 운영업체를 선정", 운영대상 "커뮤니티 주민공동시설(피트니스, 독서실 등)"이었다.
// ① 본문 판정: K-apt '관련 아님' 줄 중 분류가 '사업자-용역'(시설 서비스 아님)이고 제목에 운영·위탁·편의시설·커뮤니티·주민공동·부대복리 말이 있으며 광고·공사 낱말이 없는
//    마감 전 공고 → 첨부 공고문을 받아 목적·운영대상·사업 개요·과업 범위를 지금 판정 규칙(matchFit)으로 다시 봄. 다짐(또는 하이링크)이 본문 낱말로 잡히고 본문에 운영·위탁 말이
//    있으면 관련으로 올림 — 까닭 '공고문 본문에서 찾음: …'. 광고료·광고 사업 본문은 거름(14). 한 공고에 한 번(body_fit_at), 받기 실패는 2번까지.
// ② 현장설명 필수: 공고문의 "현장설명 … 참석 … 서명해야만 입찰 참여" 같은 문장 → doc_briefing_kind '필수'(K-apt 칸보다 우선, 필수·임의가 다 찍힌 애매한 칸 대신)
// ③ 서로 다른 값: 입찰가 산정 개월 수(× n개월·계약기간)와 실적 세대 기준이 공고문 안에서 다르면 '관리사무소에 물어볼 것'(doc_checks) — 규칙만(AI·비용 없음)
// 비용: 첨부 받기·글자 뽑기는 무료(규칙). AI 는 쓰지 않음.
import { db } from '../db';
import { extractTextResult } from '../textExtract';
import { AD_RE, DIRECT_OPS, initialClassification, matchFit, type FitBusiness } from './collectors/procurement';

type Row = Record<string, any>;
const kstDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** 본문 판정 대상 제목 — 운영 맡김·편의시설·커뮤니티 말 */
export const BODY_TITLE = /운영|위탁|편의\s*시설|커뮤니티|주민\s*공동|부대\s*복리/;
/** 본문을 읽어도 다짐·하이링크가 아닌 제목(광고·공사·물품·시설 서비스) */
const BODY_SKIP_TITLE = /공사|설치|교체|보수|도색|방수|구매|구입|렌탈|납품|청소|미화|경비|소독|방역|승강기|주택\s*관리|위탁\s*관리|관리\s*업자|재활용|음식물|택배|알뜰|매각|보험|회계/;
/** K-apt 분류 세 번째 칸(사업자 - 용역 - ○○)이 시설 서비스면 읽지 않음 */
const SERVICE_CAT = /경비|청소|미화|소독|방역|승강기|위탁\s*관리|주택\s*관리|전기|소방|보험|회계|감사|도장|방수|재활용|음식물|택배|알뜰|조경|수목|정화조|저수조|급수|주차|통신|인터넷|지능형|홈네트워크|보수/;
const catPart = (cat: string) => cat.split(/\s*-\s*/).map((x) => x.trim())[2] ?? '';
/** 분류로 본 대상 여부 — 빈 분류는 '모름'(상세에서 받아 다시 봄) */
export function bodyCategoryOk(cat: string | null | undefined): boolean | null {
  const c = String(cat ?? '').trim(); if (!c) return null;
  return /사업자/.test(c) && /용역/.test(c) && !SERVICE_CAT.test(catPart(c));
}
export const bodyTitleOk = (title: string) => BODY_TITLE.test(title) && !BODY_SKIP_TITLE.test(title) && !AD_RE.test(title);

/** 판정에 쓰는 본문 부분 — 첫 1,200자 + '목적·운영 대상·대상 시설·위탁 대상·사업 개요·과업 범위·운영 시설' 머리 뒤 400자씩(참가자격·평가표·서식은 뺌) */
export function bodySnippet(text: string): string {
  const t = String(text ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const parts = [t.slice(0, 1200)];
  for (const m of t.matchAll(/목\s*적|운영\s*대상|대상\s*시설|위탁\s*대상|사업\s*개요|과업\s*(?:범위|내용)|운영\s*시설|위탁\s*범위/g)) { parts.push(t.slice(m.index ?? 0, (m.index ?? 0) + 400)); if (parts.length > 8) break; }
  return parts.join('\n').slice(0, 4000);
}
/** 광고 자리 운영 본문(광고료·광고 사업) — 시설 운영 말이 없으면 다짐 아님 */
const AD_BODY = /광고\s*(?:료|사업|대행|게재|수익|물)|미디어\s*보드|전광판|사이니지/;
const FAC_BODY = /피트니스|헬스|체력\s*단련|운동\s*시설|GX|골프|수영|사우나|독서실|도서관|커뮤니티\s*(?:센터|시설)|주민\s*공동\s*시설|카페|게스트\s*하우스/;
export type BodyFit = { at: string; fit: FitBusiness | null; words: string[]; direct: boolean; why: string | null; quote: string | null; file: string | null; skip?: string; error?: string; tries?: number };
/** 본문 판정(순수 함수) — 제목·분류 + 본문 부분으로 지금 규칙을 다시 돌려, 본문 낱말로 잡히고 본문에 운영·위탁 말이 있을 때만 */
export function bodyJudge(title: string, cat: string | null, text: string): Pick<BodyFit, 'fit' | 'words' | 'direct' | 'why' | 'quote'> | { fit: null; skip: string } {
  const snip = bodySnippet(text);
  const f = matchFit(title, cat, snip, '공동주택');
  if (!f.fit) return { fit: null, skip: f.dropped?.[0]?.why ?? '본문에도 우리 사업 낱말 없음' };
  if (!/위탁|운영/.test(snip)) return { fit: null, skip: '본문에 운영·위탁 말 없음' };
  const flat = snip.replace(/\s+/g, ' ');
  // 목적(첫 단락)이 광고 자리 운영이면 시설 낱말이 섞여도 다짐 아님 · 그 밖은 시설 운영 말이 없을 때만 거름
  if (AD_BODY.test(flat.slice(0, 400)) || (AD_BODY.test(flat) && !FAC_BODY.test(flat))) return { fit: null, skip: '광고 자리 운영(광고료·광고 사업)' };
  const words = f.matched.slice(0, 6);
  const at = words.map((w) => flat.indexOf(w)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  const quote = at == null ? null : flat.slice(Math.max(0, at - 30), at + 60).trim();
  return { fit: f.fit, words, direct: f.direct || DIRECT_OPS.test(flat), why: `공고문 본문에서 찾음: ${words.slice(0, 4).join('·')}`, quote };
}

/** 현장설명 필수·없음 — 공고문 문장 우선(K-apt 칸은 필수·임의가 함께 찍혀 애매할 때가 있음). 못 찾으면 null */
export function docBriefing(text: string): { kind: '필수' | '없음'; label: string } | null {
  const lines = String(text ?? '').replace(/\r/g, '').split(/\n|(?<=[.。])\s+/).map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => /현장\s*설명/.test(x));
  for (const l of lines) {
    if (/현장\s*설명(?:회)?[^.]{0,30}?(?:필수|의무)|(?:참석|참가|방문)[^.]{0,40}?(?:한\s*(?:업체|자|사업자)(?:에\s*한(?:하여|해)|만)|하여야|해야|서명해야만|서명한\s*(?:업체|자)만|만\s*입찰)|(?:불참|미참석|참석하지\s*않은|참가하지\s*않은)[^.]{0,40}?(?:입찰|참여|참가|자격)[^.]{0,20}?(?:불가|제한|무효|없|박탈|상실|못)/.test(l))
      return { kind: '필수', label: l.slice(0, 90) };
  }
  for (const l of lines) if (/현장\s*설명(?:회)?\s*[:：]?\s*(?:없음|미실시|생략|실시하지\s*않|하지\s*않)/.test(l)) return { kind: '없음', label: l.slice(0, 90) };
  return null;
}
/** 공고문 안 서로 다른 값 — 입찰가 산정 개월 수(× n개월·계약기간 n년/n개월) · 실적 세대 기준. 관리사무소에 물어볼 것 */
export function docChecks(text: string): string[] {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  const out: string[] = [];
  const months = new Map<number, string>();
  for (const m of t.matchAll(/[×xX*]\s*(\d{1,2})\s*개월/g)) { const n = Number(m[1]); if (n >= 6 && !months.has(n)) months.set(n, `${n}개월(금액 곱하기)`); }
  for (const m of t.matchAll(/계약\s*기간\s*[:：]?\s*(?:은|는)?[^.]{0,30}?(\d{1,2})\s*(년|개월)/g)) { const n = Number(m[1]) * (m[2] === '년' ? 12 : 1); if (n >= 6 && n <= 120 && !months.has(n)) months.set(n, `${m[1]}${m[2]}(계약 기간)`); }
  if (months.size > 1) out.push(`입찰가·계약 개월 수가 서로 다름: ${[...months.values()].join(' · ')}`);
  const hh = new Map<number, string>();
  for (const m of t.matchAll(/(\d{1,2},?\d{3}|\d{3})\s*세대\s*(?:이상|규모)/g)) {
    const ctx = t.slice(Math.max(0, (m.index ?? 0) - 60), (m.index ?? 0) + 60);
    if (!/실적/.test(ctx)) continue;
    const n = Number(m[1].replace(',', '')); if (!hh.has(n)) hh.set(n, `${n.toLocaleString('ko-KR')}세대`);
  }
  if (hh.size > 1) out.push(`실적 세대 기준이 서로 다름: ${[...hh.values()].join(' · ')}`);
  return out;
}
/** 공고문 글 → 줄에 붙일 칸(현장설명 필수·서로 다른 값) */
export function docPatch(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  const b = docBriefing(text); const c = docChecks(text);
  return { ...(b ? { doc_briefing_kind: b.kind, doc_briefing_label: b.label } : {}), doc_checks: c, doc_read_at: new Date().toISOString() };
}

/** 본문 판정 후보(마감 전·관련 아님·K-apt) — days 는 처음 본 때 기준 */
async function candidates(days: number) {
  const sql = db(); const td = kstDay(); const from = new Date(Date.now() - days * 864e5).toISOString();
  const rows = await sql<{ src_id: string; row: Row }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
    and row->>'source_type' = 'kapt_bid' and coalesce(row->>'related', 'false') <> 'true' and coalesce(row->>'title', '') ~ '운영|위탁|편의|커뮤니티|주민|부대'
    and coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) >= ${from} and left(coalesce(row->>'deadline_at', ''), 10) >= ${td}
    and coalesce(row->>'current_status', '') !~ '취소|낙찰|유찰' order by row->>'deadline_at' asc`;
  return rows.filter((r) => bodyTitleOk(String(r.row.title ?? '')) && bodyCategoryOk(r.row.bid_category) !== false);
}
/** 운영자 조회(로컬 9번 '하루 몇 건'): 최근 14일 날짜별 — 제목 후보·분류 통과·읽음·올림 */
export async function bodyFitCounts(days = 14) {
  const sql = db(); const from = new Date(Date.now() - days * 864e5).toISOString();
  const rows = await sql<{ row: Row }[]>`select jsonb_build_object('title', row->'title', 'cat', row->'bid_category', 'first', coalesce(row->>'first_seen_at', row->>'created_at'), 'related', row->'related',
      'body', row->'body_fit', 'dl', row->'deadline_at') as row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'kapt_bid'
    and coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) >= ${from} and coalesce(row->>'title', '') ~ '운영|위탁|편의|커뮤니티|주민|부대'`;
  const by = new Map<string, { day: string; titles: number; unrelated: number; catOk: number; catUnknown: number; read: number; raised: number }>();
  for (const { row } of rows) {
    if (!bodyTitleOk(String(row.title ?? ''))) continue;
    const day = kstDay(new Date(String(row.first ?? ''))); const c = by.get(day) ?? { day, titles: 0, unrelated: 0, catOk: 0, catUnknown: 0, read: 0, raised: 0 }; by.set(day, c);
    c.titles++;
    if (row.body?.fit) c.raised++;
    if (row.body && !row.body.error) c.read++;
    if (row.related === true && !row.body?.fit) continue;
    c.unrelated++;
    const ok = bodyCategoryOk(row.cat); if (ok) c.catOk++; else if (ok === null) c.catUnknown++;
  }
  return [...by.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/** 한 공고: 분류(없으면 K-apt 상세) → 첨부 공고문 → 본문 판정 → 저장(올리기·현장설명·서로 다른 값) */
export async function readBodyFit(id: string, opt: { fetchImpl?: typeof fetch } = {}): Promise<BodyFit | null> {
  const sql = db(); const now = new Date(); const t = now.toISOString();
  const [r0] = await sql<{ row: Row }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
  if (!r0) return null; const row = r0.row; const prev = (row.body_fit ?? null) as BodyFit | null;
  const save = async (bf: BodyFit, extra: Record<string, unknown> = {}) => {
    await sql`update sales_src_rows set row = row || ${sql.json({ body_fit: bf, body_fit_at: t, ...extra } as never)}::jsonb, synced_at = now() where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
    return bf;
  };
  let cat: string | null = row.bid_category ? String(row.bid_category) : null; const extra: Record<string, unknown> = {};
  if (!cat && row.source_external_id) { // 분류가 비면 K-apt 상세에서(분류 빈 줄 읽기와 같은 칸)
    try {
      const { kaptSession } = await import('./files'); const { parseKaptBidDetail } = await import('./collectors/kapt');
      const s = await kaptSession(String(row.source_external_id), opt.fetchImpl ?? fetch, 8000);
      if (s.status === 200) { const d = parseKaptBidDetail(s.html); if (d.category) { cat = d.category; extra.bid_category = d.category; } if (d.bidKind) extra.contract_method = d.bidKind; if (d.content) extra.task_scope = d.content; extra.category_probed_at = t; }
    } catch { /* 분류 없이 본문으로 */ }
  }
  if (bodyCategoryOk(cat) === false) return save({ at: t, fit: null, words: [], direct: false, why: null, quote: null, file: null, skip: `분류 '${catPart(String(cat))}' — 시설 서비스` }, extra);
  const { noticeFiles } = await import('./autoAttach'); const { fetchFile } = await import('./files'); const { rankFiles } = await import('./eligibility');
  const src = await noticeFiles(id).catch(() => null);
  const files = rankFiles(src?.files ?? []).slice(0, 2);
  let text: string | null = null; let file: string | null = null; const errs: string[] = [];
  for (const f of files) {
    try { const got = await fetchFile(f.url, f.name, { bid: src?.bid ?? null }); const x = await extractTextResult(got.data, got.fileName, got.mime); if (x.text) { text = x.text; file = got.fileName; break; } errs.push(x.error ?? '글자 없음'); }
    catch (e) { errs.push(String((e as Error)?.message ?? e).slice(0, 40)); }
  }
  if (!text) return save({ at: t, fit: null, words: [], direct: false, why: null, quote: null, file: null, error: files.length ? errs.join(' · ').slice(0, 120) : '첨부 공고문 없음', tries: (prev?.tries ?? 0) + 1 }, extra);
  const j = bodyJudge(String(row.title ?? ''), cat, text);
  const bf: BodyFit = 'skip' in j ? { at: t, fit: null, words: [], direct: false, why: null, quote: null, file, skip: j.skip } : { at: t, ...j, file };
  const doc = docPatch(text);
  if (!bf.fit) return save(bf, { ...extra, ...doc });
  // 올림 — 다시 판정(refitNotices)이 올리는 것과 같은 칸 · 마감 전이면 '다시 찾은 공고'(오늘 새 공고·당일 메일)
  const merged = { ...row, ...extra, fit_business: bf.fit };
  const cls = !row.classification || row.classification === '참고(비관련)' ? { classification: bf.direct ? '즉시 검토' : initialClassification(merged) } : {};
  return save(bf, { ...extra, ...doc, related: true, fit_business: bf.fit, matched_keywords: bf.words, judged_at: t, ...(row.refound_at ? {} : { refound_at: t }), ...cls });
}

/** 정기 실행 — 마감 가까운 순으로 한 번에 4건·20초. 이미 판정한 공고는 다시 안 함(받기 실패는 20시간 뒤, 2번까지) */
export async function bodyFitTick(o: { budgetMs?: number; max?: number; days?: number; fetchImpl?: typeof fetch; force?: boolean } = {}) {
  if (process.env.SALES_BODY_FIT === 'off' && !o.force) return { skipped: 'off' };
  const t0 = Date.now(); const budget = o.budgetMs ?? 20_000; const max = o.max ?? 4;
  const rows = await candidates(o.days ?? 30);
  const due = rows.filter(({ row }) => { const b = row.body_fit as BodyFit | undefined; if (!b) return true; return !!b.error && (b.tries ?? 0) < 2 && Date.now() - Date.parse(b.at) > 20 * 3600e3; });
  let done = 0, raised = 0; const tried: string[] = [];
  for (const { src_id, row } of due) {
    if (done >= max || Date.now() - t0 > budget) break;
    const b = await readBodyFit(src_id, { fetchImpl: o.fetchImpl }).catch((e) => { tried.push(`${String(row.source_external_id ?? src_id).slice(0, 24)} 오류(${String((e as Error)?.message ?? e).slice(0, 30)})`); return null; }); done++;
    if (b?.fit) raised++;
    if (b) tried.push(`${String(row.source_external_id ?? src_id).slice(0, 24)} ${b.fit ? '올림' : b.error ? '못 받음' : '그대로'}`);
  }
  return { candidates: rows.length, due: due.length, done, raised, tried }; // 공개 정기 실행 기록에는 번호·결과만(제목·단지 이름 없음)
}
