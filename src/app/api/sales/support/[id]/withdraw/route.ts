import { handler, body } from '@/lib/api';
import { withdrawInput, withdrawWork } from '@/lib/sales/support';

/** 277차 #815 [업무 회수]: 만든 업무는 휴지통(30일) · 진행 기록은 처음 상태 · 담당 알림 — 다른 사람 흔적이 있으면 needsConfirm 먼저 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => withdrawWork(user, params.id, await body(req, withdrawInput)));
