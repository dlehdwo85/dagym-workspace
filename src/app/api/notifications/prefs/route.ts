import { z } from 'zod';
import { handler, body, zTime } from '@/lib/api';
import { db } from '@/lib/db';
import { NOTIFICATION_TYPES } from '@/lib/types';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const prefs = await sql<{ type: string; in_app: boolean; push: boolean }[]>`select type, in_app, push from notification_prefs where user_id = ${user.id}`;
  const [s] = await sql`select due_soon_hours, event_reminder_minutes, to_char(quiet_start,'HH24:MI') quiet_start, to_char(quiet_end,'HH24:MI') quiet_end,
    to_char(briefing_time,'HH24:MI') briefing_time, briefing_enabled, briefing_weekend, task_reminder_minutes, requester_due_alerts from user_settings where user_id = ${user.id}`;
  const subs = await sql`select id, kind, platform, created_at, last_success_at, disabled_at from push_subscriptions where user_id = ${user.id} order by created_at desc`;
  return {
    types: Object.entries(NOTIFICATION_TYPES).map(([type, label]) => {
      const p = prefs.find((x) => x.type === type);
      return { type, label, inApp: p?.in_app ?? true, push: p?.push ?? true };
    }),
    settings: { dueSoonHours: s?.due_soon_hours ?? 0, eventReminderMinutes: s?.event_reminder_minutes ?? 60, taskReminderMinutes: s?.task_reminder_minutes ?? 60, quietStart: s?.quiet_start ?? null, quietEnd: s?.quiet_end ?? null,
      briefingTime: s?.briefing_time ?? '08:30', briefingEnabled: s?.briefing_enabled ?? true, briefingWeekend: s?.briefing_weekend ?? false, requesterDueAlerts: s?.requester_due_alerts ?? false },
    subscriptions: subs,
  };
});

export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, z.object({
    types: z.array(z.object({ type: z.string(), inApp: z.boolean(), push: z.boolean() })).optional(),
    settings: z.object({ dueSoonHours: z.number().int().min(0).max(168), eventReminderMinutes: z.number().int().min(0).max(1440).optional(), quietStart: zTime.nullable(), quietEnd: zTime.nullable(),
      briefingTime: zTime.optional(), briefingEnabled: z.boolean().optional(), briefingWeekend: z.boolean().optional(),
      taskReminderMinutes: z.number().int().min(0).max(10080).optional(), requesterDueAlerts: z.boolean().optional() }).optional(),
  }));
  const sql = db();
  for (const t of i.types ?? []) {
    if (!(t.type in NOTIFICATION_TYPES)) continue;
    await sql`insert into notification_prefs (user_id, type, in_app, push) values (${user.id}, ${t.type}, ${t.inApp}, ${t.push})
      on conflict (user_id, type) do update set in_app = excluded.in_app, push = excluded.push`;
  }
  if (i.settings) {
    const rem = i.settings.eventReminderMinutes ?? 60;
    await sql`insert into user_settings (user_id, due_soon_hours, event_reminder_minutes, quiet_start, quiet_end) values (${user.id}, ${i.settings.dueSoonHours}, ${rem}, ${i.settings.quietStart}, ${i.settings.quietEnd})
      on conflict (user_id) do update set due_soon_hours = excluded.due_soon_hours, event_reminder_minutes = excluded.event_reminder_minutes, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now()`;
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
