import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { oauthStart } from '@/lib/marketingAds';

/** Meta·Google 광고 계정 OAuth 시작(관리자) */
export const GET = handler<{ provider: string }>(async ({ user, params }) => NextResponse.redirect(await oauthStart(user, params.provider), 302));
