import { handler } from '@/lib/api';
import { proposalQuotePdf } from '@/lib/ai/assistant';

/** 견적서 제안 카드 [PDF 미리보기] — 제안 주인만 */
export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const r = await proposalQuotePdf(user, params.id);
  return new Response(new Uint8Array(r), { headers: { 'content-type': 'application/pdf', 'content-disposition': 'inline; filename="quote-draft.pdf"' } });
});
