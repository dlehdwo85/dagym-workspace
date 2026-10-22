import { NextResponse, after, type NextRequest } from 'next/server';
import { processMetaLead, receiveWebhook, verifyChallenge } from '@/lib/metaLeads';
import { logError } from '@/lib/log';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** 광고 2차 ① Meta 웹후크 확인(앱 대시보드에서 콜백 주소 저장 때) — 확인 토큰이 맞으면 hub.challenge 를 그대로 돌려줌 */
export async function GET(req: NextRequest) {
  const c = verifyChallenge(req.nextUrl.searchParams);
  return c === null ? new NextResponse('forbidden', { status: 403 }) : new NextResponse(c, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

/** 리드 알림(page › leadgen): 앱 시크릿 서명 확인 → 받은 기록(같은 리드는 한 번) → 200 을 먼저 돌려주고 응답 뒤에 영업 리드 처리(남으면 점검이 이어서) */
export async function POST(req: NextRequest) {
  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length > 1_000_000) return NextResponse.json({ error: 'too large' }, { status: 413 });
  try {
    const ids = await receiveWebhook(raw, req.headers.get('x-hub-signature-256'));
    if (ids.length) after(async () => {
      for (const id of ids) await processMetaLead(id).catch((e) => logError('meta-leads', e, { id }));
      await (await import('@/lib/push')).dispatchPending().catch(() => {});
    });
    return NextResponse.json({ ok: true, received: ids.length });
  } catch (e: any) {
    if (e?.status === 403) return NextResponse.json({ error: 'bad signature' }, { status: 403 });
    await logError('meta-webhook', e).catch(() => {});
    return NextResponse.json({ ok: false }); // 본문이 이상하면 200 — 같은 것을 계속 다시 보내지 않게(처리는 점검의 '놓친 리드 불러오기'가 채움)
  }
}
