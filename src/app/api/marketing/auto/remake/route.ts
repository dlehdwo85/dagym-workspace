import { handler, body } from '@/lib/api';
import { remakeContents, remakeInput } from '@/lib/mktAuto';

export const maxDuration = 120;
/** 303차 #874 관리자: 기간 안 자동 시안(승인 대기·수정 요청·묶음 초안)을 휴지통으로 옮기고 같은 자리에 새 칸 → 지금 규칙으로 다시 제작. dryRun 이면 대상만 */
export const POST = handler(async ({ req, user }) => remakeContents(user, await body(req, remakeInput)));
