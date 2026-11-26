import { NextResponse, type NextRequest } from 'next/server';
import { cronAuthorized } from '@/lib/cronAuth';
import { logError } from '@/lib/log';
import { recordReviewState, reviewInput } from '@/lib/appStore';

export const dynamic = 'force-dynamic';

/** #1177: GitHub Actions(appstore-status.yml)가 App Store Connect 에서 읽은 iOS 심사 상태를 보냄 → 바뀐 때만 운영자 알림 */
export async function POST(req: NextRequest) {
  if (!(await cronAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = reviewInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  try { return NextResponse.json(await recordReviewState(parsed.data)); }
  catch (e) { await logError('app-review', e); return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
