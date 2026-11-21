import { body, clientIp, handler } from '@/lib/api';
import { getUsageFile, removeUsageFile, uploadUsageFile, usageFileInput } from '@/lib/branchReport';

/** #1106 월간 보고 C — 하이링크 이용현황 파일(PDF·엑셀·CSV): 올리면 표를 읽어 C 를 채우고(원문 그대로) 원본은 첨부로 보관 · 내려받기 · 빼기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => uploadUsageFile(user, params.id, await body(req, usageFileInput), clientIp(req)));
export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const f = await getUsageFile(user, params.id);
  return new Response(new Uint8Array(f.data), { headers: { 'content-type': f.mime, 'content-disposition': `attachment; filename="hilink-usage"; filename*=UTF-8''${encodeURIComponent(f.name)}`, 'cache-control': 'no-store' } });
});
export const DELETE = handler<{ id: string }>(async ({ user, params }) => removeUsageFile(user, params.id, null));
