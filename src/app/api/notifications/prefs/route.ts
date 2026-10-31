import { z } from 'zod';
import { handler, body, zTime } from '@/lib/api';
import { db } from '@/lib/db';
import { NOTIFICATION_TYPES } from '@/lib/types';
import { QUIET_DEFAULT, defaultPush } from '@/lib/notifications';
import { DEFAULT_MODE, SPACE_LABEL, SPACE_MODES, SPACE_MODE_LABEL, type NotifySpace, type SpaceMode } from '@/lib/spaceNotify';
import { isAdmin } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { tenantOf } from '@/lib/types';
import { audit } from '@/lib/log';
import { MKT_KINDS, MKT_MODES, MKT_MODE_LABEL, mktPrefKey } from '@/lib/mktNotifyKinds';

const SPACES: NotifySpace[] = ['sales', 'marketing'];
const zMode = z.enum(['mine', 'all', 'off']);

export const GET = handler(async ({ user }) => {
  const sql = db();
  const prefs = await sql<{ type: string; in_app: boolean; push: boolean }[]>`select type, in_app, push from notification_prefs where user_id = ${user.id}`;
  const [s] = await sql`select due_soon_hours, event_reminder_minutes, to_char(quiet_start,'HH24:MI') quiet_start, to_char(quiet_end,'HH24:MI') quiet_end, quiet_off,
    to_char(briefing_time,'HH24:MI') briefing_time, briefing_enabled, briefing_weekend, task_reminder_minutes, requester_due_alerts, alarm_minutes, alarm_events, alarm_tasks, alarm_important from user_settings where user_id = ${user.id}`;
  const subs = await sql`select id, kind, platform, created_at, last_success_at, disabled_at from push_subscriptions where user_id = ${user.id} order by created_at desc`;
  // #104 ⑤ 공간별 알림 방식: 본인 설정 → 회사 기본값 → '담당인 것만'. 회사가 켠 공간만 보여 준다
  const [sp] = await sql<{ spaces: string[]; notify_defaults: Record<string, string> | null; space_notify: Record<string, string> | null }[]>`select t.spaces, t.notify_defaults, s.space_notify from tenants t left join user_settings s on s.user_id = ${user.id} where t.id = ${tenantOf(user)}`;
  const modeOf = (v: unknown): SpaceMode | null => (SPACE_MODES.includes(v as SpaceMode) ? (v as SpaceMode) : null);
  const spaces = SPACES.filter((s) => (sp?.spaces ?? []).includes(s)).map((space) => {
    const own = modeOf(sp?.space_notify?.[space]); const company = modeOf(sp?.notify_defaults?.[space]) ?? DEFAULT_MODE;
    return { space, label: SPACE_LABEL[space], mode: own ?? company, own: own !== null, companyDefault: company };
  });
  // 282차 #823 마케팅 알림 항목별(휴대폰 알림·알림함만·안 받음) — 마케팅 공간을 켠 회사만
  const mkt = (sp?.spaces ?? []).includes('marketing') ? MKT_KINDS.map((k) => {
    const p = prefs.find((x) => x.type === mktPrefKey(k.kind));
    return { kind: k.kind, label: k.label, desc: k.desc, def: k.def, mode: p ? (p.push ? 'push' : p.in_app ? 'inbox' : 'off') : k.def, own: !!p };
  }) : [];
  return {
    spaces, modeLabels: SPACE_MODE_LABEL, canSetCompany: isAdmin(user), mkt, mktModeLabels: MKT_MODE_LABEL,
    types: Object.entries(NOTIFICATION_TYPES).filter(([type]) => (type !== 'server_error' || user.platformAdmin) && (type !== 'meeting_lobby' || process.env.FEATURE_MEETINGS === '1')).map(([type, label]) => { // 218차: 화상회의 스위치가 꺼져 있으면 대기실 알림 설정도 숨김
      const p = prefs.find((x) => x.type === type);
      return { type, label, inApp: p?.in_app ?? true, push: p?.push ?? defaultPush(type), pushDefault: defaultPush(type) };
    }),
    settings: { dueSoonHours: s?.due_soon_hours ?? 0, eventReminderMinutes: s?.event_reminder_minutes ?? 60, taskReminderMinutes: s?.task_reminder_minutes ?? 60, quietStart: s?.quiet_start ?? QUIET_DEFAULT?.start ?? null, quietEnd: s?.quiet_end ?? QUIET_DEFAULT?.end ?? null, quietOff: s?.quiet_off ?? false, quietDefault: QUIET_DEFAULT,
      briefingTime: s?.briefing_time ?? '08:30', briefingEnabled: s?.briefing_enabled ?? true, briefingWeekend: s?.briefing_weekend ?? false, requesterDueAlerts: s?.requester_due_alerts ?? false,
      // 로컬 10/20(대표): 알람처럼 울리기 기본값 — 일정 끔·업무 마감 끔·중요(높음·긴급) 켬
      alarmEvents: s?.alarm_events ?? false, alarmTasks: s?.alarm_tasks ?? false, alarmImportant: s?.alarm_important ?? true, alarmMinutes: s?.alarm_minutes ?? 10 },
    subscriptions: subs,
  };
});

export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, z.object({
    types: z.array(z.object({ type: z.string(), inApp: z.boolean(), push: z.boolean() })).optional(),
    settings: z.object({ dueSoonHours: z.number().int().min(0).max(168), eventReminderMinutes: z.number().int().min(0).max(1440).optional(), quietStart: zTime.nullable(), quietEnd: zTime.nullable(),
      briefingTime: zTime.optional(), briefingEnabled: z.boolean().optional(), briefingWeekend: z.boolean().optional(),
      taskReminderMinutes: z.number().int().min(0).max(10080).optional(), requesterDueAlerts: z.boolean().optional(), quietOff: z.boolean().optional(),
      alarmEvents: z.boolean().optional(), alarmTasks: z.boolean().optional(), alarmImportant: z.boolean().optional(), alarmMinutes: z.number().int().min(1).max(1440).optional() }).optional(),
    /** #104 ⑤ 공간별 방식(본인). null = 회사 기본값을 따름 */
    spaces: z.object({ sales: zMode.nullable().optional(), marketing: zMode.nullable().optional() }).optional(),
    /** #104 ⑤ 회사 기본값(관리자만) */
    companySpaces: z.object({ sales: zMode.optional(), marketing: zMode.optional() }).optional(),
    /** 282차 #823 마케팅 알림 항목별. mode null = 기본값으로 */
    mkt: z.array(z.object({ kind: z.enum(MKT_KINDS.map((k) => k.kind) as [string, ...string[]]), mode: z.enum(MKT_MODES as [string, ...string[]]).nullable() })).max(20).optional(),
  }));
  const sql = db();
  if (i.spaces) {
    const cur = (await sql<{ space_notify: Record<string, string> | null }[]>`select space_notify from user_settings where user_id = ${user.id}`)[0]?.space_notify ?? {};
    const next: Record<string, string> = { ...cur };
    for (const s of SPACES) if (i.spaces[s] !== undefined) { if (i.spaces[s] === null) delete next[s]; else next[s] = i.spaces[s] as string; }
    await sql`insert into user_settings (user_id, space_notify) values (${user.id}, ${sql.json(next as never)}) on conflict (user_id) do update set space_notify = excluded.space_notify, updated_at = now()`;
  }
  if (i.companySpaces) {
    if (!isAdmin(user)) throw forbidden('회사 기본값은 관리자만 바꿉니다');
    const patch: Record<string, string> = {};
    for (const s of SPACES) if (i.companySpaces[s]) patch[s] = i.companySpaces[s] as string;
    await sql`update tenants set notify_defaults = notify_defaults || ${sql.json(patch as never)} where id = ${tenantOf(user)}`;
    await audit(sql, user.id, 'notify_defaults.set', 'tenant', null, patch).catch(() => {});
  }
  for (const m of i.mkt ?? []) {
    const key = mktPrefKey(m.kind as never);
    if (m.mode === null) await sql`delete from notification_prefs where user_id = ${user.id} and type = ${key}`;
    else await sql`insert into notification_prefs (user_id, type, in_app, push) values (${user.id}, ${key}, ${m.mode !== 'off'}, ${m.mode === 'push'})
      on conflict (user_id, type) do update set in_app = excluded.in_app, push = excluded.push`;
  }
  for (const t of i.types ?? []) {
    if (!(t.type in NOTIFICATION_TYPES)) continue;
    await sql`insert into notification_prefs (user_id, type, in_app, push) values (${user.id}, ${t.type}, ${t.inApp}, ${t.push})
      on conflict (user_id, type) do update set in_app = excluded.in_app, push = excluded.push`;
  }
  if (i.settings) {
    const rem = i.settings.eventReminderMinutes ?? 60;
    await sql`insert into user_settings (user_id, due_soon_hours, event_reminder_minutes, quiet_start, quiet_end) values (${user.id}, ${i.settings.dueSoonHours}, ${rem}, ${i.settings.quietStart}, ${i.settings.quietEnd})
      on conflict (user_id) do update set due_soon_hours = excluded.due_soon_hours, event_reminder_minutes = excluded.event_reminder_minutes, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now()`;
    if (i.settings.quietOff !== undefined) await sql`update user_settings set quiet_off = ${i.settings.quietOff} where user_id = ${user.id}`; // 로컬 10/20 조용한 시간 끄기
    // 로컬 10/20(대표): 알람처럼 울리기 기본값(일정·업무 마감·중요 표시)
    if (i.settings.alarmEvents !== undefined) await sql`update user_settings set alarm_events = ${i.settings.alarmEvents} where user_id = ${user.id}`;
    if (i.settings.alarmTasks !== undefined) await sql`update user_settings set alarm_tasks = ${i.settings.alarmTasks} where user_id = ${user.id}`;
    if (i.settings.alarmMinutes !== undefined) await sql`update user_settings set alarm_minutes = ${i.settings.alarmMinutes} where user_id = ${user.id}`; // #420 N분 전
    if (i.settings.alarmImportant !== undefined) await sql`update user_settings set alarm_important = ${i.settings.alarmImportant} where user_id = ${user.id}`;
    if (i.settings.requesterDueAlerts !== undefined) await sql`update user_settings set requester_due_alerts = ${i.settings.requesterDueAlerts} where user_id = ${user.id}`; // V13 6번
    if (i.settings.taskReminderMinutes !== undefined) await sql`update user_settings set task_reminder_minutes = ${i.settings.taskReminderMinutes} where user_id = ${user.id}`;
    // V8 1번 아침 브리핑 (시각·끄기·주말/공휴일에도)
    if (i.settings.briefingTime !== undefined || i.settings.briefingEnabled !== undefined || i.settings.briefingWeekend !== undefined) {
      await sql`update user_settings set briefing_time = coalesce(${i.settings.briefingTime ?? null}::time, briefing_time), briefing_enabled = coalesce(${i.settings.briefingEnabled ?? null}::boolean, briefing_enabled),
        briefing_weekend = coalesce(${i.settings.briefingWeekend ?? null}::boolean, briefing_weekend) where user_id = ${user.id}`;
    }
  }
  return { ok: true };
});
