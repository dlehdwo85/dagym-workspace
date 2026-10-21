import { body, handler } from '@/lib/api';
import { assertSpace } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';
import { balanceInput, balancesView, setBalance } from '@/lib/mktRecharge';

/** 대표 10/21 14:30 #411: 매체 잔액 — 보기(마케팅 공간) · 직접 입력(관리자, API 로 못 읽는 구글 선불·Higgsfield) */
export const GET = handler(async ({ user }) => { await assertSpace(user, 'marketing'); return { balances: await balancesView(tenantOf(user)) }; });
export const PUT = handler(async ({ req, user }) => setBalance(user, await body(req, balanceInput)));
