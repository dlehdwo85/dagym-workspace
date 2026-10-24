import { handler, body } from '@/lib/api';
import { homeView, homeAct, homeAction } from '@/lib/mktHome';

export const maxDuration = 120; // 대표 10/24 ①: [지금 실행] 시안 제작도 글 모델(최상 모델 30~60초)

/** ⑥ 마케팅 홈(대표 승인 10/20 오후): 숫자 4칸·승인 3·AI 작업 큐·밤사이 결과·이번 주 7일·성과 7일·광고·최근 6·제안 5·채널·카드 설정 */
export const GET = handler(async ({ user }) => homeView(user));
/** [지금 실행]/[밤에] · 제안 → [업무로 만들기] · 카드 켜기/끄기·순서 */
export const POST = handler(async ({ req, user }) => homeAct(user, await body(req, homeAction)));
