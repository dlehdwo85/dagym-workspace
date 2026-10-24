import { handler } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { searchRoom } from '@/lib/chat';

/** 메신저 3차 D15 방 안 검색 — 찾는 말이 든 메시지 id(최신 순). 화면이 위/아래로 옮겨 가며 그 메시지로 이동 */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  if (!q) throw badRequest('찾을 말을 입력하세요');
  return searchRoom(user, params.id, q);
});
