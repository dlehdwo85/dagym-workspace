import { handler } from '@/lib/api';
import { checkSummary } from '@/lib/check/rounds';

/** 홈 '점검' 카드: 진행 중인 내 점검 · 보완 요청(확인 대기·조치 중) · 마지막 점검 — 점검하기 권한이 없으면 show:false */
export const GET = handler(async ({ user }) => checkSummary(user));
