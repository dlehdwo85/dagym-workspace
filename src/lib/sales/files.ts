// S1-4(로컬 10/20): 공고 첨부 중계 — 원본 영업관리 /api/bids/file(나라장터)·/api/bids/kapt-file(K-apt) 과 같은 규칙(SALES_FEATURES 118행):
// 로그인 필요 · 허용한 공공 사이트만(SSRF 방지) · https 만 · 30MB 상한 · 리다이렉트 따라가지 않음 · octet-stream 강제 내려받기 · 저장하지 않음(바로 흘려보냄)
// 앱 WebView 는 외부 사이트 첨부(hwp)를 못 받는 경우가 있어 같은 도메인 경로로 돌려준다.
import { HttpError, badRequest } from '../errors';

const MAX = 30 * 1024 * 1024;
const DEFAULT_HOSTS = ['g2b.go.kr', 'ebid.lh.or.kr', 'apply.lh.or.kr', 'onbid.co.kr', 'nuri.go.kr', 'd2b.go.kr', 'k-apt.go.kr'];
/** 허용 호스트: 기본 공공 사이트 + SALES_FILE_HOSTS(쉼표, 시험용) — 하위 도메인도 허용 */
export function fileHostAllowed(host: string) {
  const extra = (process.env.SALES_FILE_HOSTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const h = host.toLowerCase();
  return [...DEFAULT_HOSTS, ...extra].some((d) => h === d || h.endsWith('.' + d));
}
export function isFileHost(url: string) { try { return fileHostAllowed(new URL(url).hostname); } catch { return false; } }
const safeName = (n: string) => n.replace(/[\r\n"\\/]/g, '_').slice(0, 150) || 'file';

/** 허용 사이트의 첨부를 받아 그대로 흘려보낸다(Response). 실패는 HttpError */
export async function relayFile(rawUrl: string, name?: string | null): Promise<Response> {
  let u: URL;
  try { u = new URL(rawUrl); } catch { throw badRequest('첨부 주소가 올바르지 않습니다'); }
  const allowHttp = !!process.env.SALES_FILE_HOSTS && /^(127\.0\.0\.1|localhost)$/.test(u.hostname); // 시험용 가짜 서버만 http
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:'))) throw badRequest('https 주소만 받을 수 있습니다');
  if (!fileHostAllowed(u.hostname)) throw new HttpError(403, 'file_host', '허용한 공공 사이트(나라장터·LH·온비드·누리장터·국방·K-apt)의 첨부만 받을 수 있습니다');
  let r: Response;
  try { r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(30_000), headers: { 'user-agent': 'Mozilla/5.0 (WorkIn sales file relay)', accept: '*/*' } }); }
  catch (e: any) { throw new HttpError(502, 'file_fetch', `첨부를 받지 못했습니다: ${String(e?.message ?? e).slice(0, 120)}`); }
  if (r.status >= 300 && r.status < 400) throw new HttpError(502, 'file_redirect', '첨부 주소가 다른 곳으로 넘어가 받지 않았습니다 — 원문에서 직접 받아 주세요');
  if (!r.ok || !r.body) throw new HttpError(502, 'file_fetch', `첨부를 받지 못했습니다(${r.status})`);
  const len = Number(r.headers.get('content-length') ?? 0);
  if (len > MAX) throw new HttpError(413, 'file_too_big', '30MB 넘는 첨부는 원문에서 직접 받아 주세요');
  // 크기 상한: content-length 가 없거나 거짓이어도 30MB 에서 끊는다
  let total = 0;
  const limited = r.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, ctrl) { total += chunk.byteLength; if (total > MAX) { ctrl.error(new Error('too big')); return; } ctrl.enqueue(chunk); } }));
  const fname = safeName(name?.trim() || decodeURIComponent(u.pathname.split('/').pop() || '') || 'file');
  return new Response(limited, { status: 200, headers: {
    'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${encodeURIComponent(fname).replace(/%20/g, ' ').slice(0, 60)}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
    'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', ...(len ? { 'content-length': String(len) } : {}) } });
}
