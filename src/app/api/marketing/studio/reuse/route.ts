import { handler, body } from '@/lib/api';
import { reuseInput, reuseList, reuseStart } from '@/lib/mktVideoReuse';

/** 187차 ⑦ 이번 달 만든 영상 다시 합성(관리자): 목록 · 시작 { ledgerIds } — 새로 만들지 않고 자막·끝 화면 전화·배경음(·내레이션)으로, 생성 크레딧 0 */
export const GET = handler(async ({ user }) => reuseList(user));
export const POST = handler(async ({ req, user }) => reuseStart(user, await body(req, reuseInput)));
