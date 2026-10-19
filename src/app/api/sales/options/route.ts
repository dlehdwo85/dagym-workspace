import { handler, body } from '@/lib/api';
import { optionsInput, salesOptions, setSalesOptions } from '@/lib/sales/options';

/** 영업 › 데이터 설정: 입찰·공고 사용 켜기/끄기(관리자) */
export const GET = handler(async ({ user }) => salesOptions(user));
export const PUT = handler(async ({ req, user }) => setSalesOptions(user, await body(req, optionsInput)));
