import { NextResponse, type NextRequest } from 'next/server';
import { clientIp } from '@/lib/api';
import { shareDownload } from '@/lib/mailbox';

/** V21 기간 다운로드 링크의 파일 내려받기(열람 기록 후 짧은 수명 주소로 이동) */
export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string; n: string }> }) {
  const { token, n } = await ctx.params;
  try {
    const url = await shareDownload(token, Number(n), clientIp(req), req.headers.get('user-agent'));
    return NextResponse.redirect(new URL(url, req.url), 302);
  } catch { return new NextResponse('링크가 없거나 기간이 지났습니다', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } }); }
}
