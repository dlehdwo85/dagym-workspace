import { handler } from '@/lib/api';

export const maxDuration = 120; // 만드는 일은 글 모델(최상 모델 30~60초)
/** 190차(대표 #689) 브랜드 키트 [AI로 채우기]: 소개·상품·말투·금지어·사실 카드·주제 풀·틀 성격·색·표지 머리말 후보 초안 — 저장 안 함(화면에서 고른 칸만 PATCH) */
export const POST = handler<{ id: string }>(async ({ user, params }) => (await import('@/lib/mktKitDraft')).kitDraft(user, params.id));
