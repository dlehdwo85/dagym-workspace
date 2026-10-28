// #450 지원사업 수집 — 기업마당 지원사업정보 API(bizinfo)·K-Startup 사업공고(data.go.kr)·지원사업 감시 페이지(지자체·RIPC 공지 게시판).
// 공용 1벌(support_programs, tenant null) — 회사마다 맞춤·판단·진행은 src/lib/sales/support.ts.
// 응답 칸 이름은 공개 명세 기준(2026-10-23, 실제 응답으로 확인 전)이라 후보를 차례로 본다. 칸을 못 찾으면 실행 이력 요약에 받은 칸 이름을 남긴다.
import { createHash } from 'node:crypto';
import { db } from '../../db';
import { decrypt, encrypt } from '../../crypto';
import { dataGoKey } from '../collect';
import { endpoints } from './endpoints';
import { decodeKoreanText, garbledText } from './files';
import { SIDO_ALIASES } from './prospects';
import type { Collector, CollectorCtx, CollectorResult } from './types';

export const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s ? s : null; };
const pick = (it: any, ...keys: string[]) => { for (const k of keys) { const v = str(it?.[k]); if (v) return v; } return null; };
const h16 = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const ymdKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", middot: '·', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
/** HTML → 줄바꿈을 살린 글(문단·목록·줄바꿈 태그는 줄로) */
export function plain(html: string | null | undefined): string {
  if (!html) return '';
  return String(html).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, ' ').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);
/** 글 속 날짜들(2026-10-01 · 2026.10.1 · 2026년 10월 1일 · 20261001) — 나온 순서대로 */
export function datesIn(s: string | null | undefined): { day: string; at: number }[] {
  const out: { day: string; at: number }[] = []; const t = String(s ?? '');
  for (const m of t.matchAll(/(20\d{2})\s*(?:[.\-/]\s*|년\s*)(\d{1,2})\s*(?:[.\-/]\s*|월\s*)(\d{1,2})/g)) { const d = iso(+m[1], +m[2], +m[3]); if (d) out.push({ day: d, at: m.index ?? 0 }); }
  for (const m of t.matchAll(/(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)/g)) { const d = iso(+m[1], +m[2], +m[3]); if (d) out.push({ day: d, at: m.index ?? 0 }); }
  return out.sort((a, b) => a.at - b.at);
}
/** 신청 기간 원문 → 시작·마감. 날짜 하나뿐이면 '~' 앞이면 시작, 아니면 마감. 상시·예산 소진은 날짜 없이 원문만 */
export function parsePeriod(s: string | null | undefined): { start: string | null; end: string | null; text: string | null } {
  const text = str(s); if (!text) return { start: null, end: null, text: null };
  const ds = datesIn(text);
  if (ds.length >= 2) return { start: ds[0].day, end: ds[ds.length - 1].day, text };
  if (ds.length === 1) { const tilde = text.indexOf('~'); return tilde >= 0 && tilde > ds[0].at ? { start: ds[0].day, end: null, text } : { start: null, end: ds[0].day, text }; }
  return { start: null, end: null, text };
}
/** 지원 규모 — 공고 글에 적힌 금액 문구를 그대로(지어내지 않음, 예: '최대 1,000만원'). 없으면 null */
export function amountIn(s: string | null | undefined): string | null {
  // 단위(억·천만·백만·만)가 붙거나 천 단위 쉼표가 있는 금액만 — '2026 원주시' 같은 것은 안 잡음
  const m = String(s ?? '').replace(/\s+/g, ' ').match(/(?:(?:최대|최고|기업당|업체당|과제당|개사당|연간|총)\s*)?(?:\d[\d,.]*\s*(?:억|천만|백만|만)\s*원|\d{1,3}(?:,\d{3})+\s*원)(?:\s*(?:이내|한도|까지))?/);
  return m ? m[0].trim().slice(0, 60) : null;
}
/** 시·도 찾기(짧은 이름) — 해시태그·기관·제목 앞 [대괄호] 에서만(본문 아무 데나 보지 않음) */
export function sidoIn(...parts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const p of parts) {
    const t = String(p ?? ''); if (!t) continue;
    for (const [long, short] of Object.entries(SIDO_ALIASES)) if (t.includes(long)) out.add(short);
    for (const w of t.split(/[\s,#·/()[\]]+/)) { const s = SIDO.find((x) => w === x || (w === `${x}시` && x !== '광주') /* '광주시'는 경기 광주시 */ || w === `${x}도`); if (s) out.add(s); }
  }
  return SIDO.filter((s) => out.has(s));
}
const bracket = (title: string) => title.match(/^\s*[[(【]([^\])】]{1,20})[\])】]/)?.[1] ?? '';

export type ProgramIn = {
  source: 'bizinfo' | 'kstartup' | 'watch' | 'gov24'; source_id: string; title: string; agency: string | null; executor: string | null; category: string | null; target: string | null;
  regions: string[]; nationwide: boolean; summary: string | null; apply_start: string | null; apply_end: string | null; apply_text: string | null; amount: string | null; biz_years: string | null;
  url: string | null; apply_url: string | null; attachments: { name: string; url: string }[]; hashtags: string[]; raw: Record<string, unknown>; posted_at: string | null;
};
const absUrl = (u: string | null, base: string) => { if (!u) return null; try { const x = new URL(u.replace(/&amp;/g, '&'), base); return /^https?:$/.test(x.protocol) ? x.toString() : null; } catch { return null; } };
const LONG = new Set(['bsnsSumryCn', 'pbanc_ctnt', 'description']);
const rawOf = (it: Record<string, unknown>) => Object.fromEntries(Object.entries(it).filter(([k, v]) => !LONG.has(k) && !(typeof v === 'string' && v.length > 2000)));

// ---------- 기업마당 ----------
const BIZINFO_HOST = 'https://www.bizinfo.go.kr';
/** 기업마당 응답(JSON jsonArray / RSS item) → 공고 */
export function bizinfoProgram(it: any): ProgramIn | null {
  const title = pick(it, 'pblancNm', 'title', 'bizPbancNm'); if (!title) return null;
  const url = absUrl(pick(it, 'pblancUrl', 'link', 'detailUrl'), BIZINFO_HOST);
  const id = pick(it, 'pblancId', 'pbancSn', 'seq') ?? h16(url ?? title);
  const hashtags = (pick(it, 'hashtags', 'hashTags', 'hashtag') ?? '').split(/[,#\s]+/).map((x) => x.trim()).filter(Boolean).slice(0, 30);
  const agency = pick(it, 'jrsdInsttNm', 'author', 'insttNm'); const executor = pick(it, 'excInsttNm');
  const target = pick(it, 'trgetNm', 'target');
  const how = pick(it, 'reqstMthPapersCn'); const ask = pick(it, 'refrncNm');
  const summary = [plain(pick(it, 'bsnsSumryCn', 'description')), how ? `신청 방법: ${plain(how)}` : '', ask ? `문의: ${plain(ask)}` : ''].filter(Boolean).join('\n\n').slice(0, 20000) || null;
  const per = parsePeriod(pick(it, 'reqstBeginEndDe', 'reqstDt', 'reqstPd'));
  const regions = sidoIn(hashtags.join(' '), agency, executor, bracket(title));
  const files = (pick(it, 'flpthNm') ?? '').split(/@|\|/).map((x) => x.trim()).filter(Boolean); const names = (pick(it, 'fileNm') ?? '').split(/@|\|/).map((x) => x.trim());
  const pf = pick(it, 'printFlpthNm'); const pn = pick(it, 'printFileNm');
  const attachments = [...files.map((f, i) => ({ name: names[i] || `첨부 ${i + 1}`, url: absUrl(f, BIZINFO_HOST) })), ...(pf ? [{ name: pn ?? '공고문', url: absUrl(pf, BIZINFO_HOST) }] : [])]
    .filter((a): a is { name: string; url: string } => !!a.url).slice(0, 10);
  const posted = pick(it, 'creatPnttm', 'pubDate', 'registDt');
  return {
    source: 'bizinfo', source_id: id, title: title.slice(0, 300), agency, executor, category: [pick(it, 'pldirSportRealmLclasCodeNm', 'lcategory', 'category'), pick(it, 'pldirSportRealmMlsfcCodeNm')].filter(Boolean).join(' › ') || null,
    target, regions, nationwide: !regions.length || hashtags.includes('전국'), summary, apply_start: per.start, apply_end: per.end, apply_text: per.text, amount: amountIn(`${title} ${summary ?? ''}`), biz_years: null,
    url, apply_url: absUrl(pick(it, 'rceptEngnHmpgUrl'), BIZINFO_HOST), attachments, hashtags, raw: rawOf(it), posted_at: posted ? (datesIn(posted)[0]?.day ?? null) : null,
  };
}
/** RSS(XML) 로 올 때: <item> 마다 자식 태그를 그대로 칸으로 */
export function xmlItems(xml: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const o: Record<string, string> = {};
    for (const f of m[1].matchAll(/<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g)) o[f[1]] = f[2].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
    out.push(o);
  }
  return out;
}
const arrOf = (j: any): any[] => {
  for (const c of [j?.jsonArray, j?.jsonArray?.item, j?.data, j?.items, j?.items?.item, j?.response?.body?.items?.item, j?.response?.body?.items, j?.body?.items?.item, j]) if (Array.isArray(c)) return c.filter((x) => x && typeof x === 'object');
  return [];
};
const keysOf = (list: any[]) => [...new Set(list.slice(0, 3).flatMap((x) => Object.keys(x ?? {})))].slice(0, 25).join(', ');

/** 공공 원천 응답 읽기 — 키는 로그·요약에서 가림. data.go.kr XML 오류(활용신청·키 문제)는 알아보기 쉬운 말로.
 *  service = 공공데이터포털 서비스 번호(15157820·15125364) — 로컬 10/23 운영: 활용신청 전 키는 HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED_ERROR → '활용신청 필요(서비스 번호)'로 */
async function fetchSource(url: URL, ctx: CollectorCtx, secret: string, timeoutMs: number, service?: string): Promise<{ json: any; text: string }> {
  const safe = (s: string) => s.split(secret).join('***').split(encodeURIComponent(secret)).join('***').slice(0, 200);
  let res: Response; try { res = await ctx.fetchImpl(url.toString(), { headers: { Accept: 'application/json, application/xml;q=0.9, */*;q=0.5', 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)' }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new Error(`요청 실패 (${e instanceof Error ? e.name : 'Error'})`); }
  const text = decodeKoreanText(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type')).text; // #651: charset 헤더 우선, 없으면 한글 비율
  if (/SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|등록되지 않은 (서비스|인증)키/i.test(text)) throw new Error(`공공데이터포털 활용신청 필요${service ? `(서비스 ${service})` : ''} — 키는 그대로 두고 포털(data.go.kr)에서 [활용신청]`);
  let json: any = null; try { json = JSON.parse(text); } catch { /* XML·HTML */ }
  if (!json) {
    const code = text.match(/<returnReasonCode>([^<]+)</)?.[1] ?? text.match(/<resultCode>([^<]+)</)?.[1] ?? '';
    const msg = text.match(/<returnAuthMsg>([^<]+)</)?.[1] ?? text.match(/<errMsg>([^<]+)</)?.[1] ?? text.match(/<resultMsg>([^<]+)</)?.[1] ?? '';
    if (/^(20|21|22|30|31|32|33)\b/.test(code.trim()) || /DENIED|UNREGISTERED|NOT_REGISTERED|LIMITED|EXPIRED|인증키/i.test(`${code} ${msg}`)) throw new Error(`활용신청·인증키 확인 필요: ${safe(`${code} ${msg}`.trim())}`);
    if (/^12\b/.test(code.trim()) || /NO_OPENAPI_SERVICE/i.test(msg)) throw new Error(`주소 확인 필요: ${safe(msg || code)}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${safe(text.replace(/\s+/g, ' ').slice(0, 120))}`);
  const hd = json?.response?.header ?? json?.header; const rc = hd?.resultCode != null ? String(hd.resultCode) : null;
  if (rc != null && !['00', '0', 'INFO-000'].includes(rc)) throw new Error(/03|04|30|31|32|33/.test(rc) ? `활용신청·인증키 확인 필요: ${safe(String(hd?.resultMsg ?? rc))}` : `결과코드 ${rc}: ${safe(String(hd?.resultMsg ?? ''))}`);
  if (json && (json.reqErr || json.errMsg || json.errorMessage)) throw new Error(`원천 오류: ${safe(String(json.reqErr ?? json.errMsg ?? json.errorMessage))}`);
  return { json, text };
}

// ---------- 인증키(플랫폼 운영에서 넣음, 없으면 환경 변수) ----------
type KeyVal = { bizinfoEnc?: string; datagoEnc?: string; updatedAt?: string };
async function keyRow(): Promise<KeyVal> { const [r] = await db()<{ value: KeyVal }[]>`select value from app_settings where key = 'support_api_keys'`; return r?.value ?? {}; }
const dec = (v?: string) => { if (!v) return null; try { return decrypt(v); } catch { return null; } };
/** bizinfo = 기업마당 crtfcKey · datago = 공공데이터포털 serviceKey(K-Startup·기업마당 데이터 15157820 — 서비스마다 활용신청) */
export async function supportKeys(): Promise<{ bizinfo: string | null; datago: string | null; from: { bizinfo: 'settings' | 'env' | null; datago: 'settings' | 'env' | null } }> {
  const v = await keyRow().catch(() => ({} as KeyVal));
  const b = dec(v.bizinfoEnc), k = dec(v.datagoEnc); const be = str(process.env.BIZINFO_API_KEY), ke = dataGoKey();
  return { bizinfo: b ?? be, datago: k ?? ke, from: { bizinfo: b ? 'settings' : be ? 'env' : null, datago: k ? 'settings' : ke ? 'env' : null } };
}
/** 화면용: 있는지·어디서·앞 4자만(값은 절대 안 보임) */
export async function supportKeyStatus() {
  const k = await supportKeys(); const v = await keyRow().catch(() => ({} as KeyVal));
  const hint = (s: string | null) => (s ? `${s.slice(0, 4)}…` : null);
  return { bizinfo: { present: !!k.bizinfo, from: k.from.bizinfo, hint: hint(k.bizinfo) }, datago: { present: !!k.datago, from: k.from.datago, hint: hint(k.datago) }, updatedAt: v.updatedAt ?? null };
}
/** undefined = 그대로, '' 또는 null = 지움(환경 변수로 돌아감) */
export async function saveSupportKeys(i: { bizinfo?: string | null; datago?: string | null }, actorId: string) {
  const v = await keyRow(); const next: KeyVal = { ...v };
  if (i.bizinfo !== undefined) { if (i.bizinfo) next.bizinfoEnc = encrypt(i.bizinfo.trim()); else delete next.bizinfoEnc; }
  if (i.datago !== undefined) { if (i.datago) next.datagoEnc = encrypt(i.datago.trim()); else delete next.datagoEnc; }
  next.updatedAt = new Date().toISOString();
  await db()`insert into app_settings (key, value, updated_by) values ('support_api_keys', ${db().json(next as never)}, ${actorId}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  return supportKeyStatus();
}

// ---------- 저장 ----------
const hashOf = (p: ProgramIn) => h16(JSON.stringify([p.title, p.agency, p.executor, p.category, p.target, p.regions, p.nationwide, p.summary, p.apply_start, p.apply_end, p.apply_text, p.amount, p.biz_years, p.url, p.apply_url, p.attachments, p.hashtags]));
/** 공고 N건 저장 — (원천, 원천 번호)로 하나. 바뀐 칸이 있으면 갱신, 같으면 '마지막으로 본 때'만 */
export async function upsertPrograms(items: ProgramIn[]) {
  const sql = db(); const out = { inserted: 0, updated: 0, unchanged: 0, garbled: 0 };
  // #651 수집 검수: 제목·대상이 깨진 해독(치환 문자·한자 범벅)이면 넣지 않고 건수만 남김 — 수집 요약·오류 줄에 보여 인코딩 문제를 바로 알게
  const bad = new Set(items.filter((p) => garbledText(p.title) || garbledText(p.target)));
  out.garbled = bad.size;
  const uniq = [...new Map(items.filter((p) => !bad.has(p)).map((p) => [`${p.source}:${p.source_id}`, p])).values()];
  for (const src of [...new Set(uniq.map((p) => p.source))]) {
    const list = uniq.filter((p) => p.source === src);
    for (let n = 0; n < list.length; n += 200) {
      const chunk = list.slice(n, n + 200);
      const prev = new Map((await sql<{ source_id: string; hash: string | null }[]>`select source_id, hash from support_programs where tenant is null and source = ${src} and source_id = any(${chunk.map((p) => p.source_id)}::text[])`).map((r) => [r.source_id, r.hash]));
      const ins: Record<string, unknown>[] = []; const same: string[] = [];
      for (const p of chunk) {
        const h = hashOf(p);
        const row = { source: p.source, source_id: p.source_id, title: p.title, agency: p.agency, executor: p.executor, category: p.category, target: p.target, regions: p.regions, nationwide: p.nationwide, summary: p.summary,
          apply_start: p.apply_start, apply_end: p.apply_end, apply_text: p.apply_text, amount: p.amount, biz_years: p.biz_years, url: p.url, apply_url: p.apply_url, attachments: sql.json(p.attachments as never), hashtags: p.hashtags,
          raw: sql.json(p.raw as never), hash: h, posted_at: p.posted_at };
        if (!prev.has(p.source_id)) ins.push(row);
        else if (prev.get(p.source_id) !== h) { await sql`update support_programs set ${sql(row as never, 'title', 'agency', 'executor', 'category', 'target', 'regions', 'nationwide', 'summary', 'apply_start', 'apply_end', 'apply_text', 'amount', 'biz_years', 'url', 'apply_url', 'attachments', 'hashtags', 'raw', 'hash', 'posted_at')}, last_seen_at = now(), updated_at = now() where tenant is null and source = ${src} and source_id = ${p.source_id}`; out.updated++; }
        else same.push(p.source_id);
      }
      if (ins.length) { await sql`insert into support_programs ${sql(ins as never)} on conflict (source, source_id) do nothing`; out.inserted += ins.length; }
      if (same.length) { await sql`update support_programs set last_seen_at = now() where tenant is null and source = ${src} and source_id = any(${same}::text[])`; out.unchanged += same.length; }
    }
  }
  return out;
}
/** 한 건도 못 받았을 때 요약 = 첫 오류(활용신청 안내면 '공공데이터포털 전체:'·'1쪽:' 머리말은 뗌) — 로컬 10/23: '호출 실패 · 받은 0건'만으로는 원인을 모름 */
const firstErr = (errors: string[]) => errors[0].replace(/^[^:]{1,20}: (?=공공데이터포털 활용신청)/, '');
const done = (r: { inserted: number; updated: number; unchanged: number; garbled?: number }, errors0: string[], summary0: string, mode: CollectorResult['providerMode'] = 'api'): CollectorResult => {
  // #651: 깨진 글자로 뺀 건이 있으면 요약·오류 줄에 — 응답 인코딩(charset) 문제를 수집 카드에서 바로 보이게
  const errors = r.garbled ? [...errors0, `깨진 글자 ${r.garbled}건 제외 — 응답 인코딩(charset) 확인`] : errors0;
  const summary = r.garbled ? `${summary0} · 깨진 글자 ${r.garbled}건 제외` : summary0;
  return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: errors.length, errorLog: errors.length ? errors.join('\n').slice(0, 4000) : undefined, summary, providerMode: mode };
};

/** 회사 프로필에 적힌 본점 시·도(최대 4곳) — 기업마당 hashtags=경기 처럼 지역 공고를 따로 더 받는다(최신 500건 밖의 지역 공고도 잡히게) */
async function profileRegions(): Promise<string[]> {
  const rows = await db()<{ r: string }[]>`select region_sido as r, count(*)::int n from support_profiles where region_sido is not null group by 1 order by n desc limit 4`.catch(() => []);
  return rows.map((x) => x.r).filter((r) => SIDO.includes(r));
}
export const bizinfoSupport: Collector = {
  slug: 'bizinfo_support', label: '지원사업 · 기업마당', hourKst: 8, againKst: 14, source: '기업마당 지원사업정보 API(중앙부처·지자체 지원사업 공고, 최신 500건 + 회사 본점 지역 해시태그) — 인증키는 기업마당 \'API 사용 신청\'(플랫폼 운영 › 지원사업 원천 인증키). 키가 없으면 공공데이터포털 기업마당 데이터(15157820)로', needs: ['BIZINFO_API_KEY'],
  keyReady: async () => { const k = await supportKeys(); return !!(k.bizinfo || k.datago); },
  async run(ctx) {
    const keys = await supportKeys(); const ep = await endpoints(); const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started);
    const regions = await profileRegions(); const items: ProgramIn[] = []; const errors: string[] = []; let got = 0, keys1 = ''; const calls: string[] = [];
    const take = (list: any[]) => { got += list.length; if (!keys1) keys1 = keysOf(list); for (const it of list) { const p = bizinfoProgram(it); if (p) items.push(p); } };
    if (keys.bizinfo) { // 기업마당 직접(crtfcKey)
      for (const tag of [null, ...regions]) {
        if (left() < 8000) { errors.push(`시간 한도 근접 — ${tag ?? '전체'}부터는 다음 실행에서`); break; }
        const url = new URL(ep.bizinfo_support);
        url.searchParams.set('crtfcKey', keys.bizinfo); url.searchParams.set('dataType', 'json'); url.searchParams.set('searchCnt', String(Number(ctx.params?.count) || (tag ? 300 : 500)));
        if (tag) url.searchParams.set('hashtags', tag);
        try { const { json, text } = await fetchSource(url, ctx, keys.bizinfo, Math.min(25000, left() - 3000)); take(json ? arrOf(json) : xmlItems(text)); calls.push(tag ?? '전체'); }
        catch (e) { errors.push(`${tag ?? '전체'}: ${e instanceof Error ? e.message : String(e)}`); if (!tag) break; }
      }
    } else if (keys.datago) { // 공공데이터포털 '중소기업 지원사업 공고 조회'(기업마당 데이터, 15157820) — 같은 칸 이름
      for (const [tag, page] of [[null, 1], [null, 2], ...regions.map((r) => [r, 1] as const)] as const) {
        if (left() < 8000) { errors.push('시간 한도 근접 — 나머지는 다음 실행에서'); break; }
        const url = new URL(ep.bizinfo_datago_support);
        url.searchParams.set('serviceKey', keys.datago); url.searchParams.set('dataType', 'json'); url.searchParams.set('type', 'json'); url.searchParams.set('pageNo', String(page)); url.searchParams.set('numOfRows', '300');
        if (tag) url.searchParams.set('hashtags', tag);
        try { const { json, text } = await fetchSource(url, ctx, keys.datago, Math.min(20000, left() - 3000), '15157820'); const list = json ? arrOf(json) : xmlItems(text); take(list); calls.push(`포털 ${tag ?? '전체'} ${page}쪽`); if (!tag && list.length < 300) break; }
        catch (e) { errors.push(`공공데이터포털 ${tag ?? '전체'}: ${e instanceof Error ? e.message : String(e)}`); break; }
      }
    } else return done({ inserted: 0, updated: 0, unchanged: 0 }, [], '기업마당: 인증키 입력 필요 — 건너뜀(플랫폼 운영 › 지원사업 원천 인증키 또는 BIZINFO_API_KEY)');
    if (!items.length) { if (got) errors.push(`공고 칸을 찾지 못함 — 받은 칸: ${keys1}`); return done({ inserted: 0, updated: 0, unchanged: 0 }, errors, !calls.length && errors.length ? `기업마당: ${firstErr(errors)}` : `기업마당: ${calls.join('·') || '호출 실패'} · 받은 ${got}건 · 공고 0건${got ? ` (칸: ${keys1})` : ''}`); }
    const r = await upsertPrograms(items);
    return done(r, errors, `기업마당(${keys.bizinfo ? '직접' : '공공데이터포털'}: ${calls.join('·')}): 공고 ${items.length}건 · 신규 ${r.inserted} · 바뀜 ${r.updated} · 변화없음 ${r.unchanged}`);
  },
};

// ---------- K-Startup(창업진흥원, data.go.kr) ----------
export function kstartupProgram(it: any): ProgramIn | null {
  const title = pick(it, 'biz_pbanc_nm', 'intg_pbanc_biz_nm', 'pbancNm', 'title'); if (!title) return null;
  const id = pick(it, 'pbanc_sn', 'pbancSn', 'id') ?? h16(title);
  const regionText = pick(it, 'supt_regin', 'suptRegin') ?? '';
  const regions = /전국/.test(regionText) ? [] : sidoIn(regionText.replace(/,/g, ' '));
  const target = [pick(it, 'aply_trgt'), pick(it, 'aply_trgt_ctnt'), pick(it, 'biz_trgt_age') && `연령 ${pick(it, 'biz_trgt_age')}`, pick(it, 'aply_excl_trgt_ctnt') && `제외: ${pick(it, 'aply_excl_trgt_ctnt')}`].filter(Boolean).join(' · ') || null;
  const summary = [plain(pick(it, 'pbanc_ctnt', 'description')), pick(it, 'aply_mthd_onli_rcpt_istc') ? `신청 방법: ${pick(it, 'aply_mthd_onli_rcpt_istc')}` : '', pick(it, 'prch_cnpl_no') ? `문의: ${pick(it, 'prch_cnpl_no')}` : ''].filter(Boolean).join('\n\n').slice(0, 20000) || null;
  const start = datesIn(pick(it, 'pbanc_rcpt_bgng_dt'))[0]?.day ?? null; const end = datesIn(pick(it, 'pbanc_rcpt_end_dt'))[0]?.day ?? null;
  // 상세 = detl_pg_url(상세 페이지), 신청 = biz_aply_url(사업 신청) — 칸 이름 기준. 둘 중 하나만 오면 그것을 공고 링크로
  const applyUrl = pick(it, 'biz_aply_url', 'aply_mthd_onli_rcpt_istc'); const detail = pick(it, 'detl_pg_url', 'biz_aply_url');
  return {
    source: 'kstartup', source_id: String(id), title: title.slice(0, 300), agency: pick(it, 'sprv_inst', 'pbanc_ntrp_nm'), executor: pick(it, 'biz_prch_dprt_nm', 'pbanc_ntrp_nm'), category: pick(it, 'supt_biz_clsfc'),
    target, regions, nationwide: !regions.length, summary, apply_start: start, apply_end: end, apply_text: [pick(it, 'pbanc_rcpt_bgng_dt'), pick(it, 'pbanc_rcpt_end_dt')].filter(Boolean).join(' ~ ') || null,
    amount: amountIn(`${title} ${summary ?? ''}`), biz_years: pick(it, 'biz_enyy'),
    url: absUrl(detail, 'https://www.k-startup.go.kr') ?? `https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=${encodeURIComponent(String(id))}`,
    apply_url: applyUrl && /^https?:\/\//.test(applyUrl) && applyUrl !== detail ? applyUrl : null, attachments: [], hashtags: [], raw: rawOf(it), posted_at: null,
  };
}
export const kstartupSupport: Collector = {
  slug: 'kstartup_support', label: '지원사업 · K-Startup', hourKst: 8, againKst: 14, source: 'K-Startup 사업공고(창업진흥원, 공공데이터포털 — 모집 중 공고). 공공데이터포털 인증키에 이 서비스 활용신청 필요', needs: ['DATA_GO_KR_SERVICE_KEY(K-Startup 활용신청)'],
  keyReady: async () => !!(await supportKeys()).datago,
  async run(ctx) {
    const key = (await supportKeys()).datago;
    if (!key) return done({ inserted: 0, updated: 0, unchanged: 0 }, [], 'K-Startup: 공공데이터포털 인증키 입력 필요 — 건너뜀');
    const base = (await endpoints()).kstartup_support; const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started);
    const items: ProgramIn[] = []; const errors: string[] = []; let pages = 0, got = 0, keys = '';
    for (let page = 1; page <= 10; page++) {
      if (left() < 6000) { errors.push(`시간 한도 근접 — ${page}쪽부터는 다음 실행에서`); break; }
      const url = new URL(base);
      url.searchParams.set('serviceKey', key); url.searchParams.set('page', String(page)); url.searchParams.set('perPage', '100'); url.searchParams.set('returnType', 'json'); url.searchParams.set('cond[rcrt_prgs_yn::EQ]', 'Y');
      url.searchParams.set('cond[pbanc_rcpt_end_dt::GTE]', ymdKst().replace(/-/g, '')); // 접수 마감이 오늘 이후(모집 중)
      let list: any[];
      try { const { json, text } = await fetchSource(url, ctx, key, Math.min(15000, left() - 2000), '15125364'); list = json ? arrOf(json) : xmlItems(text); }
      catch (e) { errors.push(`${page}쪽: ${e instanceof Error ? e.message : String(e)}`); break; }
      pages++; got += list.length; if (!keys) keys = keysOf(list);
      for (const it of list) { const p = kstartupProgram(it); if (p) items.push(p); }
      if (list.length < 100) break;
    }
    if (!items.length) { if (got) errors.push(`공고 칸을 찾지 못함 — 받은 칸: ${keys}`); return done({ inserted: 0, updated: 0, unchanged: 0 }, errors, !pages && errors.length ? `K-Startup: ${firstErr(errors)}` : `K-Startup: ${pages}쪽 · 받은 ${got}건 · 공고 0건`); }
    const r = await upsertPrograms(items);
    return done(r, errors, `K-Startup: ${pages}쪽 · 공고 ${items.length}건 · 신규 ${r.inserted} · 바뀜 ${r.updated} · 변화없음 ${r.unchanged}`);
  },
};

// ---------- 정부24 공공서비스(혜택) — #788(대표 10/29 00:40·00:50 승인) ----------
/** 행정안전부 '대한민국 공공서비스(혜택) 정보'(공공데이터포털 15113968, api.odcloud.kr gov24 v3). 사용자구분이 소상공인·법인/시설/단체인 서비스만(개인·가구 빼고) */
const GOV24_USER = /소상공인|법인|단체|시설/;
const ts14 = (v: string | null) => { const m = String(v ?? '').match(/^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/) ?? String(v ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):?(\d{2})?)?/);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}+09:00` : null; };
export function gov24Program(it: any): ProgramIn | null {
  const id = pick(it, '서비스ID'); const title = pick(it, '서비스명'); if (!id || !title) return null;
  const users = pick(it, '사용자구분') ?? ''; if (!GOV24_USER.test(users)) return null;
  const kind = pick(it, '지원유형'); const field = pick(it, '서비스분야'); const agency = pick(it, '소관기관명'); const agencyType = pick(it, '소관기관유형');
  const dtype = pick(it, '신청기한유형'); const dl = pick(it, '신청기한'); const per = parsePeriod(dl);
  const always = /상시/.test(`${dtype ?? ''} ${dl ?? ''}`) && !per.end;
  const regions = /지방|지자체|자치|광역|기초|시·?도|시군구/.test(agencyType ?? '') ? sidoIn(agency) : [];
  const content = pick(it, '지원내용');
  return {
    source: 'gov24', source_id: id, title: title.slice(0, 300), agency, executor: pick(it, '부서명', '접수기관'), category: [kind, field].filter(Boolean).join(' · ') || null,
    target: [pick(it, '지원대상'), pick(it, '선정기준') ? `선정기준: ${pick(it, '선정기준')}` : null].filter(Boolean).join('\n').slice(0, 4000) || null, regions, nationwide: !regions.length,
    summary: [pick(it, '서비스목적요약'), content ? `지원내용: ${content}` : null, pick(it, '신청방법') ? `신청방법: ${pick(it, '신청방법')}` : null, pick(it, '접수기관') ? `접수기관: ${pick(it, '접수기관')}` : null,
      pick(it, '전화문의') ? `문의: ${pick(it, '전화문의')}` : null].filter(Boolean).join('\n\n').slice(0, 20000) || null,
    apply_start: always ? null : per.start, apply_end: always ? null : per.end, apply_text: always ? `상시 신청${dl && !/^상시/.test(dl) ? ` · ${dl}` : ''}` : dl, amount: amountIn(content), biz_years: null,
    url: pick(it, '상세조회URL'), apply_url: null, attachments: [], hashtags: [kind, field].filter((x): x is string => !!x),
    raw: { 사용자구분: users, 소관기관유형: agencyType, 서비스분야: field, 지원유형: kind, 신청기한유형: dtype, 수정일시: pick(it, '수정일시'), 등록일시: pick(it, '등록일시') }, posted_at: ts14(pick(it, '등록일시')),
  };
}
/** supportConditions 한 줄 → 'Y' 인 JA 코드(소상공인 JA11xx·법인/단체 JA21xx·업종 JA12xx/JA22xx만 — 개인 조건은 버림) */
export const gov24Conds = (row: any): string[] => Object.keys(row ?? {}).filter((k) => /^JA(1[12]|2[12])\d\d$/.test(k) && /^(Y|y|1|true)$/.test(String(row[k] ?? '').trim())).sort();
type Gov24State = { phase: 'list' | 'cond' | 'idle'; page: number; condPage: number; total: number | null; fullAt: string | null; maxMod: string | null; kept: number };
const GOV24_PER = 500; const GOV24_FULL_DAYS = 7; const GOV24_COND_IDS = 40;
export const gov24Support: Collector = {
  slug: 'gov24_support', label: '지원사업 · 정부24 지원금', hourKst: 7, againKst: [9, 11, 13, 15, 17, 19, 21],
  source: '행정안전부 대한민국 공공서비스(혜택) 정보(정부24, 공공데이터포털 15113968) — 소상공인·법인/시설/단체 대상 서비스만. 처음엔 전체(약 1만 건)를 여러 번에 나눠 받고, 그 뒤엔 바뀐 것만(7일마다 전체 한 번)',
  needs: ['DATA_GO_KR_SERVICE_KEY(15113968 활용신청)'],
  keyReady: async () => !!(await supportKeys()).datago,
  async run(ctx) {
    const key = (await supportKeys()).datago;
    if (!key) return done({ inserted: 0, updated: 0, unchanged: 0 }, [], '정부24: 공공데이터포털 인증키 입력 필요 — 건너뜀');
    const sql = db(); const base = (await endpoints()).gov24_support.replace(/\/$/, ''); const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started);
    const [s0] = await sql<{ value: Partial<Gov24State> }[]>`select value from app_settings where key = 'gov24_sync'`;
    const st: Gov24State = { phase: 'list', page: 1, condPage: 1, total: null, fullAt: null, maxMod: null, kept: 0, ...(s0?.value ?? {}) };
    if (st.phase === 'idle' && (!st.fullAt || Date.now() - Date.parse(st.fullAt) > GOV24_FULL_DAYS * 864e5)) Object.assign(st, { phase: 'list', page: 1, condPage: 1, kept: 0 }); // 7일마다 전체 한 번(없어진 서비스·마지막 확인 시각)
    const save = () => sql`insert into app_settings (key, value) values ('gov24_sync', ${sql.json(st as never)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
    const call = async (op: string, params: Record<string, string>) => {
      const url = new URL(`${base}/${op}`); url.searchParams.set('serviceKey', key); url.searchParams.set('returnType', 'JSON');
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      const { json } = await fetchSource(url, ctx, key, Math.min(25000, left() - 3000), '15113968');
      return { list: arrOf(json), total: Number(json?.totalCount ?? json?.matchCount ?? 0) || null };
    };
    const items: ProgramIn[] = []; const errors: string[] = []; let got = 0, pages = 0, conds = 0, firstFill = false; const prevMax = st.maxMod;
    const take = (list: any[]) => { got += list.length; for (const it of list) { const p = gov24Program(it); if (p) items.push(p); const m = pick(it, '수정일시'); if (m && (!st.maxMod || m > st.maxMod)) st.maxMod = m; } };
    const setConds = async (rows: any[], only?: Set<string>) => {
      for (const r of rows) { const id = pick(r, '서비스ID'); if (!id || (only && !only.has(id))) continue; const c = gov24Conds(r);
        const u = await sql`update support_programs set conditions = ${c} where tenant is null and source = 'gov24' and source_id = ${id} and conditions is distinct from ${c}::text[]`; conds += u.count; }
    };
    try {
      if (st.phase === 'list') { // 전체 받기 — 쪽마다 저장해 다음 실행이 이어 받음
        while (left() > 8000) {
          const { list, total } = await call('serviceList', { page: String(st.page), perPage: String(GOV24_PER) }); pages++; take(list); st.total = total ?? st.total;
          st.page++; if (!list.length || (st.total != null && (st.page - 1) * GOV24_PER >= st.total)) { st.phase = 'cond'; st.condPage = 1; break; }
        }
      } else if (st.phase === 'idle' && st.maxMod) { // 바뀐 것만(수정일시 이후)
        for (let page = 1; left() > 8000; page++) { const { list } = await call('serviceList', { page: String(page), perPage: String(GOV24_PER), 'cond[수정일시::GTE]': st.maxMod }); pages++; take(list); if (list.length < GOV24_PER) break; }
      }
    } catch (e) { errors.push(`목록: ${e instanceof Error ? e.message : String(e)}`); }
    const r = items.length ? await upsertPrograms(items) : { inserted: 0, updated: 0, unchanged: 0 };
    st.kept += st.phase === 'idle' ? 0 : items.length;
    try {
      if (st.phase === 'cond') { // 지원 조건(소상공인·법인·업종 코드) — 전체를 쪽으로 받아 남긴 서비스만
        const mine = new Set((await sql<{ source_id: string }[]>`select source_id from support_programs where tenant is null and source = 'gov24'`).map((x) => x.source_id));
        while (left() > 8000) {
          const { list, total } = await call('supportConditions', { page: String(st.condPage), perPage: '1000' }); pages++; await setConds(list, mine);
          st.condPage++; if (!list.length || (total != null && (st.condPage - 1) * 1000 >= total)) { st.phase = 'idle'; st.fullAt = new Date().toISOString(); firstFill = !s0?.value?.fullAt; break; }
        }
      } else if (st.phase === 'idle' && items.length) { // 바뀐 서비스만 하나씩(지난번 마지막 수정일시와 같은 것은 이미 받음)
        for (const p of items.filter((x) => !prevMax || String(x.raw?.수정일시 ?? '') > prevMax).slice(0, GOV24_COND_IDS)) { if (left() < 6000) break; const { list } = await call('supportConditions', { page: '1', perPage: '1', 'cond[서비스ID::EQ]': p.source_id }); await setConds(list); }
      }
    } catch (e) { errors.push(`지원 조건: ${e instanceof Error ? e.message : String(e)}`); }
    await save();
    const phase = st.phase === 'list' ? `전체 받는 중 ${Math.min(st.total ?? 0, (st.page - 1) * GOV24_PER)}/${st.total ?? '?'}건` : st.phase === 'cond' ? `지원 조건 받는 중 ${(st.condPage - 1) * 1000}/${st.total ?? '?'}건` : `바뀐 것만(마지막 전체 ${st.fullAt?.slice(0, 10) ?? '-'})`;
    if (!got && errors.length) return done(r, errors, `정부24: ${firstErr(errors)}`);
    // 처음 다 채웠을 때 — 자동 AI 판단(#785) 대상이 될 수 있는 수·예상 비용(1차 규칙 '해당 없음'·마감 지난 것은 판단 안 함 → 실제는 이보다 적음)
    let note = '';
    if (firstFill) { const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from support_programs where tenant is null and source = 'gov24' and (apply_end is null or apply_end >= ${ymdKst()}::date)`;
      note = ` · 처음 채움 끝: 소상공인·법인 대상 ${n}건 — 자동 AI 판단은 회사 AI 예산 안에서 한 번에 10건씩, 많아야 약 ${(n * 2).toLocaleString('ko-KR')}원(건당 약 2원, 1차 규칙 '해당 없음'은 판단 안 함)`; }
    return done(r, errors, `정부24(${phase}): ${pages}번 호출 · 받은 ${got}건 중 소상공인·법인 대상 ${items.length}건 · 신규 ${r.inserted} · 바뀜 ${r.updated} · 변화없음 ${r.unchanged} · 조건 ${conds}${note}`);
  },
};

// ---------- 지원사업 감시 페이지(지자체·RIPC·진흥원 공지 게시판) ----------
/** detail: 상세가 자바스크립트 함수(fn_noticeView('1675'))인 게시판의 상세 주소 꼴('{id}' 자리에 함수 첫 인자) · all: 지원사업만 올리는 게시판(제목 낱말로 거르지 않음) */
export type SupportWatchPage = { name: string; url: string; region?: string | null; detail?: string | null; all?: boolean };
/** #787(로컬 10/29 00:50, 대표 승인 세 기관): 알려진 게시판 — 감시 목록에 주소만 넣어도 상세 주소·전용 게시판 규칙이 붙음 */
const KNOWN_BOARDS: { host: RegExp; detail?: string; all?: boolean }[] = [
  { host: /(^|\.)spobiz\.kspo\.or\.kr$/i, detail: '/front/sportsHistory/sportsBissMng/sportsBissNoticeDetail.do?suppBusiInfoSeq={id}', all: true }, // 국민체육진흥공단 스포츠산업지원 지원사업공고
  { host: /(^|\.)ybs\.ypa\.or\.kr$/i, detail: '/poratlAppFormDtl.do?regNo={id}', all: true }, // 용인기업지원시스템 지원사업 공고
  { host: /(^|\.)nipa\.kr$/i, all: true }, // 정보통신산업진흥원 사업공고
];
export function boardRule(p: Pick<SupportWatchPage, 'url' | 'detail' | 'all'>): { detail: string | null; all: boolean } {
  let host = ''; try { host = new URL(p.url).hostname; } catch { /* 아래 */ }
  const k = KNOWN_BOARDS.find((b) => b.host.test(host));
  return { detail: p.detail ?? k?.detail ?? null, all: p.all ?? k?.all ?? false };
}
export async function supportWatchPages(): Promise<SupportWatchPage[]> {
  const [s] = await db()<{ value: SupportWatchPage[] }[]>`select value from app_settings where key = 'support_watch_pages'`;
  const saved = Array.isArray(s?.value) ? s.value.filter((p) => p && /^https?:\/\//.test(String(p.url))) : [];
  if (process.env.SALES_COLLECT_TEST_BASE) return saved.length ? saved : [{ name: '시험 지식재산센터', url: `${process.env.SALES_COLLECT_TEST_BASE.replace(/\/$/, '')}/support/board`, region: '경기' }];
  return saved;
}
export const SUPPORT_RE = /(지원\s*사업|지원사업|참여\s*기업|수혜\s*기업|모집|공모|바우처|긴급\s*지원|지원\s*대상|신청\s*안내)/;
/** 지원사업이 아닌 글 — 결과 발표·채용·입찰·용역 계약(#787 NIPA '포럼 운영 용역 모집') */
export const NOT_SUPPORT_RE = /(결과\s*(발표|공고|안내)|선정\s*결과|최종\s*선정|합격|채용|입찰|낙찰|직원\s*모집|인턴|강사\s*모집|취소\s*공고|용역|설문\s*조사|만족도\s*조사)/;
export type BoardItem = { title: string; url: string; posted: string | null; start: string | null; end: string | null; period: string | null; org: string | null; cat: string | null };
const DAY = String.raw`20\d{2}\s*[.\-/]\s*\d{1,2}\s*[.\-/]\s*\d{1,2}\.?`;
const PERIOD = new RegExp(`(${DAY})(?:\\s*\\(?[월화수목금토일]\\)?)?(?:\\s*\\d{1,2}:\\d{2})?\\s*[~∼-]\\s*(${DAY})(?:\\s*\\(?[월화수목금토일]\\)?)?(?:\\s*\\d{1,2}(?::\\d{2}|시)(?:\\s*까지)?)?`);
const cls = (row: string, re: RegExp) => { const m = row.match(new RegExp(`<(\\w+)\\b[^>]*class="[^"]*\\b(?:${re.source})\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`, 'i')); return m ? plain(m[2]).replace(/\s+/g, ' ').trim() || null : null; };
/** 게시판 HTML → 지원사업 글(제목·상세 주소·게시일·신청 기간·기관·분류). #787: 주석 속 꼬리표(NIPA '<!-- [사업화] -->')는 지움 · 상세가 자바스크립트면 상세 주소 꼴로 ·
 *  상세 주소를 못 만드는 줄(메뉴·'#'·javascript:void(0))은 버림 · 날짜가 있는 줄이 있는 게시판이면 날짜 없는 줄(메뉴)도 버림 */
export function parseSupportBoard(html: string, base: string, opt: { detail?: string | null; all?: boolean } = {}): BoardItem[] {
  const src = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const rows: { title: string; url: string; text: string; org: string | null; cat: string | null }[] = []; const seen = new Set<string>();
  const add = (inner: string, attrs: string, row: string) => {
    const attr = (k: string) => attrs.match(new RegExp(`\\b${k}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'))?.[2]?.trim() ?? ''; // 속성 안의 다른 따옴표(onclick="fn_viewDetail('RGS_…')")까지
    const href = attr('href'); const onclick = attr('onclick');
    let url: string | null = null;
    if (href && !/^(javascript:|#)/i.test(href)) url = absUrl(href, base);
    else if (opt.detail) { const arg = `${href} ${onclick}`.match(/\b[A-Za-z_$][\w$]*\s*\(\s*['"]([^'"]+)['"]/)?.[1]; if (arg) url = absUrl(opt.detail.replace('{id}', encodeURIComponent(arg)), base); }
    if (!url || url.split('#')[0] === base.split('#')[0]) return;
    const t = (cls(inner, /pjtit|subject|tit|title/) ?? plain(inner)).replace(/\s+/g, ' ').replace(/^(?:\[?(?:공지|일반|긴급|N|NEW)\]?\s+)+/i, '').trim().slice(0, 200);
    if (!t || t.length < 6 || (!opt.all && !SUPPORT_RE.test(t)) || NOT_SUPPORT_RE.test(t) || seen.has(t)) return; seen.add(t);
    rows.push({ title: t, url, text: plain(row).replace(/\s+/g, ' '), org: cls(inner, /colorbox/) ?? cls(row, /colorbox/), cat: cls(inner, /linebox/) ?? cls(row, /linebox/) });
  };
  for (const m of src.matchAll(/<(tr|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) { const a = m[2].match(/<a\b([^>]*)>([\s\S]*?)<\/a>/i); if (a) add(a[2], a[1], m[2]); }
  if (!rows.length) for (const m of src.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) add(m[2], m[1], '');
  const out = rows.map((r) => {
    const pm = r.text.match(PERIOD); const per = pm ? parsePeriod(pm[0]) : null;
    const rest = pm ? r.text.replace(pm[0], ' ') : r.text; const posted = datesIn(rest)[0]?.day ?? null;
    return { title: r.title, url: r.url, posted: posted ?? per?.start ?? null, start: per?.start ?? null, end: per?.end ?? null, period: pm ? pm[0].replace(/\s+/g, ' ').trim() : null, org: r.org, cat: r.cat, dated: !!(pm || posted) };
  });
  const anyDated = out.some((x) => x.dated);
  return out.filter((x) => !anyDated || x.dated).map(({ dated: _d, ...x }) => x).slice(0, 40);
}
/** 상세 본문 → 신청 기간·지원 대상(#787: 감시 글은 목록에 기간·대상이 없을 때가 많아 1차 규칙이 약함) */
export function watchDetailFields(text: string): { start: string | null; end: string | null; period: string | null; target: string | null } {
  const t = String(text ?? '');
  const pm = t.match(/(?:신청|접수|모집|공모)\s*(?:기간|일정|기한)\s*[:：]?\s*\n?\s*([^\n]{4,80})/); const per = pm ? parsePeriod(pm[1]) : null;
  const tm = t.match(/(?:지원|신청|참여|모집|사업|참가)\s*대상\s*[:：]?\s*\n?\s*([^\n]{2,200})/);
  return { start: per?.start ?? null, end: per?.end ?? null, period: per && (per.start || per.end) ? pm![1].trim().slice(0, 80) : null, target: tm ? tm[1].trim().slice(0, 300) : null };
}
const WATCH_DETAIL_MAX = 8; // 한 번에 새 글 본문 읽기 수(게시판 기관에 부담 주지 않게)
export const supportWatch: Collector = {
  slug: 'support_watch', label: '지원사업 · 감시 페이지', hourKst: 8, againKst: 14, source: '지자체·지역지식재산센터(RIPC)·진흥원 공지 게시판(플랫폼 운영 › 지원사업 감시 페이지) — 지원·모집 글 제목·신청 기간(새 글은 본문의 기간·대상)',
  async run(ctx) {
    const pages = await supportWatchPages();
    if (!pages.length) return done({ inserted: 0, updated: 0, unchanged: 0 }, [], '감시 페이지 목록이 비어 있습니다(플랫폼 운영 › 지원사업 감시 페이지)', 'web_scrape');
    const sql = db(); const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const errors: string[] = []; const items: ProgramIn[] = []; const perPage: string[] = [];
    const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)' };
    for (const p of pages) {
      if (left() < 6000) { errors.push(`시간 한도 근접 — ${p.name} 부터는 다음 실행에서`); break; }
      try {
        const res = await ctx.fetchImpl(p.url, { headers: UA, signal: AbortSignal.timeout(Math.min(10000, left() - 2000)) });
        if (!res.ok) { errors.push(`${p.name}: HTTP ${res.status}`); continue; }
        const { text } = decodeKoreanText(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type'));
        const region = p.region && SIDO.includes(p.region) ? [p.region] : sidoIn(p.name);
        const found = parseSupportBoard(text, p.url, boardRule(p)); perPage.push(`${p.name} ${found.length}`);
        // 같은 상세 주소의 예전 글(제목 꼬리표가 붙어 들어온 것)은 그 번호 그대로 고침 — 같은 글이 둘이 되지 않게
        const prev = new Map((await sql<{ source_id: string; url: string }[]>`select source_id, url from support_programs where tenant is null and source = 'watch' and url = any(${found.map((r) => r.url)}::text[])`).map((x) => [x.url, x.source_id]));
        for (const r of found) {
          items.push({ source: 'watch', source_id: prev.get(r.url) ?? `${h16(p.url)}-${h16(r.url)}`, title: r.title, agency: p.name, executor: r.org, category: r.cat, target: null, regions: region, nationwide: !region.length, summary: null,
            apply_start: r.start, apply_end: r.end, apply_text: r.period, amount: amountIn(r.title), biz_years: null, url: r.url, apply_url: null, attachments: [], hashtags: [], raw: { page: p.url, name: p.name }, posted_at: r.posted });
        }
      } catch (e) { errors.push(`${p.name}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    // 새 글(본문을 아직 안 읽은 것)은 상세 본문에서 신청 기간·대상·본문 앞부분을 채움 — 한 번에 몇 건만
    const have = new Map((await sql<{ source_id: string; summary: string | null; target: string | null; apply_start: string | null; apply_end: string | null; apply_text: string | null; amount: string | null }[]>`select source_id, summary, target,
      apply_start::text, apply_end::text, apply_text, amount from support_programs where tenant is null and source = 'watch' and source_id = any(${items.map((x) => x.source_id)}::text[])`).map((x) => [x.source_id, x]));
    let read = 0;
    for (const it of items) {
      const h = have.get(it.source_id);
      if (h?.summary) { // 이미 읽은 본문에서 채운 칸은 그대로(목록에 없다고 지우지 않음 — 바뀜으로 안 셈)
        it.summary = h.summary; it.target = it.target ?? h.target; it.amount = it.amount ?? h.amount;
        if (!it.apply_end) { it.apply_start = it.apply_start ?? h.apply_start; it.apply_end = h.apply_end; it.apply_text = it.apply_text ?? h.apply_text; }
        continue;
      }
      if (!it.url || read >= WATCH_DETAIL_MAX || left() < 8000) continue;
      read++;
      const body = await watchDetailText(it.url, ctx.fetchImpl).catch(() => null);
      if (!body) continue;
      const i = body.lastIndexOf(it.title.slice(0, 15)); const main = (i >= 0 ? body.slice(i) : body).slice(0, 4000);
      const f = watchDetailFields(main);
      it.summary = main; it.target = f.target; if (!it.apply_end && f.end) { it.apply_start = it.apply_start ?? f.start; it.apply_end = f.end; it.apply_text = it.apply_text ?? f.period; }
      it.amount = it.amount ?? amountIn(main);
    }
    const r = items.length ? await upsertPrograms(items) : { inserted: 0, updated: 0, unchanged: 0 };
    return done(r, errors, `감시 ${pages.length}곳(${perPage.join(' · ')}) · 지원사업 글 ${items.length}건 · 본문 읽음 ${read} · 신규 ${r.inserted} · 바뀜 ${r.updated} · 변화없음 ${r.unchanged}`, 'web_scrape');
  },
};
/** 감시 페이지 글의 본문(AI 판단용) — 등록된 감시 페이지와 같은 호스트만 읽는다 */
export async function watchDetailText(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let host: string; try { host = new URL(url).host; } catch { return null; }
  if (!(await supportWatchPages()).some((p) => { try { return new URL(p.url).host === host; } catch { return false; } })) return null;
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)' }, signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = decodeKoreanText(new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type')).text;
    const body = html.match(/<(article|main)\b[\s\S]*?<\/\1>/i)?.[0] ?? html.match(/<body\b[\s\S]*<\/body>/i)?.[0] ?? html;
    return plain(body).slice(0, 12000) || null;
  } catch { return null; }
}
