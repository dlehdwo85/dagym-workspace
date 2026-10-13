import { z } from 'zod';
import { db } from './db';
import { forbidden } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/** Google Calendar 와 같은 12색 */
export const CAL_PALETTE = ['#d50000', '#e67c73', '#f4511e', '#f6bf26', '#33b679', '#0b8043', '#039be5', '#3f51b5', '#7986cb', '#8e24aa', '#616161', '#795548'] as const;
export const DEFAULT_CAL_COLORS = { personal: '#039be5', company: '#0b8043' };
export const colorsInput = z.object({
  personal: z.enum(CAL_PALETTE),
  company: z.enum(CAL_PALETTE),
  /** 대표만: 모두의 기본값으로 */
  asDefault: z.boolean().optional(),
});

export async function getCalColors(u: SessionUser) {
  const sql = db();
  const [[d], [mine]] = await Promise.all([
    sql<{ value: { personal: string; company: string } }[]>`select value from app_settings where key = 'cal_colors'`,
    sql<{ cal_colors: { personal: string; company: string } | null }[]>`select cal_colors from user_settings where user_id = ${u.id}`,
  ]);
  const def = { ...DEFAULT_CAL_COLORS, ...(d?.value ?? {}) };
  return { colors: { ...def, ...(mine?.cal_colors ?? {}) }, default: def, custom: !!mine?.cal_colors, palette: CAL_PALETTE };
}

export async function setCalColors(u: SessionUser, i: z.infer<typeof colorsInput>) {
  const sql = db();
  const value = { personal: i.personal, company: i.company };
  if (i.asDefault) {
    if (u.role !== 'owner') throw forbidden('모두의 기본값은 대표만 정할 수 있습니다');
    await sql`insert into app_settings (key, value, updated_by) values ('cal_colors', ${sql.json(value)}, ${u.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(sql, u.id, 'cal_colors_default', 'setting', null, value);
  }
  await sql`insert into user_settings (user_id, cal_colors) values (${u.id}, ${sql.json(value)})
    on conflict (user_id) do update set cal_colors = excluded.cal_colors, updated_at = now()`;
  return getCalColors(u);
}
