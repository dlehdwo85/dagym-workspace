import { handler, body, clientIp } from '@/lib/api';
import { consultInput, consultView, requestConsult } from '@/lib/spaceConsult';

/** #1139 잠긴 영업·마케팅: 안내(잠긴 공간·열린 상담 신청·연락처) · [상담 신청](회사 관리자, 같은 공간 중복 신청 없음) */
export const GET = handler(async ({ user }) => consultView(user));
export const POST = handler(async ({ req, user }) => requestConsult(user, await body(req, consultInput), clientIp(req)));
