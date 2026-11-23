import { body, clientIp, handler } from '@/lib/api';
import { reviewAction, reviewInput } from '@/lib/branchReport';

/** #1117 민감 내용: [가리기]·[모두 가리기]·그대로 두기(이유)·취소(작성 담당, 초안) · [승인]·[반려(사유)](대표·관리자·그 지점 검토 담당, 승인 대기) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => reviewAction(user, params.id, await body(req, reviewInput), clientIp(req)));
