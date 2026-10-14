import { NextResponse, type NextRequest } from 'next/server';
import { handleReturn } from '@/lib/billing';
import { logError } from '@/lib/log';

/** 나이스페이 결제창 인증 응답(브라우저 POST, 나이스페이 출처) → 승인 → 결제 화면으로 */
export async function POST(req: NextRequest) {
  const base = process.env.APP_URL || req.nextUrl.origin;
  try {
    const r = await handleReturn(await req.text());
    return NextResponse.redirect(`${base}/admin/usage?${new URLSearchParams(r.ok ? { paid: '1' } : { payfail: r.msg ?? '결제 실패' })}`, 303);
  } catch (e) {
    await logError('nicepay-return', e);
    return NextResponse.redirect(`${base}/admin/usage?payfail=${encodeURIComponent((e as Error).message)}`, 303);
  }
}
