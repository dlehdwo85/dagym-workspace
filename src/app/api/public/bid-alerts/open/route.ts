import { NextResponse, type NextRequest } from 'next/server';
import { recordOpen } from '@/lib/bidAlerts';

export const runtime = 'nodejs';
// 1×1 투명 GIF
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
/** #949 열람 측정(메일 안 1×1 그림) — 토큰·날짜만, 개인정보 없음. 그림은 늘 돌려준다 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  await recordOpen(q.get('t') ?? '', q.get('d') ?? '').catch(() => false);
  return new NextResponse(GIF, { status: 200, headers: { 'content-type': 'image/gif', 'cache-control': 'no-store, no-cache, must-revalidate', 'content-length': String(GIF.length) } });
}
