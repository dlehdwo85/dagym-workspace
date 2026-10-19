import { handler } from '@/lib/api';
import { openDoc } from '@/lib/libDocs';

/** 열기: snapshot + 조각(base64)·권한 */
export const GET = handler<{ id: string }>(async ({ user, params }) => openDoc(user, params.id));
