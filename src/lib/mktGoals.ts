import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { notify } from './notifications';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';

/**
 * 대표 10/20 18:00 ① 콘텐츠 근거(목적·목표 지표·핵심 메시지·왜 이 글인가) ② 월 운영 목표: 매월 25일 AI 초안(다음 달) → 대표 승인 → 주간 주제 달력 → 월요일 주간 리뷰 → 월말 결산
 * ③ AI 작업 큐 종류 '목표 설정·주간 계획·리뷰'(밤사이 범위 'goal' 기본 끔 — 낮(09~22시)에는 정기 실행이 돌림) ④ 이달 자동 제작분 근거 소급(AI 비용 0, 목표·규칙에서 문장으로).
 * 묶음 규칙의 자동 제작은 그 주 주제 달력에서 주제를 가져오고, 근거 칸이 자동으로 채워진다. 돈·외부 발송 없음.
 */
export type Rationale = { purpose?: string | null; metric?: string | null; message?: string | null; why?: string | null; source?: 'goal' | 'rule' | 'ai' | 'user' | 'backfill'; goalId?: string | null; week?: number | null; topic?: string | null };
export type GoalWeek = { week: number; from: string; to: string; topic: string; channels: string[]; kinds: string[]; note?: string };
export type Goals = { objectives: string[]; message: string; targets: { posts: number | null; inquiries: number | null; adBudget: number | null }; channels: string[] };

const KST = 'Asia/Seoul';
export const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: KST }).format(d);
export const monthKst = (d = new Date(), offset = 0) => { const [y, m] = ymd(d).split('-').map(Number); const x = new Date(Date.UTC(y, m - 1 + offset, 1)); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };
const dayKst = (d = new Date()) => Number(ymd(d).slice(8, 10));
const hourKst = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: KST, hour: '2-digit', hour12: false }).format(d)) % 24;
const dowKst = (d = new Date()) => new Date(`${ymd(d)}T00:00:00Z`).getUTCDay();
const addD = (s: string, n: number) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const lastDayOf = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
/** 월의 주 블록(1일부터 일요일까지가 1주, 이후 월~일) */
export function weeksOf(month: string): { week: number; from: string; to: string }[] {
  const first = `${month}-01`, last = lastDayOf(month); const out = []; let from = first; let w = 1;
  while (from <= last) { const dow = new Date(`${from}T00:00:00Z`).getUTCDay(); const toSun = addD(from, (7 - dow) % 7); const to = toSun < last ? toSun : last; out.push({ week: w++, from, to }); from = addD(to, 1); }
  return out;
}
export const weekOf = (weekly: GoalWeek[], day: string) => weekly.find((w) => w.from <= day && day <= w.to) ?? null;

/** 기간 실적: 게시 수(채널별)·전화 문의·광고비 */
export async function numbersOf(tenant: string, from: string, to: string, brandId?: string | null) {
  const sql = db();
  const posts = await sql<{ channel: string; n: number }[]>`select channel, count(*)::int as n from mkt_contents where tenant = ${tenant} and not is_test and status = 'published'
    and (coalesce(published_at, scheduled_at) at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date ${brandId ? sql`and brand_id = ${brandId}` : sql``} group by channel`;
  const planned = await sql<{ n: number }[]>`select count(*)::int as n from mkt_contents where tenant = ${tenant} and not is_test and status in ('pending', 'approved', 'changes', 'published', 'hold', 'draft')
    and (scheduled_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date ${brandId ? sql`and brand_id = ${brandId}` : sql``}`;
  const [calls] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_calls where tenant = ${tenant} and status <> 'excluded' and (called_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date ${brandId ? sql`and (brand_id = ${brandId} or brand_id is null)` : sql``}`;
  const [ad] = await sql<{ cost: number; clicks: number }[]>`select coalesce(sum(s.cost_krw), 0)::float8 as cost, coalesce(sum(s.clicks), 0)::float8 as clicks from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day between ${from}::date and ${to}::date`;
  const byChannel = Object.fromEntries(posts.map((p) => [p.channel, p.n]));
  return { posts: posts.reduce((n, p) => n + p.n, 0), byChannel, planned: planned[0]?.n ?? 0, inquiries: calls.n, adCost: Math.round(ad.cost), clicks: ad.clicks };
}

const DEFAULT_KINDS: Record<string, string[]> = { instagram: ['feed', 'reels'], blog: ['blog'], facebook: ['feed'], youtube: ['shorts'], threads: ['feed'] };
/** AI 없이도 쓰는 기본 초안(지난달 실적 + 브랜드 키트 주제) */
function templateGoal(month: string, brand: any, co: any, prev: Awaited<ReturnType<typeof numbersOf>>, channels: string[]): { goals: Goals; weekly: GoalWeek[] } {
  const name = brand?.name ?? co?.name ?? '우리 브랜드';
  const topics = [brand?.weekly_topic, brand?.products && `${brand.products} 소개`, '고객 후기·현장 이야기', '이벤트·혜택 안내', '운영 팁·자주 묻는 질문'].filter(Boolean) as string[];
  const weeks = weeksOf(month).map((w, i) => ({ ...w, topic: topics[i % topics.length], channels, kinds: channels.flatMap((c) => DEFAULT_KINDS[c] ?? ['feed']).filter((v, i2, a) => a.indexOf(v) === i2), note: '' }));
  return { goals: { objectives: [`${name} 인지도 — 지난달보다 게시 꾸준히(${Math.max(prev.posts, 8)}건)`, `문의 ${Math.max(prev.inquiries + 2, 5)}건 — 글마다 전화·문의 유도 한 줄`, '브랜드 말투 통일 — 금지어 0건'],
    message: brand?.intro ? String(brand.intro).slice(0, 80) : `${name}, 가까운 곳에서 믿고 맡기세요`, targets: { posts: Math.max(prev.posts, 8), inquiries: Math.max(prev.inquiries + 2, 5), adBudget: prev.adCost || null }, channels }, weekly: weeks };
}

async function approversOf(tenant: string) { return (await import('./mktAuto')).approvers(tenant); }

/** 월 운영 목표 초안(AI 25일 정기 또는 [초안 만들기]) → 승인 대기(pending) + 승인자 알림. 같은 달·브랜드가 있으면 pending/draft 일 때만 덮어씀 */
export async function draftGoal(tenant: string, month: string, brandId: string | null, actorId: string | null, opt: { force?: boolean } = {}) {
  const sql = db();
  const [ex] = await sql<any[]>`select id, status from mkt_goals where tenant = ${tenant} and coalesce(brand_id::text, '') = ${brandId ?? ''} and month = ${month}`;
  if (ex && !['pending', 'draft'].includes(ex.status) && !opt.force) return { id: ex.id, status: ex.status, skipped: true };
  const [brand] = brandId ? await sql<any[]>`select * from mkt_brands where id = ${brandId} and tenant = ${tenant}` : [];
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant } as SessionUser).catch(() => ({} as any));
  const prevMonth = monthKst(new Date(`${month}-15T00:00:00+09:00`), -1);
  const prev = await numbersOf(tenant, `${prevMonth}-01`, lastDayOf(prevMonth), brandId);
  const rules = await sql<{ channel: string }[]>`select distinct channel from mkt_rules where tenant = ${tenant} and active ${brandId ? sql`and brand_id = ${brandId}` : sql``}`;
  const connected = await sql<{ channel: string }[]>`select distinct channel from mkt_channel_settings where tenant = ${tenant} and enabled`;
  const channels = [...new Set([...rules.map((r) => r.channel), ...connected.map((r) => r.channel)])].filter((c) => c !== 'other');
  const today = ymd(new Date()); const cur = await numbersOf(tenant, `${month}-01`, lastDayOf(month), brandId); // 이달 예정(묶음 규칙 칸)·지금까지 실적
  const base = templateGoal(month, brand, co, prev, channels.length ? channels : ['instagram', 'blog']);
  base.goals.targets.posts = Math.max(base.goals.targets.posts ?? 0, cur.planned, cur.posts + 1); base.goals.targets.inquiries = Math.max(base.goals.targets.inquiries ?? 0, cur.inquiries + 1);
  if (cur.adCost > 0) base.goals.targets.adBudget = Math.max(base.goals.targets.adBudget ?? 0, Math.round(cur.adCost * 1.1));
  const remaining = base.weekly.filter((w) => w.to >= today);
  for (const w of base.weekly) if (w.to < today) { w.topic = '(지난 주)'; w.note = ''; }
  let goals = base.goals, weekly = base.weekly, source: 'ai' | 'template' = 'template';
  const P = await import('./ai/provider');
  if (P.aiEnabled()) {
    try {
      const { assertMktAi } = await import('./mktAuto'); await assertMktAi(tenant);
      const p = P.anthropicProvider({ tier: 'fast' });
      const r = await p.chat({
        system: `회사 마케팅 담당 AI 비서입니다. 다음 달 마케팅 운영 목표와 주간 주제 달력을 JSON 으로만 씁니다. 한국어. 사실은 [재료]에 있는 것만, 숫자 목표는 지난달 실적을 바탕으로 현실적으로(지난달 +10~30%). 과장·최상급 금지. 돈을 쓰거나 밖으로 보내는 계획은 '대표 승인 뒤'라고 씁니다.`,
        tools: [], messages: [{ role: 'user', content: `[재료]\n달: ${month}\n브랜드: ${brand?.name ?? co?.name ?? '(없음)'}\n${brand?.intro ? `소개: ${brand.intro}\n` : ''}${brand?.products ? `주력 상품: ${brand.products}\n` : ''}${brand?.weekly_topic ? `이번 주 주제(참고): ${brand.weekly_topic}\n` : ''}${co?.business ? `회사 사업: ${co.business}\n` : ''}${co?.customers ? `주요 고객: ${co.customers}\n` : ''}채널: ${goals.channels.join(', ')}\n지난달 실적: 게시 ${prev.posts}건(${Object.entries(prev.byChannel).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}), 전화 문의 ${prev.inquiries}건, 광고비 ${prev.adCost.toLocaleString('ko-KR')}원\n이달 현황: 묶음 규칙으로 예정된 게시 ${cur.planned}건, 지금까지 게시 ${cur.posts}건·문의 ${cur.inquiries}건·광고비 ${cur.adCost.toLocaleString('ko-KR')}원(실적) → 목표 수치는 예정·실적보다 높게\n주 블록(남은 주만 주제를 배정): ${remaining.map((w) => `${w.week}주 ${w.from}~${w.to}`).join(' / ') || '(남은 주 없음)'}\n\nobjectives 3개(한 줄씩), message(핵심 메시지 한 줄), targets{posts, inquiries, adBudget(원, 광고비 실적 없으면 null)}, weeks(남은 주 블록 수만큼 순서대로: topic 한 줄, channels, kinds(feed/reels/blog/shorts/story 중), note 한 줄)` }],
        format: { type: 'object', additionalProperties: false, required: ['objectives', 'message', 'targets', 'weeks'], properties: { objectives: { type: 'array', items: { type: 'string' } }, message: { type: 'string' },
          targets: { type: 'object', additionalProperties: false, required: ['posts', 'inquiries', 'adBudget'], properties: { posts: { type: ['integer', 'null'] }, inquiries: { type: ['integer', 'null'] }, adBudget: { type: ['integer', 'null'] } } },
          weeks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'channels', 'kinds', 'note'], properties: { topic: { type: 'string' }, channels: { type: 'array', items: { type: 'string' } }, kinds: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } } } } } },
      });
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_goal')`;
      const o = JSON.parse((r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join(''));
      goals = { objectives: (o.objectives ?? []).slice(0, 5).map(String), message: String(o.message ?? goals.message).slice(0, 200), targets: { posts: o.targets?.posts ?? goals.targets.posts, inquiries: o.targets?.inquiries ?? goals.targets.inquiries, adBudget: o.targets?.adBudget ?? goals.targets.adBudget }, channels: goals.channels };
      let k = 0;
      weekly = base.weekly.map((w) => { if (w.to < today) return w; const ow = o.weeks?.[k++]; return { ...w, topic: String(ow?.topic ?? w.topic).slice(0, 120), channels: (ow?.channels ?? w.channels).map(String), kinds: (ow?.kinds ?? w.kinds).map(String), note: String(ow?.note ?? '').slice(0, 200) }; });
      goals.targets = { posts: Math.max(goals.targets.posts ?? 0, cur.planned, cur.posts + 1) || null, inquiries: Math.max(goals.targets.inquiries ?? 0, cur.inquiries + 1) || null, adBudget: goals.targets.adBudget };
      source = 'ai';
    } catch { /* AI 실패·한도 → 기본 초안 */ }
  }
  const [g] = await sql<{ id: string }[]>`insert into mkt_goals (tenant, brand_id, month, status, goals, weekly, source, created_by)
    values (${tenant}, ${brandId}, ${month}, 'pending', ${sql.json(goals as never)}, ${sql.json(weekly as never)}, ${source}, ${actorId})
    on conflict (tenant, coalesce(brand_id::text, ''), month) do update set goals = excluded.goals, weekly = excluded.weekly, source = excluded.source, status = 'pending', approved_by = null, approved_at = null, updated_at = now() returning id`;
  await notify(sql, { userIds: await approversOf(tenant), type: 'review_requested', title: `${month.replace('-', '년 ')}월 운영 목표 초안 — 승인해 주세요${brand ? ` (${brand.name})` : ''}`, body: goals.objectives[0] ?? '', link: '/s/marketing/goals', entityType: 'mkt_goal', entityId: g.id, dedupeKey: `mktgoal:${g.id}:${source}` }).catch(() => {});
  return { id: g.id, status: 'pending', source, goals, weekly };
}

export async function goalFor(tenant: string, brandId: string | null, month: string, sql = db()) {
  const rows = await sql<any[]>`select * from mkt_goals where tenant = ${tenant} and month = ${month} and status in ('approved', 'closed', 'pending') and (brand_id = ${brandId} or brand_id is null) order by (brand_id is null), (status = 'approved') desc limit 1`;
  return rows[0] ?? null;
}

/** 홈 '이번 달 목표 n/m' 막대 */
export async function goalProgress(tenant: string, month = monthKst()) {
  const sql = db();
  const [g] = await sql<any[]>`select * from mkt_goals where tenant = ${tenant} and month = ${month} and brand_id is null order by (status = 'approved') desc, updated_at desc limit 1`
    .then(async (r) => (r.length ? r : sql<any[]>`select * from mkt_goals where tenant = ${tenant} and month = ${month} order by (status = 'approved') desc, updated_at desc limit 1`));
  if (!g) return null;
  const n = await numbersOf(tenant, `${month}-01`, lastDayOf(month), g.brand_id);
  const week = weekOf(g.weekly ?? [], ymd(new Date()));
  return { id: g.id, month, status: g.status, posts: { done: n.posts, planned: n.planned, target: g.goals?.targets?.posts ?? null }, inquiries: { done: n.inquiries, target: g.goals?.targets?.inquiries ?? null }, adCost: { spent: n.adCost, budget: g.goals?.targets?.adBudget ?? null },
    objectives: g.goals?.objectives ?? [], message: g.goals?.message ?? null, weekTopic: week?.topic ?? null, week: week?.week ?? null };
}

/** 콘텐츠 근거 문장(AI 비용 0): 목표·주차 주제·규칙에서 */
export function rationaleFrom(opts: { goal?: any; day: string; rule?: any; brandName?: string | null; kind?: string | null; channel?: string | null; why?: string | null; source: Rationale['source'] }): Rationale {
  const { goal, day, rule } = opts;
  const week = goal ? weekOf(goal.weekly ?? [], day) : null;
  const objective = goal?.goals?.objectives?.[0] ?? null;
  const t = goal?.goals?.targets;
  const metric = t ? [t.posts ? `게시 ${t.posts}건` : '', t.inquiries ? `문의 ${t.inquiries}건` : ''].filter(Boolean).join(' · ') || null : null;
  const topic = week?.topic ?? rule?.topic_hint ?? null;
  const why = opts.why ?? (goal ? `${goal.month.slice(5).replace(/^0/, '')}월 운영 목표 '${objective ?? ''}'${week ? ` · ${week.week}주 주제 '${week.topic}'` : ''}에 따라 ${rule ? '묶음 규칙으로 자동 제작' : '만든 글'}` : rule ? `묶음 규칙(${rule.channel ?? opts.channel ?? ''} ${rule.kind ?? opts.kind ?? ''})에 따라 자동 제작${rule.topic_hint ? ` — 주제 '${rule.topic_hint}'` : ''}` : null);
  return { purpose: objective, metric, message: goal?.goals?.message ?? null, why, source: opts.source, goalId: goal?.id ?? null, week: week?.week ?? null, topic };
}

export const goalInput = z.object({ goals: z.object({ objectives: z.array(z.string().trim().max(200)).max(6), message: z.string().trim().max(200), targets: z.object({ posts: z.number().int().min(0).nullable(), inquiries: z.number().int().min(0).nullable(), adBudget: z.number().int().min(0).nullable() }), channels: z.array(z.string()).max(8) }).optional(),
  weekly: z.array(z.object({ week: z.number().int(), from: z.string(), to: z.string(), topic: z.string().trim().max(200), channels: z.array(z.string()).max(8), kinds: z.array(z.string()).max(8), note: z.string().max(300).optional() })).max(6).optional() });
export const goalAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), ...goalInput.shape }), z.object({ action: z.literal('approve') }), z.object({ action: z.literal('redraft') }),
  z.object({ action: z.literal('review'), week: z.number().int().min(1).max(6).optional() }), z.object({ action: z.literal('close') })]);
export const goalCreate = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), brandId: zUuid.nullable().optional() });

export async function listGoals(u: SessionUser, month?: string) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const m = month ?? monthKst();
  const rows = await sql<any[]>`select g.*, b.name as brand, ub.name as created_by_name, ua.name as approved_by_name from mkt_goals g left join mkt_brands b on b.id = g.brand_id left join users ub on ub.id = g.created_by left join users ua on ua.id = g.approved_by
    where g.tenant = ${t} and g.month = ${m} order by (g.brand_id is null) desc, b.name`;
  const out = [];
  for (const g of rows) { const n = await numbersOf(t, `${m}-01`, lastDayOf(m), g.brand_id); out.push({ ...g, numbers: n, thisWeek: weekOf(g.weekly ?? [], ymd(new Date()))?.week ?? null }); }
  const brands = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} order by name`;
  const months = (await sql<{ month: string }[]>`select distinct month from mkt_goals where tenant = ${t} order by month desc limit 12`).map((x) => x.month);
  return { month: m, goals: out, brands, months: [...new Set([monthKst(new Date(), 1), monthKst(), ...months])].sort().reverse(), canEdit: isAdmin(u), today: ymd(new Date()) };
}
export async function createGoalNow(u: SessionUser, i: z.infer<typeof goalCreate>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('관리자만');
  return draftGoal(tenantOf(u), i.month, i.brandId ?? null, u.id, { force: true });
}
export async function actGoal(u: SessionUser, id: string, i: z.infer<typeof goalAction>, ip: string | null) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('관리자만');
  const sql = db(); const t = tenantOf(u);
  const [g] = await sql<any[]>`select * from mkt_goals where id = ${id} and tenant = ${t}`;
  if (!g) throw notFound();
  const { audit } = await import('./log');
  if (i.action === 'update') {
    await sql`update mkt_goals set goals = ${sql.json((i.goals ?? g.goals) as never)}, weekly = ${sql.json((i.weekly ?? g.weekly) as never)}, source = 'user', updated_at = now() where id = ${id}`;
    return { ok: true };
  }
  if (i.action === 'approve') {
    if (g.status === 'closed') throw badRequest('결산이 끝난 달입니다');
    await sql`update mkt_goals set status = 'approved', approved_by = ${u.id}, approved_at = now(), updated_at = now() where id = ${id}`;
    await audit(sql as never, u.id, 'mkt.goal_approve', 'mkt_goal', id, { month: g.month }, ip);
    return { ok: true };
  }
  if (i.action === 'redraft') return draftGoal(t, g.month, g.brand_id, u.id, { force: true });
  if (i.action === 'review') return reviewWeek(t, id, i.week, u.id);
  return closeGoal(t, id, u.id);
}

/** 월요일 주간 리뷰: 지난주 숫자 + 한 문단(AI 없으면 숫자 요약) → reviews[] 에 추가(같은 주 다시 돌리면 덮어씀) */
export async function reviewWeek(tenant: string, goalId: string, week?: number, actorId: string | null = null) {
  const sql = db();
  const [g] = await sql<any[]>`select * from mkt_goals where id = ${goalId} and tenant = ${tenant}`;
  if (!g) throw notFound();
  const weekly: GoalWeek[] = g.weekly ?? []; const today = ymd(new Date());
  const target = week ? weekly.find((w) => w.week === week) : [...weekly].reverse().find((w) => w.to < today) ?? weekly.find((w) => w.from <= today && today <= w.to);
  if (!target) throw badRequest('리뷰할 주가 없습니다');
  const n = await numbersOf(tenant, target.from, target.to, g.brand_id);
  const t = g.goals?.targets ?? {}; const weeksN = weekly.length || 4;
  const pace = (done: number, tot: number | null) => (tot ? `${done}/${Math.ceil(tot / weeksN)}(주 목표)` : String(done));
  let summary = `${target.week}주(${target.from.slice(5)}~${target.to.slice(5)}) 게시 ${pace(n.posts, t.posts)} · 문의 ${pace(n.inquiries, t.inquiries)} · 광고비 ${n.adCost.toLocaleString('ko-KR')}원. 주제 '${target.topic}'.` + (t.posts && n.posts < Math.ceil(t.posts / weeksN) ? ' 게시가 주 목표에 못 미쳤습니다 — 다음 주 칸을 늘리거나 주제를 바꿔 보세요.' : ' 계획대로 진행 중입니다.');
  const P = await import('./ai/provider');
  if (P.aiEnabled()) {
    try {
      const { assertMktAi } = await import('./mktAuto'); await assertMktAi(tenant);
      const p = P.anthropicProvider({ tier: 'fast' });
      const r = await p.chat({ system: '마케팅 주간 리뷰를 한국어 3문장으로 씁니다. 숫자는 [실적]에 있는 것만, 다음 주 제안 1개 포함. 텍스트만.', tools: [],
        messages: [{ role: 'user', content: `[목표] ${(g.goals?.objectives ?? []).join(' / ')} · 월 목표 게시 ${t.posts ?? '-'}건 문의 ${t.inquiries ?? '-'}건\n[이번 주] ${target.week}주 주제 '${target.topic}'\n[실적] 게시 ${n.posts}건(${Object.entries(n.byChannel).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}), 문의 ${n.inquiries}건, 광고비 ${n.adCost}원, 클릭 ${n.clicks}\n[다음 주 주제] ${weekly.find((w) => w.week === target.week + 1)?.topic ?? '(없음)'}` }] });
      await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
        values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_goal')`;
      const txt = (r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('').trim(); if (txt) summary = txt.slice(0, 800);
    } catch { /* 기본 요약 */ }
  }
  const reviews = [...(g.reviews ?? []).filter((x: any) => x.week !== target.week), { week: target.week, at: new Date().toISOString(), numbers: n, summary }].sort((a: any, b: any) => a.week - b.week);
  await sql`update mkt_goals set reviews = ${sql.json(reviews as never)}, updated_at = now() where id = ${goalId}`;
  await notify(sql, { userIds: await approversOf(tenant), type: 'weekly_report', title: `${g.month.slice(5).replace(/^0/, '')}월 ${target.week}주 마케팅 주간 리뷰`, body: summary.slice(0, 200), link: '/s/marketing/goals', entityType: 'mkt_goal', entityId: goalId, dedupeKey: `mktreview:${goalId}:${target.week}` }).catch(() => {});
  return { week: target.week, numbers: n, summary };
}

/** 월말 결산: 한 달 숫자 + 목표 대비 → closing, status closed */
export async function closeGoal(tenant: string, goalId: string, actorId: string | null = null) {
  const sql = db();
  const [g] = await sql<any[]>`select * from mkt_goals where id = ${goalId} and tenant = ${tenant}`;
  if (!g) throw notFound();
  const n = await numbersOf(tenant, `${g.month}-01`, lastDayOf(g.month), g.brand_id); const t = g.goals?.targets ?? {};
  const rate = (done: number, tot: number | null) => (tot ? Math.round((done / tot) * 100) : null);
  const closing = { at: new Date().toISOString(), numbers: n, achieved: { posts: rate(n.posts, t.posts), inquiries: rate(n.inquiries, t.inquiries), adBudget: t.adBudget ? Math.round((n.adCost / t.adBudget) * 100) : null },
    summary: `${g.month.replace('-', '년 ')}월 결산 — 게시 ${n.posts}${t.posts ? `/${t.posts}` : ''}건 · 문의 ${n.inquiries}${t.inquiries ? `/${t.inquiries}` : ''}건 · 광고비 ${n.adCost.toLocaleString('ko-KR')}원${t.adBudget ? `/${Number(t.adBudget).toLocaleString('ko-KR')}원` : ''}. 주간 리뷰 ${(g.reviews ?? []).length}회.` };
  await sql`update mkt_goals set closing = ${sql.json(closing as never)}, status = 'closed', updated_at = now() where id = ${goalId}`;
  await notify(sql, { userIds: await approversOf(tenant), type: 'weekly_report', title: closing.summary.split(' — ')[0], body: closing.summary, link: '/s/marketing/goals', entityType: 'mkt_goal', entityId: goalId, dedupeKey: `mktclose:${goalId}` }).catch(() => {});
  void actorId;
  return closing;
}

/** ④ 이달 자동 제작분 근거 소급(AI 비용 0): rationale 이 비어 있는 콘텐츠에 목표·규칙 문장 */
export async function backfillRationale(u: SessionUser, month = monthKst()) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('관리자만');
  const sql = db(); const t = tenantOf(u);
  const rows = await sql<any[]>`select c.id, c.brand_id, c.channel, c.kind, c.scheduled_at, c.rule_id, c.auto, r.channel as r_channel, r.kind as r_kind, r.topic_hint from mkt_contents c left join mkt_rules r on r.id = c.rule_id
    where c.tenant = ${t} and c.rationale is null and c.scheduled_at is not null and to_char(c.scheduled_at at time zone 'Asia/Seoul', 'YYYY-MM') = ${month}`;
  let n = 0;
  for (const c of rows) {
    const goal = await goalFor(t, c.brand_id, month, sql);
    const rule = c.rule_id ? { channel: c.r_channel, kind: c.r_kind, topic_hint: c.topic_hint } : null;
    if (!goal && !rule && !c.auto) continue;
    const r = rationaleFrom({ goal, day: ymd(new Date(c.scheduled_at)), rule, channel: c.channel, kind: c.kind, source: 'backfill' });
    await sql`update mkt_contents set rationale = ${sql.json(r as never)} where id = ${c.id}`; n++;
  }
  return { updated: n, total: rows.length };
}

/** 정기 실행(낮 09~22시, 밤은 night_scope.goal 켠 회사만): 25일 이후 다음 달 초안 · 월요일 지난주 리뷰 · 다음 달 1일 지난달 결산 */
export async function goalTick(tenant: string, now = new Date()) {
  const sql = db(); const h = hourKst(now);
  const { aiSettings } = await import('./ai/threads');
  const night = !!((await aiSettings(tenant)).night_scope as any)?.goal;
  if (h < 9 || (h >= 22 && !night)) return { skipped: 'hour' };
  const out: Record<string, unknown> = {};
  const month = monthKst(now), next = monthKst(now, 1), prev = monthKst(now, -1);
  if (dayKst(now) >= 25) {
    const [ex] = await sql<{ id: string }[]>`select id from mkt_goals where tenant = ${tenant} and month = ${next} and brand_id is null`;
    if (!ex) out.draft = await draftGoal(tenant, next, null, null).catch((e) => ({ error: String(e?.message ?? e) }));
  }
  if (dowKst(now) === 1) {
    const goals = await sql<any[]>`select id, weekly, reviews from mkt_goals where tenant = ${tenant} and month in (${month}, ${prev}) and status = 'approved'`;
    for (const g of goals) { const today = ymd(now); const last = [...(g.weekly ?? [])].reverse().find((w: any) => w.to < today); if (last && !(g.reviews ?? []).some((r: any) => r.week === last.week)) out.review = await reviewWeek(tenant, g.id, last.week).catch((e) => ({ error: String(e?.message ?? e) })); }
  }
  if (dayKst(now) <= 3) {
    const goals = await sql<{ id: string }[]>`select id from mkt_goals where tenant = ${tenant} and month = ${prev} and status = 'approved'`;
    for (const g of goals) out.close = await closeGoal(tenant, g.id).catch((e) => ({ error: String(e?.message ?? e) }));
  }
  return out;
}
export async function goalTickAll() {
  const ts = await db()<{ tenant: string }[]>`select distinct tenant from mkt_brands where tenant in (select tenant from mkt_rules where active union select tenant from mkt_goals) limit 5`;
  const out = [];
  for (const t of ts) out.push({ tenant: t.tenant, ...(await goalTick(t.tenant).catch((e) => ({ error: String(e?.message ?? e) }))) });
  return out;
}
