import { handler } from '@/lib/api';
import { approvePlan } from '@/lib/adOps';

export const maxDuration = 120; // #499-2 키워드 300개(100개씩)·매체·제외 키워드까지 한 번에

/** [승인하고 시작]: 네이버에 꺼진 상태로 생성 */
export const POST = handler<{ id: string }>(async ({ user, params }) => approvePlan(user, params.id));
