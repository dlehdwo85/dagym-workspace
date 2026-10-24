import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { NOTIFY_LEVELS, leaveRoom, renameRoom, roomDetail, setHistoryVisible, setMuted, setNotify, setOwnerOnly, setRoomPhoto, setRoomPinned, transferOwner } from '@/lib/chat';

export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = req.nextUrl.searchParams;
  const id = (k: string) => (/^\d{1,20}$/.test(p.get(k) ?? '') ? p.get(k)! : undefined);
  return roomDetail(user, params.id, { before: id('before'), after: id('after'), around: id('around'), q: p.get('q')?.trim() || undefined });
});
/** 대화방 알림(notify 전체·멘션만·끄기, 옛 muted), 목록 위 고정, 이름 바꾸기 · 메신저 3차: 방 사진·방장만 관리·방장 넘기기 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ muted: z.boolean().optional(), notify: z.enum(NOTIFY_LEVELS).optional(), pinned: z.boolean().optional(), name: z.string().max(50).optional(), historyVisible: z.boolean().optional(),
    photoKey: z.string().max(400).nullable().optional(), ownerOnly: z.boolean().optional(), ownerId: z.string().uuid().optional() }));
  if (i.name !== undefined) return renameRoom(user, params.id, i.name);
  if (i.historyVisible !== undefined) await setHistoryVisible(user, params.id, i.historyVisible); // 메신저 1차: 방장 '이전 대화 공개'
  if (i.ownerOnly !== undefined) await setOwnerOnly(user, params.id, i.ownerOnly);
  if (i.ownerId !== undefined) await transferOwner(user, params.id, i.ownerId);
  if (i.photoKey !== undefined) await setRoomPhoto(user, params.id, i.photoKey);
  if (i.pinned !== undefined) await setRoomPinned(user, params.id, i.pinned);
  if (i.notify !== undefined) await setNotify(user, params.id, i.notify);
  else if (i.muted !== undefined) await setMuted(user, params.id, i.muted);
  return { ok: true };
});
/** 그룹 대화 나가기 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => leaveRoom(user, params.id));
