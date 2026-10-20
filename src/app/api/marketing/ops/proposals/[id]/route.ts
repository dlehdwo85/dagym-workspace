import { handler, body } from '@/lib/api';
import { actProposal, proposalAction } from '@/lib/mktOps';

/** 승인(→ 실행: 계획·방향은 제작의뢰실 의뢰, 협업·인플루언서·분석은 업무) · 반려(사유) · 실행 완료 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actProposal(user, params.id, await body(req, proposalAction)));
