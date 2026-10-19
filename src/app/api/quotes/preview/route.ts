import { handler, body } from '@/lib/api';
import { previewQuote, quoteInput } from '@/lib/quotes';

/** 저장 없이 PDF 미리보기(?json=1 이면 금액·넘침만) */
export const POST = handler(async ({ req, user }) => {
  const pv = await previewQuote(user, await body(req, quoteInput));
  if (req.nextUrl.searchParams.get('json') === '1' || !pv.pdf) { const { pdf: _p, ...rest } = pv; return rest; }
  return new Response(new Uint8Array(pv.pdf), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="quote-preview.pdf"' } });
});
