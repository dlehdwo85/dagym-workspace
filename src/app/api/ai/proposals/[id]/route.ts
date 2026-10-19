import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { decideProposal } from '@/lib/ai/assistant';

/** V19: 문자·견적서 시안은 카드에서 고친 내용(patch)을 함께 보낼 수 있다 — 서버가 다시 검사·계산 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const b = await body(req, z.object({ accept: z.boolean(), patch: z.record(z.unknown()).optional() }));
  return decideProposal(user, params.id, b.accept, b.patch);
});
