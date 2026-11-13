import { handler } from '@/lib/api';
import { platformAuditLog } from '@/lib/platformAdmin';

/** 플랫폼 운영(대표 계정 전용): 모든 회사 감사 기록 — 회사 열·회사 거름(407차). 회사 화면(/api/admin/audit)은 자기 회사 기록만 */
export const GET = handler(async ({ req, user }) => platformAuditLog(user, { scope: req.nextUrl.searchParams.get('scope'), before: req.nextUrl.searchParams.get('before') }));
