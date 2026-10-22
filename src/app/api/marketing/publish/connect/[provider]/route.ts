import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { publishConnectStart } from '@/lib/mktChannels';

/** 게시 채널 [연결] 시작(관리자) — Meta: 페이스북 페이지 + 인스타그램 비즈니스. ?leads=1 = 광고 2차 ① [리드 광고 받기](리드 권한까지) */
export const GET = handler<{ provider: string }>(async ({ req, user, params }) => NextResponse.redirect(await publishConnectStart(user, params.provider, { leads: req.nextUrl.searchParams.get('leads') === '1' }), 302));
