// S1-4(로컬 10/20): 공고 첨부 중계 — 원본 영업관리 /api/bids/file(나라장터)·/api/bids/kapt-file(K-apt) 과 같은 규칙(SALES_FEATURES 118행):
// 로그인 필요 · 허용한 공공 사이트만(SSRF 방지) · https 만 · 30MB 상한 · 리다이렉트 따라가지 않음 · octet-stream 강제 내려받기 · 저장하지 않음(바로 흘려보냄)
// 앱 WebView 는 외부 사이트 첨부(hwp)를 못 받는 경우가 있어 같은 도메인 경로로 돌려준다.
// #507 후속(로컬 10/23 실측): K-apt 는 같은 쿠키로 ① 공고 상세(쿠키·_csrf) → ② 첨부 목록 POST(이때 세션에 받을 파일이 등록됨) → ③ /cmm/file/BID/fileDownload.do 순서여야 파일이 온다.
// 원천이 파일 대신 웹페이지를 보내면 파일로 넘기지 않고 '원문에서 받아 주세요' 안내. 이름은 응답 머리(UTF-8·EUC-KR·URL 인코딩) → 없으면 '<공고명 앞 30자> 첨부 n' + 첫 바이트로 본 확장자.
import { HttpError, badRequest } from '../errors';

const MAX = 30 * 1024 * 1024;
const UA = 'Mozilla/5.0 (WorkIn sales file relay)';
const DEFAULT_HOSTS = ['g2b.go.kr', 'ebid.lh.or.kr', 'apply.lh.or.kr', 'onbid.co.kr', 'nuri.go.kr', 'd2b.go.kr', 'k-apt.go.kr', 'bizinfo.go.kr', 'k-startup.go.kr', 'kg2b.com' /* 279차 #828 KG2B 공고서 */]; // #507 지원사업(기업마당·K-Startup) 첨부도
/** 허용 호스트: 기본 공공 사이트 + SALES_FILE_HOSTS(쉼표, 시험용) — 하위 도메인도 허용 */
export function fileHostAllowed(host: string) {
  const extra = (process.env.SALES_FILE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = host.toLowerCase();
  return [...DEFAULT_HOSTS, ...extra].some((d) => h === d || h.endsWith('.' + d));
}
export function isFileHost(url: string) { try { return fileHostAllowed(new URL(url).hostname); } catch { return false; } }
const safeName = (n: string) => n.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'file';

// ---- K-apt ----
/** K-apt 주소 바탕(시험: SALES_COLLECT_TEST_BASE/kapt — 수집기와 같은 가짜 원천) */
export const kaptBase = () => { const t = process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, ''); return t ? `${t}/kapt` : 'https://www.k-apt.go.kr'; };
export const kaptDetailUrl = (bid: string) => `${kaptBase()}/bid/bidDetail.do?bidNum=${encodeURIComponent(bid)}`;
/** 저장용 K-apt 첨부 주소(공고번호·파일 번호). 이 주소만으로는 K-apt 가 주지 않음 — 서버가 세션 순서를 밟아 받는다(중계·자동 첨부) */
export const kaptFileUrl = (bid: string, seq: string) => `${kaptBase()}/cmm/file/BID/fileDownload.do?key=${encodeURIComponent(seq)}&bidNum=${encodeURIComponent(bid)}`;
export const isKaptUrl = (url: string) => { try { const u = new URL(url); return /(^|\.)k-apt\.go\.kr$/i.test(u.hostname) || url.startsWith(`${kaptBase()}/`); } catch { return false; } };
/** K-apt 첨부 주소면 공고번호·파일 번호·이름 — 실제 받기 주소(fileDownload.do?key=)·원본 영업관리 주소(bidFileDown.do?fileSeq=)·옛 함수(bidFileDownload.do?fileNum=) 모두 */
export function kaptFileRef(url: string): { bid: string | null; seq: string; name: string | null } | null {
  if (!isKaptUrl(url)) return null;
  const u = new URL(url); const q = u.searchParams; const p = u.pathname.toLowerCase();
  const seq = p.endsWith('/cmm/file/bid/filedownload.do') ? q.get('key') : p.endsWith('/bid/bidfiledown.do') ? q.get('fileSeq') : p.endsWith('/bid/bidfiledownload.do') ? q.get('fileNum') : null;
  if (!seq || !/^\d{1,20}$/.test(seq)) return null;
  return { bid: q.get('bidNum') || null, seq, name: q.get('fileName') || null };
}
export type KaptSession = { cookie: string; csrf: string; csrfHeader: string; referer: string; html: string; status: number };
/** Set-Cookie 들을 이름별로 모아 Cookie 머리로 */
function addCookies(jar: Map<string, string>, r: Response) {
  const list: string[] = typeof (r.headers as any).getSetCookie === 'function' ? (r.headers as any).getSetCookie() : (r.headers.get('set-cookie') ?? '').split(/,(?=\s*[^;,=\s]+=)/);
  for (const c of list) { const m = /^\s*([^=;\s]+)=([^;]*)/.exec(c); if (m) jar.set(m[1], m[2]); }
}
const cookieOf = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
/** 페이지의 CSRF 값·머리 이름(<meta name="_csrf" content> — 속성 순서 무관, 예전 화면은 <input name="_csrf" value>) */
export function csrfOf(html: string): { token: string; header: string } {
  const tag = (name: string) => [...html.matchAll(/<(?:meta|input)\b[^>]*>/gi)].map((m) => m[0]).find((t) => new RegExp(`\\bname=["']${name}["']`, 'i').test(t)) ?? '';
  const val = (t: string) => /\b(?:content|value)=["']([^"']+)["']/i.exec(t)?.[1] ?? '';
  return { token: val(tag('_csrf')), header: val(tag('_csrf_header')) || 'X-CSRF-TOKEN' };
}
/** ① 공고 상세를 열어 세션(JSESSIONID·KHANUSER)과 _csrf 를 받음. 같은 사이트 안 리다이렉트는 쿠키를 들고 3번까지 */
export async function kaptSession(bid: string, f: typeof fetch = fetch, timeoutMs = 15_000): Promise<KaptSession> {
  const jar = new Map<string, string>(); const referer = kaptDetailUrl(bid); let url = referer; let r: Response | null = null;
  for (let hop = 0; hop < 3; hop++) {
    r = await f(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*', 'accept-language': 'ko-KR', ...(jar.size ? { cookie: cookieOf(jar) } : {}) } });
    addCookies(jar, r);
    const loc = r.status >= 300 && r.status < 400 ? r.headers.get('location') : null;
    if (!loc) break;
    const next = new URL(loc, url); if (next.host !== new URL(referer).host) break;
    await r.body?.cancel().catch(() => {}); url = next.toString();
  }
  const html = r ? await r.text().catch(() => '') : '';
  const c = csrfOf(html);
  return { cookie: cookieOf(jar), csrf: c.token, csrfHeader: c.header, referer, html, status: r?.status ?? 0 };
}
export type KaptFile = { seq: string; name: string | null };
/** 첨부 목록 응답 → 파일 번호·이름. JSON {code:'SCC', data:[{seq, fileName}]}(Accept json) · XML <Res><data><seq/><fileName/></data></Res> · HTML 링크(fileSeq=·fileDown('…')) */
export function parseKaptFileList(body: string): KaptFile[] {
  const out: KaptFile[] = []; const seen = new Set<string>();
  const push = (seq: unknown, name: unknown) => { const s = String(seq ?? '').trim(); if (!/^\d{1,20}$/.test(s) || seen.has(s)) return; seen.add(s); const n = String(name ?? '').replace(/\s+/g, ' ').trim(); out.push({ seq: s, name: n ? n.slice(0, 200) : null }); };
  const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const hit = Object.keys(o).find((x) => x.toLowerCase() === k); if (hit && o[hit] != null && o[hit] !== '') return o[hit]; } return null; };
  let j: any = undefined; try { j = JSON.parse(body); } catch { /* XML·HTML */ }
  if (j !== undefined) {
    const data = j?.data ?? j?.list ?? j?.fileList ?? j?.resultList ?? j;
    for (const it of Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : []) if (it && typeof it === 'object') push(pick(it, 'seq', 'fileseq', 'key', 'filenum'), pick(it, 'filename', 'orgfilename', 'orgfilenm', 'filenm', 'name'));
    return out;
  }
  const xmlText = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  for (const m of body.matchAll(/<data>([\s\S]*?)<\/data>/gi)) push(xmlText(/<seq>([\s\S]*?)<\/seq>/i.exec(m[1])?.[1] ?? ''), xmlText(/<fileName>([\s\S]*?)<\/fileName>/i.exec(m[1])?.[1] ?? ''));
  if (out.length) return out;
  for (const m of body.matchAll(/<a\b[^>]*?(?:fileSeq=|key=|[Ff]ile[Dd]own\w*\(\s*['"]?)(\d{1,20})[^>]*>([\s\S]*?)<\/a>/g)) push(m[1], xmlText(m[2]));
  return out;
}
/** ② 첨부 목록(로컬 10/23 실측): POST /bid/bidFileListData.do?seq=BID_FILE, 본문 JSON {bidNum}, X-CSRF-TOKEN·같은 쿠키·Referer. 이 호출이 세션에 받을 파일을 등록한다 */
export async function kaptFileList(bid: string, opt: { fetchImpl?: typeof fetch; session?: KaptSession; timeoutMs?: number } = {}): Promise<KaptFile[]> {
  const f = opt.fetchImpl ?? fetch; const s = opt.session ?? await kaptSession(bid, f);
  if (!s.cookie) throw new HttpError(502, 'kapt_session', 'K-apt 세션을 열지 못했습니다');
  const r = await f(`${kaptBase()}/bid/bidFileListData.do?seq=BID_FILE`, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(opt.timeoutMs ?? 10_000), body: JSON.stringify({ bidNum: bid }),
    headers: { 'user-agent': UA, accept: 'application/json, text/javascript, */*; q=0.01', 'content-type': 'application/json; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest', referer: s.referer, cookie: s.cookie, ...(s.csrf ? { [s.csrfHeader]: s.csrf } : {}) } });
  const text = await r.text().catch(() => '');
  if (!r.ok) throw new HttpError(502, 'kapt_list', `K-apt 첨부 목록을 읽지 못했습니다(${r.status})`);
  if (/<state>\s*csrf\s*<\/state>/i.test(text)) throw new HttpError(502, 'kapt_list', 'K-apt 첨부 목록을 읽지 못했습니다(보안 값 거절)');
  const code = /^\s*\{/.test(text) ? (() => { try { return JSON.parse(text)?.code ?? null; } catch { return null; } })() : /<code>([^<]*)<\/code>/i.exec(text)?.[1] ?? null;
  if (code && code !== 'SCC') throw new HttpError(502, 'kapt_list', `K-apt 첨부 목록을 읽지 못했습니다(${String(code).slice(0, 20)})`);
  return parseKaptFileList(text);
}

// ---- 받기 ----
type Opened = { u: URL; r: Response; len: number; head: Uint8Array; body: ReadableStream<Uint8Array>; page: boolean; nameHint?: string | null };
/** 앞 몇 바이트를 먼저 읽고(웹페이지인지·확장자 판별) 나머지는 그대로 이어지는 흐름 */
async function peek(src: ReadableStream<Uint8Array>): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
  const reader = src.getReader(); const chunks: Uint8Array[] = []; let n = 0; let ended = false;
  while (n < 1024) { const { done, value } = await reader.read(); if (done) { ended = true; break; } chunks.push(value); n += value.byteLength; }
  const head = Buffer.concat(chunks);
  const body = new ReadableStream<Uint8Array>({
    start(ctrl) { if (head.byteLength) ctrl.enqueue(new Uint8Array(head)); if (ended) ctrl.close(); },
    async pull(ctrl) { if (ended) return; const { done, value } = await reader.read(); if (done) { ended = true; ctrl.close(); } else ctrl.enqueue(value); },
    cancel(reason) { return reader.cancel(reason); },
  });
  return { head, body };
}
/** 첫 바이트로 확장자(로컬 10/23): PK+hwp → hwpx · PK+word/xl/ppt → docx/xlsx/pptx · 그 밖 PK → zip · D0CF(OLE) → hwp(워드·엑셀·파워포인트 표시가 있으면 doc/xls/ppt) · %PDF → pdf · 그림 */
export function sniffExt(b: Uint8Array): string | null {
  if (b.byteLength < 4) return null;
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  const part = buf.byteLength > 131072 ? Buffer.concat([buf.subarray(0, 65536), buf.subarray(buf.byteLength - 65536)]) : buf; // 앞(첫 항목)·뒤(zip 목록)
  const s = part.toString('latin1'); const u16 = (t: string) => s.includes(Buffer.from(t, 'utf16le').toString('latin1'));
  if (s.startsWith('%PDF')) return 'pdf';
  if (s.startsWith('PK\x03\x04')) return /hwp\+zip|Contents\/section\d+\.xml/i.test(s) ? 'hwpx' : s.includes('word/') ? 'docx' : s.includes('xl/') ? 'xlsx' : s.includes('ppt/') ? 'pptx' : 'zip';
  if (s.startsWith('\xd0\xcf\x11\xe0')) return s.includes('HWP Document File') ? 'hwp' : u16('WordDocument') ? 'doc' : u16('Workbook') ? 'xls' : u16('PowerPoint Document') ? 'ppt' : 'hwp';
  if (s.startsWith('\x89PNG')) return 'png';
  if (s.startsWith('\xff\xd8\xff')) return 'jpg';
  if (s.startsWith('GIF8')) return 'gif';
  return null;
}
/** 파일 대신 웹페이지(로그인·세션 만료·오류 화면)인가 — 파일 표시(PDF·ZIP·OLE·그림)가 있으면 파일, 비었거나 HTML 로 시작하거나 text/html 이면 웹페이지 */
function isPage(ct: string, head: Uint8Array) {
  if (!head.byteLength) return true;
  if (sniffExt(head)) return false;
  const s = Buffer.from(head).toString('latin1').replace(/^\xef\xbb\xbf/, '').trimStart();
  return /^<(!doctype\s+html|html|head|body|script|meta|title|!--)/i.test(s) || /^(text\/html|application\/xhtml\+xml)$/.test(ct);
}
/** 허용 사이트·https·리다이렉트 금지·30MB(content-length) 확인 뒤 응답을 열고 앞부분을 본다 — 중계(relayFile)·서버 저장(fetchFile) 같은 규칙 */
async function openChecked(rawUrl: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Opened> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw badRequest('첨부 주소가 올바르지 않습니다'); }
  const allowHttp = !!process.env.SALES_FILE_HOSTS && /^(127\.0\.0\.1|localhost)$/.test(u.hostname); // 시험용 가짜 서버만 http
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) throw badRequest('https 주소만 받을 수 있습니다');
  if (!fileHostAllowed(u.hostname)) throw new HttpError(403, 'file_host', '허용한 공공 사이트(나라장터·LH·온비드·누리장터·국방·K-apt·기업마당·K-Startup)의 첨부만 받을 수 있습니다');
  let r: Response;
  try { r = await fetch(u, { method: init.method ?? 'GET', body: init.body, redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': UA, accept: '*/*', ...init.headers } }); }
  catch (e: any) { throw new HttpError(502, 'file_fetch', `첨부를 받지 못했습니다: ${String(e?.message ?? e).slice(0, 120)}`); }
  if (r.status >= 300 && r.status < 400) throw new HttpError(502, 'file_redirect', '첨부 주소가 다른 곳으로 넘어가 받지 않았습니다 — 원문에서 직접 받아 주세요');
  if (!r.ok || !r.body) { await r.body?.cancel().catch(() => {}); throw new HttpError(502, 'file_fetch', `첨부를 받지 못했습니다(${r.status})`); }
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX) { await r.body.cancel().catch(() => {}); throw new HttpError(413, 'file_too_big', '30MB 넘는 첨부는 원문에서 직접 받아 주세요'); }
  const { head, body } = await peek(r.body);
  return { u, r, len, head, body, page: isPage((r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), head) };
}
/** ①②③ K-apt: 상세(쿠키·_csrf) → 첨부 목록(세션에 등록·그 공고의 첨부인지 확인·원래 이름) → 같은 쿠키로 fileDownload.do. 단계 실패는 kapt_* (중계는 안내 화면) */
async function openKapt(ref: { bid: string | null; seq: string; name: string | null }, bidHint?: string | null): Promise<Opened> {
  const bid = ref.bid ?? bidHint ?? null;
  if (!bid) throw new HttpError(502, 'kapt_no_bid', 'K-apt 공고번호를 몰라 받지 못했습니다 — 원문에서 받아 주세요');
  let s: KaptSession; let list: KaptFile[];
  try { s = await kaptSession(bid); list = await kaptFileList(bid, { session: s }); }
  catch (e) { throw e instanceof HttpError ? new HttpError(502, 'kapt_list', `${e.message} — 원문에서 받아 주세요`) : new HttpError(502, 'file_fetch', `K-apt 에 연결하지 못했습니다: ${String((e as Error)?.message ?? e).slice(0, 100)}`); }
  const item = list.find((x) => x.seq === ref.seq);
  if (!item) throw new HttpError(502, 'kapt_missing', '그 공고의 첨부 목록에 없는 파일입니다(정정·삭제됐을 수 있음) — 원문에서 받아 주세요');
  const o = await openChecked(`${kaptBase()}/cmm/file/BID/fileDownload.do?key=${encodeURIComponent(item.seq)}&fileName=${encodeURIComponent(item.name ?? ref.name ?? '')}&_cb=${Date.now()}`, { headers: { cookie: s.cookie, referer: s.referer, 'accept-language': 'ko-KR' } });
  return { ...o, nameHint: item.name };
}
async function openFile(rawUrl: string, bidHint?: string | null): Promise<Opened> {
  const k = kaptFileRef(rawUrl);
  return k ? openKapt(k, bidHint) : openChecked(rawUrl);
}

// ---- 이름 ----
const FILE_EXT = /^(hwp|hwpx|hwt|pdf|zip|7z|egg|alz|doc|docx|xls|xlsx|csv|ppt|pptx|odt|ods|rtf|txt|jpg|jpeg|png|gif|bmp|tif|tiff)$/;
const extOf = (n: string) => /\.([a-z0-9]{1,5})$/i.exec(n)?.[1]?.toLowerCase() ?? '';
/** 바이트 → 글자: UTF-8 이 맞으면 UTF-8, 아니면 EUC-KR(CP949) */
function decodeBytes(b: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* 아래로 */ }
  try { return new TextDecoder('euc-kr').decode(b); } catch { return Buffer.from(b).toString('latin1'); }
}
/** %XX 풀기(자바 URLEncoder 는 빈칸을 + 로) — 글자표가 주어지면 그것으로, 아니면 UTF-8 → EUC-KR */
function pctDecode(s: string, charset?: string | null): string {
  const bytes: number[] = []; const t = s.replace(/\+/g, ' ');
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '%' && /^[0-9a-f]{2}$/i.test(t.slice(i + 1, i + 3))) { bytes.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
    else { const c = t.charCodeAt(i); if (c < 0x100) bytes.push(c); else bytes.push(...Buffer.from(t[i], 'utf8')); }
  }
  const b = Uint8Array.from(bytes);
  if (charset && !/^utf-?8$/i.test(charset)) { try { return new TextDecoder(/ks_c_5601|cp949|ms949/i.test(charset) ? 'euc-kr' : charset.toLowerCase()).decode(b); } catch { /* 아래로 */ } }
  return decodeBytes(b);
}
/** Content-Disposition 의 파일 이름 — filename*(UTF-8·EUC-KR) → filename(따옴표·URL 인코딩·날 UTF-8/EUC-KR 바이트). 머리 값은 바이트 하나가 글자 하나(latin1)로 온다 */
export function dispositionName(h: string | null): string | null {
  if (!h) return null;
  const star = /filename\*\s*=\s*([\w-]+)'[^']*'("?)([^";]+)\2/i.exec(h);
  if (star) { const v = pctDecode(star[3].trim(), star[1]).trim(); if (v) return v; }
  const m = /(?:^|;)\s*filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i.exec(h);
  let v = (m?.[1] ?? m?.[2] ?? '').trim();
  if (!v) return null;
  if (/[\x80-\xff]/.test(v)) v = decodeBytes(Buffer.from(v, 'latin1'));
  if (/%[0-9a-f]{2}/i.test(v)) v = pctDecode(v);
  v = v.replace(/^["']|["']$/g, '').trim();
  return v || null;
}
/** 이름에 %XX 가 남아 있으면 풀기(두 번 인코딩까지, 빈칸 +) — 원천·옛 저장 칸이 이름을 URL 인코딩한 채로 줄 때(로컬 10/23: K-apt 중계 n 없을 때 '%EC%BB…+…') */
export function decodeName(n: string): string {
  let v = n;
  for (let i = 0; i < 2 && /%[0-9a-f]{2}/i.test(v); i++) { const d = pctDecode(v); if (d === v || d.includes('\uFFFD')) break; v = d; }
  return v;
}
/** 파일 이름: 넘겨받은 이름 > 응답 머리 > 원천 목록 이름 > 주소 끝(진짜 파일 이름일 때만 — downloadFile.do·bidFileDown.do 는 아님) > '<공고명 앞 30자> 첨부 n'. 확장자가 없으면 첫 바이트로 붙임 */
export function fileNameOf(o: { given?: string | null; header?: string | null; hint?: string | null; url?: URL | null; head: Uint8Array; fallback?: string | null }): string {
  let pathName = ''; try { pathName = decodeURIComponent(o.url?.pathname.split('/').pop() || ''); } catch { pathName = o.url?.pathname.split('/').pop() || ''; }
  let n = decodeName((o.given?.trim() || dispositionName(o.header ?? null) || o.hint?.trim() || (FILE_EXT.test(extOf(pathName)) ? pathName : '') || o.fallback?.trim() || '첨부').trim());
  const ext = sniffExt(o.head);
  if (!FILE_EXT.test(extOf(n)) && ext) n = `${n}.${ext}`;
  return safeName(n);
}
const MIME: Record<string, string> = { hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', pdf: 'application/pdf', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', txt: 'text/plain' };

// ---- 원문 안내 ----
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** 원문 링크: K-apt 는 공고 상세, 그 밖은 화면이 넘긴 원문 주소(허용 사이트만) → 없으면 첨부 주소 */
function originOf(rawUrl: string, origin?: string | null, bidHint?: string | null) {
  const kapt = isKaptUrl(rawUrl); const bid = kaptFileRef(rawUrl)?.bid ?? (kapt ? bidHint : null);
  if (bid) return { href: kaptDetailUrl(bid), kapt: true };
  const ok = (x?: string | null) => { try { const u = new URL(String(x)); return /^https?:$/.test(u.protocol) && fileHostAllowed(u.hostname) ? u.toString() : null; } catch { return null; } };
  return { href: ok(origin) ?? ok(rawUrl) ?? '', kapt };
}
/** 안내 화면으로 바꾸는 실패(웹페이지·K-apt 순서 실패) */
const PAGE_CODES = new Set(['file_page', 'kapt_no_bid', 'kapt_list', 'kapt_missing']);
/** 원천이 파일 대신 웹페이지를 보냄(로그인·세션·오류 화면) — 가짜 파일로 넘기지 않고 '원문에서 받아 주세요 — [원문 열기]' */
export function pageGuide(rawUrl: string, opt: { origin?: string | null; bid?: string | null; reason?: string | null } = {}): Response {
  const o = originOf(rawUrl, opt.origin, opt.bid); const site = o.kapt ? 'K-apt' : '원천 사이트';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>원문에서 받아 주세요</title>
<style>body{margin:0;padding:32px 16px;background:#f6f7f9;color:#1f2933;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif}main{max-width:440px;margin:0 auto;background:#fff;border:1px solid #e3e6ea;border-radius:12px;padding:24px}h1{margin:0 0 8px;font-size:18px}p{margin:0 0 16px;color:#52606d;font-size:14px}a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:8px;background:#2563eb;color:#fff;font-weight:600;text-decoration:none}</style></head>
<body><main data-testid="file-page-guide"><h1>원문에서 받아 주세요</h1><p>${opt.reason ? `${esc(site)}에서 파일을 받지 못했습니다(${esc(opt.reason)}).` : `${esc(site)}가 파일 대신 웹페이지를 보냈습니다(로그인·세션이 필요한 경우).`} 가짜 파일을 받지 않도록 여기서 멈췄습니다 — 원문을 열어 첨부를 직접 받아 주세요.</p>${o.href ? `<a href="${esc(o.href)}" rel="noopener noreferrer" data-testid="file-page-origin">${o.kapt ? 'K-apt 원문 열기' : '원문 열기'}</a>` : ''}</main></body></html>`;
  return new Response(html, { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-workin-file': 'page' } });
}

/** 허용 사이트의 첨부를 받아 그대로 흘려보낸다(Response). 웹페이지가 오면 안내 화면. 그 밖 실패는 HttpError */
export async function relayFile(rawUrl: string, name?: string | null, opt: { fallback?: string | null; origin?: string | null; bid?: string | null } = {}): Promise<Response> {
  let o: Opened;
  try { o = await openFile(rawUrl, opt.bid); }
  catch (e) { if (e instanceof HttpError && PAGE_CODES.has(e.code)) return pageGuide(rawUrl, { ...opt, reason: e.message.replace(/ — .*$/, '') }); throw e; }
  if (o.page && !/^html?$/.test(extOf(name ?? ''))) { await o.body.cancel().catch(() => {}); return pageGuide(rawUrl, opt); }
  // 크기 상한: content-length 가 없거나 거짓이어도 30MB 에서 끊는다
  let total = 0;
  const limited = o.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, ctrl) { total += chunk.byteLength; if (total > MAX) { ctrl.error(new Error('too big')); return; } ctrl.enqueue(chunk); } }));
  const fname = fileNameOf({ given: name, header: o.r.headers.get('content-disposition'), hint: o.nameHint, url: o.u, head: o.head, fallback: opt.fallback });
  return new Response(limited, { status: 200, headers: {
    'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(fname).replace(/%20/g, ' ').slice(0, 60)}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...(o.len ? { 'content-length': String(o.len) } : {}) } });
}

/** #507 서버가 직접 받아 자료실에 저장할 때 — 중계와 같은 규칙(허용 사이트·https·리다이렉트 금지·30MB, content-length 가 없거나 거짓이어도 30MB 에서 끊음). 웹페이지가 오면 저장하지 않음(file_page) */
export async function fetchFile(rawUrl: string, name?: string | null, opt: { fallback?: string | null; bid?: string | null } = {}): Promise<{ data: Buffer; fileName: string; mime: string }> {
  const o = await openFile(rawUrl, opt.bid);
  if (o.page && !/^html?$/.test(extOf(name ?? ''))) { await o.body.cancel().catch(() => {}); throw new HttpError(502, 'file_page', '파일 대신 웹페이지가 왔습니다(로그인·세션 필요)'); }
  const reader = o.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX) { await reader.cancel().catch(() => {}); throw new HttpError(413, 'file_too_big', '30MB 넘는 첨부는 원문에서 직접 받아 주세요'); }
    chunks.push(value);
  }
  const data = Buffer.concat(chunks);
  const fileName = fileNameOf({ given: name, header: o.r.headers.get('content-disposition'), hint: o.nameHint, url: o.u, head: data, fallback: opt.fallback });
  const ct = (o.r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return { data, fileName, mime: MIME[extOf(fileName)] ?? (ct && ct !== 'application/octet-stream' ? ct : 'application/octet-stream') };
}

// ---- 원천 행의 첨부 칸 ----
export type SrcFile = { url: string; name: string | null };
const MAX_FILES = 10;
/** 원천 행의 첨부 칸(문자열 주소·{url|href, name}·JSON 글자) → 받을 목록. 화면용 중계 주소(/api/bids/…)는 원래 주소로, K-apt 첨부는 한 모양(fileDownload.do?key=&bidNum=)으로 — 같은 파일이 두 번 붙지 않게 */
export function sourceFiles(...lists: unknown[]): SrcFile[] {
  const out: SrcFile[] = []; const seen = new Set<string>();
  for (const list of lists) {
    const arr = Array.isArray(list) ? list : typeof list === 'string' && list.startsWith('[') ? (() => { try { return JSON.parse(list) as unknown[]; } catch { return []; } })() : list ? [list] : [];
    for (const a of arr as any[]) {
      let url = typeof a === 'string' ? a : String(a?.url ?? a?.href ?? '');
      let name: string | null = a && typeof a === 'object' && a.name ? String(a.name) : null;
      if (url.startsWith('/api/bids/')) {
        const q = new URL(url, 'http://x').searchParams; name = name ?? q.get('n');
        url = q.get('u') ?? (q.get('bid') && q.get('seq') ? kaptFileUrl(q.get('bid')!, q.get('seq')!) : '');
      }
      url = url.trim();
      const k = kaptFileRef(url); if (k?.bid) { url = kaptFileUrl(k.bid, k.seq); name = name ?? k.name; }
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url); out.push({ url, name: name?.trim() || null });
    }
  }
  return out.slice(0, MAX_FILES);
}
