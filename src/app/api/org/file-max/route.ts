import { handler, body, clientIp } from '@/lib/api';
import { fileMaxInput, getFileMax, setFileMax } from '@/lib/fileLimit';

/** #1128 회사의 파일 한 개 최대 크기 — 보기는 회사 사람 누구나(안내 글), 바꾸기는 회사 정보 편집 권한 */
export const GET = handler(async ({ user }) => getFileMax(user));
export const PUT = handler(async ({ req, user }) => setFileMax(user, await body(req, fileMaxInput), clientIp(req)));
