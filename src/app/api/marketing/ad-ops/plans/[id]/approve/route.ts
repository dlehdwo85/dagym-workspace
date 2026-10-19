import { handler } from '@/lib/api';
import { approvePlan } from '@/lib/adOps';

/** [승인하고 시작]: 네이버에 꺼진 상태로 생성 */
export const POST = handler<{ id: string }>(async ({ user, params }) => approvePlan(user, params.id));
