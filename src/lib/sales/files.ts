// S1-4(로컬 10/20): 공고 첨부 중계 — 원본 영업관리 /api/bids/file(나라장터)·/api/bids/kapt-file(K-apt) 과 같은 규칙(SALES_FEATURES 118행):
// 로그인 필요 · 허용한 공공 사이트만(SSRF 방지) · https 만 · 30MB 상한 · 리다이렉트 따라가지 않음 · octet-stream 강제 내려받기 · 저장하지 않음(바로 흘려보냄)
// 앱 WebView 는 외부 사이트 첨부(hwp)를 못 받는 경우가 있어 같은 도메인 경로로 돌려준다.
import { HttpError, badRequest } from '../errors';

const MAX = 30 * 1024 * 1024;
const DEFAULT_HOSTS = ['g2b.go.kr', 'ebid.lh.or.kr', 'apply.lh.or.kr', 'onbid.co.kr', 'nuri.go.kr', 'd2b.go.kr', 'k-apt.go.kr', 'bizinfo.go.kr', 'k-startup.go.kr']; // #507 지원사업(기업마당·K-Startup) 첨부도
/** 허용 호스트: 기본 공공 사이트 + SALES_FILE_HOSTS(쉼표, 시험용) — 하위 도메인도 허용 */
export function fileHostAllowed(host: string) {
  const extra = (process.env.SALES_FILE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = host.toLowerCase();
  return [...DEFAULT_HOSTS, ...extra].some((d) => h === d || h.endsWith('.' + d));
}
export function isFileHost(url: string) { try { return fileHostAllowed(new URL(url).hostname); } catch { return false; } }
const safeName = (n: string) => n.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'file';

/** 허용 사이트·https·리다이렉트 금지·30MB(content-length) 확인 뒤 응답을 연다 — 중계(relayFile)·서버 저장(fetchFile) 같은 규칙 */
async function openRemote(rawUrl: string): Promise<{ u: URL; r: Response; len: number }> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw badRequest('첨부 주소가 올바르지 않습니다'); }
  const allowHttp = !!process.env.SALES_FILE_HOSTS && /^(127\.0\.0\.1|localhost)$/.test(u.hostname); // 시험용 가짜 서버만 http
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) throw badRequest('https 주소만 받을 수 있습니다');
  if (!fileHostAllowed(u.hostname)) throw new HttpError(403, 'file_host', '허용한 공공 사이트(나라장터·LH·온비드·누리장터·국방·K-apt·기업마당·K-Startup)의 첨부만 받을 수 있습니다');
  let r: Response;
  try { r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0 (WorkIn sales file relay)', accept: '*/*' } }); }
  catch (e: any) { throw new HttpError(502, 'file_fetch', `첨부를 받지 못했습니다: ${String(e?.message ?? e).slice(0, 120)}`); }
  if (r.status >= 300 && r.status < 400) throw new HttpError(502, 'file_redirect', '첨부 주소가 다른 곳으로 넘어가 받지 않았습니다 — 원문에서 직접 받아 주세요');
  if (!r.ok || !r.body) throw new HttpError(502, 'file_fetch', `첨부를 받지 못했습니다(${r.status})`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX) { await r.body.cancel().catch(() => {}); throw new HttpError(413, 'file_too_big', '30MB 넘는 첨부는 원문에서 직접 받아 주세요'); }
  return { u, r, len };
}
/** 허용 사이트의 첨부를 받아 그대로 흘려보낸다(Response). 실패는 HttpError */
export async function relayFile(rawUrl: string, name?: string | null): Promise<Response> {
  const { u, r, len } = await openRemote(rawUrl);
  if (!r.body) throw new HttpError(502, 'file_fetch', '첨부를 받지 못했습니다');
  // 크기 상한: content-length 가 없거나 거짓이어도 30MB 에서 끊는다
  let total = 0;
  const limited = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, ctrl) { total += chunk.byteLength; if (total > MAX) { ctrl.error(new Error('too big')); return; } ctrl.enqueue(chunk); } }));
  const fname = safeName(name?.trim() || decodeURIComponent(u.pathname.split('/').pop() || '') || 'file');
  return new Response(limited, { status: 200, headers: {
    'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(fname).replace(/%20/g, ' ').slice(0, 60)}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...(len ? { 'content-length': String(len) } : {}) } });
}

/** content-disposition 의 파일 이름(filename* UTF-8 우선) */
function dispositionName(h: string | null): string | null {
  if (!h) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(h)?.[1];
  if (star) { try { return decodeURIComponent(star.trim().replace(/^"|"$/g, '')); } catch { /* 아래로 */ } }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(h)?.[1]?.trim();
  if (!plain) return null;
  try { return decodeURIComponent(plain); } catch { return plain; }
}
const MIME: Record<string, string> = { hwp: 'application/x-hwp', hwpx: 'application/hwp+zip', pdf: 'application/pdf', zip: 'application/zip', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', txt: 'text/plain' };
/** #507 서버가 직접 받아 자료실에 저장할 때 — 중계와 같은 규칙(허용 사이트·https·리다이렉트 금지·30MB, content-length 가 없거나 거짓이어도 30MB 에서 끊음). 이름: 넘겨받은 이름 > 응답 머리 > 주소 끝 */
export async function fetchFile(rawUrl: string, name?: string | null): Promise<{ data: Buffer; fileName: string; mime: string }> {
  const { u, r } = await openRemote(rawUrl);
  if (!r.body) throw new HttpError(502, 'file_fetch', '첨부를 받지 못했습니다');
  const reader = r.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX) { await reader.cancel().catch(() => {}); throw new HttpError(413, 'file_too_big', '30MB 넘는 첨부는 원문에서 직접 받아 주세요'); }
    chunks.push(value);
  }
  let pathName = ''; try { pathName = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch { pathName = u.pathname.split('/').pop() || ''; }
  const fileName = safeName(name?.trim() || dispositionName(r.headers.get('content-disposition')) || pathName || 'file');
  const ext = /\.([a-z0-9]{1,5})$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  const ct = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const data = Buffer.concat(chunks);
  // 파일 대신 웹페이지(로그인·세션 만료·오류 화면)가 오면 저장하지 않음 — 원문에서 직접 받도록
  if ((ct === 'text/html' || /^\s*<(!doctype html|html)/i.test(data.subarray(0, 200).toString('latin1'))) && !/^html?$/.test(ext)) throw new HttpError(502, 'file_page', '파일 대신 웹페이지가 왔습니다(로그인·세션 필요)');
  return { data, fileName, mime: MIME[ext] ?? (ct && ct !== 'application/octet-stream' ? ct : 'application/octet-stream') };
}
