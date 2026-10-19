import { z } from 'zod';
import { db } from './db';
import { forbidden } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/** Google Calendar 와 같은 12색 */
export const CAL_PALETTE = ['#d50000', '#e67c73', '#f4511e', '#f6bf26', '#33b679', '#0b8043', '#039be5', '#3f51b5', '#7986cb', '#8e24aa', '#616161', '#795548'] as const;
export const DEFAULT_CAL_COLORS = { personal: '#039be5', company: '#0b8043' };
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, '색은 #rrggbb');
const zId = z.string().uuid();
/** 캘린더 키: 캘린더 id 또는 공간 주요 일정(space:sales·space:marketing, 대표 확정 10/19) */
const zCalKey = z.union([zId, z.enum(['space:sales', 'space:marketing'])]);
/** 대표 지적(10/19 ②): 팔레트 12색 + 직접 선택, 캘린더별·사람별 색(사람마다 저장), 사람 약칭 대신 색 점 */
export const colorsInput = z.object({
  personal: hex.optional(),
  company: hex.optional(),
  /** 캘린더 id → 색(null = 기본으로) */
  cals: z.record(zCalKey, hex.nullable()).optional(),
  /** 사람 id → 그 사람 개인 일정 색(null = 기본으로) */
  people: z.record(zId, hex.nullable()).optional(),
  /** 다른 사람 일정 앞 '민수 · ' 대신 색 점 */
  whoDot: z.boolean().optional(),
  /** 대표만: 모두의 기본값으로(개인·회사 두 색) */
  asDefault: z.boolean().optional(),
});
type Stored = { personal?: string; company?: string; cals?: Record<string, string>; people?: Record<string, string>; whoDot?: boolean };

export async function getCalColors(u: SessionUser) {
  const sql = db();
  const [[d], [mine]] = await Promise.all([
    sql<{ value: { personal: string; company: string } }[]>`select value from app_settings where key = 'cal_colors'`,
    sql<{ cal_colors: Stored | null }[]>`select cal_colors from user_settings where user_id = ${u.id}`,
  ]);
  const def = { ...DEFAULT_CAL_COLORS, ...(d?.value ?? {}) };
  const m = mine?.cal_colors ?? {};
  return {
    colors: { personal: m.personal ?? def.personal, company: m.company ?? def.company, cals: m.cals ?? {}, people: m.people ?? {}, whoDot: !!m.whoDot },
    default: def, custom: !!mine?.cal_colors, palette: CAL_PALETTE,
  };
}

function mergeMap(cur: Record<string, string> | undefined, patch: Record<string, string | null> | undefined) {
  const out = { ...(cur ?? {}) };
  for (const [k, v] of Object.entries(patch ?? {})) { if (v) out[k] = v; else delete out[k]; }
  return out;
}

export async function setCalColors(u: SessionUser, i: z.infer<typeof colorsInput>) {
  const sql = db();
  const [mine] = await sql<{ cal_colors: Stored | null }[]>`select cal_colors from user_settings where user_id = ${u.id}`;
  const cur = mine?.cal_colors ?? {};
  const value: Stored = {
    ...cur,
    ...(i.personal ? { personal: i.personal } : {}),
    ...(i.company ? { company: i.company } : {}),
    cals: mergeMap(cur.cals, i.cals),
    people: mergeMap(cur.people, i.people),
    ...(i.whoDot !== undefined ? { whoDot: i.whoDot } : {}),
  };
  if (i.asDefault) {
    if (u.role !== 'owner') throw forbidden('모두의 기본값은 대표만 정할 수 있습니다');
    const def = { personal: value.personal ?? DEFAULT_CAL_COLORS.personal, company: value.company ?? DEFAULT_CAL_COLORS.company };
    await sql`insert into app_settings (key, value, updated_by) values ('cal_colors', ${sql.json(def)}, ${u.id})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
    await audit(sql, u.id, 'cal_colors_default', 'setting', null, def);
  }
  await sql`insert into user_settings (user_id, cal_colors) values (${u.id}, ${sql.json(value as never)})
    on conflict (user_id) do update set cal_colors = excluded.cal_colors, updated_at = now()`;
  return getCalColors(u);
}
