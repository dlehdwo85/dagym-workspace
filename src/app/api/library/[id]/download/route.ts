import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { libraryDownload } from '@/lib/library';

/** ?json=1 이면 이동 대신 주소만(앱: 기기 브라우저로 넘겨 내려받기) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => {
  const abs = new URL(await libraryDownload(user, params.id, req.nextUrl.searchParams.get('inline') === '1'), req.nextUrl.origin).toString();
  return req.nextUrl.searchParams.get('json') === '1' ? { url: abs } : NextResponse.redirect(abs, 302);
});
