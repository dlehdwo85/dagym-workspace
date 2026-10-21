import { body, handler } from '@/lib/api';
import { bizCatsInput, getBizCats, saveBizCats } from '@/lib/sales/bizCats';

/** 대표 10/21 12:00 영업 재편 4): 회사 관심 사업(카테고리) — 공고 사업별 탭·적합 배지 근거 */
export const GET = handler(async ({ user }) => getBizCats(user));
export const PUT = handler(async ({ req, user }) => saveBizCats(user, await body(req, bizCatsInput)));
