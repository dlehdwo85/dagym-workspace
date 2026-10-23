import { handler } from '@/lib/api';
import { makeVisualNow } from '@/lib/mktAutoVisual';

export const maxDuration = 60;
/** #516 [지금 만들기]: 시안 없는 피드·스토리에 서버가 시안을 그려 붙이고 재승인 대기(크레딧 0) */
export const POST = handler<{ id: string }>(async ({ user, params }) => makeVisualNow(user, params.id));
