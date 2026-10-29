/**
 * 255차 #793(대표 10/29 01:45 '마케팅실 AI 가 현 문제 파악을 못함 — 승인함에 승인 대기가 하나도 없다고 했더니 승인함을 조회할 도구가 없다'):
 * AI 마케터가 직접 읽는 운영 상태 — 승인함 현황(종류별 수·숨겨진 것·이유) · 콘텐츠 상태(상태·버전·게시일·마지막 결정·의견·수정본·제작 요청) · 자동 제작 상태(일시정지·언제·누가·다음 제작·남은 크레딧).
 * 화면과 같은 계산(승인 가능 = 승인 대기·시험 아님 — 게시일이 지난 것도, 승인하면 다음 빈 칸으로). 읽기만 하고 아무것도 바꾸지 않는다
 */
import { db } from './db';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';

const VIDEO = ['reels', 'shorts', 'video'];
const KST = (d: Date | string | null) => (d ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d)) : null);
const STATUS: Record<string, string> = { pending: '승인 대기', changes: '수정 요청', hold: '보류', approved: '승인됨', published: '게시됨', draft: '초안', canceled: '취소' };
type Row = { id: string; title: string; status: string; channel: string; kind: string | null; auto: boolean; scheduled_at: Date | null; quality: any; brand: string | null; media: number; current_version: number;
  revision: any; last: { decision: string; comment: string | null; version: number; at: string; by: string | null } | null; production: { id: string; kind: string; status: string; reason: string | null; est: number } | null };

async function rowsOf(t: string, where = db()`true`): Promise<Row[]> {
  return db()<Row[]>`select c.id, c.title, c.status, c.channel, c.kind, c.auto, c.scheduled_at, c.quality, b.name as brand, coalesce(cardinality(v.media_ids), 0)::int as media, c.current_version, v.revision,
      (select json_build_object('decision', d.decision, 'comment', d.comment, 'version', d.version, 'at', d.decided_at, 'by', du.name) from mkt_decisions d left join users du on du.id = d.decided_by where d.content_id = c.id order by d.decided_at desc limit 1) as last,
      (select json_build_object('id', p.id, 'kind', p.kind, 'status', p.status, 'reason', p.reason, 'est', p.est_credits) from mkt_production_requests p where p.content_id = c.id and p.status in ('open', 'needs_approval') order by p.created_at desc limit 1) as production
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id left join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${t} and not c.is_test and c.deleted_at is null and ${where} order by c.scheduled_at nulls last limit 300`;
}
/** 수정 요청을 받았는데 AI 수정본·제작 요청 카드가 아직 없는 글(255차 전에는 사람이 쓴 글은 수정본을 만들지 않았음) */
const unprocessed = (r: Row) => r.status === 'changes' && r.last?.decision === 'changes' && r.last.version === r.current_version && !r.production;

export async function inboxStatus(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const A = await import('./mktAuto'); const M = await import('./marketing');
  const s = await A.settingsOf(t); const now = Date.now();
  const rows = await rowsOf(t, sql`c.status in ('pending', 'changes', 'hold', 'draft', 'approved')`);
  const late = (r: Row) => !!r.scheduled_at && (M.approvalDeadline(r.scheduled_at, s)?.getTime() ?? Infinity) < now;
  const noVisual = (r: Row) => !r.media && r.channel !== 'threads';
  const pending = rows.filter((r) => r.status === 'pending');
  const approvable = pending.filter((r) => !noVisual(r));
  const changes = rows.filter((r) => r.status === 'changes');
  const postponed = rows.filter((r) => r.status === 'hold' && r.quality?.postponed);
  const hold = rows.filter((r) => r.status === 'hold' && !r.quality?.postponed);
  const held = rows.filter((r) => r.status === 'draft' && r.quality?.held);
  const batchWait = rows.filter((r) => r.status === 'draft' && r.quality?.batch && !r.quality.batch.released); // 267차 #795 묶음 올리는 때를 기다리는 원고
  const planned = rows.filter((r) => r.status === 'draft' && !r.quality?.held && r.scheduled_at && new Date(r.scheduled_at).getTime() > now);
  const approved = rows.filter((r) => r.status === 'approved');
  const approvedPast = approved.filter((r) => r.scheduled_at && new Date(r.scheduled_at).getTime() < now - 864e5);
  const [o] = await sql<{ proposals: number; budgets: number; goals: number; briefs: number; requests: number; asks: number }[]>`select
      (select count(*)::int from mkt_proposals where tenant = ${t} and status = 'pending') as proposals, (select count(*)::int from mkt_ad_budgets where tenant = ${t} and status = 'pending') as budgets,
      (select count(*)::int from mkt_goals where tenant = ${t} and status = 'pending') as goals, (select count(*)::int from mkt_briefs where tenant = ${t} and status in ('ready', 'failed')) as briefs,
      (select count(*)::int from mkt_production_requests where tenant = ${t} and status = 'open') as requests, (select count(*)::int from mkt_production_requests where tenant = ${t} and status = 'needs_approval') as asks`;
  const why: string[] = [];
  if (!approvable.length) why.push('승인할 시안이 0건입니다');
  if (pending.some(late)) why.push(`게시일(승인 마감)이 지난 승인 대기 ${pending.filter(late).length}건 — 승인함에 '게시일 지남'으로 보이고, 승인하면 가장 가까운 빈 게시 칸으로 옮겨 게시합니다`);
  if (pending.some(noVisual)) why.push(`시안(사진·영상)이 없어 승인 숫자에서 뺀 글 ${pending.filter(noVisual).length}건 — 승인함 '시안 없음' 칸의 [지금 만들기]`);
  if (s.auto_pause) why.push('자동 제작 일시정지 중 — 정기 칸·자동 제작·밤사이·주간 계획·운영 제안이 멈춰 새 시안이 올라오지 않습니다(다시 켜기는 대표 결정)');
  if (changes.some(unprocessed)) why.push(`수정 요청 ${changes.filter(unprocessed).length}건이 아직 AI 수정본으로 안 만들어짐 — 승인함 카드의 [AI 수정본 만들기]`);
  if (changes.some((r) => r.production?.status === 'needs_approval')) why.push(`영상·AI 이미지 다시 만들기 ${changes.filter((r) => r.production?.status === 'needs_approval').length}건이 비용 승인을 기다림`);
  if (held.length) why.push(`초안 보관 ${held.length}건(브랜드 템플릿 전 자동 시안 — 승인함에 올리지 않음)`);
  if (batchWait.length) { const at = A.batchAtOf(String(batchWait[0].quality.batch.week), s); why.push(`주 단위 묶음으로 올릴 원고 ${batchWait.length}건이 준비됨 — ${at.getTime() > now ? `${KST(at.toISOString())}에` : '그 주 원고가 다 만들어지면(늦어도 2시간 안)'} 한 번에 승인함으로 올라옵니다`); }
  if (postponed.length) why.push(`미뤄진 글 ${postponed.length}건(옮길 날짜가 없어 멈춤 — 날짜를 골라 다시 올리기)`);
  const brief = (r: Row) => ({ id: r.id, title: r.title, brand: r.brand, status: STATUS[r.status] ?? r.status, format: VIDEO.includes(r.kind ?? '') ? `${r.channel} 영상(${r.kind})` : `${r.channel}${r.kind ? ` ${r.kind}` : ''}`,
    version: r.current_version, scheduled: KST(r.scheduled_at), late: late(r), media: r.media, link: `/s/marketing/approvals?c=${r.id}` });
  return {
    counts: { approvable: approvable.length, approvableLate: approvable.filter(late).length, noVisual: pending.filter(noVisual).length, changes: changes.length, changesUnprocessed: changes.filter(unprocessed).length,
      hold: hold.length, postponed: postponed.length, heldDrafts: held.length, batchWaiting: batchWait.length, plannedDrafts: planned.length, approvedNotPublished: approved.length, approvedPastDue: approvedPast.length,
      productionOpen: o.requests, productionNeedsApproval: o.asks, proposals: o.proposals, budgets: o.budgets, goals: o.goals, briefs: o.briefs },
    autoPaused: !!s.auto_pause, why,
    approvable: approvable.slice(0, 10).map(brief), changes: changes.slice(0, 10).map((r) => ({ ...brief(r), request: r.last?.decision === 'changes' ? r.last.comment : null, aiRevisionPending: unprocessed(r), production: r.production })),
    note: '숫자는 승인함 화면과 같은 계산입니다. 승인·수정 요청은 화면의 승인함에서 사람이 합니다.',
  };
}

export async function contentStatus(u: SessionUser, q: string, limit = 5) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db(); const term = q.trim();
  const A = await import('./mktAuto'); const M = await import('./marketing'); const s = await A.settingsOf(t);
  const where = /^[0-9a-f-]{36}$/i.test(term) ? sql`c.id = ${term}` : term ? sql`c.title ilike ${'%' + term.replace(/[%_\\]/g, '\\$&') + '%'}` : sql`c.status in ('pending', 'changes')`;
  const rows = (await rowsOf(t, where)).slice(0, Math.min(10, Math.max(1, limit)));
  return { items: rows.map((r) => {
    const dl = r.scheduled_at ? M.approvalDeadline(r.scheduled_at, s) : null;
    return { id: r.id, title: r.title, brand: r.brand, channel: r.channel, kind: r.kind, auto: r.auto, status: STATUS[r.status] ?? r.status, version: r.current_version, media: r.media,
      scheduled: KST(r.scheduled_at), approvalDeadline: KST(dl), late: !!dl && dl.getTime() < Date.now() && ['pending', 'changes'].includes(r.status),
      lastDecision: r.last ? { decision: ({ approve: '승인', changes: '수정 요청', hold: '보류' } as Record<string, string>)[r.last.decision] ?? r.last.decision, comment: r.last.comment, version: r.last.version, at: KST(r.last.at), by: r.last.by } : null,
      aiRevision: r.revision?.ai ? { n: r.revision.n, request: r.revision.request, result: r.revision.check?.status ?? null, detail: r.revision.check?.detail ?? null } : null,
      aiRevisionPending: unprocessed(r), production: r.production, issues: r.quality?.passed === false ? (r.quality.issues ?? []).slice(0, 4) : [],
      rescheduled: r.quality?.rescheduled ? { from: KST(r.quality.rescheduled.from), to: KST(r.quality.rescheduled.to) } : null, link: `/s/marketing/approvals?c=${r.id}` };
  }), total: rows.length };
}

/** 267차: AI 마케터 '자동 제작 상태' — 승인 올리는 방식·다음 묶음·이번 주(월~일) 승인 마감 */
async function rhythmOf(t: string, s: Awaited<ReturnType<typeof import('./mktAuto')['settingsOf']>>, A: typeof import('./mktAuto')) {
  const nb = A.nextBatch(s);
  const week = A.weekOf(new Date());
  const rows = await db()<{ title: string; scheduled_at: string; status: string }[]>`select title, scheduled_at, status from mkt_contents where tenant = ${t} and not is_test and deleted_at is null
    and status in ('pending', 'changes') and scheduled_at > now() and (scheduled_at at time zone 'Asia/Seoul')::date between ${week}::date and ${week}::date + 6 order by scheduled_at limit 20`;
  return { mode: s.approval_mode === 'weekly' ? `주 단위 묶음 — 매주 ${A.DOW[s.batch_dow]} ${s.batch_hour}:00 에 다음 주(월~일) 게시분을 한 번에 올림` : `게시 ${s.lead_days}일 전 ${s.lead_hour}:00 에 한 건씩`,
    nextBatch: nb ? { at: KST(nb.at.toISOString()), posts: nb.label } : null, deadlineRule: `승인 마감 ${A.deadlineRule(s)} · 마감을 넘긴 글은 그 글만 다음 빈 칸으로 미루고 알림${s.approval_mode === 'weekly' ? ' · 게시 3일 안 남았는데 승인 안 된 글은 한 번 알림' : ''}`,
    thisWeek: { awaiting: rows.length, deadlines: rows.slice(0, 8).map((r) => ({ title: r.title, scheduled: KST(r.scheduled_at), deadline: KST(A.deadlineOf(r.scheduled_at, s).toISOString()), status: STATUS[r.status] ?? r.status })) } };
}
export async function autoStatus(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const A = await import('./mktAuto'); const s = await A.settingsOf(t);
  const [last] = await sql<{ action: string; at: string; by: string | null }[]>`select l.action, l.created_at as at, u.name as by from audit_logs l left join users u on u.id = l.actor_id
    where l.action in ('mkt.auto_pause', 'mkt.auto_resume') and l.target_id = ${t} order by l.created_at desc limit 1`;
  const [n] = await sql<{ next: string | null; planned: number; produced: string | null; rules: number }[]>`select
      (select min(produce_at) from mkt_contents where tenant = ${t} and auto and status = 'draft' and produced_at is null and produce_at is not null and not is_test) as next,
      (select count(*)::int from mkt_contents where tenant = ${t} and auto and status = 'draft' and produced_at is null and scheduled_at between now() and now() + interval '7 days' and not is_test) as planned,
      (select max(produced_at) from mkt_contents where tenant = ${t} and auto and not is_test) as produced,
      (select count(*)::int from mkt_rules where tenant = ${t} and active) as rules`;
  const left = await A.productionLeft(t);
  const wm = await A.writeModelInfo(s);
  return {
    paused: !!s.auto_pause,
    pausedSince: s.auto_pause ? (last?.action === 'mkt.auto_pause' ? { at: KST(last.at), by: last.by } : { at: '10/25 22:20', by: null, decision: '대표 결정 15-16(전면 디벨롭 동안 자동 생성 멈춤 → 대표 방향 검토 뒤 다시 켬) — 203 마이그레이션으로 켜짐' }) : null,
    resumedAt: !s.auto_pause && last?.action === 'mkt.auto_resume' ? { at: KST(last.at), by: last.by } : null,
    whilePaused: s.auto_pause ? '정기 칸·자동 제작·밤사이 제작·주간 계획·운영 제안 카드가 멈춤(소진율·충전 감시와 사람이 누르는 제작·수정 요청은 그대로)' : null,
    videoPaused: !!s.video_pause, activeRules: n.rules, nextProduction: s.auto_pause ? null : KST(n.next), plannedNext7Days: n.planned, lastProduced: KST(n.produced),
    writeModel: wm.label, revisionModel: '수정 요청 수정본은 최상 모델(deep)로 다시 씀',
    // 267차(대표 #795): 승인 올리는 방식 · 다음 묶음 올리는 때 · 승인 마감 규칙 · 이번 주 승인 마감
    approvalRhythm: await rhythmOf(t, s, A),
    left: { credits: left.leftCredits, videos: left.videosLeft, regens: left.regensLeft, over: left.overMessage },
  };
}
