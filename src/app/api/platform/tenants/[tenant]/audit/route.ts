import { handler } from '@/lib/api';
import { tenantAuditLog } from '@/lib/platformAdmin';

/** 플랫폼 운영: 고객사 감사 기록 */
export const GET = handler<{ tenant: string }>(async ({ user, params }) => tenantAuditLog(user, params.tenant));
