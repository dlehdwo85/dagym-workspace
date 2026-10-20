import { handler } from '@/lib/api';
import { inboxView } from '@/lib/mktOps';

/** 대표 02:30 ① 승인함 통합: 콘텐츠·운영 제안·광고 예산·월 목표·제작 의뢰 건수 + 목록 */
export const GET = handler(async ({ user }) => inboxView(user));
