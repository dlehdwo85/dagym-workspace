import { handler, body } from '@/lib/api';
import { sampleInput, sampleSet } from '@/lib/mktAuto';

export const maxDuration = 300;
/** 요청 C §4(대표 10/25 22:20): 관리자 — 브랜드별 시안 세트(내일 피드 카드뉴스·스토리, 고른 브랜드 블로그) 1회 제작 → 승인함. 제작은 응답 뒤 이어서 */
export const POST = handler(async ({ req, user }) => sampleSet(user, await body(req, sampleInput)));
