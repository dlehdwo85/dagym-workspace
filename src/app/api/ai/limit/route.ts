import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setLimit } from '@/lib/ai/assistant';

export const PUT = handler(async ({ req, user }) => setLimit(user, (await body(req, z.object({ monthlyUsd: z.number().min(0).max(100000) }))).monthlyUsd));
