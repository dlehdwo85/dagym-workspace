import { handler, body } from '@/lib/api';
import { localKeywords, localKwInput } from '@/lib/adOps';

export const maxDuration = 60;
/** 광고 최적화 1차 ② 동네 × 서비스 키워드의 네이버 월 검색량(키워드 도구, 관리자) */
export const POST = handler(async ({ req, user }) => localKeywords(user, await body(req, localKwInput)));
