import { handler, body } from '@/lib/api';
import { addonInput, upsertAddon } from '@/lib/plans';

export const PUT = handler<{ code: string }>(async ({ req, user, params }) => upsertAddon(user, params.code, await body(req, addonInput)));
