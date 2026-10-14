import { handler, body, clientIp } from '@/lib/api';
import { HttpError } from '@/lib/errors';
import { actionImport, actionInput, gptActionEnabled, tokenFromHeader } from '@/lib/revenue';

/**
 * GPT Custom Action 이 월 실적을 보내는 곳. 세션 대신 쓰기 전용 토큰(Authorization: Bearer wk_...)만 받는다.
 * 할 수 있는 일은 매출 항목 입력뿐(조회·삭제 없음). 오류가 하나라도 있으면 아무것도 저장하지 않는다.
 */
export const POST = handler(async ({ req }) => {
  // V13 1번: GPT Custom Action 은 기본 꺼짐 (매출 입력은 엑셀/CSV·자료로 입력(AI))
  if (!gptActionEnabled()) throw new HttpError(404, 'not_found', '찾을 수 없습니다');
  const token = await tokenFromHeader(req.headers.get('authorization'));
  if (!token) throw new HttpError(401, 'unauthorized', '유효한 매출 입력 토큰이 필요합니다');
  const i = await body(req, actionInput);
  return actionImport(token, i, clientIp(req));
}, { public: true });
