import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { decideProposal } from '@/lib/ai/assistant';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => decideProposal(user, params.id, (await body(req, z.object({ accept: z.boolean() }))).accept));
