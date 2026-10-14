import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { decideHandoff } from '@/lib/tasks';

export const POST = handler<{ id: string; hid: string }>(async ({ req, user, params }) =>
  decideHandoff(user, params.id, params.hid, (await body(req, z.object({ approve: z.boolean() }))).approve));
