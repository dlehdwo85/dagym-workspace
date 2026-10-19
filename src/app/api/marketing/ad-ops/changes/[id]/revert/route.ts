import { handler } from '@/lib/api';
import { revertChange } from '@/lib/adOps';

/** 변경 되돌리기(전 값으로, 돈이 늘면 상한 검사) */
export const POST = handler<{ id: string }>(async ({ user, params }) => revertChange(user, params.id));
