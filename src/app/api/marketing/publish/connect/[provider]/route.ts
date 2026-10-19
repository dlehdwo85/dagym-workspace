import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { publishConnectStart } from '@/lib/mktChannels';

/** 게시 채널 [연결] 시작(관리자) — Meta: 페이스북 페이지 + 인스타그램 비즈니스 */
export const GET = handler<{ provider: string }>(async ({ user, params }) => NextResponse.redirect(await publishConnectStart(user, params.provider), 302));
