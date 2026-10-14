import { handler, body, clientIp } from '@/lib/api';
import { folderSecInput, listFolderSecurity, setFolderSecurity } from '@/lib/library';

/** V14 15번 폴더 보안 등급(하위 상속) */
export const GET = handler(async ({ user }) => listFolderSecurity(user));
export const PUT = handler(async ({ req, user }) => setFolderSecurity(user, await body(req, folderSecInput), clientIp(req)));
