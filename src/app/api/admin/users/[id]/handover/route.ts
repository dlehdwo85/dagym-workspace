import { handler, body, clientIp } from '@/lib/api';
import { doHandover, handoverInput, handoverSummary } from '@/lib/offboard';

/** 대표 10/20 7): 인수인계 — GET 항목별 개수·받을 사람 목록 / POST 고른 항목을 한 사람에게 일괄 이전 */
export const GET = handler<{ id: string }>(async ({ user, params }) => handoverSummary(user, params.id));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => doHandover(user, params.id, await body(req, handoverInput), clientIp(req)));
