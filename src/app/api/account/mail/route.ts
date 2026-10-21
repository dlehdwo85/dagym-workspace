import { handler, body, clientIp } from '@/lib/api';
import { accountInput, deleteMyMailAccount, getMyMailAccount, saveMyMailAccount } from '@/lib/mailbox';

/** V33 4 (#184) 내 메일 계정(SMTP): 회사가 허용했을 때만, 연결 시험(시험 메일 1통)이 성공해야 저장. 네이버는 해외 IP 를 막기도 해서 서울 지역에서 실행 */
export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const GET = handler(async ({ user }) => getMyMailAccount(user));
export const PUT = handler(async ({ req, user }) => saveMyMailAccount(user, await body(req, accountInput), clientIp(req)));
export const DELETE = handler(async ({ req, user }) => deleteMyMailAccount(user, clientIp(req)));
