import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { versionDownload } from '@/lib/attachmentEdit';

/** 이전 버전 내려받기(서명 주소로 이동 — 로컬 저장은 상대 주소라 절대 주소로) */
export const GET = handler<{ id: string; vid: string }>(async ({ req, user, params }) => NextResponse.redirect(new URL(await versionDownload(user, params.id, params.vid), req.nextUrl.origin).toString(), 302));
