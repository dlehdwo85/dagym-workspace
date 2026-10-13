import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { decidePlanRequest } from '@/lib/plans';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => decidePlanRequest(user, params.id, (await body(req, z.object({ approve: z.boolean() }))).approve));
