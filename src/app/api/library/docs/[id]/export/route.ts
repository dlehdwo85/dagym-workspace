import { handler } from '@/lib/api';
import { exportDoc } from '@/lib/libDocs';

/** ?format=docx|md|txt — 워크인 문서를 파일로 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const fmt = req.nextUrl.searchParams.get('format');
  const r = await exportDoc(user, params.id, fmt === 'md' || fmt === 'txt' ? fmt : 'docx');
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': r.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
