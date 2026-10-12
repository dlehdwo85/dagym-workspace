import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { s3Configured } from '@/lib/storage';
import { webPushConfigured, fcmConfigured } from '@/lib/push';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    const sql = db();
    const [r] = await sql`select now() as now,
      (select max(started_at) from job_runs where job = 'tick' and status = 'ok') as last_tick,
      (select name from schema_migrations order by name desc limit 1) as migration`;
    const lastTick = r.last_tick ? new Date(r.last_tick) : null;
    const tickAgeMin = lastTick ? Math.round((Date.now() - lastTick.getTime()) / 60000) : null;
    return NextResponse.json({
      ok: true,
      db: 'ok',
      dbLatencyMs: Date.now() - started,
      migration: r.migration,
      scheduler: { lastTick, ageMinutes: tickAgeMin, healthy: tickAgeMin !== null && tickAgeMin <= 30 },
      config: {
        fileStorage: s3Configured() ? 's3' : 'local-disk',
        webPush: webPushConfigured(),
        appPush: fcmConfigured(),
        googleCalendar: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, db: 'error', error: (e as Error).message }, { status: 503 });
  }
}
