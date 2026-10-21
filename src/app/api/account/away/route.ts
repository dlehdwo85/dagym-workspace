import { handler, body } from '@/lib/api';
import { awayInput, clearAway, getAway, setAway } from '@/lib/away';

/** V35 2 2차 (#76) 설정 › 부재중: 기간·자동 응답·대리인·알림 보류 */
export const GET = handler(async ({ user }) => getAway(user));
export const PUT = handler(async ({ req, user }) => setAway(user, await body(req, awayInput)));
export const DELETE = handler(async ({ user }) => clearAway(user));
