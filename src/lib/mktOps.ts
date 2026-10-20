import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { notify } from './notifications';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { monthKst, numbersOf, ymd } from './mktGoals';

/**
 * 대표 10/20 20:00 ① 마케팅 운영실 = AI 마케터(30년차)가 운영 전체를 맡되, 분석·방향·협업·인플루언서·계획은 전부 '승인 요청 카드'로 올리고 대표가 승인해야 실행(돈·외부 발송은 사람이).
 * ② 광고실: 채널별(네이버 검색·파워링크 / Google / 유튜브 / 인스타·메타) 월 예산 계획 → 승인 → 집행(연결된 네이버 캠페인 하루 예산, 나머지는 안내) + 소진율로 '충전 필요' 알림(충전은 대표).
 * ③ 월 매출 목표 vs 실적: 실적 = 영업 계약 등록 금액 + (플랫폼 회사) 워크인 결제. CAC·ROI 는 월간 보고에.
 */
export const PROPOSAL_KIND: Record<string, string> = { direction: '게시 방향', collab: '협업 제안', influencer: '인플루언서', analysis: '광고 효과 분석', plan: '향후 계획' };
export const AD_CH: Record<string, { label: string; charge: string; provider: 'naver' | 'google' | 'meta' | null }> = {
  naver: { label: '네이버 검색·파워링크', charge: 'https://searchad.naver.com/', provider: 'naver' }, google: { label: 'Google 검색·디스플레이', charge: 'https://ads.google.com/aw/billing', provider: 'google' },
  youtube: { label: '유튜브(Google Ads)', charge: 'https://ads.google.com/aw/billing', provider: 'google' }, meta: { label: '인스타·페이스북(Meta)', charge: 'https://business.facebook.com/billing', provider: 'meta' },
};
const lastDayOf = (month: string) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

/** 지난 30일·이달 숫자 묶음(AI 재료·기본 제안 공용) */
async function material(tenant: string) {
  const sql = db(); const td = ymd(new Date()); const d30 = ymd(new Date(Date.now() - 30 * 864e5));
  const last30 = await numbersOf(tenant, d30, td);
  const byProvider = await sql<{ provider: string; cost: number; clicks: number; impressions: number; conversions: number }[]>`select a.provider, coalesce(sum(s.cost_krw), 0)::float8 cost, coalesce(sum(s.clicks), 0)::float8 clicks, coalesce(sum(s.impressions), 0)::float8 impressions, coalesce(sum(s.conversions), 0)::float8 conversions
    from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day >= ${d30}::date group by a.provider`;
  const campaigns = await sql<{ provider: string; name: string; cost: number; clicks: number; impressions: number }[]>`select a.provider, max(s.campaign_name) as name, sum(s.cost_krw)::float8 cost, sum(s.clicks)::float8 clicks, sum(s.impressions)::float8 impressions
    from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day >= ${d30}::date group by a.provider, s.campaign_id order by sum(s.cost_krw) desc limit 8`;
  const brands = await sql<any[]>`select name, intro, products, tone, weekly_topic from mkt_brands where tenant = ${tenant} order by name`;
  const channels = await sql<{ channel: string; enabled: boolean }[]>`select channel, enabled from mkt_channel_settings where tenant = ${tenant}`;
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant } as SessionUser).catch(() => ({} as any));
  const goal = await sql<any[]>`select goals, weekly from mkt_goals where tenant = ${tenant} and month = ${monthKst()} and status in ('approved', 'pending') order by (status = 'approved') desc limit 1`;
  const top = await sql<{ title: string; channel: string }[]>`select title, channel from mkt_contents where tenant = ${tenant} and not is_test and status = 'published' order by published_at desc nulls last limit 6`;
  const text = [`회사: ${co?.name ?? ''}${co?.industries?.length ? ` (${co.industries.join('·')})` : ''}`, co?.business ? `사업: ${co.business}` : '', co?.customers ? `주요 고객: ${co.customers}` : '',
    brands.length ? `브랜드: ${brands.map((b) => `${b.name}${b.intro ? ` — ${String(b.intro).slice(0, 80)}` : ''}`).join(' / ')}` : '', channels.length ? `채널: ${channels.map((c) => `${c.channel}${c.enabled ? '' : '(끔)'}`).join(', ')}` : '',
    `지난 30일: 게시 ${last30.posts}건(${Object.entries(last30.byChannel).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}), 전화 문의 ${last30.inquiries}건, 광고비 ${won(last30.adCost)}, 클릭 ${last30.clicks}`,
    byProvider.length ? `매체별 30일: ${byProvider.map((p) => `${p.provider} ${won(p.cost)} 클릭 ${p.clicks} CPC ${p.clicks ? won(p.cost / p.clicks) : '-'} 전환 ${p.conversions}`).join(' / ')}` : '광고 계정 연결 없음',
    campaigns.length ? `캠페인 상위: ${campaigns.map((c) => `${c.name ?? '(이름 없음)'} ${won(c.cost)} CTR ${c.impressions ? Math.round((c.clicks / c.impressions) * 1000) / 10 : 0}%`).join(' / ')}` : '',
    goal[0] ? `이달 운영 목표: ${(goal[0].goals?.objectives ?? []).join(' / ')}` : '', top.length ? `최근 게시: ${top.map((t) => t.title).join(' · ')}` : ''].filter(Boolean).join('\n');
  return { last30, byProvider, campaigns, brands, co, goal: goal[0] ?? null, text };
}

async function aiJson(tenant: string, actorId: string | null, system: string, user: string, format: any, purpose: string) {
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) return null;
  const { assertMktAi } = await import('./mktAuto'); await assertMktAi(tenant);
  const p = P.anthropicProvider({ tier: 'default' });
  const r = await p.chat({ system, tools: [], messages: [{ role: 'user', content: user }], format });
  await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, ${purpose})`;
  return JSON.parse((r.content as any[]).filter((x) => x.type === 'text').map((x) => x.text).join(''));
}

// ---------------- ① 승인 요청 카드 ----------------
export const proposeInput = z.object({ kinds: z.array(z.enum(['direction', 'collab', 'influencer', 'analysis', 'plan'])).min(1).max(5).default(['analysis', 'direction']) });
/** AI 마케터 제안: 종류별 카드 1장씩(pending). AI 없으면 숫자로 만든 기본 분석 카드 */
export async function propose(tenant: string, kinds: string[], actorId: string | null) {
  const sql = db(); const m = await material(tenant);
  const existing = await sql<{ kind: string }[]>`select kind from mkt_proposals where tenant = ${tenant} and status = 'pending'`;
  const want = kinds.filter((k) => !existing.some((e) => e.kind === k));
  if (!want.length) return { created: 0, skipped: kinds };
  let cards: any[] = [];
  try {
    const o = await aiJson(tenant, actorId, `당신은 경력 30년의 마케터입니다. 회사 상황을 보고 아래 종류의 운영 제안 카드를 씁니다. JSON 만. 사실·숫자는 [재료]에 있는 것만, 없으면 '확인 필요'라고 씁니다. 돈을 쓰거나 밖으로 보내는 일은 모두 '대표 승인 뒤 사람이 실행'이 전제이므로 실행 단계를 구체적으로(누가·무엇을) 씁니다. 과장·최상급 금지.
종류: direction=게시 방향(채널·주제·빈도), collab=협업 제안(업체·기관, 이유·접근 방법), influencer=인플루언서 제안(규모·분야·조건·예산 범위), analysis=광고 효과 분석(지표·문제·개선안), plan=향후 계획(4주, 단계별).
각 카드: {kind, title(한 줄), summary(2~3문장), items[{title, detail, expected(기대 효과), cost(비용·'없음'|'확인 필요')}] 3~5개, rationale(근거 한 문단)}`,
      `[재료]\n${m.text}\n\n만들 종류: ${want.join(', ')}`,
      { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kind', 'title', 'summary', 'items', 'rationale'], properties: { kind: { type: 'string' }, title: { type: 'string' }, summary: { type: 'string' }, rationale: { type: 'string' },
        items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'detail', 'expected', 'cost'], properties: { title: { type: 'string' }, detail: { type: 'string' }, expected: { type: 'string' }, cost: { type: 'string' } } } } } } } } }, 'marketing_ops');
    cards = (o?.cards ?? []).filter((c: any) => want.includes(c.kind)).map((c: any) => ({ ...c, source: 'ai' }));
  } catch { /* 기본 카드 */ }
  for (const k of want) if (!cards.some((c) => c.kind === k)) cards.push(templateCard(k, m));
  let created = 0;
  for (const c of cards) {
    await sql`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_by) values (${tenant}, ${c.kind}, ${String(c.title).slice(0, 200)}, ${String(c.summary).slice(0, 1000)}, ${sql.json({ items: (c.items ?? []).slice(0, 6), rationale: c.rationale ?? '', numbers: m.last30 } as never)}, ${c.source ?? 'template'}, ${monthKst()}, ${actorId})`;
    created++;
  }
  await notify(sql, { userIds: await (await import('./mktAuto')).approvers(tenant), type: 'review_requested', title: `AI 마케터 승인 요청 ${created}건: ${cards.map((c) => PROPOSAL_KIND[c.kind]).join('·')}`, body: cards[0]?.title ?? '', link: '/s/marketing/ops', entityType: 'mkt_proposal', dedupeKey: `mktops:${tenant}:${ymd(new Date())}` }).catch(() => {});
  return { created, skipped: kinds.filter((k) => !want.includes(k)) };
}
function templateCard(kind: string, m: Awaited<ReturnType<typeof material>>) {
  const n = m.last30; const cpc = n.clicks ? Math.round(n.adCost / n.clicks) : null; const cpi = n.inquiries ? Math.round(n.adCost / n.inquiries) : null;
  const base = { source: 'template', rationale: `지난 30일 게시 ${n.posts}건 · 문의 ${n.inquiries}건 · 광고비 ${won(n.adCost)}${cpc ? ` · CPC ${won(cpc)}` : ''}${cpi ? ` · 문의 1건당 ${won(cpi)}` : ''}` };
  if (kind === 'analysis') return { ...base, kind, title: '지난 30일 광고 효과 점검', summary: `광고비 ${won(n.adCost)}로 클릭 ${n.clicks}·문의 ${n.inquiries}건. ${cpi ? `문의 1건당 ${won(cpi)}` : '문의 추적이 없어 효율을 계산할 수 없음'}.`, items: [{ title: '문의 추적 연결', detail: '전화 문의·폼 문의를 광고 캠페인과 연결(네이버 전환 추적·착신번호)', expected: '문의당 비용이 보임', cost: '없음' }, { title: '소재 2개 비교', detail: '상위 캠페인에 소재 2개를 2주 돌려 CTR 비교', expected: 'CTR 20% 개선', cost: '제작 크레딧' }] };
  if (kind === 'direction') return { ...base, kind, title: '다음 4주 게시 방향', summary: '채널별 역할을 나누고 주 2~3회 꾸준히 — 인스타는 현장·후기, 블로그는 정보성 긴 글, 쇼츠는 15초 장면.', items: [{ title: '인스타 피드 주 2회 + 릴스 주 1회', detail: '현장 사진·고객 질문 답변', expected: '팔로워·문의', cost: '제작 크레딧' }, { title: '블로그 주 1회', detail: '검색 유입 키워드 중심 정보 글(표지+본문 사진)', expected: '검색 유입', cost: '없음' }] };
  if (kind === 'collab') return { ...base, kind, title: '지역 협업 제안(확인 필요)', summary: '같은 고객을 보는 지역 업체·기관과 공동 이벤트·상호 소개.', items: [{ title: '인근 업체 1곳 공동 이벤트', detail: '서로의 고객에게 할인·소개(대상은 대표 확인 필요)', expected: '신규 문의', cost: '확인 필요' }] };
  if (kind === 'influencer') return { ...base, kind, title: '소규모 인플루언서 협업안(확인 필요)', summary: '팔로워 1~5만 지역·분야 인플루언서 1~2명과 체험 콘텐츠.', items: [{ title: '체험 후기 콘텐츠 1건', detail: '무료 이용권 + 소정의 비용, 게시 1회·스토리 2회 조건', expected: '도달·신뢰', cost: '확인 필요' }] };
  return { ...base, kind, title: '향후 4주 계획', summary: '1~2주 제작·게시 안정화, 3주 광고 소재 비교, 4주 리뷰·다음 달 목표.', items: [{ title: '1~2주', detail: '묶음 규칙 게시 빠짐없이 승인', expected: '게시 목표 달성', cost: '없음' }, { title: '3주', detail: '광고 소재 2개 비교', expected: 'CTR 개선', cost: '제작 크레딧' }, { title: '4주', detail: '월간 리뷰·다음 달 목표 초안 승인', expected: '', cost: '없음' }] };
}
export const proposalAction = z.object({ action: z.enum(['approve', 'reject', 'done']), note: z.string().trim().max(500).optional() });
export async function actProposal(u: SessionUser, id: string, i: z.infer<typeof proposalAction>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('대표·관리자만');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [p] = await sql<any[]>`select * from mkt_proposals where id = ${id} and tenant = ${t}`;
  if (!p) throw notFound();
  if (i.action === 'reject') { if (!i.note) throw badRequest('반려 사유를 적어 주세요'); await sql`update mkt_proposals set status = 'rejected', decision_note = ${i.note}, decided_by = ${u.id}, decided_at = now(), updated_at = now() where id = ${id}`; return { status: 'rejected' }; }
  if (i.action === 'done') { if (p.status !== 'approved') throw badRequest('승인된 카드만'); await sql`update mkt_proposals set status = 'done', executed = ${sql.json({ at: new Date().toISOString(), by: u.id, note: i.note ?? null } as never)}, updated_at = now() where id = ${id}`; return { status: 'done' }; }
  if (p.status !== 'pending') throw badRequest('승인 대기 카드만');
  // 승인 뒤 실행: 향후 계획·게시 방향 → 항목마다 제작의뢰실 의뢰(대기)로 넘겨 바로 제작 가능. 협업·인플루언서·분석은 사람이 하는 일 → 업무로 만들어 담당자에게
  const executed: any = { at: new Date().toISOString(), by: u.id, briefs: [] as string[], tasks: [] as string[] };
  if (['plan', 'direction'].includes(p.kind)) {
    for (const it of (p.body?.items ?? []).slice(0, 3)) {
      const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, channel, kind, purpose, message, refs, quantity, status, created_by) values (${t}, 'instagram', 'feed', 'awareness', ${String(it.title ?? p.title).slice(0, 300)}, ${sql.json({ mediaIds: [], contentIds: [], links: [], proposalId: id } as never)}, 1, 'queued', ${u.id}) returning id`;
      executed.briefs.push(b.id);
    }
  } else {
    try { const { createTask } = await import('./tasks');
      const r = await createTask(u, { title: `[마케팅] ${p.title}`, description: `${p.summary}\n\n${(p.body?.items ?? []).map((it: any) => `- ${it.title}: ${it.detail}`).join('\n')}\n\n운영실 카드 /s/marketing/ops`, space: 'marketing', assigneeId: u.id, requestedById: u.id, dueDate: null, approvalRequired: false, tags: ['마케팅', PROPOSAL_KIND[p.kind] ?? p.kind] }, { quiet: false, skipQuota: true });
      executed.tasks.push(r.id);
    } catch (e: any) { executed.taskError = String(e?.message ?? e); }
  }
  await sql`update mkt_proposals set status = 'approved', decision_note = ${i.note ?? null}, decided_by = ${u.id}, decided_at = now(), executed = ${sql.json(executed as never)}, updated_at = now() where id = ${id}`;
  const { audit } = await import('./log'); await audit(sql as never, u.id, 'mkt.proposal_approve', 'mkt_proposal', id, { kind: p.kind }, null).catch(() => {});
  return { status: 'approved', executed };
}

// ---------------- ② 광고 예산 ----------------
export const budgetDraftInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), total: z.number().int().min(0).max(1_000_000_000).optional() });
export async function draftBudget(tenant: string, month: string, actorId: string | null, totalHint?: number) {
  const sql = db(); const m = await material(tenant);
  const accounts = await sql<{ provider: string; n: number }[]>`select provider, count(*)::int n from mkt_ad_accounts where tenant = ${tenant} and status <> 'disconnected' group by provider`;
  const connected = new Set(accounts.map((a) => a.provider));
  const spend = Object.fromEntries(m.byProvider.map((p) => [p.provider, p.cost]));
  const goalBudget = m.goal?.goals?.targets?.adBudget ?? null;
  const total = totalHint ?? goalBudget ?? Math.max(300000, Math.round(Object.values(spend).reduce((a, b) => a + b, 0) * 1.1));
  // 기본 배분: 연결된 매체 실적 비례, 연결 없으면 네이버 50 · 메타 30 · 구글 20
  const base: Record<string, number> = { naver: 0.5, meta: 0.3, google: 0.15, youtube: 0.05 };
  const sum = Object.values(spend).reduce((a, b) => a + b, 0);
  const unit = total >= 500000 ? 10000 : 1000; const roundU = (n: number) => Math.max(0, Math.round((Number.isFinite(n) ? n : 0) / unit) * unit);
  const num = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : 0; };
  // 로컬 23:00·23:20 🟡 전부 0원: AI 가 '약 1만원'·'15,000원'·'1.5만 원' 처럼 글로 쓰거나 '1만원 단위' 숫자(1 = 1만원)로 줌 → 원 단위로 복구
  const krw = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v ?? '').replace(/\s+/g, '').replace(/,/g, '');
    const m = /(\d+(?:\.\d+)?)(억|만|천)?원?/.exec(t); if (!m) return null;
    const n = Number(m[1]) * (m[2] === '억' ? 1e8 : m[2] === '만' ? 1e4 : m[2] === '천' ? 1e3 : 1);
    const rest = /(?:억|만)(\d+)천?원?/.exec(t); return Number.isFinite(n) ? n + (rest && m[2] === '만' ? Number(rest[1]) * 1e3 : 0) : null;
  };
  void num;
  const baseline = () => Object.entries(AD_CH).map(([k, ch]) => { const share = sum > 0 && ch.provider && spend[ch.provider] ? (k === 'youtube' ? 0.05 : spend[ch.provider] / sum * (ch.provider === 'google' ? 0.75 : 1)) : base[k]; return { provider: k, label: ch.label, monthly: roundU(total * share), note: '', connected: !!ch.provider && connected.has(ch.provider) }; });
  let plan = baseline();
  let rationale = `지난 30일 매체별 실적(${m.byProvider.map((p) => `${p.provider} ${won(p.cost)}`).join(', ') || '없음'})과 이달 목표 광고비${goalBudget ? `(${won(goalBudget)})` : '(없음)'}를 기준으로 배분. 연결 안 된 매체는 안내만.`;
  let source: 'ai' | 'template' = 'template';
  try {
    const o = await aiJson(tenant, actorId, `당신은 경력 30년의 퍼포먼스 마케터입니다. 채널별 월 광고 예산 계획을 JSON 으로 씁니다. 총액은 주어진 값 안에서, 실적(CPC·전환)이 좋은 매체에 더, 연결 안 된 매체는 0 또는 작게(시작 제안). monthly 는 반드시 원 단위 정수(예: 15000 — '1만원' 같은 글자·만원 단위 숫자 금지). rationale 에 근거 한 문단(실적 숫자 인용).`,
      `[재료]\n${m.text}\n총액(원): ${total}\n매체: ${Object.entries(AD_CH).map(([k, c]) => `${k}=${c.label}${c.provider && connected.has(c.provider) ? '(연결됨)' : '(연결 없음)'}`).join(', ')}`,
      { type: 'object', additionalProperties: false, required: ['plan', 'rationale'], properties: { rationale: { type: 'string' }, plan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['provider', 'monthly', 'note'], properties: { provider: { type: 'string' }, monthly: { type: 'integer' }, note: { type: 'string' } } } } } }, 'marketing_ops');
    if (o?.plan?.length) {
      const vals = o.plan.map((x: any) => krw(x.monthly) ?? 0);
      const unitMan = vals.every((v: number) => v < 1000) && vals.some((v: number) => v > 0); // 전부 작은 숫자면 '만원 단위'로 준 것
      plan = plan.map((p) => { const ai = o.plan.find((x: any) => x.provider === p.provider); if (!ai) return p;
        let won = krw(ai.monthly) ?? 0; if (unitMan) won *= 10000;
        if (!won) won = krw(/(\d[\d,.]*\s*(?:억|만|천)?\s*원)/.exec(String(ai.note ?? ''))?.[1]) ?? 0; // 비고 문장의 금액으로 복구
        return { ...p, monthly: roundU(won), note: String(ai.note ?? '').slice(0, 200) }; });
      rationale = String(o.rationale ?? rationale).slice(0, 1000); source = 'ai';
    }
    if (total > 0 && plan.reduce((a, p) => a + p.monthly, 0) === 0) plan = baseline(); // AI 숫자를 못 읽었으면 기본 배분
  } catch { /* 기본 배분 */ }
  const tot = plan.reduce((a, p) => a + p.monthly, 0);
  const days = Number(lastDayOf(month).slice(8));
  plan = plan.map((p) => ({ ...p, daily: Math.round(p.monthly / days / 100) * 100 }));
  const [b] = await sql<{ id: string }[]>`insert into mkt_ad_budgets (tenant, month, status, plan, total, rationale, source, created_by) values (${tenant}, ${month}, 'pending', ${sql.json(plan as never)}, ${tot}, ${rationale}, ${source}, ${actorId})
    on conflict (tenant, month) do update set plan = excluded.plan, total = excluded.total, rationale = excluded.rationale, source = excluded.source, status = 'pending', approved_by = null, approved_at = null, executed = null, updated_at = now() returning id`;
  await notify(sql, { userIds: await (await import('./mktAuto')).approvers(tenant), type: 'review_requested', title: `${month.replace('-', '년 ')}월 광고 예산 계획 — 승인해 주세요 (${won(tot)})`, body: rationale.slice(0, 200), link: '/s/marketing/ops', entityType: 'mkt_ad_budget', entityId: b.id, dedupeKey: `mktbudget:${b.id}:${source}` }).catch(() => {});
  return { id: b.id, plan, total: tot, rationale, source };
}
export const budgetAction = z.discriminatedUnion('action', [z.object({ action: z.literal('update'), plan: z.array(z.object({ provider: z.string(), monthly: z.number().int().min(0).max(1_000_000_000), note: z.string().max(200).optional() })).min(1).max(8) }), z.object({ action: z.literal('approve') }), z.object({ action: z.literal('reject'), note: z.string().trim().min(1).max(500) })]);
export async function actBudget(u: SessionUser, id: string, i: z.infer<typeof budgetAction>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('대표·관리자만');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<any[]>`select * from mkt_ad_budgets where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound();
  if (i.action === 'update') {
    const days = Number(lastDayOf(b.month).slice(8));
    const plan = (b.plan as any[]).map((p) => { const n = i.plan.find((x) => x.provider === p.provider); return n ? { ...p, monthly: n.monthly, daily: Math.round(n.monthly / days / 100) * 100, note: n.note ?? p.note } : p; });
    await sql`update mkt_ad_budgets set plan = ${sql.json(plan as never)}, total = ${plan.reduce((a: number, p: any) => a + p.monthly, 0)}, source = 'user', status = 'pending', updated_at = now() where id = ${id}`;
    return { ok: true };
  }
  if (i.action === 'reject') { await sql`update mkt_ad_budgets set status = 'rejected', rationale = ${`${b.rationale ?? ''}\n\n반려: ${i.note}`}, updated_at = now() where id = ${id}`; return { status: 'rejected' }; }
  if (b.status !== 'pending') throw badRequest('승인 대기 계획만');
  if (!Number(b.total)) throw badRequest('예산이 0원인 계획은 집행할 수 없습니다 — [고치기]로 금액을 넣어 주세요'); // 로컬 23:00: 0원 승인 → 캠페인 예산 0 위험
  // 집행(연결된 계정 범위): 네이버 — 만들어진 활성/일시정지 캠페인의 하루 예산을 계획값으로(돈이 늘면 adOps 상한 검사). 다른 매체는 안내만.
  const executed: any[] = [];
  const { actPlan } = await import('./adOps');
  for (const p of b.plan as any[]) {
    const ch = AD_CH[p.provider]; if (!ch?.provider || !p.monthly) { executed.push({ provider: p.provider, ok: false, note: ch?.provider ? '예산 0' : '매체 없음' }); continue; }
    if (ch.provider !== 'naver') { executed.push({ provider: p.provider, ok: false, note: `${ch.label}은 연결 계정에서 직접 설정 — 하루 ${won(p.daily)}` }); continue; }
    const plans = await sql<{ id: string; name: string }[]>`select p.id, p.name from mkt_ad_plans p join mkt_ad_accounts a on a.id = p.account_id where p.tenant = ${t} and a.provider = 'naver' and p.status in ('active', 'paused', 'created')`;
    if (!plans.length) { executed.push({ provider: p.provider, ok: false, note: '네이버 캠페인(세팅안) 없음 — 광고 운영에서 세팅안을 먼저' }); continue; }
    const each = Math.max(50, Math.round(p.daily / plans.length / 10) * 10);
    for (const pl of plans) {
      try { await actPlan(u, pl.id, { action: 'budget', dailyBudget: each }); executed.push({ provider: p.provider, planId: pl.id, name: pl.name, dailyBudget: each, ok: true }); }
      catch (e: any) { executed.push({ provider: p.provider, planId: pl.id, name: pl.name, dailyBudget: each, ok: false, error: String(e?.message ?? e).slice(0, 200) }); }
    }
  }
  await sql`update mkt_ad_budgets set status = 'approved', approved_by = ${u.id}, approved_at = now(), executed = ${sql.json(executed as never)}, updated_at = now() where id = ${id}`;
  const { audit } = await import('./log'); await audit(sql as never, u.id, 'mkt.budget_approve', 'mkt_ad_budget', id, { total: b.total, executed: executed.length }, null).catch(() => {});
  return { status: 'approved', executed };
}
/** 소진율: 승인된 이달 예산 vs 매체별 지출 → 80% 넘거나 남은 일수 대비 모자라면 '충전 필요' 알림(채널·금액·충전 링크), 채널마다 한 번 */
export async function budgetGuard(tenant: string, now = new Date()) {
  const sql = db(); const month = monthKst(now); const td = ymd(now);
  const [b] = await sql<any[]>`select * from mkt_ad_budgets where tenant = ${tenant} and month = ${month} and status = 'approved'`;
  if (!b) return { skipped: 'no_budget' };
  const spend = await sql<{ provider: string; cost: number }[]>`select a.provider, coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day between ${`${month}-01`}::date and ${td}::date group by a.provider`;
  const used = Object.fromEntries(spend.map((s) => [s.provider, s.cost]));
  const dayN = Number(td.slice(8)), days = Number(lastDayOf(month).slice(8));
  const alerted = { ...(b.alerted ?? {}) }; const alerts: any[] = [];
  for (const p of b.plan as any[]) {
    const ch = AD_CH[p.provider]; if (!ch?.provider || !p.monthly) continue;
    const u = used[ch.provider] ?? 0; const rate = u / p.monthly; const projected = dayN ? (u / dayN) * days : 0;
    const need = rate >= 0.8 || projected > p.monthly * 1.2;
    if (!need || alerted[p.provider]) continue;
    alerted[p.provider] = new Date().toISOString();
    const amount = Math.max(0, Math.round((projected - p.monthly) / 10000) * 10000) || Math.round(p.monthly * 0.3 / 10000) * 10000;
    alerts.push({ provider: p.provider, used: u, rate, amount });
    await notify(sql, { userIds: await (await import('./mktAuto')).approvers(tenant), type: 'usage_alert', title: `충전 필요 — ${ch.label} 소진율 ${Math.round(rate * 100)}%`, body: `이달 예산 ${won(p.monthly)} 중 ${won(u)} 사용(${dayN}일). 예상 ${won(projected)} → 약 ${won(amount)} 충전 권장. 충전: ${ch.charge}`, link: '/s/marketing/ops', entityType: 'mkt_ad_budget', entityId: b.id, dedupeKey: `mktcharge:${b.id}:${p.provider}` }).catch(() => {});
  }
  if (alerts.length) await sql`update mkt_ad_budgets set alerted = ${sql.json(alerted as never)} where id = ${b.id}`;
  return { alerts };
}

// ---------------- ③ 월 매출 목표 vs 실적 ----------------
export const revenueGoalInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), target: z.number().int().min(0).max(1_000_000_000_000), note: z.string().max(300).optional() });
/** 실적 = 영업 계약 등록(sales_lead_records contracts, 계약일 기준) + 플랫폼 회사면 워크인 결제(payments paid) */
export async function revenueOf(tenant: string, month: string, includeWorkin: boolean) {
  const sql = db(); const from = `${month}-01`, to = lastDayOf(month);
  const [c] = await sql<{ amount: number; n: number }[]>`select coalesce(sum((data->>'amount')::numeric), 0)::float8 amount, count(*)::int n from sales_lead_records where tenant = ${tenant} and kind = 'contracts'
    and coalesce((data->>'contract_date')::date, (data->>'start_date')::date, (occurred_at at time zone 'Asia/Seoul')::date) between ${from}::date and ${to}::date`;
  const [w] = includeWorkin ? await sql<{ amount: number; n: number }[]>`select coalesce(sum(amount - canceled_amount), 0)::float8 amount, count(*)::int n from payments where status in ('paid', 'partial_canceled') and (paid_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date` : [{ amount: 0, n: 0 }];
  const [g] = await sql<{ target: string; note: string | null }[]>`select target, note from mkt_revenue_goals where tenant = ${tenant} and month = ${month}`;
  const actual = Math.round(c.amount + w.amount);
  return { month, target: g ? Number(g.target) : null, note: g?.note ?? null, actual, contracts: { amount: Math.round(c.amount), n: c.n }, workin: includeWorkin ? { amount: Math.round(w.amount), n: w.n } : null, rate: g && Number(g.target) ? Math.round((actual / Number(g.target)) * 100) : null };
}
export async function setRevenueGoal(u: SessionUser, i: z.infer<typeof revenueGoalInput>) {
  if (!isAdmin(u)) throw forbidden('대표·관리자만');
  await db()`insert into mkt_revenue_goals (tenant, month, target, note, updated_by) values (${tenantOf(u)}, ${i.month}, ${i.target}, ${i.note ?? null}, ${u.id}) on conflict (tenant, month) do update set target = excluded.target, note = excluded.note, updated_by = excluded.updated_by, updated_at = now()`;
  return revenueOf(tenantOf(u), i.month, !!u.platformAdmin);
}
/** CAC·ROI(월간 보고): 광고비 ÷ 새 리드(영업) 또는 문의, (매출 − 광고비) ÷ 광고비 */
export async function cacRoi(tenant: string, month: string, adCost: number, includeWorkin: boolean) {
  const sql = db(); const from = `${month}-01`, to = lastDayOf(month);
  const [leads] = await sql<{ n: number }[]>`select count(*)::int n from sales_leads where tenant = ${tenant} and deleted_at is null and (created_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date`;
  const [calls] = await sql<{ n: number }[]>`select count(*)::int n from mkt_calls where tenant = ${tenant} and status <> 'excluded' and (called_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date`;
  const rev = await revenueOf(tenant, month, includeWorkin);
  const acq = leads.n || calls.n;
  return { revenue: rev, newLeads: leads.n, inquiries: calls.n, cac: acq ? Math.round(adCost / acq) : null, roi: adCost ? Math.round(((rev.actual - adCost) / adCost) * 1000) / 10 : null };
}

// ---------------- 화면·정기 실행 ----------------
export async function opsView(u: SessionUser, month?: string) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const m = month ?? monthKst();
  const proposals = await sql<any[]>`select p.*, du.name as decided_by_name from mkt_proposals p left join users du on du.id = p.decided_by where p.tenant = ${t} order by (p.status = 'pending') desc, p.created_at desc limit 40`;
  const [budget] = await sql<any[]>`select b.*, au.name as approved_by_name from mkt_ad_budgets b left join users au on au.id = b.approved_by where b.tenant = ${t} and b.month = ${m}`;
  const spend = await sql<{ provider: string; cost: number }[]>`select a.provider, coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day between ${`${m}-01`}::date and ${lastDayOf(m)}::date group by a.provider`;
  const used = Object.fromEntries(spend.map((s) => [s.provider, s.cost]));
  const budgetView = budget ? { ...budget, total: Number(budget.total), plan: (budget.plan as any[]).map((p) => { const ch = AD_CH[p.provider]; const u2 = ch?.provider ? used[ch.provider] ?? 0 : 0; return { ...p, charge: ch?.charge ?? null, used: u2, rate: p.monthly ? Math.round((u2 / p.monthly) * 100) : null }; }) } : null;
  const revenue = await revenueOf(t, m, !!u.platformAdmin);
  return { month: m, proposals, budget: budgetView, revenue, kinds: PROPOSAL_KIND, channels: AD_CH, canEdit: isAdmin(u), months: [monthKst(new Date(), 1), monthKst(), monthKst(new Date(), -1)] };
}
/** 정기: 월요일 09시 이후 분석·방향 카드(대기 없으면), 매일 소진율 알림, 25일 이후 다음 달 예산 초안(없으면). 밤(22시~)은 night_scope.goal 켠 회사만 */
export async function opsTick(tenant: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(now)) % 24;
  const { aiSettings } = await import('./ai/threads'); const night = !!((await aiSettings(tenant)).night_scope as any)?.goal;
  const out: Record<string, unknown> = {};
  out.guard = await budgetGuard(tenant, now).catch((e) => ({ error: String(e?.message ?? e) })); // 소진율 알림은 시각과 무관(광고 상한 감시와 같은 기준, 채널마다 한 번)
  if (h < 9 || (h >= 22 && !night)) return { ...out, skipped: 'hour' };
  const sql = db(); const dow = new Date(`${ymd(now)}T00:00:00Z`).getUTCDay(); const day = Number(ymd(now).slice(8));
  if (dow === 1) {
    const [recent] = await sql<{ n: number }[]>`select count(*)::int n from mkt_proposals where tenant = ${tenant} and source <> 'user' and created_at >= now() - interval '6 days'`;
    if (!recent.n) out.proposals = await propose(tenant, ['analysis', 'direction'], null).catch((e) => ({ error: String(e?.message ?? e) }));
  }
  if (day >= 25) {
    const next = monthKst(now, 1);
    const [ex] = await sql<{ id: string }[]>`select id from mkt_ad_budgets where tenant = ${tenant} and month = ${next}`;
    const [acc] = await sql<{ n: number }[]>`select count(*)::int n from mkt_ad_accounts where tenant = ${tenant} and status <> 'disconnected'`;
    if (!ex && acc.n) out.budget = await draftBudget(tenant, next, null).catch((e) => ({ error: String(e?.message ?? e) }));
  }
  return out;
}
export async function opsTickAll() {
  const ts = await db()<{ tenant: string }[]>`select tenant from mkt_brands union select tenant from mkt_ad_budgets union select tenant from mkt_ad_accounts limit 20`;
  const out = [];
  for (const t of ts) out.push({ tenant: t.tenant, ...(await opsTick(t.tenant).catch((e) => ({ error: String(e?.message ?? e) }))) });
  return out;
}
export { zUuid };
