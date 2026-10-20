import { handler, body } from '@/lib/api';
import { actBrief, briefAction } from '@/lib/mktStudio';

/** prompt(다시 쓰기) · update(프롬프트·자막 수정) · generate(관리자: 생성 또는 제작 요청 카드) · cancel */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actBrief(user, params.id, await body(req, briefAction)));
