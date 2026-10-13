import { handler } from '@/lib/api';
import { listTrash } from '@/lib/tasks';

/** V6 11번 휴지통: 30일 안에 삭제한, 내가 되살릴 수 있는 업무 */
export const GET = handler(async ({ user }) => ({ tasks: await listTrash(user) }));
