import { handler } from '@/lib/api';
import { roomMedia } from '@/lib/chat';

/** 메신저 1차 A2: 방 정보 — 사진·파일·링크 모아보기 */
export const GET = handler<{ id: string }>(async ({ user, params }) => roomMedia(user, params.id));
