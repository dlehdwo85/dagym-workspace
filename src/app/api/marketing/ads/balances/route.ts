import { body, handler } from '@/lib/api';
import { assertSpace } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';
import { balanceInput, balancesView, guardInput, setBalance, setGuard } from '@/lib/mktRecharge';

/** 대표 10/21 14:30 #411: 매체 잔액 — 보기(마케팅 공간) · 직접 입력(관리자, API 로 못 읽는 구글 선불·Higgsfield) */
export const GET = handler(async ({ user }) => { await assertSpace(user, 'marketing'); return { balances: await balancesView(tenantOf(user)) }; });
export const PUT = handler(async ({ req, user }) => setBalance(user, await body(req, balanceInput)));
/** 402차 #1028 끊김 방지 메일(남은 날 14·7·3일·잔액 0 → 대표 메일) 켜기·끄기 — 관리자 */
export const PATCH = handler(async ({ req, user }) => setGuard(user, await body(req, guardInput)));
