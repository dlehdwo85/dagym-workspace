import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { leaveRoom, roomDetail, setMuted, setRoomPinned } from '@/lib/chat';

export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = req.nextUrl.searchParams;
  return roomDetail(user, params.id, { before: /^\d+$/.test(p.get('before') ?? '') ? p.get('before')! : undefined, q: p.get('q')?.trim() || undefined });
});
/** 대화방 알림 끄기·켜기, 목록 위 고정 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ muted: z.boolean().optional(), pinned: z.boolean().optional() }));
  if (i.pinned !== undefined) await setRoomPinned(user, params.id, i.pinned);
  if (i.muted !== undefined) await setMuted(user, params.id, i.muted);
  return { ok: true };
});
/** 그룹 대화 나가기 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => leaveRoom(user, params.id));
