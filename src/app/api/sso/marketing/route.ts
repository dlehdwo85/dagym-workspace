import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { issueMarketingToken } from '@/lib/sso';

/** V41 4-1: [마케팅 운영실 열기] → 1회용 토큰을 붙여 운영실 SSO 주소로 보냄(운영실이 확인 엔드포인트로 검증) */
export const GET = handler(async ({ user }) => {
  const token = await issueMarketingToken(user);
  const to = new URL(process.env.MARKETING_SSO_URL || 'https://dazim-hilink-integration.vercel.app/api/sso/workin');
  to.searchParams.set('token', token);
  return NextResponse.redirect(to, 302);
});
