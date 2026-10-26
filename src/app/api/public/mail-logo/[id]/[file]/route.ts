import { NextResponse, type NextRequest } from 'next/server';
import { mailLogo } from '@/lib/mailbox';

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
/** 184차(로컬 10/26 18:25 A안): 메일 명함 로고 — 주소에 파일 id 가 있어 로고를 바꿔도 지난 메일은 보낸 때 로고 그대로(서명된 주소만).
 *  그 파일이 지워졌으면 지금 로고로 대신하고 그때는 짧게만 캐시 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await ctx.params;
  try {
    const { data, name, exact } = await mailLogo(id, req.nextUrl.searchParams.get('s') ?? '', file);
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    return new NextResponse(new Uint8Array(data), { headers: { 'content-type': MIME[ext] ?? 'image/png', 'cache-control': exact ? 'public, max-age=2592000, immutable' : 'public, max-age=86400',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'" } });
  } catch { return new NextResponse('not found', { status: 404 }); }
}
