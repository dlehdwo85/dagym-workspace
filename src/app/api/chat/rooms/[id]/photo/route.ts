import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { roomPhoto } from '@/lib/chat';

/** 메신저 3차 D14 방 사진(방 사람만) — 잠깐 쓰는 주소로 넘김. ?v= 는 사진이 바뀌면 달라지는 값(브라우저가 옛 사진을 붙잡지 않게) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const res = NextResponse.redirect(new URL(await roomPhoto(user, params.id), req.nextUrl.origin), 302);
  res.headers.set('cache-control', 'private, max-age=300');
  return res;
});
