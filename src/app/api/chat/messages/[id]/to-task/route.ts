import { handler } from '@/lib/api';
import { messageToTaskSuggestion } from '@/lib/chat';

export const maxDuration = 60;
/** "업무로 만들기" 제안 (생성은 사람이 업무 등록 창에서 확인) */
export const POST = handler<{ id: string }>(async ({ user, params }) => messageToTaskSuggestion(user, params.id));
