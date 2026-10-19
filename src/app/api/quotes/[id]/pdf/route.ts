import { handler } from '@/lib/api';
import { quotePdf } from '@/lib/quotes';

/** ?download=1 이면 내려받기, 아니면 화면 안에서 보기 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const r = await quotePdf(user, params.id);
  const dl = req.nextUrl.searchParams.get('download') === '1';
  return new Response(new Uint8Array(r.data), { headers: { 'content-type': 'application/pdf', 'content-disposition': `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(r.fileName)}` } });
});
