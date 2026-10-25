import { handler, clientIp } from '@/lib/api';
import { cancelContract, deleteContract, getContract } from '@/lib/contracts';

/** #116 계약서 상세(서명자·감사 추적) · 취소 · ?purge=1 = 끝난 계약서 통째로 지우기(로컬 10/25 17:05 ①, 대표·관리자) */
export const GET = handler<{ id: string }>(async ({ user, params }) => getContract(user, params.id));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) =>
  (new URL(req.url).searchParams.get('purge') === '1' ? deleteContract : cancelContract)(user, params.id, clientIp(req)));
