import { handler, body, clientIp } from '@/lib/api';
import { joinInput, requestDomainJoin } from '@/lib/joinLinks';

/** #1176 회사 메일 도메인으로 합류 신청(가입 화면에서 '이 도메인은 ○○ 회사가 씁니다' 뒤) — 확인 메일 → 관리자 승인 */
export const POST = handler(async ({ req }) => requestDomainJoin(await body(req, joinInput), clientIp(req)), { public: true });
