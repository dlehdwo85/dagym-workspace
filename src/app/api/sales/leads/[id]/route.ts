import { handler, body } from '@/lib/api';
import { leadPatch, updateLead } from '@/lib/sales/cutover';

/** 리드 수정(상태·사유·다음 연락일·메모·담당) — 전환 전(writes_open=false)에는 409 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateLead(user, params.id, await body(req, leadPatch)));
