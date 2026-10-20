import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';
import { zUuid } from './api';

/**
 * ⑥ 마케팅 홈 디벨롭(시안 DESIGN_HOME_SIDEBAR 2026-10-20, 대표 승인 10/20 오후 — 폴시아 참고 6가지):
 * 0 AI 비서 입력창(홈 맨 위, 답은 카드 1개) · 1 숫자 4칸 · 2 지금 승인할 것 상위 3(썸네일) · 3 AI 작업 큐(대기→실행 중→완료, [지금 실행]/[밤에]) + 🌙 밤사이 결과
 * · 4 이번 주 게시 캘린더 줄(7일 × 채널 점) · 5 성과 7일 미니 차트 + 광고 카드 · 6 최근 게시물 6 + [다음 할 일 제안] → [업무로 만들기] · 7 채널 상태 한 줄 · ⚙ 카드 켜기/끄기·순서(사람별, 관리자는 회사 기본도)
 * 돈·외부 발송은 절대 자동 아님(V19 — 사람이 [보내기]). 밤사이 비서 범위는 회사 AI 설정(ai_settings.night_scope, 기본 모두 끔).
 */
export const HOME_CARDS = ['chat', 'kpi', 'approve', 'queue', 'week', 'perf', 'recent', 'channels'] as const;
export type HomeCard = (typeof HOME_CARDS)[number];
export const HOME_CARD_LABEL: Record<HomeCard, string> = { chat: 'AI 비서 입력창', kpi: '숫자 4칸', approve: '지금 승인할 것', queue: 'AI 작업 큐 · 밤사이 결과', week: '이번 주 게시 캘린더', perf: '성과 7일 · 광고', recent: '최근 게시물 · 다음 할 일 제안', channels: '채널 상태' };
/** 밤사이 비서 범위 4개(기본 모두 끔 → 대표가 켬). draft 만 지금 실행기가 처리, 나머지 셋은 저장만(다음 단계) */
export const NIGHT_SCOPE = ['draft', 'lead_next', 'bid_summary', 'report'] as const;
export const NIGHT_LABEL: Record<(typeof NIGHT_SCOPE)[number], string> = { draft: '원고 초안(자동 제작 시안을 밤에 미리)', lead_next: '리드 다음 연락 제안', bid_summary: '입찰 요약', report: '보고서 초안' };

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const hourKst = (d = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(d)) % 24;
/** 다음 22:00(KST) — 지금이 22시 이후면 바로 */
export function nextNight(now = new Date()) {
  if (hourKst(now) >= 22) return now;
  return new Date(`${ymd(now)}T22:00:00+09:00`);
}

async function cardsOf(u: SessionUser) {
  const sql = db(); const t = tenantOf(u);
  const [me] = await sql<{ c: HomeCard[] | null }[]>`select mkt_home_cards as c from user_settings where user_id = ${u.id}`;
  const [co] = await sql<{ value: HomeCard[] }[]>`select value from app_settings where key = ${`mkt_home_cards:${t}`}`;
  const pick = (v: unknown): HomeCard[] | null => (Array.isArray(v) && v.length ? (v.filter((x) => (HOME_CARDS as readonly string[]).includes(String(x))) as HomeCard[]) : null);
  return { cards: pick(me?.c) ?? pick(co?.value) ?? [...HOME_CARDS], mine: !!pick(me?.c), company: pick(co?.value) };
}

export async function homeView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const admin = isAdmin(u);
  const { homeNow, approvableCount } = await import('./marketing');
  const { homeChannels } = await import('./mktChannels');
  const now = await homeNow(t);
  const queueIds = now.queue.slice(0, 3).map((c: any) => c.id);
  const thumbs = queueIds.length ? await sql<{ content_id: string; media: string | null }[]>`select v.content_id, v.media_ids[1]::text as media from mkt_versions v join mkt_contents c on c.id = v.content_id and c.current_version = v.version where v.content_id = any(${queueIds}::uuid[])` : [];
  const thumb = new Map(thumbs.map((r) => [r.content_id, r.media]));
  const approve = now.queue.slice(0, 3).map((c: any) => ({ ...c, media: thumb.get(c.id) ?? null }));
  // 1 숫자 4칸
  const [adp] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_ad_plans where tenant = ${t} and status = 'draft'`;
  const [wk] = await sql<{ done: number; planned: number }[]>`select count(*) filter (where status = 'published')::int as done, count(*) filter (where status in ('approved', 'pending', 'changes'))::int as planned
    from mkt_contents where tenant = ${t} and not is_test and (scheduled_at at time zone 'Asia/Seoul')::date between (now() at time zone 'Asia/Seoul')::date and (now() at time zone 'Asia/Seoul')::date + 6`;
  const [ad] = await sql<{ accounts: number; cost7: number; clicks7: number; today: number }[]>`select (select count(*)::int from mkt_ad_accounts a where a.tenant = ${t} and a.status <> 'disconnected') as accounts,
      coalesce((select sum(s.cost_krw) from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6), 0)::float8 as cost7,
      coalesce((select sum(s.clicks) from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6), 0)::float8 as clicks7,
      coalesce((select sum(s.cost_krw) from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day = (now() at time zone 'Asia/Seoul')::date), 0)::float8 as today`;
  const [calls] = await sql<{ d7: number; open: number }[]>`select count(*) filter (where called_at >= now() - interval '7 days')::int as d7, count(*) filter (where status = 'new')::int as open from mkt_calls where tenant = ${t}`;
  const approvable = await approvableCount(t);
  const kpi = { approvals: approvable + adp.n, approvalsDetail: { contents: approvable, adPlans: adp.n }, today: now.todayPosts.map((c: any) => ({ id: c.id, channel: c.channel, kind: c.kind, at: c.scheduled_at, status: c.status })),
    week: { done: wk.done, planned: wk.planned }, ads: ad.accounts > 0 ? { cost7: ad.cost7, clicks7: ad.clicks7, today: ad.today } : null, calls7: calls.d7 };
  // 3 AI 작업 큐: 자동 제작 시안(대기·실행 중·완료 24시간) · 내 문서 작업 · 광고 개선안(승인 전) · 내 문자/견적 시안
  const contents = await sql<any[]>`select id, title, produce_at, produced_at, status, night_run, (exists (select 1 from mkt_production_requests q where q.content_id = c.id and q.kind = 'topic' and q.status = 'open')) as needs_topic
    from mkt_contents c where tenant = ${t} and auto and not is_test and (produced_at is null and status = 'draft' or produced_at >= now() - interval '24 hours') order by coalesce(produced_at, produce_at) desc nulls last limit 12`;
  const docs = await sql<any[]>`select id, title, status, run_after, created_at, finished_at from ai_doc_jobs where tenant = ${t} and user_id = ${u.id} and (status in ('queued', 'running') or finished_at >= now() - interval '24 hours') order by created_at desc limit 8`;
  const plans = await sql<any[]>`select id, name, status, created_at from mkt_ad_plans where tenant = ${t} and (status = 'draft' or (status in ('created', 'active') and approved_at >= now() - interval '24 hours')) order by created_at desc limit 6`;
  const props = await sql<any[]>`select id, summary, status, created_at from ai_proposals where tenant = ${t} and user_id = ${u.id} and status = 'pending' and kind in ('sms', 'quote', 'send_sms', 'send_mail') order by created_at desc limit 4`;
  type Q = { kind: 'content' | 'doc' | 'adplan' | 'proposal'; id: string; title: string; state: 'waiting' | 'running' | 'done'; at: string | null; href: string; night: boolean; canRun: boolean; canNight: boolean; note?: string };
  const q: Q[] = [
    ...contents.map((c): Q => ({ kind: 'content', id: c.id, title: c.title, href: c.produced_at ? `/s/marketing/approvals?c=${c.id}` : '/s/marketing/automation', night: !!c.night_run,
      state: c.produced_at ? 'done' : c.needs_topic ? 'waiting' : c.produce_at && new Date(c.produce_at) <= new Date() ? 'running' : 'waiting', at: c.produced_at ?? c.produce_at ?? null,
      canRun: admin && !c.produced_at && !c.needs_topic, canNight: admin && !c.produced_at && !c.needs_topic && !c.night_run, note: c.needs_topic ? '주제 필요' : undefined })),
    ...docs.map((d): Q => ({ kind: 'doc', id: d.id, title: `문서: ${d.title}`, href: '/assistant?space=marketing', night: !!d.run_after, state: d.status === 'running' ? 'running' : d.status === 'queued' ? 'waiting' : 'done', at: d.finished_at ?? d.created_at,
      canRun: d.status === 'queued', canNight: d.status === 'queued' && !d.run_after, note: d.status === 'failed' ? '실패' : undefined })),
    ...plans.map((p): Q => ({ kind: 'adplan', id: p.id, title: `광고 세팅안: ${p.name}`, href: '/s/marketing/ad-ops', night: false, state: p.status === 'draft' ? 'waiting' : 'done', at: p.created_at, canRun: false, canNight: false, note: p.status === 'draft' ? '대표 승인 필요' : undefined })),
    ...props.map((p): Q => ({ kind: 'proposal', id: p.id, title: p.summary, href: '/assistant?space=marketing', night: false, state: 'waiting', at: p.created_at, canRun: false, canNight: false, note: '사람이 [보내기]' })),
  ];
  const order = { running: 0, waiting: 1, done: 2 };
  const queue = q.sort((a, b) => order[a.state] - order[b.state] || String(b.at ?? '').localeCompare(String(a.at ?? ''))).slice(0, 8);
  // 🌙 밤사이 결과: 어젯밤 22시 ~ 오늘 08시 사이에 만들어진 자동 시안·문서
  const nightFrom = new Date(`${ymd(new Date(Date.now() - 864e5))}T22:00:00+09:00`), nightTo = new Date(`${ymd(new Date())}T08:00:00+09:00`);
  const night = await sql<any[]>`select id, title, 'content' as kind from mkt_contents where tenant = ${t} and auto and not is_test and produced_at between ${nightFrom} and ${nightTo}
    union all select id, title, 'doc' from ai_doc_jobs where tenant = ${t} and user_id = ${u.id} and status = 'done' and finished_at between ${nightFrom} and ${nightTo} limit 10`;
  // 4 이번 주 게시 줄: 7일 × 채널 점
  const weekRows = await sql<any[]>`select c.id, c.channel, c.status, (c.scheduled_at at time zone 'Asia/Seoul')::date::text as day, c.title from mkt_contents c
    where c.tenant = ${t} and not c.is_test and c.status in ('pending', 'changes', 'approved', 'published', 'hold')
      and (c.scheduled_at at time zone 'Asia/Seoul')::date between (now() at time zone 'Asia/Seoul')::date and (now() at time zone 'Asia/Seoul')::date + 6 order by c.scheduled_at`;
  const week = Array.from({ length: 7 }, (_, i) => { const d = ymd(new Date(Date.now() + i * 864e5)); return { day: d, posts: weekRows.filter((r) => r.day === d).map((r) => ({ id: r.id, channel: r.channel, status: r.status, title: r.title })) }; });
  // 5 성과 7일(일별 광고비·클릭·문의) + 광고 카드(캠페인 켜짐/꺼짐·월 상한·오늘 지출·캠페인별 CTR/CPC·개선안 수)
  const daily = await sql<{ day: string; cost: number; clicks: number }[]>`select s.day::text as day, sum(s.cost_krw)::float8 as cost, sum(s.clicks)::float8 as clicks from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6 group by s.day`;
  const callsDaily = await sql<{ day: string; n: number }[]>`select (called_at at time zone 'Asia/Seoul')::date::text as day, count(*)::int as n from mkt_calls where tenant = ${t} and called_at >= now() - interval '7 days' group by 1`;
  const perf = Array.from({ length: 7 }, (_, i) => { const d = ymd(new Date(Date.now() - (6 - i) * 864e5)); const r = daily.find((x) => x.day === d); return { day: d, cost: r?.cost ?? 0, clicks: r?.clicks ?? 0, calls: callsDaily.find((x) => x.day === d)?.n ?? 0 }; });
  const camps = await sql<any[]>`select s.campaign_id, max(s.campaign_name) as name, sum(s.impressions)::float8 as imp, sum(s.clicks)::float8 as clicks, sum(s.cost_krw)::float8 as cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6 group by s.campaign_id order by sum(s.cost_krw) desc limit 5`;
  const [plansOn] = await sql<{ on: number; off: number }[]>`select count(*) filter (where status = 'active')::int as "on", count(*) filter (where status = 'paused')::int as off from mkt_ad_plans where tenant = ${t}`;
  const [cap] = await sql<{ monthly_cap: string; stopped_month: string | null }[]>`select monthly_cap, stopped_month from mkt_ad_caps where tenant = ${t}`;
  const ads = ad.accounts > 0 ? { accounts: ad.accounts, on: plansOn.on, off: plansOn.off, monthlyCap: cap ? Number(cap.monthly_cap) : null, stopped: !!cap?.stopped_month, today: ad.today, suggestions: adp.n,
    campaigns: camps.map((c) => ({ id: c.campaign_id, name: c.name || c.campaign_id, ctr: c.imp ? Math.round((c.clicks / c.imp) * 10000) / 100 : null, cpc: c.clicks ? Math.round(c.cost / c.clicks) : null, cost: c.cost })) } : null;
  // 6 최근 게시물 6(썸네일) + 다음 할 일 제안 5
  const recent = await sql<any[]>`select c.id, c.title, c.channel, c.kind, c.published_at, c.published_url, v.media_ids[1]::text as media from mkt_contents c
    left join mkt_versions v on v.content_id = c.id and v.version = coalesce(c.approved_version, c.current_version)
    where c.tenant = ${t} and not c.is_test and c.status = 'published' order by c.published_at desc nulls last limit 6`;
  const [nomedia] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_contents c left join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${t} and not c.is_test and c.status in ('pending', 'approved') and c.channel <> 'blog' and c.scheduled_at between now() and now() + interval '7 days' and cardinality(coalesce(v.media_ids, '{}')) = 0`;
  const [topic] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_production_requests q join mkt_contents c on c.id = q.content_id where c.tenant = ${t} and q.kind = 'topic' and q.status = 'open'`;
  const drop = await sql<any[]>`with x as (select s.campaign_id, max(s.campaign_name) as name,
      sum(s.clicks) filter (where s.day >= (now() at time zone 'Asia/Seoul')::date - 2)::float8 as c3, sum(s.impressions) filter (where s.day >= (now() at time zone 'Asia/Seoul')::date - 2)::float8 as i3,
      sum(s.clicks) filter (where s.day < (now() at time zone 'Asia/Seoul')::date - 2)::float8 as c4, sum(s.impressions) filter (where s.day < (now() at time zone 'Asia/Seoul')::date - 2)::float8 as i4
      from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= (now() at time zone 'Asia/Seoul')::date - 6 group by s.campaign_id)
    select name from x where i3 >= 200 and i4 >= 200 and (c3 / i3) < (c4 / i4) * 0.7 limit 2`;
  const channels = await homeChannels(u);
  const broken = channels.filter((c) => c.state === 'broken');
  const suggestions: { key: string; title: string; detail: string; href: string }[] = [];
  if (approvable) suggestions.push({ key: 'approve', title: `승인 대기 ${approvable}건 처리`, detail: '마감 전에 승인하면 예정 시각에 게시됩니다', href: '/s/marketing/approvals' });
  if (nomedia.n) suggestions.push({ key: 'media', title: `시안(이미지·영상) 없는 예정 게시 ${nomedia.n}건`, detail: '이번 주 게시인데 미디어가 비어 있습니다', href: '/s/marketing/calendar' });
  for (const d of drop) suggestions.push({ key: `drop:${d.name}`, title: `하락 소재 점검: ${d.name}`, detail: '최근 3일 클릭률이 그 전보다 30% 넘게 떨어졌습니다', href: '/s/marketing/ads' });
  if (calls.open) suggestions.push({ key: 'calls', title: `미응답 문의 ${calls.open}건`, detail: '전화 문의를 리드로 넘기거나 제외로 정리', href: '/s/marketing/calls' });
  for (const c of broken) suggestions.push({ key: `broken:${c.key}`, title: `${c.label} 연결 다시`, detail: c.error ?? '토큰이 만료됐거나 권한이 바뀌었습니다', href: '/s/marketing/connections' });
  if (topic.n) suggestions.push({ key: 'topic', title: `자동 제작 주제 필요 ${topic.n}건`, detail: '재료가 없어 시안을 만들지 못했습니다 — 주제를 적어 주세요', href: '/s/marketing/automation' });
  const { aiSettings } = await import('./ai/threads');
  const nightScope = (await aiSettings(t)).night_scope ?? {};
  return { canEdit: admin, cards: await cardsOf(u), kpi, approve, approvalHour: now.approvalHour, queue, night, nightScope, week, perf, ads, recent, suggestions: suggestions.slice(0, 5), channels, cardLabels: HOME_CARD_LABEL };
}

export const homeAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run'), kind: z.enum(['content', 'doc']), id: zUuid }),
  z.object({ action: z.literal('night'), kind: z.enum(['content', 'doc']), id: zUuid }),
  z.object({ action: z.literal('task'), keys: z.array(z.string().max(80)).min(1).max(5), assigneeId: zUuid.nullable().optional() }),
  z.object({ action: z.literal('cards'), cards: z.array(z.enum(HOME_CARDS)).max(HOME_CARDS.length), company: z.boolean().optional() }),
]);
export async function homeAct(u: SessionUser, i: z.infer<typeof homeAction>) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  if (i.action === 'run' || i.action === 'night') {
    if (i.kind === 'content') {
      if (!isAdmin(u)) throw forbidden('자동 제작 실행은 관리자만');
      const [c] = await sql<any[]>`select * from mkt_contents where id = ${i.id} and tenant = ${t} and auto`;
      if (!c) throw notFound('시안이 없습니다');
      if (c.produced_at) throw badRequest('이미 만들어진 시안입니다');
      if (i.action === 'night') { await sql`update mkt_contents set produce_at = ${nextNight()}, night_run = true, updated_at = now() where id = ${c.id}`; return { ok: true, at: nextNight().toISOString() }; }
      const r = await (await import('./mktAuto')).produceContent(c, u.id);
      return { ok: true, ...r };
    }
    const [d] = await sql<any[]>`select id, status, run_after from ai_doc_jobs where id = ${i.id} and tenant = ${t} and user_id = ${u.id}`;
    if (!d) throw notFound('문서 작업이 없습니다');
    if (d.status !== 'queued') throw badRequest('대기 중인 작업만 바꿀 수 있습니다');
    if (i.action === 'night') { await sql`update ai_doc_jobs set run_after = ${nextNight()} where id = ${d.id}`; return { ok: true, at: nextNight().toISOString() }; }
    await sql`update ai_doc_jobs set run_after = null where id = ${d.id}`;
    await (await import('./ai/docEngine')).processDocJob(d.id);
    return { ok: true };
  }
  if (i.action === 'task') {
    const v = await homeView(u);
    const picked = v.suggestions.filter((s) => i.keys.includes(s.key));
    if (!picked.length) throw badRequest('제안이 바뀌었습니다 — 다시 골라 주세요');
    const { createTask } = await import('./tasks');
    const ids: string[] = [];
    for (const s of picked) { const r: any = await createTask(u, { title: s.title, description: `${s.detail}\n${s.href}`, space: 'marketing', assigneeId: i.assigneeId ?? u.id } as any, { quiet: true }); ids.push(r?.id ?? r?.task?.id ?? ''); }
    return { ok: true, ids, count: picked.length };
  }
  // cards: 사람별 덮어쓰기(빈 목록 = 회사 기본으로 되돌림), 관리자는 회사 기본으로도
  if (i.company) {
    if (!isAdmin(u)) throw forbidden('회사 기본은 관리자만');
    await sql`insert into app_settings (key, value) values (${`mkt_home_cards:${t}`}, ${sql.json(i.cards as never)}) on conflict (key) do update set value = excluded.value`;
    await sql`insert into user_settings (user_id, mkt_home_cards) values (${u.id}, null) on conflict (user_id) do update set mkt_home_cards = null`;
  } else {
    await sql`insert into user_settings (user_id, mkt_home_cards) values (${u.id}, ${i.cards.length ? sql.json(i.cards as never) : null}) on conflict (user_id) do update set mkt_home_cards = excluded.mkt_home_cards`;
  }
  return { ok: true, ...(await cardsOf(u)) };
}

/** 밤사이 비서(정기 실행): 22시~06시(KST), night_scope.draft 켠 회사만 — 3일 안에 게시할 자동 시안을 미리 만든다(만든 건 night_run 표시 → 아침 홈 '🌙 밤사이 결과'·브리핑). 돈·외부 발송 없음 */
export async function nightAssistantTick() {
  const h = hourKst();
  if (h < 22 && h >= 6) return { skipped: 'day' };
  const sql = db();
  const ts = await sql<{ tenant: string }[]>`select tenant from ai_settings where coalesce((night_scope->>'draft')::boolean, false) limit 5`;
  const out: { tenant: string; produced: number }[] = [];
  const { produceContent } = await import('./mktAuto');
  for (const { tenant } of ts) {
    const due = await sql<any[]>`select * from mkt_contents where tenant = ${tenant} and auto and status = 'draft' and produced_at is null and not is_test
      and scheduled_at between now() and now() + interval '3 days'
      and not exists (select 1 from mkt_production_requests q where q.content_id = mkt_contents.id and q.kind = 'topic' and q.status = 'open') order by scheduled_at limit 3`;
    let n = 0;
    for (const c of due) {
      await sql`update mkt_contents set night_run = true where id = ${c.id}`;
      const r: any = await produceContent(c).catch((e) => ({ error: String(e?.message ?? e), quota: e?.code === 'ai_quota' || e?.code === 'mkt_ai_quota' || e?.code === 'ai_credit' }));
      if (r?.error) { await sql`update mkt_contents set night_run = false where id = ${c.id}`; if (r.quota) break; continue; }
      n++;
    }
    out.push({ tenant, produced: n });
  }
  return out;
}
