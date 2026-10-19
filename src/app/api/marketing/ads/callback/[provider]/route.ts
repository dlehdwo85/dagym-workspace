import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '@/lib/auth';
import { oauthCallback } from '@/lib/marketingAds';

/** OAuth 콜백 → 광고 성과 화면으로(성공·실패 안내는 화면에서) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const base = (process.env.APP_URL ?? req.nextUrl.origin).replace(/\/$/, '');
  const back = (q: string) => NextResponse.redirect(`${base}/s/marketing/connections?${q}`, 302);
  const u = await currentUser();
  if (!u) return NextResponse.redirect(`${base}/login?next=/s/marketing/connections`, 302);
  const p = req.nextUrl.searchParams;
  if (p.get('error')) return back(`error=${encodeURIComponent(p.get('error_description') ?? p.get('error')!)}`);
  try {
    const r = await oauthCallback(u, provider, p.get('code') ?? '', p.get('state') ?? '');
    return back(`connected=${provider}&count=${r.count}`);
  } catch (e: any) {
    return back(`error=${encodeURIComponent(String(e?.message ?? '연결 실패').slice(0, 200))}`);
  }
}
