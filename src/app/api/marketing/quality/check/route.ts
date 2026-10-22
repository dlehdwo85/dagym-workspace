import { handler, body } from '@/lib/api';
import { checkInput, checkQuality } from '@/lib/mktQuality';

/** #426 글 품질 검사(저장 없음): 훅 점수·사람다움 점수·채널별 검사·초 단위 구성표·광고 문구 글자 수 */
export const POST = handler(async ({ req, user }) => checkQuality(user, await body(req, checkInput)));
