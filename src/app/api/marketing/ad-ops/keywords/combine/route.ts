import { handler, body } from '@/lib/api';
import { combineInput, combineVolumes } from '@/lib/adOps';

export const maxDuration = 120; // 조합 300개 = 키워드 도구 60번
/** #499-2 키워드 N단 조합(단어 그룹 2~4개, 최대 300개) + 네이버 월 검색량(키워드 도구, 관리자) */
export const POST = handler(async ({ req, user }) => combineVolumes(user, await body(req, combineInput)));
