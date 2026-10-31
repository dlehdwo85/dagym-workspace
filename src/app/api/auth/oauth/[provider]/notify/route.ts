import { NextResponse, type NextRequest } from 'next/server';
import { appleEnv, appleNotify } from '@/lib/oauthApple';

/**
 * 299차 #858 Apple 서버 알림(Services ID 의 Server-to-Server Notification Endpoint):
 * 사용자가 Apple 쪽에서 연결을 끊거나 Apple 계정을 지우면 우리 쪽 Apple 연결도 지움. 서명(Apple 공개 키)·대상(Services ID) 확인 뒤에만.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  if (provider !== 'apple' || !appleEnv()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const j = await req.json().catch(() => null) as { payload?: unknown } | null;
  if (typeof j?.payload !== 'string') return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try { return NextResponse.json(await appleNotify(j.payload)); }
  catch { return NextResponse.json({ error: 'invalid' }, { status: 400 }); }
}
