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
      (select name from schema_migrations order by name desc limit 1) as migration,
      current_setting('jit') as jit,
      (select coalesce(bool_or(c = 'jit=off'), false) from pg_roles, unnest(rolconfig) c where rolname = current_user) as jit_role`;
    const lastTick = r.last_tick ? new Date(r.last_tick) : null;
    const tickAgeMin = lastTick ? Math.round((Date.now() - lastTick.getTime()) / 60000) : null;
    return NextResponse.json({
      ok: true,
      db: 'ok',
      dbLatencyMs: Date.now() - started,
      migration: r.migration,
      dbJit: r.jit, // 238차(#742): 220 마이그레이션 뒤 'off' 여야 함(큰 SQL 이 컴파일에 1초 넘게 쓰던 원인)
      dbJitRole: r.jit_role, // 239차: 역할 설정에 jit=off 가 들어갔는지(true 인데 dbJit 'on' 이면 DB 연결이 아직 옛 연결)
      // 로컬 10/22: 빌드가 기대하는 마지막 마이그레이션보다 DB 가 뒤면 true — 빌드 때 DB 장애로 건너뛴 것(다시 배포 또는 db:migrate)
      expectedMigration: process.env.LATEST_MIGRATION || null,
      migrationBehind: !!process.env.LATEST_MIGRATION && (r.migration ?? '') < process.env.LATEST_MIGRATION,
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
        funnelStats: !!process.env.FUNNEL_STATS_TOKEN && process.env.FUNNEL_STATS_TOKEN.length >= 16, // 로컬 10/21 16:50: 주간 퍼널 읽기 토큰이 설정됐는지(값은 안 보임)

      },
      env: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, db: 'error', error: (e as Error).message }, { status: 503 });
  }
}
