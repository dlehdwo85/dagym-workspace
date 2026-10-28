import { body, handler } from '@/lib/api';
import { getMeeting, meetingPatch, patchMeeting } from '@/lib/meetings';

/** 회의 정보(주최자·공동 주최자는 대기 인원 포함) · 설정 바꾸기(대기실·직원 먼저·잠금·화면 공유·전체 음소거) */
export const GET = handler<{ id: string }>(async ({ user, params }) => getMeeting(user, params.id));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => patchMeeting(user, params.id, await body(req, meetingPatch)));
