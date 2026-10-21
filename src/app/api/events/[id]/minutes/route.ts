import { handler, body } from '@/lib/api';
import { listMinutes, makeMinutes, minutesInput } from '@/lib/ai/meetingMinutes';

/** V30 ⑥ (#74) 녹음 → 회의록: GET 최근 회의록·월 한도·단가 / POST 녹음 파일(자료실 id) → 받아쓰기 → 요약·결정·할 일 */
export const maxDuration = 180;
export const GET = handler<{ id: string }>(async ({ user, params, req }) => listMinutes(user, params.id, req.nextUrl.searchParams.get('occurrenceStart')));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => makeMinutes(user, params.id, await body(req, minutesInput)));
