import { handler, body } from '@/lib/api';
import { brandKitInput, saveBrandKit } from '@/lib/mktAuto';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveBrandKit(user, params.id, await body(req, brandKitInput)));
