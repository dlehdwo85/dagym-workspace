import { handler, body } from '@/lib/api';
import { listRooms, openRoom, roomInput } from '@/lib/chat';

/** V13 10번 사내 메신저: 내 대화방 목록 / 1:1·그룹·업무 대화방 열기 */
export const GET = handler(async ({ user }) => listRooms(user));
export const POST = handler(async ({ req, user }) => openRoom(user, await body(req, roomInput)));
