import { handler, body, clientIp } from '@/lib/api';
import { folderPermInput, listFolderPerms, setFolderPerm } from '@/lib/library';

/** V13 4번 폴더 권한 (대표만) */
export const GET = handler(async ({ user }) => listFolderPerms(user));
export const PUT = handler(async ({ req, user }) => setFolderPerm(user, await body(req, folderPermInput), clientIp(req)));
