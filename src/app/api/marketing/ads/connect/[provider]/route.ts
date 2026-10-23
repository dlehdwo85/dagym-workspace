import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { oauthStart } from '@/lib/marketingAds';

/** Meta·Google 광고 계정 OAuth 시작(관리자) · ?manage=1 = 메타 광고 만들기 권한(#494) */
export const GET = handler<{ provider: string }>(async ({ req, user, params }) => NextResponse.redirect(await oauthStart(user, params.provider, { manage: new URL(req.url).searchParams.get('manage') === '1' }), 302));
