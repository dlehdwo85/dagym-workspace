import { handler } from '@/lib/api';
import { approveMetaDraft } from '@/lib/metaAuto';

/** [승인하고 집행](관리자): 서버가 상한을 다시 확인한 뒤 켬 — 변경·감사 기록 */
export const POST = handler<{ id: string }>(async ({ user, params }) => approveMetaDraft(user, params.id));
