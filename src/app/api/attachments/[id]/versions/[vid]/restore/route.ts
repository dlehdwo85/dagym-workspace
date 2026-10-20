import { handler } from '@/lib/api';
import { restoreVersion } from '@/lib/attachmentEdit';

/** 이 버전으로 되돌리기(새 버전으로 쌓임) */
export const POST = handler<{ id: string; vid: string }>(async ({ user, params }) => restoreVersion(user, params.id, params.vid));
