/**
 * 대표 10/20 16:00 (#104) 마케팅·영업 알림은 담당자에게만.
 * - 역할 담당(#100 규칙: 마케팅 브랜드별 · 영업 원천별)에게 바로. 승인자는 '승인 필요'(approval) 알림만 바로.
 * - 직접 관련된 사람(요청자·만든 사람 = userIds)은 늘 바로.
 * - 담당이 아닌데 '모두 받기'로 한 사람은 1시간 묶음(배치당 알림 1건).
 * - 담당 규칙이 없고 승인 건도 아니면 관리자 1명(대표 우선)에게 하루 1회 묶음(09시 이후).
 * - [시험]·is_test 는 실행자에게만.
 * 사람별 방식: 설정 › 알림 › 공간별 — 담당인 것만(기본) · 모두 · 받지 않음(승인 요청·내가 한 일은 받음). 회사 기본값은 관리자가.
 */
import { db, type Sql } from './db';
import { notify, type NotifyInput } from './notifications';

export type NotifySpace = 'marketing' | 'sales';
export type SpaceMode = 'mine' | 'all' | 'off';
export const SPACE_MODES: SpaceMode[] = ['mine', 'all', 'off'];
export const DEFAULT_MODE: SpaceMode = 'mine';
export const SPACE_LABEL: Record<NotifySpace, string> = { marketing: '마케팅', sales: '영업' };
export const SPACE_MODE_LABEL: Record<SpaceMode, string> = { mine: '담당인 것만', all: '모두(담당 아닌 것은 1시간마다 묶어서 1건)', off: '받지 않음(승인 요청·내가 한 일의 결과는 받음)' };
/** 하루 묶음을 보내는 시각(서울) */
export const DAILY_DIGEST_HOUR = 9;

export interface SpaceNotifyInput extends Omit<NotifyInput, 'userIds'> {
  tenant: string;
  space: NotifySpace;
  /** 역할 담당 규칙 — 브랜드 id · 영업 원천(bid/building/…) · ''=기본 */
  role?: { kind: 'marketing_brand' | 'sales_source'; ref?: string | null } | null;
  /** 승인·결정이 필요한 알림 → 승인자(#100 승인자 규칙 → 받는 사람 설정 → 관리자)에게도 바로 */
  approval?: boolean;
  /** 직접 관련된 사람(요청자·만든 사람) — 방식과 무관하게 바로 */
  userIds?: (string | null | undefined)[];
  /** 시험([시험]·is_test): 실행자에게만, 다른 사람에게는 아무것도 안 감 */
  test?: { actorId: string | null | undefined } | null;
}

const modeOf = (v: unknown): SpaceMode => (SPACE_MODES.includes(v as SpaceMode) ? (v as SpaceMode) : DEFAULT_MODE);

/** 그 공간을 볼 수 있는 사람(관리자 + 공간 멤버)마다 유효한 방식(본인 설정 → 회사 기본값 → '담당인 것만') */
export async function modesOf(sql: Sql, tenant: string, space: NotifySpace): Promise<Map<string, SpaceMode>> {
  const rows = await sql<{ id: string; mode: string | null }[]>`select u.id, coalesce(s.space_notify->>${space}, t.notify_defaults->>${space}) as mode
    from users u join tenants t on t.id = u.tenant left join user_settings s on s.user_id = u.id left join space_members sm on sm.user_id = u.id and sm.tenant = u.tenant
    where u.tenant = ${tenant} and u.status = 'active' and not u.is_demo and (u.role in ('owner', 'admin') or sm.spaces @> array[${space}]::text[])`;
  return new Map(rows.map((r) => [r.id, modeOf(r.mode)]));
}
/** 담당 미지정 묶음을 받는 관리자 1명 — 대표, 없으면 가장 먼저 만든 관리자 */
export async function fallbackAdmin(sql: Sql, tenant: string): Promise<string | null> {
  const [r] = await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and not is_demo and role in ('owner', 'admin') order by (role = 'owner') desc, created_at asc limit 1`;
  return r?.id ?? null;
}

async function enqueue(sql: Sql, n: SpaceNotifyInput, userId: string, cadence: 'hour' | 'day') {
  await sql`insert into notification_digest_items (tenant, user_id, space, cadence, type, title, body, link, entity_type, entity_id, dedupe_key)
    values (${n.tenant}, ${userId}, ${n.space}, ${cadence}, ${n.type}, ${n.title.slice(0, 300)}, ${(n.body ?? '').slice(0, 500)}, ${n.link}, ${n.entityType ?? null}, ${n.entityId ?? null}, ${n.dedupeKey})
    on conflict (user_id, dedupe_key) do nothing`;
}

/** #542 '머리: 항목' 꼴 제목 → 같은 종류 묶음(머리 끝의 (v2) 같은 판 번호는 뗌). 휴대폰 푸시는 같은 묶음을 1건으로(push.ts), 알림 목록은 한 줄씩 그대로 */
export function groupOf(space: string, title: string): { group: string; head: string; item: string } | null {
  const m = /^([^:\n]{2,40}):\s+(.+)$/s.exec(title.trim());
  if (!m) return null;
  const head = m[1].replace(/\s*\(v\d+\)$/, '').trim();
  return head ? { group: `${space}:${head}`, head, item: m[2].trim().slice(0, 80) } : null;
}

export async function notifySpace(sql: Sql, n: SpaceNotifyInput): Promise<{ direct: string[]; hourly: string[]; daily: string[] }> {
  const g = groupOf(n.space, n.title);
  // #618: 승인 대기 알림(approval)은 meta.approval 로 표시 → 푸시·목록 버튼 [확인][승인함 열기](notifActions)
  const extra = { ...(g ?? {}), ...(n.approval ? { approval: true } : {}) };
  const base = { type: n.type, title: n.title, body: n.body, link: n.link, entityType: n.entityType, entityId: n.entityId, dedupeKey: n.dedupeKey, push: n.push, meta: Object.keys(extra).length ? { ...(n.meta ?? {}), ...extra } : n.meta, space: n.space };
  if (n.test) {
    const to = n.test.actorId ? [n.test.actorId] : [];
    if (to.length) await notify(sql, { ...base, userIds: to, actorId: null });
    return { direct: to, hourly: [], daily: [] };
  }
  const explicit = new Set((n.userIds ?? []).filter((x): x is string => !!x));
  const direct = new Set(explicit);
  if (n.role) {
    const r = await (await import('./assignees')).resolveAssignee(sql, n.tenant, n.role.kind, n.role.ref ?? '').catch(() => null);
    if (r) direct.add(r.userId);
  }
  const approvers = n.approval ? await (await import('./mktAuto')).approvers(n.tenant).catch(() => [] as string[]) : [];
  for (const a of approvers) direct.add(a);
  const modes = await modesOf(sql, n.tenant, n.space);
  // '받지 않음'이어도 승인 요청·내가 직접 관련된 것은 받음
  const directIds = [...direct].filter((id) => modes.get(id) !== 'off' || explicit.has(id) || approvers.includes(id));
  if (directIds.length) await notify(sql, { ...base, userIds: directIds, actorId: n.actorId });
  const hourly: string[] = [];
  for (const [id, m] of modes) if (m === 'all' && !direct.has(id) && id !== n.actorId) { await enqueue(sql, n, id, 'hour'); hourly.push(id); }
  const daily: string[] = [];
  if (!direct.size) {
    const admin = await fallbackAdmin(sql, n.tenant);
    if (admin && admin !== n.actorId && !hourly.includes(admin) && modes.get(admin) !== 'off') { await enqueue(sql, n, admin, 'day'); daily.push(admin); }
  }
  return { direct: directIds, hourly, daily };
}

const kstDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);

/** tick: 1시간 묶음(가장 오래된 것이 1시간 지나면) · 하루 묶음(09시 이후, 그 시각 전에 쌓인 것) — 사람·공간마다 알림 1건 */
export async function digestTick(now = new Date(), opt: { force?: boolean } = {}) {
  const sql = db(); let hour = 0, day = 0;
  const flush = async (userId: string, space: NotifySpace, cadence: 'hour' | 'day', before: Date | null, dedupeKey: string) => {
    const items = await sql<{ id: number; type: string; title: string; link: string; created_at: Date }[]>`select id, type, title, link, created_at from notification_digest_items
      where user_id = ${userId} and space = ${space} and cadence = ${cadence} and flushed_at is null ${before ? sql`and created_at < ${before}` : sql``} order by created_at`;
    if (!items.length) return 0;
    const label = SPACE_LABEL[space] ?? space;
    await notify(sql, { userIds: [userId], type: 'digest', title: `${label} 알림 ${items.length}건 ${cadence === 'hour' ? '(지난 1시간 묶음)' : '(하루 묶음)'}`, body: items.slice(0, 3).map((i) => i.title).join('\n') + (items.length > 3 ? `\n외 ${items.length - 3}건` : ''),
      link: `/notifications?space=${space}`, space, dedupeKey, push: true, meta: { digest: cadence, items: items.slice(0, 12).map((i) => ({ type: i.type, title: i.title, link: i.link, at: i.created_at })) } });
    await sql`update notification_digest_items set flushed_at = now() where id = any(${items.map((i) => i.id)}::bigint[])`;
    return 1;
  };
  const hourGroups = await sql<{ user_id: string; space: NotifySpace }[]>`select user_id, space from notification_digest_items where flushed_at is null and cadence = 'hour'
    group by user_id, space ${opt.force ? sql`` : sql`having min(created_at) <= ${now}::timestamptz - interval '1 hour'`}`;
  for (const g of hourGroups) hour += await flush(g.user_id, g.space, 'hour', null, `digest:hour:${g.space}:${now.getTime()}`);
  const today = kstDay(now); const boundary = new Date(`${today}T${String(DAILY_DIGEST_HOUR).padStart(2, '0')}:00:00+09:00`);
  if (opt.force || now >= boundary) {
    const dayGroups = await sql<{ user_id: string; space: NotifySpace }[]>`select user_id, space from notification_digest_items where flushed_at is null and cadence = 'day' ${opt.force ? sql`` : sql`and created_at < ${boundary}`} group by user_id, space`;
    for (const g of dayGroups) day += await flush(g.user_id, g.space, 'day', opt.force ? null : boundary, `digest:day:${g.space}:${today}${opt.force ? `:${now.getTime()}` : ''}`);
  }
  return { hour, day };
}
