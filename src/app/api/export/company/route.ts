import { handler, clientIp } from '@/lib/api';
import { listCompanyExports, requestCompanyExport } from '@/lib/companyExport';

/** 상용화 B4 회사 전체 내보내기(대표·관리자) — GET 최근 5건 · POST 요청(하루 1번). /api/export 아래라 읽기 전용·이용 중지 회사도 됨 */
export const GET = handler(async ({ user }) => listCompanyExports(user));
export const POST = handler(async ({ req, user }) => requestCompanyExport(user, clientIp(req)));
