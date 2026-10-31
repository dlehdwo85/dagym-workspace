import { handler } from '@/lib/api';
import { trialView } from '@/lib/mktTrial';

/** 275차 #809 상용화 시험(우리 회사 관리자만): 브랜드별 이번 달 글 작성 비용·생성 크레딧·승인률·수정 요청 · 요금제 가격 대비 원가율 */
export const GET = handler(async ({ user }) => trialView(user));
