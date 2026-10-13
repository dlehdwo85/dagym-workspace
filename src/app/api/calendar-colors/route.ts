import { handler, body } from '@/lib/api';
import { colorsInput, getCalColors, setCalColors } from '@/lib/calColors';

/** V7 4번: 내 캘린더 색(개인/회사) — 대표는 모두의 기본값도 */
export const GET = handler(async ({ user }) => getCalColors(user));
export const PUT = handler(async ({ req, user }) => setCalColors(user, await body(req, colorsInput)));
