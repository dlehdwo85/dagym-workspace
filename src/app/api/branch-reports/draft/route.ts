import { body, clientIp, handler } from '@/lib/api';
import { draftInput, generateDraft } from '@/lib/branchReport';

/** #1096 주간보고 초안(AI) — 붙여 넣은 주간보고 글(+선택: 대화·워크인 업무). 초안만, 제출은 사람이 */
export const POST = handler(async ({ req, user }) => generateDraft(user, await body(req, draftInput), clientIp(req)));
