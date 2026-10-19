import { handler, body, clientIp } from '@/lib/api';
import { reconcile, reconcileInput } from '@/lib/billing/settlement';

/** 입금 대사: 나이스페이 정산 내역 엑셀/CSV(base64) */
export const POST = handler(async ({ req, user }) => reconcile(user, await body(req, reconcileInput), clientIp(req)), { idempotent: true });
