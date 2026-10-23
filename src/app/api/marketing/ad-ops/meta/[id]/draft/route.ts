import { handler } from '@/lib/api';
import { buildMetaDraft } from '@/lib/metaAuto';

/** [Meta에 초안 만들기]: 소재 올리기 + 캠페인·광고 세트·광고 모두 일시정지(PAUSED) + 총 상한 → 승인함 '광고 초안' */
export const POST = handler<{ id: string }>(async ({ user, params }) => buildMetaDraft(user, params.id));
