import { handler } from '@/lib/api';
import { leadBrief } from '@/lib/sales/leadList';

/** 197차(#460): 리드 업무 [완료] 창이 읽는 리드 요약(이름·단계·다음 연락·다음 할 일·담당·단계를 바꿀 수 있는지) */
export const GET = handler<{ id: string }>(async ({ user, params }) => leadBrief(user, params.id));
