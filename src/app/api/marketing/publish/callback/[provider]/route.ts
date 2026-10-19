import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { publishConnectCallback } from '@/lib/mktChannels';

/** 게시 채널 OAuth 콜백 → 연결 계정 화면(결과·점검 안내는 화면에서) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const base = (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  const back = (q: string) => NextResponse.redirect(`${base}/s/marketing/connections?${q}`, 302);
  const u = await currentUser();
  if (!u) return NextResponse.redirect(`${base}/login?next=/s/marketing/connections`, 302);
  const p = req.nextUrl.searchParams;
  if (p.get('error')) return back(`error=${encodeURIComponent(p.get('error_description') ?? p.get('error')!)}`);
  try {
    const r = await publishConnectCallback(u, provider, p.get('code') ?? '', p.get('state') ?? '');
    return back(`published=${provider}&pages=${r.pages}&ig=${r.instagram}&warn=${r.warnings}`);
  } catch (e: any) {
    return back(`error=${encodeURIComponent(String(e?.message ?? '연결 실패').slice(0, 300))}`);
  }
}
