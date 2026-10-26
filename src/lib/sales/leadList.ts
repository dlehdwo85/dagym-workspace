/**
 * 197차(#461 영업 진행 목록 개편 1단계, 설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md · docs/research/SALES_BID_SPLIT_2026-10-27.md 7):
 * 목록 칸(단계 머문 날·다음 할 일·마지막 접촉·출처·종결일·다시 볼 날) · 사용자별 저장된 보기·열(기기 간 유지) ·
 * 업무 완료 때 묻는 창이 읽는 리드 요약 · '다시 볼 날' 정기 점검(보류·실패로 닫으며 고른 날 → 담당자 업무 1건).
 * 원칙: "모든 진행 중 거래처는 다음 행동이 있거나, 종결 사유가 있다".
 */
import { z } from 'zod';
import { db, type Sql } from '../db';
import { notFound } from '../errors';
import { notify } from '../notifications';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';

/** 종결 단계(성사·보류·실패·되돌림) — 그 밖은 진행 중 */
export const CLOSED_STAGES = ['계약완료', '보류', '실패', '되돌림'];
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const iso = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));

export type LeadSource = { kind: 'bid' | 'building' | 'facility' | 'vendor' | 'meta' | 'moved' | 'direct'; label: string; href: string | null };
export type LeadExtra = { nextAction: string | null; revisit: string | null; stageSince: string | null; closedAt: string | null; lastContact: { at: string; kind: string } | null; source: LeadSource };
type Terms = { kind: Record<string, string>; buildingsTab: string; facilitiesTab: string; vendorsTab: string };

/**
 * 리드 id → 목록 칸. 마지막 접촉 = 상담 기록(종류) · 사람이 끝낸 리드 업무 · 사람이 바꾼 단계 중 가장 늦은 것(처음 만든 기록·자동 기록은 빼고).
 * 출처 = 영업기회 허브에서 넘긴 건(공고·단지·시설·협력사, 링크) · 리드 광고 · 이전 자료(옮겨 온 리드) · 직접 등록
 */
export async function leadExtras(sql: Sql, tenant: string, terms: Terms) {
  const rows = await sql<{ id: string; status: string | null; next_action: string | null; revisit: string | null; created_at: Date; src_id: string | null; src_from: string | null; src_ref: string | null; name: string;
    stage_at: Date | null; act_at: Date | null; act_kind: string | null; task_at: Date | null; status_at: Date | null }[]>`
    select l.id, l.status, l.next_action, l.revisit_date::text as revisit, l.created_at, l.src_id, l.src->>'from' as src_from, l.src->>'id' as src_ref, l.name,
      (select g.changed_at from sales_status_log g where g.lead_id = l.id and g.to_status = coalesce(l.status, '') order by g.changed_at desc limit 1) as stage_at,
      act.at as act_at, act.kind as act_kind,
      (select max(v.created_at) from tasks t join activities v on v.entity_type = 'task' and v.entity_id = t.id and v.action in ('completed', 'approved')
        where t.lead_id = l.id and t.deleted_at is null and t.status = 'done') as task_at, -- 사람이 끝낸 업무만(리드를 닫을 때 자동으로 마친 영업 업무는 접촉이 아님)
      (select max(g.changed_at) from sales_status_log g where g.lead_id = l.id and g.from_status is not null and g.changed_by is not null) as status_at
    from sales_leads l
    left join lateral (select x.occurred_at as at, x.data->>'activity_type' as kind from sales_lead_records x where x.lead_id = l.id and x.kind = 'sales_activities' order by x.occurred_at desc nulls last limit 1) act on true
    where l.tenant = ${tenant} and l.deleted_at is null limit 5000`;
  const HUB: Record<string, [string, (id: string, name: string) => string]> = {
    bid: [`${terms.kind.bid} 공고`, (id) => `/s/sales/hub?tab=bids&bt=working&bq=${encodeURIComponent(id)}`],
    building: [terms.buildingsTab, (_id, name) => `/s/sales/hub?tab=buildings&q=${encodeURIComponent(name)}`],
    facility: [terms.facilitiesTab, (_id, name) => `/s/sales/hub?tab=facilities&q=${encodeURIComponent(name)}`],
    vendor: [terms.vendorsTab, (_id, name) => `/s/sales/hub?tab=vendors&q=${encodeURIComponent(name)}`],
  };
  const out = new Map<string, LeadExtra>();
  for (const r of rows) {
    const cand: { at: number; kind: string }[] = [];
    if (r.act_at) cand.push({ at: new Date(r.act_at).getTime(), kind: r.act_kind || '상담' });
    if (r.task_at) cand.push({ at: new Date(r.task_at).getTime(), kind: '업무' });
    if (r.status_at) cand.push({ at: new Date(r.status_at).getTime(), kind: '단계' });
    const last = cand.sort((a, b) => b.at - a.at)[0];
    const hub = r.src_from ? HUB[r.src_from] : undefined;
    const source: LeadSource = hub && r.src_ref ? { kind: r.src_from as LeadSource['kind'], label: hub[0], href: hub[1](r.src_ref, r.name) }
      : r.src_from === 'meta_lead' ? { kind: 'meta', label: '리드 광고', href: null }
      : r.src_id ? { kind: 'moved', label: '이전 자료', href: null } : { kind: 'direct', label: '직접 등록', href: null };
    const closed = CLOSED_STAGES.includes(String(r.status ?? ''));
    out.set(r.id, { nextAction: r.next_action, revisit: r.revisit, stageSince: iso(r.stage_at ?? r.created_at), closedAt: closed ? iso(r.stage_at) : null,
      lastContact: last ? { at: new Date(last.at).toISOString(), kind: last.kind } : null, source });
  }
  return out;
}

// ── 사용자별 목록 설정(저장된 보기·열) — user_settings.list_views.leads ──────────────
const viewQuery = z.object({ lv: z.string().max(40).optional(), focus: z.string().max(20).optional(), chips: z.string().max(200).optional(), status: z.string().max(40).optional(), sort: z.string().max(20).optional(), rev: z.string().max(2).optional(),
  pri: z.string().max(20).optional(), owner: z.string().max(40).optional(), region: z.string().max(60).optional(), src: z.string().max(20).optional(), q: z.string().max(100).optional() });
export const leadViewsInput = z.object({
  views: z.array(z.object({ id: z.string().regex(/^[a-z0-9]{4,16}$/), name: z.string().trim().min(1, '보기 이름을 적어 주세요').max(30), q: viewQuery })).max(12, '저장된 보기는 12개까지입니다').optional(),
  cols: z.array(z.string().regex(/^[a-z]{2,20}$/)).max(20).optional(),
});
export type LeadViews = { views: z.infer<typeof leadViewsInput>['views']; cols: string[] | null };
export async function getLeadViews(sql: Sql, userId: string): Promise<LeadViews> {
  const [s] = await sql<{ v: any }[]>`select list_views->'leads' as v from user_settings where user_id = ${userId}`;
  return { views: Array.isArray(s?.v?.views) ? s.v.views : [], cols: Array.isArray(s?.v?.cols) ? s.v.cols : null };
}
/** 보기·열 저장(준 칸만 바꿈) — 내 설정이라 누구나(영업 공간 구성원) */
export async function saveLeadViews(u: SessionUser, i: z.infer<typeof leadViewsInput>) {
  await assertSpace(u, 'sales');
  const sql = db();
  const cur = await getLeadViews(sql, u.id);
  const next = { views: i.views ?? cur.views ?? [], cols: i.cols ?? cur.cols };
  if (new Set(next.views!.map((v) => v.id)).size !== next.views!.length) next.views = next.views!.filter((v, k, a) => a.findIndex((x) => x.id === v.id) === k);
  await sql`insert into user_settings (user_id, list_views) values (${u.id}, ${sql.json({ leads: next } as never)})
    on conflict (user_id) do update set list_views = coalesce(user_settings.list_views, '{}'::jsonb) || ${sql.json({ leads: next } as never)}`;
  return next;
}

/** #460 업무 완료 창이 읽는 리드 요약 — 이름·단계·다음 연락·다음 할 일·담당, 단계를 바꿀 수 있는지(리드 담당·관리자·담당 없음) */
export async function leadBrief(u: SessionUser, id: string) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  const [l] = await sql<{ id: string; name: string; status: string | null; next: string | null; next_action: string | null; owner_id: string | null; owner: string | null }[]>`select l.id, l.name, l.status, l.next_contact_date::text as next, l.next_action, l.owner_id, u.name as owner
    from sales_leads l left join users u on u.id = l.owner_id where l.id = ${id} and l.tenant = ${tenantOf(u)} and l.deleted_at is null`;
  if (!l) throw notFound();
  const canStage = ['owner', 'admin'].includes(u.role) || !l.owner_id || l.owner_id === u.id;
  return { id: l.id, name: l.name, status: l.status, next: l.next, nextAction: l.next_action, ownerId: l.owner_id, owner: l.owner, closed: CLOSED_STAGES.includes(String(l.status ?? '')), canStage };
}

/**
 * 다시 볼 날 정기 점검(jobs.ts 'leadRevisit'): 보류·실패로 닫으며 고른 날이 되면 담당자(없으면 관리자)에게 '[영업] 이름 — 다시 연락(재접촉 검토)' 업무 1건 + 알림.
 * 리드 단계는 그대로(다시 진행할지는 사람이) · 한 번만(다시 볼 날을 지움) · 쓰기 열린 회사만
 */
export async function leadRevisitTick(now = new Date()) {
  const sql = db(); const today = ymd(now);
  const rows = await sql<{ id: string; tenant: string; name: string; status: string; owner_id: string | null; revisit: string; reason: string | null }[]>`select l.id, l.tenant, l.name, l.status, l.owner_id, l.revisit_date::text as revisit,
      (select g.reason from sales_status_log g where g.lead_id = l.id and g.to_status = l.status order by g.changed_at desc limit 1) as reason
    from sales_leads l join sales_cutover c on c.tenant = l.tenant and c.writes_open
    where l.deleted_at is null and l.revisit_date <= ${today}::date and coalesce(l.status, '') in ('보류', '실패') order by l.revisit_date limit 50`;
  const { actorOf, adminOf } = await import('./bidTasks');
  const { createTask } = await import('../tasks');
  let made = 0;
  for (const l of rows) {
    const actor = (await actorOf(sql, l.owner_id)) ?? (await adminOf(sql, l.tenant));
    if (actor) {
      const t = await createTask(actor, { title: `[영업] ${l.name.slice(0, 120)} — 다시 연락(재접촉 검토)`, space: 'sales', assigneeId: actor.id, requestedById: actor.id, dueDate: today, approvalRequired: false, tags: ['영업', '리드'],
        description: `'${l.status}'(으)로 닫으며 고른 다시 볼 날(${l.revisit})입니다${l.reason ? ` — 사유: ${l.reason}` : ''}\n리드: /s/sales/leads?id=${l.id}\n다시 진행하려면 리드의 단계를 진행 단계로 바꾸세요` }, { quiet: true, skipQuota: true });
      await sql`update tasks set sales_ref = ${sql.json({ kind: 'lead', id: l.id, name: l.name, manual: true, revisit: true })}, lead_id = ${l.id} where id = ${t.id}`;
      await notify(sql, { userIds: [actor.id], type: 'task_assigned', title: `다시 볼 날: ${l.name}`, body: `'${l.status}'(으)로 닫은 거래처를 다시 볼 날입니다 — 오늘 업무로 넣었습니다`,
        link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: null, dedupeKey: `lead_revisit:${l.id}:${l.revisit}` });
      made++;
    }
    await sql`update sales_leads set revisit_date = null, updated_at = now() where id = ${l.id}`;
  }
  return { checked: rows.length, made };
}
