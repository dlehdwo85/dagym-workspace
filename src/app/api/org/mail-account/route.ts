import { handler, body, clientIp } from '@/lib/api';
import { accountInput, deleteMailAccount, getMailAccount, saveMailAccount } from '@/lib/mailbox';

/** V21 조직 메일 계정(SMTP) — 연결 시험이 성공해야 저장. 네이버는 해외 IP 로그인을 막기도 해서 서울 지역에서 실행 */
export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const GET = handler(async ({ user }) => getMailAccount(user));
export const PUT = handler(async ({ req, user }) => saveMailAccount(user, await body(req, accountInput), clientIp(req)));
export const DELETE = handler(async ({ req, user }) => deleteMailAccount(user, clientIp(req)));
