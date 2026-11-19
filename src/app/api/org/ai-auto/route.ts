import { handler, body, clientIp } from '@/lib/api';
import { aiAutoInput, getCompanyAiAuto, setCompanyAiAuto } from '@/lib/ai/consent';

/** 회사 스위치 '회사 자료 자동 AI 처리'(대표 11/19): 사람이 누르지 않아도 도는 작업(문의 한 줄 요약 등)이 바깥 AI 를 써도 되는지 — 바꾸기는 회사 정보 편집 권한 */
export const GET = handler(async ({ user }) => getCompanyAiAuto(user));
export const PUT = handler(async ({ req, user }) => setCompanyAiAuto(user, await body(req, aiAutoInput), clientIp(req)));
