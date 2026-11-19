import { handler } from '@/lib/api';
import { agreementSummary } from '@/lib/agreements';

/** 홈 '계약' 카드: 챙길 것(만료·연장 확인·통보 기한 지남)과 30일 안에 손써야 하는 계약 — 계약 관리 권한이 없으면 show:false */
export const GET = handler(async ({ user }) => agreementSummary(user));
