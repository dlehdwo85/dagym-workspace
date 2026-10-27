import { handler } from '@/lib/api';
import { getKwSuggestion, runKwSuggestion } from '@/lib/sales/kwSuggest';

// 224차 #457 관심 검색어·제외어 추천: GET = 마지막 추천 · POST = 지금 추천 받기(관리자, AI 는 회사 월 AI 예산 안)
export const GET = handler(async ({ user }) => getKwSuggestion(user));
export const POST = handler(async ({ user }) => runKwSuggestion(user));
