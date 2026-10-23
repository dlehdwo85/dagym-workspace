import { handler, body } from '@/lib/api';
import { capiTest, capiTestInput } from '@/lib/metaCapi';

/** #499-3 [시험 보내기](관리자): 최근 리드 ID 로 첫 단계 1건 + 시험 이벤트 코드 → 이벤트 관리자 '이벤트 테스트' */
export const POST = handler(async ({ req, user }) => capiTest(user, await body(req, capiTestInput)));
