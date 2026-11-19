import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { photoUrl, removePhoto } from '@/lib/check/photos';

/** 점검 사진 열기(권한을 본 뒤 잠깐 쓰는 주소로 넘김) · 지우기(가이드 편집 권한) */
export const GET = handler<{ id: string }>(async ({ req, user, params }) => NextResponse.redirect(new URL(await photoUrl(user, params.id), req.nextUrl.origin).toString(), 302));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => removePhoto(user, params.id));
