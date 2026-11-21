import { handler } from '@/lib/api';
import { reportEvidence } from '@/lib/branchReport';

/** #1096 근거 보기(D줄·대화·워크인 업무) — refs=D3,M120,W2 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => reportEvidence(user, params.id, (req.nextUrl.searchParams.get('refs') ?? '').split(',')));
