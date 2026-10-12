import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { newToken } from '@/lib/crypto';
import { authUrl, googleConfigured } from '@/lib/google/client';
import { HttpError } from '@/lib/errors';

/** 연결 범위 선택: mode=both(읽기·쓰기 양방향) | import(읽기 전용 가져오기) */
export const GET = handler(async ({ req, user }) => {
  if (!googleConfigured()) throw new HttpError(503, 'not_configured', 'Google 연동이 아직 설정되지 않았습니다 (관리자 설정 필요)');
  const mode = req.nextUrl.searchParams.get('mode') === 'import' ? 'import' : 'both';
  const state = newToken(24);
  await db()`insert into google_oauth_states (state, user_id, mode) values (${state}, ${user.id}, ${mode})`;
  return NextResponse.redirect(authUrl(state, mode), 302);
});
