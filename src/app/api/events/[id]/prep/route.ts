import { handler, body } from '@/lib/api';
import { createPrepTasks, prepInput, prepPresetsFor } from '@/lib/eventtasks';
import { tenantOf } from '@/lib/types';

export const GET = handler(async ({ user }) => ({ presets: Object.entries(prepPresetsFor(tenantOf(user))).map(([id, p]) => ({ id, ...p })) }));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => createPrepTasks(user, params.id, await body(req, prepInput)), { idempotent: true });
