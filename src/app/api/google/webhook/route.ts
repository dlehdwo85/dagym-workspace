import { featureGateOk } from '@/lib/google/gate';
import { NextResponse, after, type NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { syncLink } from '@/lib/google/sync';

/** Google Calendar 푸시 알림 수신. 채널 id + 토큰이 일치할 때만 해당 연결을 동기화 */
export async function POST(req: NextRequest) {
  if (!featureGateOk()) return new NextResponse(null, { status: 404 });
  const channelId = req.headers.get('x-goog-channel-id');
  const token = req.headers.get('x-goog-channel-token');
  const state = req.headers.get('x-goog-resource-state');
  if (!channelId || !token) return new NextResponse(null, { status: 400 });
  const [l] = await db()`select id from google_calendar_links where channel_id = ${channelId} and channel_token = ${token}`;
  if (!l) return new NextResponse(null, { status: 404 });
  if (state !== 'sync') after(() => syncLink(l.id, 'webhook').catch(() => {}));
  return new NextResponse(null, { status: 200 });
}
