import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { leaveRoom, renameRoom, roomDetail, setHistoryVisible, setMuted, setRoomPinned } from '@/lib/chat';

export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = req.nextUrl.searchParams;
  return roomDetail(user, params.id, { before: /^\d+$/.test(p.get('before') ?? '') ? p.get('before')! : undefined, q: p.get('q')?.trim() || undefined });
});
/** 대화방 알림 끄기·켜기, 목록 위 고정, 이름 바꾸기 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ muted: z.boolean().optional(), pinned: z.boolean().optional(), name: z.string().max(50).optional(), historyVisible: z.boolean().optional() }));
  if (i.name !== undefined) return renameRoom(user, params.id, i.name);
  if (i.historyVisible !== undefined) await setHistoryVisible(user, params.id, i.historyVisible); // 메신저 1차: 방장 '이전 대화 공개'
  if (i.pinned !== undefined) await setRoomPinned(user, params.id, i.pinned);
  if (i.muted !== undefined) await setMuted(user, params.id, i.muted);
  return { ok: true };
});
/** 그룹 대화 나가기 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => leaveRoom(user, params.id));
