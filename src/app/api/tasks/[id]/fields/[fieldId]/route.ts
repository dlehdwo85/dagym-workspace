import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setFieldValue } from '@/lib/fields';

export const PUT = handler<{ id: string; fieldId: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ value: z.unknown() }));
  return setFieldValue(user, params.id, params.fieldId, i.value);
});
