import { handler } from '@/lib/api';
import { leadsReport } from '@/lib/adLeads';

/** 광고 최적화 1차 ③ 키워드별 광고비 × 광고로 들어온 전화·문의 → 전환당 비용·판단(마케팅 공간, 끄기는 관리자) */
export const GET = handler(async ({ req, user }) => leadsReport(user, { days: Number(req.nextUrl.searchParams.get('days')) || undefined }));
