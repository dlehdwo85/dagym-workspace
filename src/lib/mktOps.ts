import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';
import { monthKst, numbersOf, ymd } from './mktGoals';

/**
 * 대표 10/20 20:00 ① 마케팅 운영실 = AI 마케터(30년차)가 운영 전체를 맡되, 분석·방향·협업·인플루언서·계획은 전부 '승인 요청 카드'로 올리고 대표가 승인해야 실행(돈·외부 발송은 사람이).
 * ② 광고실: 채널별(네이버 검색·파워링크 / Google / 유튜브 / 인스타·메타) 월 예산 계획 → 승인 → 집행(연결된 네이버 캠페인 하루 예산, 나머지는 안내) + 소진율로 '충전 필요' 알림(충전은 대표).
 * ③ 월 매출 목표 vs 실적: 실적 = 영업 계약 등록 금액 + (플랫폼 회사) 워크인 결제. CAC·ROI 는 월간 보고에.
 */
export const PROPOSAL_KIND: Record<string, string> = { direction: '게시 방향', collab: '협업 제안', influencer: '인플루언서', analysis: '광고 효과 분석', plan: '향후 계획', alert: '운영 신호', weekly: '주간 운영 제안' };
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

export async function aiJson(tenant: string, actorId: string | null, system: string, user: string, format: any, purpose: string) {
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
  await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `AI 마케터 승인 요청 ${created}건: ${cards.map((c) => PROPOSAL_KIND[c.kind]).join('·')}`, body: cards[0]?.title ?? '', link: '/s/marketing/ops', entityType: 'mkt_proposal', dedupeKey: `mktops:${tenant}:${ymd(new Date())}` }).catch(() => {});
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
/** ② 반려된 카드를 AI 가 사유를 반영해 고쳐 v2 로 다시 올림. revision_note = "반려 사유 → 반영한 점". 같은 줄기(thread_id) 최대 3판 */
export async function reviseProposal(tenant: string, p: any, note: string, actorId: string | null) {
  const sql = db(); const version = Number(p.version ?? 1);
  if (version >= MAX_REVISIONS) return null;
  const thread = p.thread_id ?? p.id;
  const o = await aiJson(tenant, actorId, `당신은 경력 30년의 마케터입니다. 대표가 반려한 운영 제안 카드를 반려 사유를 반영해 고칩니다. JSON 만. 사실·숫자는 카드와 [재료]에 있는 것만. 돈을 쓰거나 밖으로 보내는 일은 '대표 승인 뒤'. 결과: {title, summary(2~3문장), items[{title, detail, expected, cost}] 3~5개, rationale, changes("반려 사유 → 반영한 점" 2~3문장)}`,
    `[카드 v${version}] ${PROPOSAL_KIND[p.kind] ?? p.kind}\n제목: ${p.title}\n요약: ${p.summary}\n항목: ${(p.body?.items ?? []).map((it: any) => `${it.title}: ${it.detail}`).join(' / ')}\n근거: ${p.body?.rationale ?? ''}\n\n[반려 사유] ${note}\n\n[재료]\n${(await material(tenant)).text}`,
    { type: 'object', additionalProperties: false, required: ['title', 'summary', 'items', 'rationale', 'changes'], properties: { title: { type: 'string' }, summary: { type: 'string' }, rationale: { type: 'string' }, changes: { type: 'string' },
      items: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'detail', 'expected', 'cost'], properties: { title: { type: 'string' }, detail: { type: 'string' }, expected: { type: 'string' }, cost: { type: 'string' } } } } } }, 'marketing_ops');
  if (!o?.title) return null;
  const [n] = await sql<{ id: string }[]>`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_by, version, revised_from, thread_id, revision_note)
    values (${tenant}, ${p.kind}, ${String(o.title).slice(0, 200)}, ${String(o.summary).slice(0, 1000)}, ${sql.json({ items: (o.items ?? []).slice(0, 6), rationale: o.rationale ?? '', numbers: p.body?.numbers ?? null, rejected: note } as never)}, 'ai', ${p.month ?? monthKst()}, ${actorId}, ${version + 1}, ${p.id}, ${thread}, ${String(o.changes ?? '').slice(0, 600)}) returning id`;
  await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `AI 마케터 고친 안 v${version + 1}: ${String(o.title).slice(0, 60)}`, body: String(o.changes ?? '').slice(0, 200), link: '/s/marketing/approvals?tab=proposals', entityType: 'mkt_proposal', entityId: n.id, dedupeKey: `mktops:rev:${n.id}`, push: true });
  return { id: n.id, version: version + 1, changes: String(o.changes ?? '') };
}
export const proposalAction = z.object({ action: z.enum(['approve', 'reject', 'done']), note: z.string().trim().max(500).optional() });
export async function actProposal(u: SessionUser, id: string, i: z.infer<typeof proposalAction>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('대표·관리자만');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [p] = await sql<any[]>`select * from mkt_proposals where id = ${id} and tenant = ${t}`;
  if (!p) throw notFound();
  if (i.action === 'reject') {
    if (!i.note) throw badRequest('반려 사유를 적어 주세요');
    await sql`update mkt_proposals set status = 'rejected', decision_note = ${i.note}, decided_by = ${u.id}, decided_at = now(), updated_at = now() where id = ${id}`;
    // ② 반려 사유 → AI 가 고친 안(v2) 을 같은 줄기로 다시 올림(최대 3회, 승인자 알림 1회). 반려 사유 없는 반려·AI 없음·3회 초과면 반려로 끝
    const revised = p.status === 'pending' ? await reviseProposal(t, p, i.note, u.id).catch(() => null) : null;
    return { status: 'rejected', revised };
  }
  if (i.action === 'done') { if (p.status !== 'approved') throw badRequest('승인된 카드만'); await sql`update mkt_proposals set status = 'done', executed = ${sql.json({ at: new Date().toISOString(), by: u.id, note: i.note ?? null } as never)}, updated_at = now() where id = ${id}`; return { status: 'done' }; }
  if (p.status !== 'pending') throw badRequest('승인 대기 카드만');
  // 승인 뒤 실행: 향후 계획·게시 방향 → 항목마다 제작의뢰실 의뢰(대기)로 넘겨 바로 제작 가능. 협업·인플루언서·분석은 사람이 하는 일 → 업무로 만들어 담당자에게
  const executed: any = { at: new Date().toISOString(), by: u.id, briefs: [] as string[], tasks: [] as string[] };
  if (['plan', 'direction'].includes(p.kind)) {
    for (const it of (p.body?.items ?? []).slice(0, 3)) {
      const [b] = await sql<{ id: string }[]>`insert into mkt_briefs (tenant, channel, kind, purpose, message, refs, quantity, status, created_by) values (${t}, 'instagram', 'feed', 'awareness', ${String(it.title ?? p.title).slice(0, 300)}, ${sql.json({ mediaIds: [], contentIds: [], links: [], proposalId: id } as never)}, 1, 'queued', ${u.id}) returning id`;
      executed.briefs.push(b.id);
    }
  } else if (p.kind === 'weekly') {
    // 주간 운영 제안: 항목마다 담당 업무 1건(단가 조정·소재 교체·방향·협업) — 돈이 움직이는 변경은 광고 운영 화면에서 사람이 실행
    try { const { createTask } = await import('./tasks');
      for (const it of (p.body?.items ?? []).slice(0, 6)) { const r = await createTask(u, { title: `[마케팅 주간] ${String(it.title).slice(0, 120)}`, description: `${it.detail}\n기대: ${it.expected} · 비용: ${it.cost}\n\n주간 운영 제안 카드 /s/marketing/ops${it.action === 'bid_down' || it.action === 'creative' || it.action === 'shift' ? '\n광고 운영: /s/marketing/ad-ops' : ''}`, space: 'marketing', assigneeId: u.id, requestedById: u.id, dueDate: null, approvalRequired: false, tags: ['마케팅', '주간 운영'] } as never); executed.tasks.push(r.id); }
    } catch (e: any) { executed.taskError = String(e?.message ?? e); }
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
/** 대표 10/21 02:30 ③ 브랜드 비중 기본값(브랜드에 ad_share 가 없을 때, 이름으로) — 하이링크 40(35~40) · 워크인 35(30~35) · 바디랩 15 · 다짐 10 = 100. 직접 적은 비중은 그대로, 나머지 브랜드가 남는 비중을 기본 가중치대로 나눔 */
const BRAND_SHARE_DEFAULT: [RegExp, number, string | null][] = [[/하이\s*-?\s*링크|hi-?link/i, 40, null], [/워크\s*인|work-?in/i, 35, null], [/바디\s*랩|body\s*lab/i, 15, '지역 한정(천안 두정·성정) — 지역 타게팅·플레이스 위주'], [/다짐|dagym/i, 10, null]];
export type BrandBudget = { brandId: string; name: string; share: number; monthly: number; priority: number | null; note: string; plans: number; needsPlan: boolean };
/** 브랜드별 비중·우선순위: ad_share(직접) → 이름 기본값 → 남는 비중 균등. 합이 100 이 되게 맞춤 */
export async function brandShares(tenant: string): Promise<Omit<BrandBudget, 'monthly' | 'plans' | 'needsPlan'>[]> {
  const sql = db();
  const rows = await sql<{ id: string; name: string; ad_priority: number | null; ad_share: string | null; ad_note: string | null; plans: number }[]>`select b.id, b.name, b.ad_priority, b.ad_share::text, b.ad_note,
      (select count(*)::int from mkt_ad_plans p where p.brand_id = b.id and p.status in ('created', 'active', 'paused')) as plans
    from mkt_brands b where b.tenant = ${tenant} order by b.ad_priority nulls last, b.name`;
  if (!rows.length) return [];
  const items = rows.map((b) => { const d = BRAND_SHARE_DEFAULT.find(([re]) => re.test(b.name)); return { brandId: b.id, name: b.name, fixed: b.ad_share !== null ? Number(b.ad_share) : null, weight: d ? d[1] : null, priority: b.ad_priority, note: b.ad_note ?? d?.[2] ?? '' }; });
  const fixedSum = items.reduce((a, x) => a + (x.fixed ?? 0), 0);
  const soft = items.filter((x) => x.fixed === null);
  const wDef = soft.filter((x) => x.weight !== null); const avgW = wDef.length ? wDef.reduce((a, x) => a + (x.weight as number), 0) / wDef.length : 1;
  const wSum = soft.reduce((a, x) => a + (x.weight ?? avgW), 0) || 1;
  const rest = Math.max(0, 100 - fixedSum);
  let out = items.map((x) => ({ brandId: x.brandId, name: x.name, priority: x.priority, note: x.note, share: x.fixed !== null ? x.fixed : Math.round((rest * (x.weight ?? avgW) / wSum) * 10) / 10 }));
  if (fixedSum > 100) { const sum = out.reduce((a, x) => a + x.share, 0) || 1; out = out.map((x) => ({ ...x, share: Math.round((x.share / sum) * 1000) / 10 })); } // 직접 적은 비중 합이 100 을 넘으면 비례 축소
  // 우선순위 없는 브랜드는 비중 큰 순으로 뒤에
  const withP = out.filter((x) => x.priority !== null).sort((a, b) => (a.priority as number) - (b.priority as number));
  const noP = out.filter((x) => x.priority === null).sort((a, b) => b.share - a.share);
  return [...withP, ...noP].map((x, i) => ({ ...x, priority: x.priority ?? withP.length + i + 1 }));
}
/** 총액 출처: 대표 입력(mkt_settings.ad_budget_monthly) → 월 목표 광고비 → 지난달 지출 ×1.5 → 최소 30만 */
export async function budgetTotalOf(tenant: string, month: string, hint?: number) {
  const sql = db();
  if (hint !== undefined && hint > 0) return { total: hint, source: 'hint' as const };
  const [s] = await sql<{ v: string | null }[]>`select ad_budget_monthly::text as v from mkt_settings where tenant = ${tenant}`;
  if (s?.v && Number(s.v) > 0) return { total: Number(s.v), source: 'owner' as const };
  const [g] = await sql<{ v: number | null }[]>`select (goals->'targets'->>'adBudget')::bigint as v from mkt_goals where tenant = ${tenant} and month = ${month} and brand_id is null and status in ('approved', 'pending') order by (status = 'approved') desc limit 1`;
  if (g?.v && Number(g.v) > 0) return { total: Number(g.v), source: 'goal' as const };
  const prev = monthKst(new Date(`${month}-15T00:00:00+09:00`), -1);
  const [p] = await sql<{ cost: number }[]>`select coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day between ${`${prev}-01`}::date and ${lastDayOf(prev)}::date`;
  if (p?.cost > 0) return { total: Math.round(p.cost * 1.5), source: 'last' as const };
  return { total: 300000, source: 'min' as const };
}
export const budgetDraftInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional(), total: z.number().int().min(0).max(1_000_000_000).optional() });
export const budgetTotalInput = z.object({ monthly: z.number().int().min(0).max(1_000_000_000).nullable(), month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
/** 운영실 [예산 총액 적기]: 대표가 적은 월 광고 예산 총액 → 회사 설정 + 그 달 월 운영 목표 광고비 연동(있을 때) */
export async function setBudgetTotal(u: SessionUser, i: z.infer<typeof budgetTotalInput>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('대표·관리자만');
  const sql = db(); const t = tenantOf(u); const m = i.month ?? monthKst();
  await sql`insert into mkt_settings (tenant, ad_budget_monthly) values (${t}, ${i.monthly}) on conflict (tenant) do update set ad_budget_monthly = excluded.ad_budget_monthly`;
  if (i.monthly) await sql`update mkt_goals set goals = jsonb_set(coalesce(goals, '{}'::jsonb), '{targets,adBudget}', to_jsonb(${i.monthly}::bigint), true), updated_at = now() where tenant = ${t} and month = ${m} and brand_id is null and status in ('pending', 'approved', 'draft')`;
  return { ok: true, monthly: i.monthly, month: m };
}
export async function draftBudget(tenant: string, month: string, actorId: string | null, totalHint?: number, revise?: { note: string }) {
  const sql = db(); const m = await material(tenant);
  const accounts = await sql<{ provider: string; n: number }[]>`select provider, count(*)::int n from mkt_ad_accounts where tenant = ${tenant} and status <> 'disconnected' group by provider`;
  const connected = new Set(accounts.map((a) => a.provider));
  const spend = Object.fromEntries(m.byProvider.map((p) => [p.provider, p.cost]));
  const goalBudget = m.goal?.goals?.targets?.adBudget ?? null;
  const [prevRow] = await sql<any[]>`select * from mkt_ad_budgets where tenant = ${tenant} and month = ${month}`;
  const tot0 = await budgetTotalOf(tenant, month, totalHint ?? (revise && prevRow ? Number(prevRow.total) : undefined));
  const total = tot0.total; const totalSource = revise && prevRow && totalHint === undefined ? (prevRow.total_source ?? 'hint') : tot0.source;
  // 기본 배분: 연결된 매체 실적 비례, 연결 없으면 네이버 50 · 메타 30 · 구글 20
  const base: Record<string, number> = { naver: 0.5, meta: 0.3, google: 0.15, youtube: 0.05 };
  const sum = Object.values(spend).reduce((a, b) => a + b, 0);
  const unit = total >= 500000 ? 10000 : 1000; const roundU = (n: number) => Math.max(0, Math.round((Number.isFinite(n) ? n : 0) / unit) * unit);
  // 로컬 23:00·23:20 🟡 전부 0원: AI 가 '약 1만원'·'15,000원'·'1.5만 원' 처럼 글로 쓰거나 '1만원 단위' 숫자(1 = 1만원)로 줌 → 원 단위로 복구
  const krw = (v: unknown): number | null => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const t = String(v ?? '').replace(/\s+/g, '').replace(/,/g, '');
    const m = /(\d+(?:\.\d+)?)(억|만|천)?원?/.exec(t); if (!m) return null;
    const n = Number(m[1]) * (m[2] === '억' ? 1e8 : m[2] === '만' ? 1e4 : m[2] === '천' ? 1e3 : 1);
    const rest = /(?:억|만)(\d+)천?원?/.exec(t); return Number.isFinite(n) ? n + (rest && m[2] === '만' ? Number(rest[1]) * 1e3 : 0) : null;
  };
  const baseline = () => Object.entries(AD_CH).map(([k, ch]) => { const share = sum > 0 && ch.provider && spend[ch.provider] ? (k === 'youtube' ? 0.05 : spend[ch.provider] / sum * (ch.provider === 'google' ? 0.75 : 1)) : base[k]; return { provider: k, label: ch.label, monthly: roundU(total * share), note: '', connected: !!ch.provider && connected.has(ch.provider) }; });
  let plan = baseline();
  // ③ 브랜드 축: 비중(대표 지정 → 이름 기본값) × 총액, 우선순위, 세팅안 수(없으면 '세팅안 필요'), 메모(바디랩 지역 한정)
  const shares = await brandShares(tenant);
  const planCount = Object.fromEntries((await sql<{ brand_id: string; n: number }[]>`select brand_id, count(*)::int n from mkt_ad_plans where tenant = ${tenant} and brand_id is not null and status in ('created', 'active', 'paused') group by brand_id`).map((r) => [r.brand_id, r.n]));
  const brandOf = (): BrandBudget[] => shares.map((s) => ({ ...s, monthly: roundU(total * s.share / 100), plans: planCount[s.brandId] ?? 0, needsPlan: !(planCount[s.brandId] ?? 0) }));
  let brandPlan = brandOf();
  let rationale = `지난 30일 매체별 실적(${m.byProvider.map((p) => `${p.provider} ${won(p.cost)}`).join(', ') || '없음'})과 이달 목표 광고비${goalBudget ? `(${won(goalBudget)})` : '(없음)'}를 기준으로 배분. 연결 안 된 매체는 안내만.${brandPlan.length ? ` 브랜드 비중: ${brandPlan.map((b) => `${b.name} ${b.share}%`).join(' · ')}.` : ''}`;
  let source: 'ai' | 'template' = 'template'; let revisionNote: string | null = null;
  try {
    const o = await aiJson(tenant, actorId, `당신은 경력 30년의 퍼포먼스 마케터입니다. 채널별 월 광고 예산 계획을 JSON 으로 씁니다. 총액은 주어진 값 안에서, 실적(CPC·전환)이 좋은 매체에 더, 연결 안 된 매체는 0 또는 작게(시작 제안). monthly 는 반드시 원 단위 정수(예: 150000). 비고는 한 줄. rationale 은 근거 한 문단. 브랜드 비중이 주어지면 brands[] 에 브랜드별 월 예산(원 단위 정수, 비중은 ±5%p 안에서 조정 가능)과 한 줄 메모(바디랩처럼 지역 한정 메모가 있으면 유지)를 씁니다.${revise ? ' 이전 계획이 반려되었습니다. 반려 사유를 반영해 고치고, changes 에 "반려 사유 → 반영한 점"을 2~3문장으로 씁니다.' : ''}`,
      `[재료]\n${m.text}\n총액(원): ${total}\n매체: ${Object.entries(AD_CH).map(([k, c]) => `${k}=${c.label}${c.provider && connected.has(c.provider) ? '(연결됨)' : '(연결 없음)'}`).join(', ')}${brandPlan.length ? `\n브랜드 비중(우선순위 순): ${brandPlan.map((b) => `${b.name}(id ${b.brandId}) ${b.share}% 우선순위 ${b.priority}${b.plans ? ` 세팅안 ${b.plans}건` : ' 세팅안 없음'}${b.note ? ` 메모: ${b.note}` : ''}`).join(' / ')}` : ''}${revise && prevRow ? `\n\n[이전 계획 v${prevRow.version ?? 1}]\n${(prevRow.plan as any[]).map((p) => `${p.provider} ${p.monthly}원 ${p.note ?? ''}`).join(' / ')}\n[반려 사유] ${revise.note}` : ''}`,
      { type: 'object', additionalProperties: false, required: ['plan', 'rationale', 'brands', 'changes'], properties: { rationale: { type: 'string' }, changes: { type: 'string' }, plan: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['provider', 'monthly', 'note'], properties: { provider: { type: 'string' }, monthly: { type: 'integer' }, note: { type: 'string' } } } },
        brands: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['brandId', 'monthly', 'note'], properties: { brandId: { type: 'string' }, monthly: { type: 'integer' }, note: { type: 'string' } } } } } }, 'marketing_budget');
    if (o?.plan?.length) {
      const vals = o.plan.map((x: any) => krw(x.monthly) ?? 0);
      const unitMan = vals.every((v: number) => v < 1000) && vals.some((v: number) => v > 0); // 전부 작은 숫자면 '만원 단위'로 준 것
      plan = plan.map((p) => { const ai = o.plan.find((x: any) => x.provider === p.provider); if (!ai) return p;
        let won = krw(ai.monthly) ?? 0; if (unitMan) won *= 10000;
        if (!won) won = krw(/(\d[\d,.]*\s*(?:억|만|천)?\s*원)/.exec(String(ai.note ?? ''))?.[1]) ?? 0; // 비고 문장의 금액으로 복구
        return { ...p, monthly: roundU(won), note: String(ai.note ?? '').slice(0, 200) }; });
      rationale = String(o.rationale ?? rationale).slice(0, 1000); source = 'ai';
      if (revise) revisionNote = String(o.changes ?? '').slice(0, 600) || null;
      if (Array.isArray(o.brands) && o.brands.length) {
        const bp = brandPlan.map((b) => { const ai = o.brands.find((x: any) => x.brandId === b.brandId || x.brandId === b.name); if (!ai) return b; let won = krw(ai.monthly) ?? 0; if (unitMan) won *= 10000; return { ...b, monthly: won ? roundU(won) : b.monthly, note: String(ai.note ?? b.note).slice(0, 200) || b.note }; });
        const bs = bp.reduce((a, b) => a + b.monthly, 0);
        if (bs > 0) brandPlan = bp.map((b) => ({ ...b, share: Math.round((b.monthly / bs) * 1000) / 10 }));
      }
    }
    if (total > 0 && plan.reduce((a, p) => a + p.monthly, 0) === 0) plan = baseline(); // AI 숫자를 못 읽었으면 기본 배분
  } catch { /* 기본 배분 */ }
  const tot = plan.reduce((a, p) => a + p.monthly, 0);
  const days = Number(lastDayOf(month).slice(8));
  plan = plan.map((p) => ({ ...p, daily: Math.round(p.monthly / days / 100) * 100 }));
  const version = revise && prevRow ? Number(prevRow.version ?? 1) + 1 : 1;
  const [b] = await sql<{ id: string }[]>`insert into mkt_ad_budgets (tenant, month, status, plan, total, rationale, source, created_by, brand_plan, total_source, version, revision_note, reject_note)
    values (${tenant}, ${month}, 'pending', ${sql.json(plan as never)}, ${tot}, ${rationale}, ${source}, ${actorId}, ${sql.json(brandPlan as never)}, ${totalSource}, ${version}, ${revisionNote}, ${revise?.note ?? null})
    on conflict (tenant, month) do update set plan = excluded.plan, total = excluded.total, rationale = excluded.rationale, source = excluded.source, status = 'pending', approved_by = null, approved_at = null, executed = null, brand_plan = excluded.brand_plan, total_source = excluded.total_source,
      version = excluded.version, revision_note = excluded.revision_note, reject_note = excluded.reject_note, updated_at = now() returning id`;
  await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `${month.replace('-', '년 ')}월 광고 예산 계획${version > 1 ? ` v${version}(반려 반영)` : ''} — 승인해 주세요 (${won(tot)})`, body: (revisionNote ?? rationale).slice(0, 200), link: '/s/marketing/approvals?tab=budget', entityType: 'mkt_ad_budget', entityId: b.id, dedupeKey: `mktbudget:${tenant}:${month}:v${version}`, push: true });
  return { id: b.id, plan, total: tot, rationale, source, brandPlan, totalSource, version, revisionNote };
}
export const budgetAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), plan: z.array(z.object({ provider: z.string(), monthly: z.number().int().min(0).max(1_000_000_000), note: z.string().max(200).optional() })).min(1).max(8).optional(),
    brands: z.array(z.object({ brandId: zUuid, monthly: z.number().int().min(0).max(1_000_000_000), note: z.string().max(200).optional() })).max(20).optional() }),
  z.object({ action: z.literal('approve') }), z.object({ action: z.literal('reject'), note: z.string().trim().min(1).max(500) })]);
export const MAX_REVISIONS = 3; // 대표 02:30 ②: 반려 → AI 고친 안 재요청은 같은 줄기에서 최대 3회
export async function actBudget(u: SessionUser, id: string, i: z.infer<typeof budgetAction>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('대표·관리자만');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<any[]>`select * from mkt_ad_budgets where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound();
  const days = Number(lastDayOf(b.month).slice(8));
  if (i.action === 'update') {
    const plan = (b.plan as any[]).map((p) => { const n = i.plan?.find((x) => x.provider === p.provider); return n ? { ...p, monthly: n.monthly, daily: Math.round(n.monthly / days / 100) * 100, note: n.note ?? p.note } : p; });
    let brandPlan = (b.brand_plan ?? []) as BrandBudget[];
    if (i.brands?.length) {
      brandPlan = brandPlan.map((x) => { const n = i.brands!.find((y) => y.brandId === x.brandId); return n ? { ...x, monthly: n.monthly, note: n.note ?? x.note } : x; });
      const bs = brandPlan.reduce((a, x) => a + x.monthly, 0); brandPlan = brandPlan.map((x) => ({ ...x, share: bs ? Math.round((x.monthly / bs) * 1000) / 10 : x.share }));
    }
    await sql`update mkt_ad_budgets set plan = ${sql.json(plan as never)}, brand_plan = ${sql.json(brandPlan as never)}, total = ${plan.reduce((a: number, p: any) => a + p.monthly, 0)}, source = 'user', status = 'pending', updated_at = now() where id = ${id}`;
    return { ok: true };
  }
  if (i.action === 'reject') {
    // ② 반려 사유 → AI 가 고친 안(v2)으로 다시 요청(최대 3회, 승인자 알림 1회). AI 없거나 3회 넘으면 반려로 끝
    const ver = Number(b.version ?? 1);
    const P = await import('./ai/provider');
    if (ver < MAX_REVISIONS && P.aiEnabled() && b.status === 'pending') {
      try {
        const r = await draftBudget(t, b.month, u.id, undefined, { note: i.note });
        if (r.source === 'ai') { const { audit } = await import('./log'); await audit(sql as never, u.id, 'mkt.budget_reject_revise', 'mkt_ad_budget', id, { note: i.note, version: r.version }, null).catch(() => {}); return { status: 'revised', version: r.version, revisionNote: r.revisionNote }; }
      } catch { /* AI 실패 → 반려로 */ }
    }
    await sql`update mkt_ad_budgets set status = 'rejected', reject_note = ${i.note}, rationale = ${`${b.rationale ?? ''}\n\n반려: ${i.note}`}, updated_at = now() where id = ${id}`;
    return { status: 'rejected', version: ver, final: ver >= MAX_REVISIONS };
  }
  if (b.status !== 'pending') throw badRequest('승인 대기 계획만');
  if (!Number(b.total)) throw badRequest('예산이 0원인 계획은 집행할 수 없습니다 — [고치기]로 금액을 넣어 주세요'); // 로컬 23:00: 0원 승인 → 캠페인 예산 0 위험
  // 집행(연결된 계정 범위): 네이버 — 브랜드별 세팅안(brand_id)이 있으면 브랜드 월 예산의 네이버 몫을 그 브랜드 캠페인에, 브랜드 세팅안이 없으면 '세팅안 필요'. 브랜드 없는 세팅안은 남은 네이버 예산을 나눔. 다른 매체는 안내만.
  const executed: any[] = [];
  const { actPlan } = await import('./adOps');
  const naver = (b.plan as any[]).find((p) => p.provider === 'naver');
  const naverShare = Number(b.total) ? Number(naver?.monthly ?? 0) / Number(b.total) : 0;
  const plans = await sql<{ id: string; name: string; brand_id: string | null }[]>`select p.id, p.name, p.brand_id from mkt_ad_plans p join mkt_ad_accounts a on a.id = p.account_id where p.tenant = ${t} and a.provider = 'naver' and p.status in ('active', 'paused', 'created')`;
  const setDaily = async (pl: { id: string; name: string }, daily: number, brand: string | null) => {
    const each = Math.max(50, Math.round(daily / 10) * 10);
    try { await actPlan(u, pl.id, { action: 'budget', dailyBudget: each }); executed.push({ provider: 'naver', planId: pl.id, name: pl.name, brand, dailyBudget: each, ok: true }); }
    catch (e: any) { executed.push({ provider: 'naver', planId: pl.id, name: pl.name, brand, dailyBudget: each, ok: false, error: String(e?.message ?? e).slice(0, 200) }); }
  };
  const brandPlan = (b.brand_plan ?? []) as BrandBudget[];
  let brandNaver = 0;
  for (const bp of brandPlan) {
    const mine = plans.filter((p) => p.brand_id === bp.brandId);
    if (!mine.length) { executed.push({ provider: 'naver', brand: bp.name, ok: false, needsPlan: true, note: `세팅안 필요 — ${bp.name} 월 ${won(bp.monthly)}(네이버 몫 ${won(bp.monthly * naverShare)}) 은 광고 운영에서 브랜드 세팅안을 만든 뒤 집행` }); continue; }
    const monthlyNaver = bp.monthly * naverShare; brandNaver += monthlyNaver;
    for (const pl of mine) await setDaily(pl, monthlyNaver / days / mine.length, bp.name);
  }
  for (const p of b.plan as any[]) {
    const ch = AD_CH[p.provider]; if (!ch?.provider || !p.monthly) { executed.push({ provider: p.provider, ok: false, note: ch?.provider ? '예산 0' : '매체 없음' }); continue; }
    if (ch.provider !== 'naver') { executed.push({ provider: p.provider, ok: false, note: `${ch.label}은 연결 계정에서 직접 설정 — 하루 ${won(p.daily)}` }); continue; }
    const rest = plans.filter((p2) => !p2.brand_id || !brandPlan.some((bp) => bp.brandId === p2.brand_id));
    if (!plans.length) { executed.push({ provider: p.provider, ok: false, note: '네이버 캠페인(세팅안) 없음 — 광고 운영에서 세팅안을 먼저' }); continue; }
    if (!rest.length) continue;
    const left = Math.max(0, p.monthly - brandNaver);
    for (const pl of rest) await setDaily(pl, left / days / rest.length, null);
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
    await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'usage_alert', title: `충전 필요 — ${ch.label} 소진율 ${Math.round(rate * 100)}%`, body: `이달 예산 ${won(p.monthly)} 중 ${won(u)} 사용(${dayN}일). 예상 ${won(projected)} → 약 ${won(amount)} 충전 권장. 충전: ${ch.charge}`, link: '/s/marketing/ops', entityType: 'mkt_ad_budget', entityId: b.id, dedupeKey: `mktcharge:${b.id}:${p.provider}` }).catch(() => {});
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
  const [g] = await sql<{ target: string; note: string | null; suggest: any }[]>`select target, note, suggest from mkt_revenue_goals where tenant = ${tenant} and month = ${month}`;
  const actual = Math.round(c.amount + w.amount);
  return { month, target: g && Number(g.target) ? Number(g.target) : null, note: g?.note ?? null, suggest: g?.suggest ?? null, actual, contracts: { amount: Math.round(c.amount), n: c.n }, workin: includeWorkin ? { amount: Math.round(w.amount), n: w.n } : null, rate: g && Number(g.target) ? Math.round((actual / Number(g.target)) * 100) : null };
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
// ---------------- 대표 03:00 ① 월 매출 목표 AI 추천 ----------------
export type RevenueOption = { key: 'conservative' | 'base' | 'stretch'; label: string; target: number; rationale: string };
/** 근거 재료: 지난 3달 계약 금액 · 영업 파이프라인(제안 금액, 이달 계약 예정) · 워크인 가입·결제 추세(플랫폼 회사) · 이달 광고 예산 */
async function revenueBasis(tenant: string, month: string, includeWorkin: boolean) {
  const sql = db();
  const months = [3, 2, 1].map((k) => monthKst(new Date(`${month}-15T00:00:00+09:00`), -k));
  const past = [];
  for (const m of months) past.push(await revenueOf(tenant, m, includeWorkin));
  const [pipe] = await sql<{ amount: number; n: number }[]>`select coalesce(sum((data->>'amount')::numeric), 0)::float8 amount, count(*)::int n from sales_lead_records r where r.tenant = ${tenant} and r.kind = 'proposals'
    and coalesce(r.data->>'status', '제안') not in ('계약', '탈락', '실패', '종료') and coalesce((r.data->>'proposal_date')::date, (r.occurred_at at time zone 'Asia/Seoul')::date) >= (${`${month}-01`}::date - interval '90 days')
    and not exists (select 1 from sales_lead_records c where c.tenant = r.tenant and c.kind = 'contracts' and c.lead_id = r.lead_id and c.lead_id is not null)`;
  const [due] = await sql<{ amount: number; n: number }[]>`select coalesce(sum((data->>'amount')::numeric), 0)::float8 amount, count(*)::int n from sales_lead_records where tenant = ${tenant} and kind = 'contracts'
    and (data->>'contract_date') is null and coalesce((data->>'expected_contract_date')::date, (data->>'expectedContractDate')::date) between ${`${month}-01`}::date and ${lastDayOf(month)}::date`;
  const [leads] = await sql<{ amount: number; n: number }[]>`select coalesce(sum(expected_revenue), 0)::float8 amount, count(*)::int n from sales_leads where tenant = ${tenant} and expected_revenue > 0 and coalesce(status, '') not in ('실패', '탈락', '계약', '보류', '종료')`;
  const signups = includeWorkin ? await sql<{ month: string; n: number }[]>`select to_char(created_at at time zone 'Asia/Seoul', 'YYYY-MM') as month, count(*)::int n from tenants where created_at >= (${`${months[0]}-01`}::date) group by 1 order by 1` : [];
  const ad = await budgetTotalOf(tenant, month);
  return { month, past, pipeline: { proposals: pipe, dueContracts: due, leads }, signups, adBudget: ad };
}
export async function recommendRevenue(u: SessionUser, month: string) {
  await assertSpace(u, 'marketing').catch(() => assertSpace(u, 'sales')); if (!isAdmin(u)) throw forbidden('대표·관리자만');
  const sql = db(); const t = tenantOf(u);
  const b = await revenueBasis(t, month, !!u.platformAdmin);
  const avg3 = b.past.reduce((a, p) => a + p.actual, 0) / 3; const last = b.past[2].actual;
  const pipe = b.pipeline.proposals.amount + b.pipeline.dueContracts.amount;
  const unit = avg3 + pipe >= 50_000_000 ? 1_000_000 : avg3 + pipe >= 5_000_000 ? 100_000 : 10_000; const r = (n: number) => Math.max(0, Math.round(n / unit) * unit);
  const base0 = Math.max(avg3, last);
  let options: RevenueOption[] = [
    { key: 'conservative', label: '보수', target: r(base0 * 0.9 + pipe * 0.3 + b.pipeline.dueContracts.amount * 0.3), rationale: `최근 3달 평균(${won(avg3)})의 90% + 파이프라인 30%` },
    { key: 'base', label: '기본', target: r(base0 * 1.05 + pipe * 0.5), rationale: `최근 3달 평균·지난달 중 큰 쪽(${won(base0)}) +5% + 파이프라인(${won(pipe)}) 50%` },
    { key: 'stretch', label: '도전', target: r(base0 * 1.2 + pipe * 0.7), rationale: `+20% + 파이프라인 70% — 광고 예산 ${won(b.adBudget.total)} 집행 전제` }];
  let summary = `지난 3달 ${b.past.map((p) => `${Number(p.month.slice(5))}월 ${won(p.actual)}`).join(' · ')}. 파이프라인 제안 ${b.pipeline.proposals.n}건 ${won(b.pipeline.proposals.amount)}, 이달 계약 예정 ${b.pipeline.dueContracts.n}건 ${won(b.pipeline.dueContracts.amount)}${b.signups.length ? `, 워크인 가입 ${b.signups.map((s) => `${Number(s.month.slice(5))}월 ${s.n}`).join('·')}` : ''}. 광고 예산 ${won(b.adBudget.total)}.`;
  let source: 'ai' | 'template' = 'template';
  try {
    const o = await aiJson(t, u.id, `당신은 경력 30년의 마케터이자 영업 기획자입니다. 다음 달 월 매출 목표를 보수/기본/도전 3안으로 추천합니다. JSON 만. 숫자는 원 단위 정수, [재료]에 있는 숫자만 근거로(없으면 '확인 필요'). 과장 금지. 각 안에 한 줄 근거. summary 는 2문장.`,
      `[재료]\n달: ${month}\n지난 3달 실적: ${b.past.map((p) => `${p.month} ${p.actual}원(계약 ${p.contracts.n}건${p.workin ? `, 워크인 결제 ${p.workin.n}건 ${p.workin.amount}원` : ''})`).join(' / ')}\n파이프라인: 제안 ${b.pipeline.proposals.n}건 ${b.pipeline.proposals.amount}원 · 이달 계약 예정 ${b.pipeline.dueContracts.n}건 ${b.pipeline.dueContracts.amount}원 · 리드 예상 매출 ${b.pipeline.leads.n}건 ${b.pipeline.leads.amount}원\n${b.signups.length ? `워크인 가입 추세: ${b.signups.map((s) => `${s.month} ${s.n}`).join(', ')}\n` : ''}이달 광고 예산: ${b.adBudget.total}원(${b.adBudget.source})\n기본 계산: 보수 ${options[0].target} · 기본 ${options[1].target} · 도전 ${options[2].target}`,
      { type: 'object', additionalProperties: false, required: ['options', 'summary'], properties: { summary: { type: 'string' }, options: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'target', 'rationale'], properties: { key: { type: 'string' }, target: { type: 'integer' }, rationale: { type: 'string' } } } } } }, 'marketing_revenue');
    if (o?.options?.length) {
      options = options.map((x) => { const ai = o.options.find((y: any) => y.key === x.key); return ai && Number(ai.target) > 0 ? { ...x, target: Math.round(Number(ai.target)), rationale: String(ai.rationale ?? x.rationale).slice(0, 300) } : x; });
      summary = String(o.summary ?? summary).slice(0, 600); source = 'ai';
    }
  } catch { /* 기본 계산 */ }
  const suggest = { at: new Date().toISOString(), source, options, summary, basis: { avg3: Math.round(avg3), last, pipeline: Math.round(pipe), adBudget: b.adBudget.total } };
  await sql`insert into mkt_revenue_goals (tenant, month, target, suggest, updated_by) values (${t}, ${month}, 0, ${sql.json(suggest as never)}, ${u.id}) on conflict (tenant, month) do update set suggest = excluded.suggest`;
  return suggest;
}

// ---------------- 대표 03:00 ② AI 마케터 상시 운영: 매일 지표 → 변화 감지 → '운영 신호' 카드(승인 뒤 실행) · 아침 한 줄 브리핑 · 지금 상태 ----------------
export type OpsSignal = { key: string; level: 'warn' | 'action'; title: string; detail: string; action: string; /** 카드 [열기] 링크(선택) */ link?: string };
async function dailyMetrics(tenant: string, day: string, includeWorkin: boolean) {
  const sql = db();
  const [c] = await sql<any[]>`select count(*) filter (where status = 'published' and (coalesce(published_at, scheduled_at) at time zone 'Asia/Seoul')::date = ${day}::date)::int posts,
      count(*) filter (where status = 'approved' and scheduled_at < now() - interval '2 hours' and not is_test)::int delayed,
      count(*) filter (where status = 'pending' and not is_test and scheduled_at < now())::int late
    from mkt_contents where tenant = ${tenant}`;
  const [a] = await sql<any[]>`select coalesce(sum(s.impressions), 0)::float8 impressions, coalesce(sum(s.clicks), 0)::float8 clicks, coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day = ${day}::date`;
  const [q] = await sql<{ n: number }[]>`select count(*)::int n from mkt_calls where tenant = ${tenant} and status <> 'excluded' and (called_at at time zone 'Asia/Seoul')::date = ${day}::date`;
  const [k] = await sql<{ n: number; amount: number }[]>`select count(*)::int n, coalesce(sum((data->>'amount')::numeric), 0)::float8 amount from sales_lead_records where tenant = ${tenant} and kind = 'contracts' and coalesce((data->>'contract_date')::date, (occurred_at at time zone 'Asia/Seoul')::date) = ${day}::date`;
  const [s] = includeWorkin ? await sql<{ n: number }[]>`select count(*)::int n from tenants where (created_at at time zone 'Asia/Seoul')::date = ${day}::date` : [{ n: 0 }];
  const { approvableCount } = await import('./marketing');
  const [bud] = await sql<any[]>`select plan, total from mkt_ad_budgets where tenant = ${tenant} and month = ${day.slice(0, 7)} and status = 'approved'`;
  const spend = bud ? await sql<{ cost: number }[]>`select coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day between ${`${day.slice(0, 7)}-01`}::date and ${day}::date` : [{ cost: 0 }];
  const budgetRate = bud && Number(bud.total) ? Math.round((spend[0].cost / Number(bud.total)) * 100) : null;
  return { posts: c.posts, delayed: c.delayed, late: c.late, impressions: a.impressions, clicks: a.clicks, cost: Math.round(a.cost), cpc: a.clicks ? Math.round(a.cost / a.clicks) : null, inquiries: q.n, contracts: k.n, contractAmount: Math.round(k.amount), signups: s.n, approvals: await approvableCount(tenant), budgetRate };
}
/** 변화 감지(7일 평균 대비) → 신호. 모두 숫자로만(AI 비용 0). 카드는 대표 승인 뒤 실행(업무) */
function detectSignals(m: Awaited<ReturnType<typeof dailyMetrics>>, hist: any[], weekAgo: { contracts: number; prevContracts: number }): OpsSignal[] {
  const out: OpsSignal[] = [];
  const avg = (k: string) => { const xs = hist.map((h) => Number(h.metrics?.[k] ?? 0)); return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; };
  const cpcAvg = (() => { const cs = hist.filter((h) => Number(h.metrics?.clicks ?? 0) > 0); return cs.length ? cs.reduce((a, h) => a + Number(h.metrics.cost) , 0) / cs.reduce((a, h) => a + Number(h.metrics.clicks), 0) : 0; })();
  if (m.cpc && cpcAvg > 0 && m.cpc >= cpcAvg * 1.5 && m.clicks >= 10) out.push({ key: 'cpc_spike', level: 'action', title: `CPC 급등 ${won(m.cpc)} (7일 평균 ${won(Math.round(cpcAvg))})`, detail: `오늘 클릭 ${m.clicks}·광고비 ${won(m.cost)}. 입찰가·키워드 점검 필요.`, action: '네이버 키워드별 CPC 확인 → 입찰가 낮추기·비효율 키워드 끄기(광고 운영 세팅안)' });
  if (m.inquiries === 0 && hist.length >= 6 && hist.every((h) => Number(h.metrics?.inquiries ?? 0) === 0) && (avg('cost') > 0 || avg('posts') > 0)) out.push({ key: 'no_inquiries', level: 'warn', title: '문의 0건 7일째', detail: `게시·광고는 돌고 있는데 전화 문의가 7일간 없음(광고비 하루 평균 ${won(Math.round(avg('cost')))}).`, action: '랜딩·전화 버튼 점검, 문의 유도 소재로 교체, 전화 추적 번호 확인' });
  if (m.budgetRate !== null && m.budgetRate >= 80) out.push({ key: 'budget_80', level: 'action', title: `광고 예산 소진율 ${m.budgetRate}%`, detail: '승인된 이달 예산의 80% 이상 사용.', action: '충전(대표) 또는 남은 기간 하루 예산 조정' });
  if (m.delayed > 0) out.push({ key: 'publish_delay', level: 'action', title: `게시 지연 ${m.delayed}건`, detail: '승인됐는데 예정 시각 2시간이 지나도 게시 안 됨.', action: '게시 도우미/서버 게시 상태 확인 → 다시 시도 또는 일정 재배치' });
  if (m.late > 0) out.push({ key: 'approvals_late', level: 'warn', title: `승인 밀림 ${m.late}건`, detail: '예정 시각이 지났는데 승인 대기.', action: '승인함에서 승인 또는 일정 재배치' });
  if (weekAgo.prevContracts >= 2 && weekAgo.contracts <= weekAgo.prevContracts / 2) out.push({ key: 'contract_drop', level: 'warn', title: `계약 전환 감소 ${weekAgo.prevContracts}건 → ${weekAgo.contracts}건`, detail: '지난주 대비 이번 주 계약 등록이 절반 이하.', action: '제안 중 리드 후속 연락, 영업 홈 오늘 할 일 점검' });
  if (weekAgo.prevContracts > 0 && weekAgo.contracts >= weekAgo.prevContracts * 2 && weekAgo.contracts >= 3) out.push({ key: 'contract_up', level: 'warn', title: `계약 전환 증가 ${weekAgo.prevContracts}건 → ${weekAgo.contracts}건`, detail: '이번 주 계약 등록이 지난주의 2배 이상 — 잘 되는 소재·채널 확대 검토.', action: '이번 주 게시·광고 중 전환 기여 소재 확인 → 예산·빈도 늘리기 제안' });
  return out;
}
/** 상시 운영 검토: 오늘 지표 스냅숏 + 신호 → 상태(정상/주의/조치 필요) 저장, 새 신호는 '운영 신호' 카드(3일 안 같은 신호 중복 없음), 07시 이후 하루 1번 아침 브리핑 */
export async function opsReview(tenant: string, now = new Date(), opts: { force?: boolean } = {}) {
  const sql = db(); const day = ymd(now); const minus = (n: number) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) - n * 864e5));
  const [prev] = await sql<any[]>`select reviewed_at, brief_at from mkt_ops_daily where tenant = ${tenant} and day = ${day}::date`;
  if (!opts.force && prev && Date.now() - new Date(prev.reviewed_at).getTime() < 55 * 60 * 1000) return { skipped: 'recent', day };
  const [co] = await sql<{ platform: boolean }[]>`select exists (select 1 from users where tenant = ${tenant} and platform_admin) as platform`.catch(() => [{ platform: false }]);
  const m = await dailyMetrics(tenant, day, !!co?.platform);
  const hist = await sql<any[]>`select metrics from mkt_ops_daily where tenant = ${tenant} and day between ${minus(7)}::date and ${minus(1)}::date order by day`;
  const wk = async (from: number, to: number) => (await sql<{ n: number }[]>`select count(*)::int n from sales_lead_records where tenant = ${tenant} and kind = 'contracts' and coalesce((data->>'contract_date')::date, (occurred_at at time zone 'Asia/Seoul')::date) between ${minus(from)}::date and ${minus(to)}::date`)[0].n;
  const signals = detectSignals(m, hist, { contracts: await wk(6, 0), prevContracts: await wk(13, 7) });
  // 대표 10/21 12:20 피드 일관성: 브랜드별 최근 9장 톤 편차(숫자만, sharp) → 신호(없으면 건너뜀)
  signals.push(...(await (await import('./mktFeed')).feedSignals(tenant).catch(() => [])));
  const status = signals.some((s) => s.level === 'action') ? 'action' : signals.length ? 'warn' : 'ok';
  await sql`insert into mkt_ops_daily (tenant, day, metrics, signals, status, reviewed_at) values (${tenant}, ${day}::date, ${sql.json(m as never)}, ${sql.json(signals as never)}, ${status}, now())
    on conflict (tenant, day) do update set metrics = excluded.metrics, signals = excluded.signals, status = excluded.status, reviewed_at = now()`;
  // 신호 → 카드(같은 신호 3일 안 중복 없음, 승인 뒤 실행)
  let cards = 0;
  for (const sg of signals) {
    const [dup] = await sql<{ id: string }[]>`select id from mkt_proposals where tenant = ${tenant} and kind = 'alert' and body->>'signal' = ${sg.key} and created_at >= now() - interval '3 days' limit 1`;
    if (dup) continue;
    await sql`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_by) values (${tenant}, 'alert', ${sg.title.slice(0, 200)}, ${sg.detail.slice(0, 1000)},
      ${sql.json({ signal: sg.key, level: sg.level, items: [{ title: '제안 조치', detail: sg.action, expected: sg.level === 'action' ? '손실 막기' : '기회 확대', cost: '없음(대표 승인 뒤 담당 업무)' }], ...(sg.link ? { link: sg.link } : {}), rationale: `오늘 지표: 게시 ${m.posts}·클릭 ${m.clicks}·CPC ${m.cpc ? won(m.cpc) : '-'}·문의 ${m.inquiries}·가입 ${m.signups}·계약 ${m.contracts}${m.budgetRate !== null ? `·소진율 ${m.budgetRate}%` : ''}`, numbers: m } as never)}, 'template', ${day.slice(0, 7)}, null)`;
    cards++;
  }
  if (cards) await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `AI 마케터 운영 신호 ${cards}건: ${signals.slice(0, 2).map((s) => s.title).join(' · ')}`, body: '승인하면 담당 업무로 만듭니다', link: '/s/marketing/approvals?tab=proposals', entityType: 'mkt_proposal', dedupeKey: `mktops:alert:${tenant}:${day}`, push: true });
  // 아침 브리핑(07시 이후 하루 1번): 어제 숫자 한 줄 + 상태
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(now)) % 24;
  let brief: string | null = null;
  if (h >= 7 && !prev?.brief_at) {
    const y = ymd(new Date(now.getTime() - 864e5)); const ym = await dailyMetrics(tenant, y, !!co?.platform);
    brief = `어제 게시 ${ym.posts}건 · 클릭 ${ym.clicks}${ym.cpc ? `(CPC ${won(ym.cpc)})` : ''} · 문의 ${ym.inquiries}건${co?.platform ? ` · 가입 ${ym.signups}` : ''} · 계약 ${ym.contracts}건${ym.contractAmount ? ` ${won(ym.contractAmount)}` : ''} · 승인 대기 ${m.approvals}건 — 상태 ${status === 'ok' ? '정상' : status === 'warn' ? '주의' : '조치 필요'}${signals.length ? `(${signals.map((s) => s.title).join(', ')})` : ''}`;
    await sql`update mkt_ops_daily set brief = ${brief}, brief_at = now() where tenant = ${tenant} and day = ${day}::date`;
  }
  return { day, status, signals, cards, brief, metrics: m };
}
export async function opsStatus(tenant: string) {
  const [r] = await db()<any[]>`select day::text, status, signals, metrics, brief, brief_at, reviewed_at from mkt_ops_daily where tenant = ${tenant} order by day desc limit 1`;
  return r ? { day: r.day, status: r.status as 'ok' | 'warn' | 'action', signals: (r.signals ?? []) as OpsSignal[], metrics: r.metrics, brief: r.brief, briefAt: r.brief_at, reviewedAt: r.reviewed_at } : null;
}
export async function opsView(u: SessionUser, month?: string) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const m = month ?? monthKst();
  const feed = await (await import('./mktFeed')).feedConsistency(t).catch(() => null); // 대표 10/21 12:20 피드 일관성(브랜드별 최근 9장)
  const proposals = await sql<any[]>`select p.*, du.name as decided_by_name from mkt_proposals p left join users du on du.id = p.decided_by where p.tenant = ${t} order by (p.status = 'pending') desc, p.created_at desc limit 40`;
  const [budget] = await sql<any[]>`select b.*, au.name as approved_by_name from mkt_ad_budgets b left join users au on au.id = b.approved_by where b.tenant = ${t} and b.month = ${m}`;
  const spend = await sql<{ provider: string; cost: number }[]>`select a.provider, coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day between ${`${m}-01`}::date and ${lastDayOf(m)}::date group by a.provider`;
  const used = Object.fromEntries(spend.map((s) => [s.provider, s.cost]));
  const budgetView = budget ? { ...budget, total: Number(budget.total), brand_plan: budget.brand_plan ?? [], plan: (budget.plan as any[]).map((p) => { const ch = AD_CH[p.provider]; const u2 = ch?.provider ? used[ch.provider] ?? 0 : 0; return { ...p, charge: ch?.charge ?? null, used: u2, rate: p.monthly ? Math.round((u2 / p.monthly) * 100) : null }; }) } : null;
  const revenue = await revenueOf(t, m, !!u.platformAdmin);
  const [st] = await sql<{ v: string | null }[]>`select ad_budget_monthly::text as v from mkt_settings where tenant = ${t}`;
  const brands = await brandShares(t);
  const totalDefault = await budgetTotalOf(t, m);
  return { month: m, feed, proposals, budget: budgetView, revenue, kinds: PROPOSAL_KIND, channels: AD_CH, canEdit: isAdmin(u), months: [monthKst(new Date(), 1), monthKst(), monthKst(new Date(), -1)],
    ownerTotal: st?.v ? Number(st.v) : null, totalDefault, brands, maxRevisions: MAX_REVISIONS, review: await opsStatus(t) };
}
/** 대표 02:30 ① 승인함 통합: 콘텐츠(기존) + 운영 제안 + 광고 예산 + 월 목표 + 제작 의뢰(프롬프트 준비 → [생성] 결정) 건수·목록 */
export async function inboxView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const { approvableCount } = await import('./marketing');
  const contents = await approvableCount(t);
  const feed = await (await import('./mktFeed')).feedConsistency(t).catch(() => null); // 대표 10/21 12:20 피드 일관성(브랜드별 최근 9장)
  const proposals = await sql<any[]>`select p.*, du.name as decided_by_name from mkt_proposals p left join users du on du.id = p.decided_by where p.tenant = ${t} and p.status = 'pending' order by p.created_at desc limit 20`;
  const budgets = await sql<any[]>`select b.*, au.name as approved_by_name from mkt_ad_budgets b left join users au on au.id = b.approved_by where b.tenant = ${t} and b.status = 'pending' order by b.month desc limit 3`;
  const goals = await sql<any[]>`select g.*, b.name as brand, ub.name as created_by_name, ua.name as approved_by_name from mkt_goals g left join mkt_brands b on b.id = g.brand_id left join users ub on ub.id = g.created_by left join users ua on ua.id = g.approved_by where g.tenant = ${t} and g.status = 'pending' order by g.month desc, (g.brand_id is null) desc limit 10`;
  const briefs = await sql<any[]>`select b.id, b.kind, b.channel, b.purpose, b.message, b.status, b.quantity, b.due_date::text, b.created_at, br.name as brand, cu.name as created_by_name, b.prompt->>'summaryKo' as summary_ko, b.prompt->>'model' as model
    from mkt_briefs b left join mkt_brands br on br.id = b.brand_id left join users cu on cu.id = b.created_by where b.tenant = ${t} and b.status in ('ready', 'failed') order by b.created_at desc limit 20`;
  const { numbersOf: nums } = await import('./mktGoals');
  const goalsOut = [];
  for (const g of goals) goalsOut.push({ ...g, numbers: await nums(t, `${g.month}-01`, lastDayOf(g.month), g.brand_id), thisWeek: null });
  const spend = budgets.length ? await sql<{ provider: string; cost: number }[]>`select a.provider, coalesce(sum(s.cost_krw), 0)::float8 cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= ${`${budgets[0].month}-01`}::date group by a.provider` : [];
  const used = Object.fromEntries(spend.map((s) => [s.provider, s.cost]));
  const budgetsOut = budgets.map((b) => ({ ...b, total: Number(b.total), brand_plan: b.brand_plan ?? [], plan: (b.plan as any[]).map((p) => { const ch = AD_CH[p.provider]; const u2 = ch?.provider ? used[ch.provider] ?? 0 : 0; return { ...p, charge: ch?.charge ?? null, used: u2, rate: p.monthly ? Math.round((u2 / p.monthly) * 100) : null }; }) }));
  const counts = { contents, proposals: proposals.length, budget: budgets.length, goals: goals.length, briefs: briefs.length };
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0), proposals, budgets: budgetsOut, goals: goalsOut, briefs, kinds: PROPOSAL_KIND, canEdit: isAdmin(u), today: ymd(new Date()), maxRevisions: MAX_REVISIONS };
}
/** 정기: 월요일 09시 이후 분석·방향 카드(대기 없으면), 매일 소진율 알림, 25일 이후 다음 달 예산 초안(없으면). 밤(22시~)은 night_scope.goal 켠 회사만 */
export async function opsTick(tenant: string, now = new Date()) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(now)) % 24;
  const { aiSettings } = await import('./ai/threads'); const night = !!((await aiSettings(tenant)).night_scope as any)?.goal;
  const out: Record<string, unknown> = {};
  out.guard = await budgetGuard(tenant, now).catch((e) => ({ error: String(e?.message ?? e) })); // 소진율 알림은 시각과 무관(광고 상한 감시와 같은 기준, 채널마다 한 번)
  out.review = await opsReview(tenant, now).catch((e) => ({ error: String(e?.message ?? e) })); // 대표 03:00 ② 상시 운영: 1시간마다 지표·신호(AI 비용 0), 07시 이후 아침 브리핑
  out.recharge = await (await import('./mktRecharge')).rechargeCheck(tenant).catch((e) => ({ error: String(e?.message ?? e) })); // 대표 10/21 14:30 #411 매체 잔액 → 충전 필요 카드 → 충전 감지 자동 완료
  if (h < 9 || (h >= 22 && !night)) return { ...out, skipped: 'hour' };
  const sql = db(); const dow = new Date(`${ymd(now)}T00:00:00Z`).getUTCDay(); const day = Number(ymd(now).slice(8));
  if (dow === 1) {
    const [recent] = await sql<{ n: number }[]>`select count(*)::int n from mkt_proposals where tenant = ${tenant} and source <> 'user' and created_at >= now() - interval '6 days'`;
    if (!recent.n) out.proposals = await propose(tenant, ['analysis', 'direction'], null).catch((e) => ({ error: String(e?.message ?? e) }));
    out.weekly = await weeklyProposal(tenant, null).catch((e) => ({ error: String(e?.message ?? e) })); // 대표 10/20 14:10 ④ 월요일 주간 운영 제안(숫자)
  }
  if (day >= 25) {
    const next = monthKst(now, 1);
    const [ex] = await sql<{ id: string }[]>`select id from mkt_ad_budgets where tenant = ${tenant} and month = ${next}`;
    const [acc] = await sql<{ n: number }[]>`select count(*)::int n from mkt_ad_accounts where tenant = ${tenant} and status <> 'disconnected'`;
    if (!ex && acc.n) out.budget = await draftBudget(tenant, next, null).catch((e) => ({ error: String(e?.message ?? e) }));
  }
  return out;
}
/** 대표 10/20 14:10 ④ 주간 운영 제안(월요일 1회, 숫자만·AI 비용 0): 지난 7일 캠페인별 CPC·CTR 로 단가 조정(입찰가 낮추기/소재 교체)·방향(잘 되는 매체 확대)·협업·예산 페이스 → 카드 1장 → 승인하면 항목마다 담당 업무(단가 조정은 광고 운영 화면에서 사람이 실행) */
export async function weeklyProposal(tenant: string, actorId: string | null, opts: { force?: boolean } = {}) {
  const sql = db();
  if (!opts.force) { const [dup] = await sql<{ id: string }[]>`select id from mkt_proposals where tenant = ${tenant} and kind = 'weekly' and created_at >= now() - interval '6 days' limit 1`; if (dup) return { created: 0, skipped: 'recent', id: dup.id }; }
  const d7 = ymd(new Date(Date.now() - 7 * 864e5)); const d14 = ymd(new Date(Date.now() - 14 * 864e5)); const td = ymd(new Date());
  const camps = await sql<{ provider: string; campaign_id: string; name: string; cost: number; clicks: number; impressions: number; conversions: number }[]>`select a.provider, s.campaign_id, max(s.campaign_name) name, sum(s.cost_krw)::float8 cost, sum(s.clicks)::float8 clicks, sum(s.impressions)::float8 impressions, sum(s.conversions)::float8 conversions
    from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day > ${d7}::date and s.day <= ${td}::date group by a.provider, s.campaign_id order by sum(s.cost_krw) desc limit 30`;
  const [prev] = await sql<{ cost: number; clicks: number }[]>`select coalesce(sum(s.cost_krw), 0)::float8 cost, coalesce(sum(s.clicks), 0)::float8 clicks from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day > ${d14}::date and s.day <= ${d7}::date`;
  const cost = camps.reduce((s, c) => s + c.cost, 0), clicks = camps.reduce((s, c) => s + c.clicks, 0); const cpc = clicks ? cost / clicks : 0; const ctrAvg = camps.reduce((s, c) => s + c.impressions, 0) ? clicks / camps.reduce((s, c) => s + c.impressions, 0) : 0;
  const items: { title: string; detail: string; expected: string; cost: string; action?: string }[] = [];
  for (const c of camps.filter((c) => c.clicks >= 10 && cpc > 0 && c.cost / c.clicks >= cpc * 1.3).slice(0, 3)) items.push({ title: `단가 조정: ${c.name || c.campaign_id} 입찰가 10% 낮추기`, detail: `지난 7일 CPC ${won(Math.round(c.cost / c.clicks))} — 평균 ${won(Math.round(cpc))}의 1.3배 이상(클릭 ${Math.round(c.clicks)}·광고비 ${won(Math.round(c.cost))}).`, expected: '같은 예산으로 클릭 10% 안팎 늘기', cost: '없음(입찰가 변경은 광고 운영 화면에서 사람이 실행)', action: 'bid_down' });
  for (const c of camps.filter((c) => c.impressions >= 1000 && ctrAvg > 0 && c.clicks / c.impressions <= ctrAvg * 0.5).slice(0, 2)) items.push({ title: `소재 교체: ${c.name || c.campaign_id}`, detail: `CTR ${((c.clicks / c.impressions) * 100).toFixed(2)}% — 평균 ${(ctrAvg * 100).toFixed(2)}%의 절반 이하(노출 ${Math.round(c.impressions)}).`, expected: 'CTR 회복 → CPC 하락', cost: '제작 크레딧(소재 1~2개)', action: 'creative' });
  const best = camps.filter((c) => c.clicks >= 10).sort((a, b) => a.cost / a.clicks - b.cost / b.clicks)[0];
  if (best) items.push({ title: `방향: ${best.name || best.campaign_id}(${best.provider}) 비중 늘리기`, detail: `지난 7일 CPC ${won(Math.round(best.cost / best.clicks))}로 가장 효율이 좋음${best.conversions ? ` · 전환 ${Math.round(best.conversions)}` : ''}.`, expected: '전체 CPC 하락', cost: '예산 재배분(총액 그대로)', action: 'shift' });
  if (prev.cost > 0 && cost >= prev.cost * 1.3) items.push({ title: `예산 페이스: 이번 주 광고비 ${won(Math.round(cost))} — 지난주 ${won(Math.round(prev.cost))}의 ${Math.round((cost / prev.cost) * 100)}%`, detail: '월 예산 소진이 빨라짐. 남은 기간 하루 예산 점검.', expected: '월 예산 안에서 운영', cost: '없음', action: 'pace' });
  const [posts] = await sql<{ n: number }[]>`select count(*)::int n from mkt_contents where tenant = ${tenant} and not is_test and status = 'published' and published_at > now() - interval '7 days'`;
  items.push({ title: '협업·제휴 1건 접촉', detail: `지난 7일 게시 ${posts.n}건. 같은 고객층의 지역 업체·기관 1곳에 공동 이벤트·상호 소개를 제안(대상은 대표 확인).`, expected: '신규 문의 경로', cost: '없음', action: 'collab' });
  if (!camps.length) items.unshift({ title: '광고 데이터 없음 — 광고 계정 연결·동기화 확인', detail: '지난 7일 광고 성과가 들어오지 않아 단가 조정 제안을 만들 수 없습니다.', expected: '다음 주부터 단가·소재 제안', cost: '없음', action: 'connect' });
  const week = `${d7.slice(5)}~${td.slice(5)}`;
  const [n] = await sql<{ id: string }[]>`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_by) values (${tenant}, 'weekly', ${`주간 운영 제안 (${week})`}, ${`지난 7일 광고비 ${won(Math.round(cost))} · 클릭 ${Math.round(clicks)}${cpc ? ` · CPC ${won(Math.round(cpc))}` : ''} · 게시 ${posts.n}건. 제안 ${items.length}건 — 승인하면 항목마다 담당 업무로 만듭니다.`},
    ${sql.json({ items: items.slice(0, 6), rationale: `캠페인 ${camps.length}개 · 지난주 광고비 ${won(Math.round(prev.cost))} · 클릭 ${Math.round(prev.clicks)}`, numbers: { cost, clicks, cpc, prevCost: prev.cost, posts: posts.n }, week } as never)}, 'template', ${monthKst()}, ${actorId}) returning id`;
  await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `AI 마케터 주간 운영 제안 ${items.length}건 (${week})`, body: items[0]?.title ?? '', link: '/s/marketing/approvals?tab=proposals', entityType: 'mkt_proposal', entityId: n.id, dedupeKey: `mktops:weekly:${tenant}:${td}` }).catch(() => {});
  return { created: 1, id: n.id, items: items.length };
}
export async function opsTickAll() {
  const ts = await db()<{ tenant: string }[]>`select tenant from mkt_brands union select tenant from mkt_ad_budgets union select tenant from mkt_ad_accounts limit 20`;
  const out = [];
  for (const t of ts) out.push({ tenant: t.tenant, ...(await opsTick(t.tenant).catch((e) => ({ error: String(e?.message ?? e) }))) });
  return out;
}
export { zUuid };
