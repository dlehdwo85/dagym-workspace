import { handler, body } from '@/lib/api';
import { notFound } from '@/lib/errors';
import { prospectInput, setProspect } from '@/lib/sales/sources';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw notFound();
  return setProspect(user, id, await body(req, prospectInput));
});
