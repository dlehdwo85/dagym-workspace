import { NextResponse, type NextRequest } from 'next/server';
import { mailLogo } from '@/lib/mailbox';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
/** V21 메일 명함 로고 — 메일 프로그램이 로그인 없이 불러간다(서명된 주소만, 하루 캐시) */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const { data, name } = await mailLogo(id, req.nextUrl.searchParams.get('s') ?? '');
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return new NextResponse(new Uint8Array(data), { headers: { 'content-type': MIME[ext] ?? 'image/png', 'cache-control': 'public, max-age=86400', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  } catch { return new NextResponse('not found', { status: 404 }); }
}
