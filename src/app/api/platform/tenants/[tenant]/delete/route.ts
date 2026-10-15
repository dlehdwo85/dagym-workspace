import { handler, body, clientIp } from '@/lib/api';
import { deleteInput, tenantDeletion } from '@/lib/platformAdmin';

/** V28-3 삭제 예약(30일)·취소·영구 삭제 실행(예약 30일 뒤, 회사 이름 재입력) */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => tenantDeletion(user, params.tenant, await body(req, deleteInput), clientIp(req)));
