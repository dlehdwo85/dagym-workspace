import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { libraryDownload } from '@/lib/library';

export const GET = handler<{ id: string }>(async ({ req, user, params }) =>
  NextResponse.redirect(new URL(await libraryDownload(user, params.id, req.nextUrl.searchParams.get('inline') === '1'), req.nextUrl.origin), 302));
