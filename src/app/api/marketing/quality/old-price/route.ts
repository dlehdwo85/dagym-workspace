import { handler } from '@/lib/api';
import { oldPriceHits } from '@/lib/mktQuality';

/** 269차 #807: 워크인 옛 요금 문구('5명까지 무료'·'영구 무료')가 남은 곳 — 브랜드 키트 칸·규칙 주제·안 올린 글(관리자) */
export const GET = handler(async ({ user }) => oldPriceHits(user));
