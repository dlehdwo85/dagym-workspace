import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { outboxJob } from '@/lib/mailbox';
import { logError } from '@/lib/log';

/** V21 보관함 처리(재시도) — 정기 실행이 서울 지역에서 돌도록 이 주소를 부른다. CRON_SECRET 필요 */
export const preferredRegion = 'icn1';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || token.length !== secret.length || !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json(await outboxJob()); } catch (e) { await logError('outbox:run', e); return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
