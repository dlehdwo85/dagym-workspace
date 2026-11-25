import { handler, body, clientIp } from '@/lib/api';
import { joinInfo, joinInput, requestJoin } from '@/lib/joinLinks';

/** #1176 회사 초대 링크(로그인 없이) — GET 회사 이름·쓸 수 있는지 · POST 이메일로 합류 신청(확인 메일 → 관리자 승인) */
export const GET = handler<{ token: string }>(async ({ params }) => joinInfo(params.token), { public: true });
export const POST = handler<{ token: string }>(async ({ req, params }) => requestJoin(params.token, await body(req, joinInput), clientIp(req)), { public: true });
