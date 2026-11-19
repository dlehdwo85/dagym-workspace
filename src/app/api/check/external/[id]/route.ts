import { handler, body } from '@/lib/api';
import { closeExternal, externalInput } from '@/lib/check/rounds';

/** 외부 업체·건물 관리처 연락의 결과 적기(적으면 닫힘) */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => closeExternal(user, params.id, await body(req, externalInput)));
