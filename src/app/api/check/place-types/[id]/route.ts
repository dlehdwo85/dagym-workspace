import { handler, body } from '@/lib/api';
import { placeTypeInput, savePlaceType } from '@/lib/check/guide';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => savePlaceType(user, params.id, await body(req, placeTypeInput)));
