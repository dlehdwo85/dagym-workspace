import { handler, body } from '@/lib/api';
import { createMetaPlan, metaAutoInput, metaAutoOverview } from '@/lib/metaAuto';

/** #494 메타 광고 자동 세팅: 세팅안·초안·변경 기록 / 세팅안 만들기(아직 Meta 에는 안 만듦) */
export const GET = handler(async ({ user }) => metaAutoOverview(user));
export const POST = handler(async ({ req, user }) => createMetaPlan(user, await body(req, metaAutoInput)));
