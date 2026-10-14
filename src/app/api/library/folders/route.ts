import { handler, body, clientIp } from '@/lib/api';
import { createFolder, deleteFolder, folderInput, folderRenameInput, renameFolder } from '@/lib/library';

/** V14 18번 폴더: 만들기(POST) · 이름 바꾸기/옮기기(PATCH) · 빈 폴더 삭제(DELETE) */
export const POST = handler(async ({ req, user }) => createFolder(user, await body(req, folderInput)));
export const PATCH = handler(async ({ req, user }) => renameFolder(user, await body(req, folderRenameInput), clientIp(req)));
export const DELETE = handler(async ({ req, user }) => deleteFolder(user, await body(req, folderInput)));
