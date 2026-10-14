import { handler, body, clientIp } from '@/lib/api';
import { menuMatrix, menuPermInput, setMenuPerm } from '@/lib/menuPerms';

/** V13 2번: 대표 전용 메뉴 권한 (메뉴 × 등급, 사람별 예외) */
export const GET = handler(async ({ user }) => menuMatrix(user));
export const PUT = handler(async ({ req, user }) => setMenuPerm(user, await body(req, menuPermInput), clientIp(req)));
