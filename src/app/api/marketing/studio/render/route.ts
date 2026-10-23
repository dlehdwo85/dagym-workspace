import { NextResponse, after, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { renderNext } from '@/lib/mktVideo';
import { logError } from '@/lib/log';

/** #454 영상 검수·합성 함수 — ffmpeg 정적 빌드가 이 함수에만 실린다(next.config outputFileTracingIncludes). 정기 실행·생성 확인이 CRON_SECRET 으로 부르고,
 *  응답은 바로(202) 주고 처리는 응답 뒤(최대 300초). 시간이 모자라면 남은 편은 다음 호출이 이어받는다 */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const j = await req.json().catch(() => ({}));
  const id = typeof j?.briefId === 'string' && /^[0-9a-f-]{36}$/i.test(j.briefId) ? j.briefId : null;
  after(async () => { try { await renderNext(id); } catch (e) { await logError('mkt:render', e); } });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
