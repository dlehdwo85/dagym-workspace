import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { leaveRoom, roomDetail, setMuted } from '@/lib/chat';

export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = req.nextUrl.searchParams;
  return roomDetail(user, params.id, { before: /^\d+$/.test(p.get('before') ?? '') ? p.get('before')! : undefined, q: p.get('q')?.trim() || undefined });
});
/** 대화방 알림 끄기·켜기 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => setMuted(user, params.id, (await body(req, z.object({ muted: z.boolean() }))).muted));
/** 그룹 대화 나가기 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => leaveRoom(user, params.id));
