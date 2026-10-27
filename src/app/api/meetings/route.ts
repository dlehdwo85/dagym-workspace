import { body, handler } from '@/lib/api';
import { createMeeting, meetingInput } from '@/lib/meetings';

/** 218차 화상회의(FEATURE_MEETINGS): 즉석 회의 · 내 고정 회의실 · 메시지방 통화 만들기 */
export const POST = handler(async ({ req, user }) => createMeeting(user, await body(req, meetingInput)));
