import { handler, body } from '@/lib/api';
import { accountBrandInput, removePublishAccount, setPublishAccountBrand } from '@/lib/mktChannels';

/** 게시 연결 끊기(관리자) — 토큰 즉시 삭제 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => removePublishAccount(user, params.id));
/** 로컬 10/21 08:10: 계정 브랜드(또는 공용) 지정 — 게시 대상은 브랜드 계정 + 공용 계정만 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => setPublishAccountBrand(user, params.id, await body(req, accountBrandInput)));
