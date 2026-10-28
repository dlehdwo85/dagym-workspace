import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { eventMeeting, setEventMeeting } from '@/lib/meetings';

/** 218차 일정 [워크인 화상회의]: 상태·회의 기록 · 켜기/끄기(일정을 고칠 수 있는 사람) — 켜면 일정 '회의 주소' 칸에 /meet/<code> */
export const GET = handler<{ id: string }>(async ({ user, params }) => eventMeeting(user, params.id));
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => setEventMeeting(user, params.id, (await body(req, z.object({ on: z.boolean() }))).on));
