import { handler, body, clientIp } from '@/lib/api';
import { agreementInput, archiveAgreement, getAgreement, purgeAgreement, updateAgreement } from '@/lib/agreements';

/** 계약 한 건(기간 이력·계약서 파일·알림 받는 사람) · 고치기 */
export const GET = handler<{ id: string }>(async ({ user, params }) => getAgreement(user, params.id));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateAgreement(user, params.id, await body(req, agreementInput.partial()), clientIp(req)));
/** D-05(대표 11/23): 지우기 = 보관(숨김, 되살릴 수 있음) · ?purge=1 = 보관함의 계약을 완전 삭제(대표만, 휴지통 기록 30일) */
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) =>
  req.nextUrl.searchParams.get('purge') === '1' ? purgeAgreement(user, params.id, clientIp(req)) : archiveAgreement(user, params.id, clientIp(req)));
