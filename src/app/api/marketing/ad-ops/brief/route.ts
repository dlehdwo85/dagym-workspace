import { handler } from '@/lib/api';
import { brandBriefs } from '@/lib/mktBrandBrief';

/** 399차 #1025 사업(브랜드)별 한 장 요약 — 이번 달 광고비·계획·클릭·문의·잔액·잘 되는 검색어·돈만 쓰는 검색어·할 일(마케팅 공간 구성원) */
export const GET = handler(async ({ user }) => brandBriefs(user));
