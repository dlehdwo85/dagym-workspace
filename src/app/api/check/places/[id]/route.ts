import { handler, body } from '@/lib/api';
import { placeInput, savePlace } from '@/lib/check/guide';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => savePlace(user, params.id, await body(req, placeInput)));
