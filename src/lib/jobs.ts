import { randomUUID } from 'node:crypto';
import { db } from './db';
import { notify } from './notifications';
import { dispatchPending } from './push';
import { spawnNextRecurrence } from './tasks';
import { nextDate, occurrences } from './recurrence';
import { addDays, todaySeoul } from './time';
import { STATUS_LABEL, type TaskStatus } from './types';
import { logError } from './log';
import { googleConfigured } from './google/client';
import { syncAllDue } from './google/sync';

const RECUR_LEAD_DAYS = 7;

async function dueNotifications() {
  const sql = db();
  // 마감 임박: 사용자별 설정 시간(기본 24시간) 이내
  // 로컬 10/20 알림 다이어트: 개별 마감 예고 푸시는 높음·긴급 업무만, 나머지는 목록 + 아침 브리핑에 모아서
  const important = (p: string) => p === 'high' || p === 'urgent';
  // 로컬 10/20(대표): 알람처럼 울리기 — 업무별 alarm 또는 사람별 기본값(업무 끔·중요 켬) → meta.alarm (푸시 payload·웹 띠·[해제][10분 뒤])
  const { alarmOn } = await import('./alarm');
  const AD = new Map((await sql<{ user_id: string; e: boolean; t: boolean; i: boolean }[]>`select user_id, coalesce(alarm_events, false) e, coalesce(alarm_tasks, false) t, coalesce(alarm_important, true) i from user_settings`).map((r) => [r.user_id, { events: r.e, tasks: r.t, important: r.i }]));
  const adOf = (uid: string) => AD.get(uid) ?? { events: false, tasks: false, important: true };
  const alarmMeta = (t: { assignee_id: string; alarm: boolean | null; priority: string }) => (alarmOn('task', t.alarm, adOf(t.assignee_id), t.priority) ? { alarm: true } : {});
  // 대표 10/21 22:00 ⑦(#420): 알람은 사람별 'N분 전'(alarm_minutes, 기본 10) 시점에만 전체 화면으로 — 다른 시점(1시간 전 등) 알림은 보통 푸시
  const alarmAt = (t: { assignee_id: string; alarm: boolean | null; priority: string; m: number; alarm_m: number }) => (t.m === t.alarm_m ? alarmMeta(t) : {});
  const soon = await sql<{ id: string; title: string; assignee_id: string; due_date: string; due_time: string | null; priority: string; alarm: boolean | null }[]>`
    select t.id, t.title, t.assignee_id, t.due_date, to_char(t.due_time,'HH24:MI') due_time, t.priority, t.alarm
    from tasks t join users u on u.id = t.assignee_id left join user_settings s on s.user_id = u.id
    where t.deleted_at is null and t.status not in ('done','on_hold') and u.status = 'active' and t.due_date is not null
      and ((t.due_date + coalesce(t.due_time, time '23:59')) at time zone 'Asia/Seoul') between now() and now() + make_interval(hours => coalesce(s.due_soon_hours, 0))
      -- V14 10번: 같은 업무·같은 날 알림은 가장 구체적인 1건 — 마감 당일은 "오늘 마감", 업무별 🔔 를 정했으면 그 알림만
      and t.due_date > (now() at time zone 'Asia/Seoul')::date and t.reminder_minutes is null`;
  let n = 0;
  for (const t of soon) {
    n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `마감 임박: ${t.title}`,
      body: `마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      dedupeKey: `due_soon:${t.id}:${t.due_date}:${t.due_time ?? ''}`, push: important(t.priority) || alarmOn('task', t.alarm, adOf(t.assignee_id), t.priority), meta: { kind: 'due', ...alarmMeta(t) } })).length;
  }
  // 매일 오전 9시(서울) 이후 첫 실행에서 하루 1회: 기한 지남 → 담당자·요청자, 오늘 마감 → 담당자 (완료·보류되면 멈춤)
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now));
  const today = todaySeoul(now);
  let over: { id: string; title: string; assignee_id: string | null; requested_by: string | null; created_by: string; due_date: string; days: number }[] = [];
  let dueToday: { id: string; title: string; assignee_id: string; due_time: string | null }[] = [];
  if (hour >= Number(process.env.DUE_DIGEST_HOUR ?? 9)) {
    over = await sql`
      select t.id, t.title, t.assignee_id, t.requested_by, t.created_by, t.due_date, (${today}::date - t.due_date)::int as days from tasks t
      -- 2026-10-15 대표: 기한 초과는 첫날(마감 다음 날) 1번만 — 그 뒤는 홈 "지연" 목록으로
      where t.deleted_at is null and t.status not in ('done','on_hold') and t.due_date is not null and t.due_date = ${today}::date - 1`;
    for (const t of over) {
      n += (await notify(sql, { userIds: [t.assignee_id, t.requested_by ?? t.created_by], type: 'overdue', title: `기한 지남: ${t.title}`,
        body: `마감일 ${t.due_date} · ${t.days}일 지났습니다`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        dedupeKey: `overdue:${t.id}:${today}`, push: false, meta: { kind: 'due' } })).length;
    }
    dueToday = await sql`
      select t.id, t.title, t.assignee_id, to_char(t.due_time,'HH24:MI') due_time, t.alarm, t.priority from tasks t join users u on u.id = t.assignee_id
        left join user_settings s on s.user_id = t.assignee_id
      where t.deleted_at is null and t.status not in ('done','on_hold') and t.due_date = ${today}::date and u.status = 'active'
        -- V14 10번(검수 3): 같은 업무·수신자·날짜당 1건 — 오늘 울리는 시각 알림(🔔 또는 기본 n분 전)이 있으면 "오늘 마감"은 생략
        and not exists (select 1 from unnest(coalesce(t.reminder_minutes, case when t.due_time is not null then array[coalesce(s.task_reminder_minutes, 60)] else array[]::int[] end)) r(m)
          where ((t.due_date + coalesce(t.due_time, time '09:00')) - make_interval(mins => r.m))::date = t.due_date)`;
    for (const t of dueToday) {
      n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `오늘 마감: ${t.title}`,
        body: t.due_time ? `오늘 ${t.due_time}까지` : '오늘까지 마감입니다', link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        dedupeKey: `due_today:${t.id}:${today}`, push: !!alarmMeta(t as any).alarm, meta: { kind: 'due', ...alarmMeta(t as any) } })).length;
    }
  }
  // V8 8번 미리 알림: 시간 있는 업무는 업무별 알림(최대 3개) 또는 각자 기본값(60분 전), 날짜만 있는 업무는 업무별 알림을 정했을 때만(당일 09시 기준)
  // 정기 실행 사이에 지나간 알림도 마감 전이면 보낸다(분 단위 정확도는 정기 실행 주기에 따름 — NEXT_ACTION 참고)
  const hourLeft = await sql<{ id: string; title: string; assignee_id: string; due_date: string; due_time: string | null; m: number; priority: string; alarm: boolean | null; alarm_m: number }[]>`
    select t.id, t.title, t.assignee_id, to_char(t.due_date,'YYYY-MM-DD') due_date, to_char(t.due_time,'HH24:MI') due_time, r.m, t.priority, t.alarm, coalesce(s.alarm_minutes, 10) as alarm_m
    from tasks t join users u on u.id = t.assignee_id left join user_settings s on s.user_id = t.assignee_id
    -- #420: 알람이 켜진 업무는 'N분 전'(alarm_minutes) 시점을 알림 시각에 더한다(그 시점만 전체 화면 알람)
    cross join lateral unnest(array_cat(coalesce(t.reminder_minutes, array[coalesce(s.task_reminder_minutes, 60)]),
      case when t.alarm is true or (t.alarm is null and (coalesce(s.alarm_tasks, false) or (t.priority in ('high', 'urgent') and coalesce(s.alarm_important, true)))) then array[coalesce(s.alarm_minutes, 10)] else array[]::int[] end)) as r(m)
    -- 기준 시각: 마감 시각 / 날짜만 있는 업무는 업무별 🔔 면 09시, 기본 알림이면 18시(퇴근 기준) → 기본 1시간 전 = 17시 (2026-10-15 대표: 모든 업무 1시간 전)
    cross join lateral (select (t.due_date + coalesce(t.due_time, case when t.reminder_minutes is null then time '18:00' else time '09:00' end)) at time zone 'Asia/Seoul' as at) b
    where t.deleted_at is null and t.status not in ('done','on_hold') and u.status = 'active' and t.due_date is not null
      and b.at > now() and b.at - make_interval(mins => r.m) <= now()`;
  for (const t of hourLeft) {
    const left = t.m >= 1440 ? `${Math.round(t.m / 1440)}일 뒤` : t.m >= 60 ? `${Math.round(t.m / 60)}시간 뒤` : t.m > 0 ? `${t.m}분 뒤` : '지금';
    n += (await notify(sql, { userIds: [t.assignee_id], type: 'due_soon', title: `${left} 마감: ${t.title}`,
      body: `${t.due_date === today ? '오늘' : t.due_date} ${t.due_time ?? ''}까지`.trim(), link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      dedupeKey: `due_rem:${t.id}:${t.due_date}:${t.due_time ?? ''}:${t.m}`, push: important(t.priority) || alarmOn('task', t.alarm, adOf(t.assignee_id), t.priority), meta: { kind: 'due', ...alarmAt(t) } })).length;
  }
  // V13 6번: 같은 알림을 요청자에게도 (담당자 이름·상태로 구분, 요청자 = 담당자면 생략, 일괄 업무는 묶음 1건)
  const kinds = [
    ...soon.map((t) => ({ id: t.id, kind: 'soon', label: '마감 임박', when: `마감 ${t.due_date}${t.due_time ? ' ' + t.due_time : ''}`, key: `${t.due_date}:${t.due_time ?? ''}` })),
    ...dueToday.map((t) => ({ id: t.id, kind: 'today', label: '오늘 마감', when: t.due_time ? `오늘 ${t.due_time}까지` : '오늘까지', key: today })),
    ...hourLeft.map((t) => { const left = t.m >= 1440 ? `${Math.round(t.m / 1440)}일 뒤` : t.m >= 60 ? `${Math.round(t.m / 60)}시간 뒤` : t.m > 0 ? `${t.m}분 뒤` : '지금';
      return { id: t.id, kind: `rem${t.m}`, label: `${left} 마감`, when: `${t.due_date === today ? '오늘' : t.due_date} ${t.due_time ?? ''}까지`.trim(), key: `${t.due_date}:${t.due_time ?? ''}` }; }),
  ];
  if (kinds.length) {
    const info = await sql<{ id: string; title: string; status: TaskStatus; requested_by: string; batch_id: string | null; assignee_name: string }[]>`
      select t.id, t.title, t.status, t.requested_by, t.batch_id, a.name assignee_name from tasks t
        join users a on a.id = t.assignee_id join users r on r.id = t.requested_by left join user_settings rs on rs.user_id = r.id
      where t.id = any(${[...new Set(kinds.map((k) => k.id))]}::uuid[]) and t.requested_by is not null and t.requested_by <> t.assignee_id
        and r.status = 'active' and coalesce(rs.requester_due_alerts, false) and t.status not in ('done','on_hold')`;
    type Info = (typeof info)[number];
    const groups = new Map<string, { k: (typeof kinds)[number]; ts: Info[] }>();
    for (const k of kinds) {
      const t = info.find((x) => x.id === k.id); if (!t) continue;
      const g = `${t.requested_by}|${t.batch_id ?? t.id}|${k.kind}|${k.key}`;
      const cur = groups.get(g) ?? { k, ts: [] }; if (!cur.ts.some((x) => x.id === t.id)) cur.ts.push(t); groups.set(g, cur);
    }
    for (const [g, { k, ts }] of groups) {
      const t = ts[0];
      const who = ts.length > 1 ? `${t.assignee_name} 외 ${ts.length - 1}명` : t.assignee_name;
      const states = ts.length > 1 ? Object.entries(ts.reduce((a, x) => ({ ...a, [STATUS_LABEL[x.status]]: (a[STATUS_LABEL[x.status]] ?? 0) + 1 }), {} as Record<string, number>)).map(([s, c]) => `${s} ${c}`).join('·') : STATUS_LABEL[t.status];
      n += (await notify(sql, { userIds: [t.requested_by], type: 'due_soon', title: `[요청] ${k.label}: ${t.title}`,
        body: `담당 ${who} · ${states} · ${k.when}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
        dedupeKey: `req_${g.split('|').slice(1).join(':')}`, push: false, meta: { kind: 'due' } })).length;
    }
  }
  return { dueSoon: soon.length, overdue: over.length, dueToday: dueToday.length, dueHour: hourLeft.length, created: n };
}

async function recurringTasks() {
  const sql = db();
  const today = todaySeoul();
  const rows = await sql<{ id: string; recurrence_rule: string; due_date: string }[]>`
    select id, recurrence_rule, due_date from tasks where recurrence_rule is not null and not recurrence_stopped and deleted_at is null and due_date is not null`;
  let spawned = 0;
  for (const r of rows) {
    const next = nextDate(r.recurrence_rule, r.due_date, r.due_date);
    if (!next || next > addDays(today, RECUR_LEAD_DAYS)) continue;
    const id = await sql.begin((tx) => spawnNextRecurrence(tx, r.id, null));
    if (id) spawned++;
  }
  return { candidates: rows.length, spawned };
}

async function cleanup() {
  const sql = db();
  const a = await sql`delete from idempotency_keys where created_at < now() - interval '3 days'`;
  const b = await sql`delete from sessions where expires_at < now() - interval '7 days' or revoked_at < now() - interval '30 days'`;
  const c = await sql`delete from google_oauth_states where created_at < now() - interval '1 hour'`;
  const d = await sql`update attachments set deleted_at = now() where upload_status = 'pending' and created_at < now() - interval '1 day' and deleted_at is null`;
  const e = await sql`delete from job_runs where started_at < now() - interval '60 days'`;
  // B-8 현장 신고자 이름·연락처: 처리 완료 1년 뒤 파기 (신고 양식 동의 문구와 개인정보처리방침에 적은 기준)
  const expired = await sql<{ task_id: string }[]>`update form_submissions s set reporter_name = null, reporter_phone = null, purged_at = now()
    from tasks t where t.id = s.task_id and s.purged_at is null and (s.reporter_name is not null or s.reporter_phone is not null)
      and t.status = 'done' and t.completed_at < now() - interval '1 year' returning s.task_id`;
  if (expired.length) {
    await sql`update tasks set description = regexp_replace(description, E'\n신고자: [^\n]*', E'\n신고자: (보관 기간 경과로 삭제)')
      where id = any(${expired.map((r) => r.task_id)}::uuid[])`;
  }
  return { idempotency: a.count, sessions: b.count, oauthStates: c.count, staleUploads: d.count, jobRuns: e.count, reporterPurged: expired.length };
}

/** 서버 정기 실행 (GitHub Actions 스케줄러가 5~15분마다 호출). 대표 PC 와 무관하게 동작 */
export async function runTick(trigger: string, opt: { forceDigest?: boolean } = {}) {
  const sql = db();
  const holder = randomUUID();
  const got = await sql`insert into job_locks (name, locked_until, holder) values ('tick', now() + interval '4 minutes', ${holder})
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder where job_locks.locked_until < now() returning 1`;
  const [run] = await sql<{ id: number }[]>`insert into job_runs (job, trigger, status) values ('tick', ${trigger}, ${got.length ? 'running' : 'skipped'}) returning id`;
  if (!got.length) {
    await sql`update job_runs set finished_at = now(), detail = ${sql.json({ reason: '이전 실행이 진행 중' })} where id = ${run.id}`;
    return { skipped: true };
  }
  const detail: Record<string, unknown> = {};
  let failed = false;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try { detail[name] = await fn(); } catch (e) { failed = true; detail[name] = { error: (e as Error).message }; await logError(`tick:${name}`, e); }
  };
  await step('recurring', recurringTasks);
  await step('due', dueNotifications);
  await step('eventReminders', () => eventReminders());
  await step('automations', async () => (await import('./automation')).dueSoonAutomations());
  await step('seriesTasks', async () => (await import('./eventtasks')).seriesTasksJob());
  await step('deadlineRisk', async () => (await import('./availability')).riskNotifyJob());
  await step('weeklyReport', async () => (await import('./insights')).weeklyReportJob());
  await step('briefing', async () => (await import('./briefing')).briefingJob());
  await step('personalReport', async () => (await import('./briefing')).personalReportJob());
  await step('usage', async () => (await import('./plans')).usageJob());
  await step('trial', async () => (await import('./plans')).trialJob());
  await step('billing', async () => (await import('./billing')).billingJob()); // 18차 정기 결제·재시도
  await step('settlement', async () => (await import('./billing/settlement')).fillExpected()); // V32 2 정산 예정일 채우기
  await step('docJobs', async () => (await import('./ai/docEngine')).docJobsJob()); // V22 끊긴 문서 작업 다시
  await step('monthClose', async () => (await import('./monthClose')).monthCloseJob()); // V20 월 마감 기록(매월 1일)
  await step('aiCreditAlerts', async () => (await import('./ai/forecast')).aiCreditAlertsJob()); // V23 5장 확보 크레딧 70·90% 알림
  await step('salesCollect', async () => (await import('./sales/collect')).collectDue()); // V41 단계 3 공공데이터(하루 한 번, 원천 하나씩)
  await step('adsSync', async () => (await import('./marketingAds')).adsSyncDue()); // V41 4-2 광고 성과(회사별 연결, 하루 한 번 최근 7일)
  await step('adCapGuard', async () => (await import('./adOps')).adCapGuard()); // V44 ① 월 광고비 상한 넘으면 워크인이 켠 광고 자동 중지
  await step('salesSync', async () => (await import('./sales/migrate')).salesSyncDaily()); // V41 단계 2 전환일까지 매일 영업관리 차이분
  await step('salesCollectors', async () => (await import('./sales/collectors')).collectorsTick()); // 대표 10/21 08:45: 영업 수집기 12개(KST 시각 이후 하루 1회, tick 당 하나)
  await step('salesDigest', async () => (await import('./sales/digest')).salesDigestTick()); // 당일 입찰 다이제스트(회사 설정 시각, 메일·알림·푸시)
  await step('notices', async () => (await import('./announcements')).noticesJob()); // V30 ② 예약 게시
  await step('textExtract', async () => (await import('./library')).textExtractJob()); // V14 32: HWP·PDF 본문 재추출(기존 파일, 한 번에 15개)
  await step('contacts', async () => (await import('./contacts')).contactsJob()); // V31 연락처 휴지통 30일 정리
  await step('docVersions', async () => (await import('./libDocs')).docVersionsJob()); // 10/19 공동 편집 문서: 10분·모두 나가면 변경 기록·조각 합치기·검색 글자
  await step('mktAuto', async () => (await import('./mktAuto')).mktAutoTick()); // V41 4-3 마케팅 주간 규칙 → 제작 → 승인함 → 알림
  await step('mktGoals', async () => (await import('./mktGoals')).goalTickAll());
  await step('hfPoll', async () => (await import('./mktStudio')).hfPollTick()); // 로컬 10/22 Higgsfield 비동기 생성 결과 이어받기(완료분 자료실 저장 → 승인 대기)
  await step('mktPublish', async () => (await import('./mktPublish')).publishTick()); // 대표 10/20 22:30 ② M1 서버 게시 실행기(승인된 글 → 인스타·페북·스레드·유튜브, 자동 게시 켠 회사는 예정 시각에)
  await step('mktPublishDeleted', async () => (await import('./mktPublish')).publishDeletedTick()); // 로컬 10/21 11:45: 게시 뒤 삭제 감지(30일·6시간마다) → 작업 deleted·콘텐츠 '게시 삭제됨'·알림
  await step('mktOps', async () => (await import('./mktOps')).opsTickAll()); // 대표 10/20 20:00 ①②: 월요일 AI 마케터 분석·방향 카드 · 매일 광고 소진율 '충전 필요' · 25일 다음 달 예산 초안 // 대표 10/20 18:00 ②: 25일 다음 달 목표 초안 · 월요일 주간 리뷰 · 월초 결산
  await step('nightAssistant', async () => (await import('./mktHome')).nightAssistantTick()); // ⑥ 밤사이 비서(22~06시, 회사 AI 설정에서 켠 범위만 — 지금은 원고 초안)
  await step('mktReport', async () => (await import('./mktReport')).monthlyReportJob()); // 상용화 ⑧ 매월 1일 지난달 마케팅 보고 알림·메일
  await step('awayReturn', async () => (await import('./away')).awayReturnTick()); // #76 부재 끝난 사람에게 '부재 중 알림 n건' 1건
  await step('purgeAccounts', async () => (await import('./account')).purgeDeletedAccounts()); // #279 탈퇴 30일 뒤 개인정보 잔여 정리
  await step('opsPii', async () => (await import('./opsImport')).purgeOpsPii()); // V41 4-2 가져온 전화 기록 보관 기간
  await step('aiRetention', async () => ({ purged: await (await import('./ai/threads')).purgeOldThreads() })); // V14 2번 AI 대화 보관 기간
  await step('outbox', async () => (await import('./mailbox')).outboxTick()); // V21 메일 보관함 재시도(서울 지역)
  await step('notifDigest', async () => (await import('./spaceNotify')).digestTick(new Date(), { force: !!opt.forceDigest })); // #104 ②: 담당 아닌 사람 1시간 묶음 · 담당 미지정 관리자 1명 하루 묶음
  await step('push', () => dispatchPending(200));
  if (googleConfigured()) await step('google', () => syncAllDue());
  await step('cleanup', cleanup);
  await sql`update job_runs set finished_at = now(), status = ${failed ? 'error' : 'ok'}, detail = ${sql.json(detail as never)} where id = ${run.id}`;
  await sql`delete from job_locks where name = 'tick' and holder = ${holder}`;
  return { ok: !failed, detail };
}

/**
 * 일정 시작 전 알림: 참석자·개인 캘린더 주인·작성자에게 사용자별 설정 시간(기본 30분) 전에 1회.
 * 정기 실행이 10분 주기라 최대 10분 이르게 도착할 수 있다. 반복 일정은 회차마다 따로 보낸다.
 */
export async function eventReminders(now = new Date()) {
  const sql = db();
  const MAX_LEAD_MIN = 40320; // 최대 4주 전 알림
  const until = new Date(now.getTime() + (MAX_LEAD_MIN + 15) * 60000);
  const masters = await sql<any[]>`
    select e.*, c.type as cal_type, c.owner_user_id from events e join calendars c on c.id = e.calendar_id
    where e.deleted_at is null and e.recurring_event_id is null and not e.all_day and not e.cancelled
      and (e.rrule is not null or (e.start_at > ${now} and e.start_at < ${until}))`;
  let sent = 0;
  for (const m of masters) {
    const dur = m.end_at.getTime() - m.start_at.getTime();
    const exs = await sql<any[]>`select * from events where recurring_event_id = ${m.id} and deleted_at is null`;
    const skip = new Set([...(m.exdates ?? []).map((d: Date) => new Date(d).getTime()), ...exs.map((x) => x.original_start.getTime())]);
    const occ: { id: string; start: Date; title: string }[] = [];
    const starts = m.rrule ? occurrences(m.rrule, m.start_at, now, until) : [m.start_at];
    for (const s of starts) if (!skip.has(s.getTime()) && s > now) occ.push({ id: m.id, start: s, title: m.title });
    for (const x of exs) if (!x.cancelled && x.start_at > now && x.start_at < until) occ.push({ id: x.id, start: x.start_at, title: x.title });
    if (!occ.length) continue;
    const att = (await sql<{ user_id: string; response: string }[]>`select user_id, response from event_attendees where event_id = ${m.id}`)
      .filter((a) => a.response !== 'declined').map((a) => a.user_id);
    const people = [...new Set([...att, m.created_by, ...(m.cal_type === 'personal' && m.owner_user_id ? [m.owner_user_id] : [])])];
    const leads = await sql<{ id: string; lead: number; alarm_events: boolean; alarm_m: number }[]>`
      select u.id, coalesce(s.event_reminder_minutes, 60) as lead, coalesce(s.alarm_events, false) as alarm_events, coalesce(s.alarm_minutes, 10) as alarm_m from users u left join user_settings s on s.user_id = u.id
      where u.id = any(${people}::uuid[]) and u.status = 'active'`;
    const custom: number[] | null = m.reminder_minutes ?? null; // 일정별 알림이 있으면 사용자 기본값 대신 적용
    // S-10 연결 업무 맥락 (제목 없이 건수만)
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
    const linked = await sql<{ status: string; due_date: string | null; occurrence_start: Date | null }[]>`
      select t.status, to_char(t.due_date, 'YYYY-MM-DD') as due_date, et.occurrence_start from event_tasks et join tasks t on t.id = et.task_id
      where et.event_id = ${m.id} and t.deleted_at is null`;
    for (const o of occ) {
      const mine = linked.filter((l) => !l.occurrence_start || l.occurrence_start.getTime() === o.start.getTime());
      const late = mine.filter((l) => l.status !== 'done' && l.due_date && l.due_date < today).length;
      const open = mine.filter((l) => l.status !== 'done').length;
      const ctx = mine.length ? ` · 연결 업무 ${mine.length}건${open ? ` 중 미완료 ${open}건` : ' 모두 완료'}${late ? `(지연 ${late}건)` : ''}` : '';
      for (const p of leads) {
        // 아직 시각이 안 된 알림은 건너뛰고, 지난 알림 중 가장 가까운 것 하나만 보낸다(정기 실행 지연 시 몰아서 여러 번 보내지 않음)
        // V36 4: 장소가 있는 일정(이동) = 사용자 기본 알림 + 30분 전 기본(일정별 알림을 정했으면 그대로)
        // #420: 알람이 켜진 일정은 사람별 'N분 전' 시점을 더하고, 그 시점만 전체 화면 알람
        const alarmFor = m.alarm === true || (m.alarm == null && p.alarm_events);
        const all = [...new Set([...(custom ?? [...(p.lead ? [p.lead] : []), ...(String(m.location ?? '').trim() ? [30] : [])]), ...(alarmFor ? [p.alarm_m] : [])])];
        const due = all.filter((l) => o.start.getTime() - l * 60000 <= now.getTime());
        if (!due.length) continue;
        const lead = Math.min(...due);
        const hm = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(o.start);
        const mins = Math.max(1, Math.round((o.start.getTime() - now.getTime()) / 60000));
        sent += (await notify(sql, { userIds: [p.id], type: 'event_reminder', title: `일정 ${fmtLeft(mins)} 전: ${o.title}`, body: `${hm} 시작${m.location ? ` · 📍 ${m.location} — 이동 시간 확인` : ''}${ctx}`,
          // 로컬 10/20(대표): 일정별 alarm 또는 사람별 기본값(일정 끔) → 알람처럼
          link: `/calendar?event=${o.id}`, entityType: 'event', entityId: o.id, dedupeKey: `evrem:${m.id}:${o.start.toISOString()}:${lead}`, meta: { kind: 'event', eventId: o.id, ...((alarmFor && lead === p.alarm_m) ? { alarm: true } : {}) } })).length;
      }
    }
  }
  return { candidates: masters.length, created: sent };
}

function fmtLeft(mins: number) {
  if (mins >= 1440) return `${Math.round(mins / 1440)}일`;
  if (mins >= 60) return `${Math.round(mins / 60)}시간`;
  return `${mins}분`;
}
