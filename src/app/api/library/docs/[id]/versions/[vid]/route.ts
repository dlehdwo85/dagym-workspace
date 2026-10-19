import { handler } from '@/lib/api';
import { getVersion } from '@/lib/libDocs';

export const GET = handler<{ id: string; vid: string }>(async ({ user, params }) => getVersion(user, params.id, Number(params.vid)));
