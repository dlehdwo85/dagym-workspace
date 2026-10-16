import { handler, body } from '@/lib/api';
import { createMeeting, meetingInput } from '@/lib/eventtasks';

/** V37 8: 업무에서 [미팅 일정 만들기] — 장소·시간 있는 일정 + 업무 연결 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => createMeeting(user, params.id, await body(req, meetingInput)));
