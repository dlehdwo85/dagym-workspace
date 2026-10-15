import { handler, body } from '@/lib/api';
import { assistInput, clearTaskAssist, taskAssist, taskAssistHistory } from '@/lib/ai/taskAssist';

/** V28-1 이 업무의 AI 비서 — 기록 보기 / 묻기·초안 / 기록 지우기 */
export const maxDuration = 60;
export const GET = handler<{ id: string }>(async ({ user, params }) => taskAssistHistory(user, params.id));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => taskAssist(user, params.id, await body(req, assistInput)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => clearTaskAssist(user, params.id));
