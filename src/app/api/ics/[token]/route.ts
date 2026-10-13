import { NextResponse, type NextRequest } from 'next/server';
import { feedIcs } from '@/lib/ics';

/** 공개 ICS 구독 주소 (토큰 = 비밀). 캘린더 앱이 주기적으로 가져간다 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = token.replace(/\.ics$/, '');
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(t)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const origin = process.env.APP_URL || req.nextUrl.origin;
  const body = await feedIcs(t, origin);
  if (!body) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(body, { headers: { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'private, max-age=300', 'content-disposition': 'inline; filename="workin.ics"' } });
}
