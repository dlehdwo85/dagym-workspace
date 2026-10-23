import { handler, body } from '@/lib/api';
import { adRefInput, adRefView, createAdRef } from '@/lib/mktAdRefs';

export const maxDuration = 60;
/** #499-6 경쟁 광고 보관함: 넣은 광고(참고 먼저)·공통 구조 분석 보고서·훅 유형 */
export const GET = handler(async ({ user }) => adRefView(user));
/** [보관함에 넣기](마케팅 공간 누구나): 링크·영상/이미지·대본 → 영상 음성 받아쓰기 → 첫 문장·훅 유형 */
export const POST = handler(async ({ req, user }) => createAdRef(user, await body(req, adRefInput)));
