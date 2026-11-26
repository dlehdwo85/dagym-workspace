import { NextResponse, type NextRequest } from 'next/server';
import { runTick } from '@/lib/jobs';
import { logError } from '@/lib/log';
import { cronAuthorized } from '@/lib/cronAuth';

export const maxDuration = 300; // 대표 10/24 ①: 마케팅 글 제작(최상 모델)은 응답 뒤(after)로 돌아 이 시간 안에서 끝남
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  const who = await cronAuthorized(req);
  if (!who) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const reason = req.nextUrl.searchParams.get('reason') ?? who;
    return NextResponse.json(await runTick(reason, { forceDigest: req.nextUrl.searchParams.get('digest') === 'force' })); // digest=force 는 시험용(묶음 즉시 발송)
  } catch (e) {
    await logError('tick', e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const POST = handle;
export const GET = handle; // Vercel Cron 은 GET 으로 호출
