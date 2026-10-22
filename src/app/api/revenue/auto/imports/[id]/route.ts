import { handler, body, clientIp } from '@/lib/api';
import { actImport, importActInput } from '@/lib/revenueAuto';

export const maxDuration = 120; // [다시 읽기]는 그 자리에서 AI 가 다시 읽음
/** #161 확인 대기 자료: confirm(고친 표 rows 함께 가능 → 실적 반영 + 같은 달 10분 뒤 분석) · dismiss · retry. 매출 입력 권한 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => actImport(user, params.id, await body(req, importActInput), clientIp(req)));
