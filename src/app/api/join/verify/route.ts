import { NextResponse, type NextRequest } from 'next/server';
import { verifyJoin } from '@/lib/joinLinks';
import { HttpError } from '@/lib/errors';

/** #1176 합류 신청 메일 확인 → 관리자에게 알림 → 안내 화면 */
export async function GET(req: NextRequest) {
  try {
    const r = await verifyJoin(req.nextUrl.searchParams.get('t') ?? '');
    return NextResponse.redirect(new URL(`/join/sent?verified=1&c=${encodeURIComponent(r.company)}`, req.nextUrl.origin), 303);
  } catch (e) {
    const msg = e instanceof HttpError ? e.message : '확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요.';
    return NextResponse.redirect(new URL(`/join/sent?error=${encodeURIComponent(msg)}`, req.nextUrl.origin), 303);
  }
}
