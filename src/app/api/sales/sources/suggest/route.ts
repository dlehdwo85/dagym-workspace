import { handler, body } from '@/lib/api';
import { suggestInput, suggestSources } from '@/lib/sales/sources';

/** V41 단계 3 AI 자동 세팅: 업태·종목·지역 → 원천·검색어 추천(적용은 관리자가 [이대로 켜기]) */
export const POST = handler(async ({ req, user }) => suggestSources(user, await body(req, suggestInput)));
