import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { tenantOf } from '@/lib/types';

export const GET = handler(async ({ user }) => {
  await requireMenu(user, 'ops', 'view');
  const sql = db();
  const [jobs, errors, deliveries, syncErrors, counts, recent, noDevice, dbLocale, pickDiag] = await Promise.all([
    sql`select id, job, trigger, started_at, finished_at, status, detail from job_runs order by id desc limit 30`,
    sql`select id, source, message, context, created_at from error_logs where source not like 'diag:%' order by id desc limit 50`,
    sql`select status, count(*)::int c from notification_deliveries where created_at > now() - interval '7 days' group by status`,
    sql`select l.id, l.action, l.status, l.detail, l.created_at, u.name from sync_logs l left join users u on u.id = l.user_id
        where l.status in ('error','conflict') order by l.id desc limit 30`,
    sql`select (select count(*)::int from users where status='active') users, (select count(*)::int from tasks where deleted_at is null) tasks,
        (select count(*)::int from events where deleted_at is null) events, (select count(*)::int from attachments where deleted_at is null) files,
        (select coalesce(sum(size_bytes),0)::bigint from attachments where deleted_at is null and kind='file') file_bytes`,
    // V6 9번: 최근 알림 50건 — 받는 사람·기기 수·발송 상태(기기 없음 포함)·오류. 데모 계정 제외
    sql`select n.id, n.title, n.type, n.created_at, u.name as user_name,
          (select count(*)::int from push_subscriptions p where p.user_id = n.user_id and p.disabled_at is null) as devices,
          coalesce((select json_agg(json_build_object('channel', d.channel, 'status', d.status, 'error', d.error, 'sent_at', d.sent_at) order by d.id)
            from notification_deliveries d where d.notification_id = n.id), '[]') as deliveries
        from notifications n join users u on u.id = n.user_id
        where u.tenant = 'default' order by n.created_at desc limit 50`,
    // 알림을 받을 기기가 하나도 없는 사람 (앱 알림 켜기 안내 대상)
    sql`select u.id, u.name from users u where u.status = 'active' and u.tenant = 'default'
        and not exists (select 1 from push_subscriptions p where p.user_id = u.id and p.disabled_at is null) order by u.name`,
    // 163차 ①(로컬 10/26 ⑤): 운영 DB 정렬 규칙 — en_US.utf8 이면 한글 이름순이 가나다순이 아닐 수 있음(C.UTF-8·ko_KR 이면 괜찮음)
    sql<{ datcollate: string; datctype: string; version: string }[]>`select datcollate, datctype, version() as version from pg_database where datname = current_database()`,
    // 248차 #780: 휴대폰 사진 고르기 진단 최근 20건(사람 이름·기기)
    sql`select e.id, e.message, e.context, e.created_at, u.name from error_logs e left join users u on u.id::text = e.context->>'userId' where e.source = 'diag:pick' order by e.id desc limit 20`,
  ]);
  // 371차 #994(대표 11/06): 빠졌던 날 / 다시 채움 — AI 한도·크레딧으로 못 한 항목(이 회사 + 공용 공고)과 수집기가 실패한 날
  const { skipSummary } = await import('@/lib/ai/skips');
  const aiSkips = await skipSummary(sql, [tenantOf(user), 'global']).catch(() => []);
  const { COLLECTORS } = await import('@/lib/sales/collectors');
  const label = new Map(COLLECTORS.map((c) => [c.slug, c.label]));
  const collectorDays = (await sql<{ day: string; slug: string; failed: number; ok: number; next_ok: Date | null }[]>`
    select x.day, x.slug, x.failed, x.ok, (select min(r.started_at) from sales_collector_runs r where r.slug = x.slug and r.status in ('success', 'partial')
      and r.started_at > (x.day::date + 1)::timestamp at time zone 'Asia/Seoul') as next_ok
    from (select to_char(started_at at time zone 'Asia/Seoul', 'YYYY-MM-DD') as day, slug, count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status in ('success', 'partial'))::int as ok from sales_collector_runs where started_at > now() - interval '14 days' group by 1, 2) x
    where x.failed > 0 order by x.day desc, x.slug limit 60`.catch(() => [])).map((r) => ({ ...r, label: label.get(r.slug) ?? r.slug }));
  // 379차(로컬 11/07 'ops 에서 salesKg2bDetail 을 못 찾음'): 위 jobs 30줄은 다른 작업에 밀려 정기 실행(tick)이 빠질 수 있음 → 최근 정기 실행 5번의 KG2B 상세 읽기 결과만 따로
  const kg2bTicks = await sql`select id, started_at, finished_at, status, detail->'salesKg2bDetail' as "salesKg2bDetail" from job_runs
    where job = 'tick' and status <> 'skipped' and finished_at is not null order by id desc limit 5`.catch(() => []);
  return { jobs, errors, deliveries, syncErrors, counts: counts[0], recent, noDevice, dbLocale: dbLocale[0] ?? null, pickDiag, aiSkips, collectorDays, kg2bTicks };
});
