import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { queuePublish } from '@/lib/mktPublish';

/** 대표 10/20 22:30 ② M1 [서버로 게시](관리자): 승인된 최신 버전 → 연결 계정에 게시 작업(바로 실행, atSchedule 이면 예정 시각에) */
const input = z.object({ accountIds: z.array(zUuid).max(10).optional(), atSchedule: z.boolean().optional() });
export const POST = handler<{ id: string }>(async ({ req, user, params }) => queuePublish(user, params.id, await body(req, input)));
