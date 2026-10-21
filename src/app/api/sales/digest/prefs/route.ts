import { handler, body } from '@/lib/api';
import { getPrefs, prefsInput, savePrefs } from '@/lib/sales/digest';

/** 회사 맞춤 설정(관심 검색어·제외어·지역·발주처·물품 코드·금액) + 다이제스트 설정(시각·메일·받는 사람) */
export const GET = handler(async ({ user }) => getPrefs(user));
export const PUT = handler(async ({ req, user }) => savePrefs(user, await body(req, prefsInput)));
