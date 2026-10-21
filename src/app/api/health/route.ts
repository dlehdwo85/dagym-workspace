import { mailConfigured } from '@/lib/mail';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { s3Configured, s3EnvWarnings } from '@/lib/storage';
import { webPushConfigured, fcmConfigured } from '@/lib/push';
import { googleSyncEnabled } from '@/lib/google/client';

export const dynamic = 'force-dynamic';

export async function GET() {
  const started = Date.now();
  try {
    const sql = db();
    const [r] = await sql`select now() as now,
      (select max(started_at) from job_runs where job = 'tick' and status = 'ok') as last_tick,
      (select trigger from job_runs where job = 'tick' and status = 'ok' order by id desc limit 1) as last_trigger,
      (select name from schema_migrations order by name desc limit 1) as migration`;
    const lastTick = r.last_tick ? new Date(r.last_tick) : null;
    const tickAgeMin = lastTick ? Math.round((Date.now() - lastTick.getTime()) / 60000) : null;
    return NextResponse.json({
      ok: true,
      db: 'ok',
      dbLatencyMs: Date.now() - started,
      migration: r.migration,
      scheduler: { lastTick, lastTrigger: r.last_trigger ?? null, ageMinutes: tickAgeMin, healthy: tickAgeMin !== null && tickAgeMin <= 30 },
      config: {
        fileStorage: s3Configured() ? 's3' : 'local-disk',
        // 값은 내보내지 않고 형식 이상(공백·줄바꿈·따옴표)만
        storageWarnings: s3EnvWarnings(),
        webPush: webPushConfigured(),
        mail: mailConfigured(),
        appPush: fcmConfigured(),
        googleCalendar: googleSyncEnabled(), // 선택 기능
        salesSrcKey: (await import('@/lib/sales/supabaseSrc')).srcKeyKind(), // V41 단계 2: 영업관리 원본 키 종류(값은 안 보임)

      },
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, db: 'error', error: (e as Error).message }, { status: 503 });
  }
}
