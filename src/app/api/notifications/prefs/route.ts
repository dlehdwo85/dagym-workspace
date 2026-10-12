import { z } from 'zod';
import { handler, body, zTime } from '@/lib/api';
import { db } from '@/lib/db';
import { NOTIFICATION_TYPES } from '@/lib/types';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const prefs = await sql<{ type: string; in_app: boolean; push: boolean }[]>`select type, in_app, push from notification_prefs where user_id = ${user.id}`;
  const [s] = await sql`select due_soon_hours, to_char(quiet_start,'HH24:MI') quiet_start, to_char(quiet_end,'HH24:MI') quiet_end from user_settings where user_id = ${user.id}`;
  const subs = await sql`select id, kind, platform, created_at, last_success_at, disabled_at from push_subscriptions where user_id = ${user.id} order by created_at desc`;
  return {
    types: Object.entries(NOTIFICATION_TYPES).map(([type, label]) => {
      const p = prefs.find((x) => x.type === type);
      return { type, label, inApp: p?.in_app ?? true, push: p?.push ?? true };
    }),
    settings: { dueSoonHours: s?.due_soon_hours ?? 24, quietStart: s?.quiet_start ?? null, quietEnd: s?.quiet_end ?? null },
    subscriptions: subs,
  };
});

export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, z.object({
    types: z.array(z.object({ type: z.string(), inApp: z.boolean(), push: z.boolean() })).optional(),
    settings: z.object({ dueSoonHours: z.number().int().min(1).max(168), quietStart: zTime.nullable(), quietEnd: zTime.nullable() }).optional(),
  }));
  const sql = db();
  for (const t of i.types ?? []) {
    if (!(t.type in NOTIFICATION_TYPES)) continue;
    await sql`insert into notification_prefs (user_id, type, in_app, push) values (${user.id}, ${t.type}, ${t.inApp}, ${t.push})
      on conflict (user_id, type) do update set in_app = excluded.in_app, push = excluded.push`;
  }
  if (i.settings) {
    await sql`insert into user_settings (user_id, due_soon_hours, quiet_start, quiet_end) values (${user.id}, ${i.settings.dueSoonHours}, ${i.settings.quietStart}, ${i.settings.quietEnd})
      on conflict (user_id) do update set due_soon_hours = excluded.due_soon_hours, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = now()`;
  }
  return { ok: true };
});
