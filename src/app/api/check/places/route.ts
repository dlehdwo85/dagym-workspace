import { handler, body } from '@/lib/api';
import { listPlaces, placeInput, savePlace } from '@/lib/check/guide';

/** 지점별 공간 — ?unit=조직 id */
export const GET = handler(async ({ req, user }) => listPlaces(user, req.nextUrl.searchParams.get('unit')));
export const POST = handler(async ({ req, user }) => savePlace(user, null, await body(req, placeInput)));
