import { handler, body } from '@/lib/api';
import { listPlaceTypes, placeTypeInput, savePlaceType } from '@/lib/check/guide';

/** 공간 유형(출입구·화장실 …) */
export const GET = handler(async ({ user }) => listPlaceTypes(user));
export const POST = handler(async ({ req, user }) => savePlaceType(user, null, await body(req, placeTypeInput)));
