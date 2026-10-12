import { handler, body } from '@/lib/api';
import { PREP_PRESETS, createPrepTasks, prepInput } from '@/lib/eventtasks';

export const GET = handler(async () => ({ presets: Object.entries(PREP_PRESETS).map(([id, p]) => ({ id, ...p })) }));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => createPrepTasks(user, params.id, await body(req, prepInput)), { idempotent: true });
