import { clientIp, handler } from '@/lib/api';
import { submitReport, unsubmitReport } from '@/lib/branchReport';

/** #1096 [제출](잠김·기록) · [제출 취소](관리자, 기록) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => submitReport(user, params.id, clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => unsubmitReport(user, params.id, clientIp(req)));
