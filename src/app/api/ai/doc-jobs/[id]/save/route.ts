import { handler, body } from '@/lib/api';
import { saveDocInput, saveDocJob } from '@/lib/ai/docJobs';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => saveDocJob(user, params.id, await body(req, saveDocInput)), { idempotent: true });
