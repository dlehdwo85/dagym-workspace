import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { forbidden } from './errors';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';
import { AD_PROVIDERS, adsOverview } from './marketingAds';
import { aiJson } from './mktOps';

/**
 * 대표 10/21 06:30 ①: 광고 성과 월별 AI 마케터(30년차) 분석 — 좋았던 점·나빴던 점·다음 달 제안 3개.
 * 결과는 app_settings `mkt_ads_analysis:<tenant>:<month>` 에 보관(같은 달은 숫자가 바뀌지 않는 한 다시 만들지 않음, [다시 분석] 은 관리자).
 * [승인 요청 카드로 보내기] → 운영실 카드(kind analysis) → 승인함 '운영 제안' 탭 → 승인하면 업무로. 돈을 쓰는 제안은 모두 승인 뒤 사람이 실행.
 */
export const adsMonthInput = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), force: z.boolean().optional() });
export type AdsAnalysis = { month: string; summary: string; good: string[]; bad: string[]; proposals: { title: string; detail: string; expected: string }[]; source: 'ai' | 'template'; generatedAt: string; fingerprint: string; cardId?: string | null };

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const delta = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%` : a ? '신규' : '—');
const line = (r: any) => `노출 ${Math.round(r.impressions).toLocaleString('ko-KR')} · 클릭 ${Math.round(r.clicks).toLocaleString('ko-KR')} · 비용 ${won(r.cost)} · 전환 ${Math.round(r.conversions)}${r.clicks ? ` · CPC ${won(r.cost / r.clicks)}` : ''}`;

/** 숫자만으로 만드는 기본 분석(AI 없을 때·AI 실패 시) — 사실만, 과장 없음 */
function templateAnalysis(ov: any): Omit<AdsAnalysis, 'month' | 'generatedAt' | 'fingerprint' | 'source'> {
  const t = ov.totals, p = ov.prev; const good: string[] = []; const bad: string[] = [];
  const cpc = t.clicks ? t.cost / t.clicks : 0, pcpc = p.clicks ? p.cost / p.clicks : 0;
  if (t.conversions > p.conversions) good.push(`전환이 전월 ${Math.round(p.conversions)}건 → ${Math.round(t.conversions)}건으로 늘었습니다`);
  if (cpc && pcpc && cpc < pcpc) good.push(`클릭 단가가 ${won(pcpc)} → ${won(cpc)}로 내렸습니다`);
  if (t.clicks > p.clicks && p.clicks) good.push(`클릭이 전월 대비 ${delta(t.clicks, p.clicks)} 늘었습니다`);
  if (cpc && pcpc && cpc > pcpc * 1.2) bad.push(`클릭 단가가 ${won(pcpc)} → ${won(cpc)}로 올랐습니다(20% 이상)`);
  if (t.cost > 0 && !t.conversions) bad.push(`광고비 ${won(t.cost)}를 썼지만 잡힌 전환이 없습니다 — 전환 추적(전화·문의 폼) 연결 확인`);
  if (t.conversions < p.conversions) bad.push(`전환이 전월 ${Math.round(p.conversions)}건 → ${Math.round(t.conversions)}건으로 줄었습니다`);
  const top = (ov.campaigns ?? [])[0]; const topBrand = (ov.byBrand ?? [])[0];
  if (top) good.push(`비용 1위 캠페인 "${top.campaign_name || top.campaign_id}"(${AD_PROVIDERS[top.provider as keyof typeof AD_PROVIDERS] ?? top.provider}) ${line(top)}`);
  if (!good.length) good.push(t.cost ? `이달 합계 ${line(t)}` : '이달 집행된 광고가 없습니다');
  if (!bad.length) bad.push(ov.accounts?.length ? '눈에 띄는 문제는 없습니다 — 전환 추적이 잡히는지 계속 확인' : '연결된 광고 계정이 없어 분석할 숫자가 없습니다');
  const proposals = [
    { title: '성과 좋은 캠페인에 예산 10~20% 더', detail: top ? `"${top.campaign_name || top.campaign_id}" 의 하루 예산을 10~20% 올리고 2주 뒤 CPC·전환을 다시 봅니다` : '연결된 캠페인이 생기면 비용 1위 캠페인부터 조정', expected: '같은 비용으로 전환 +10%' },
    { title: '전환이 없는 캠페인은 키워드·소재 교체', detail: '클릭은 있는데 전환이 없는 캠페인의 키워드 3개·소재 2개를 바꾸고 2주 시험', expected: 'CPA(전환당 비용) 하락' },
    { title: topBrand ? `${topBrand.brand} 랜딩·전화 문의 경로 점검` : '랜딩·전화 문의 경로 점검', detail: '광고 클릭 뒤 전화·문의 폼까지 2번 안에 닿는지 휴대폰에서 직접 확인하고 막히는 곳을 고칩니다', expected: '문의 전환율 개선' },
  ];
  return { summary: `${ov.month} 광고 합계 ${line(t)} (전월 대비 비용 ${delta(t.cost, p.cost)} · 클릭 ${delta(t.clicks, p.clicks)} · 전환 ${delta(t.conversions, p.conversions)}).`, good, bad, proposals };
}

export async function adsMonthAnalysis(u: SessionUser, month: string, opt: { force?: boolean } = {}) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const ov: any = await adsOverview(u, { month });
  const fingerprint = JSON.stringify([Math.round(ov.totals.cost), Math.round(ov.totals.clicks), Math.round(ov.totals.conversions), Math.round(ov.totals.impressions), ov.campaigns.length]);
  const key = `mkt_ads_analysis:${t}:${month}`;
  const prev: AdsAnalysis | null = ov.analysis ?? null;
  if (prev && !opt.force && prev.fingerprint === fingerprint) return prev;
  if (opt.force && !isAdmin(u)) throw forbidden('다시 분석은 대표·관리자만');
  let out: any = null; let source: 'ai' | 'template' = 'template';
  try {
    const mat = [`[이달 ${month}] ${line(ov.totals)}`, `[전월 ${ov.prevMonth}] ${line(ov.prev)}`,
      `[매체별] ${(ov.byProvider ?? []).map((r: any) => `${AD_PROVIDERS[r.provider as keyof typeof AD_PROVIDERS] ?? r.provider}: ${line(r)}`).join(' / ') || '없음'}`,
      `[브랜드별] ${(ov.byBrand ?? []).map((r: any) => `${r.brand}: ${line(r)}`).join(' / ') || '없음'}`,
      `[캠페인 상위] ${(ov.campaigns ?? []).slice(0, 8).map((c: any) => `${c.campaign_name || c.campaign_id}(${c.provider}${c.brand ? `·${c.brand}` : ''}): ${line(c)}`).join(' / ') || '없음'}`].join('\n');
    out = await aiJson(t, u.id, `당신은 경력 30년의 퍼포먼스 마케터입니다. 한 달 광고 성과를 보고 월간 분석을 JSON 으로 씁니다. 사실·숫자는 [재료]에 있는 것만(없으면 '확인 필요'), 과장·최상급 금지, 한국어 존댓말. good·bad 는 각각 2~4개의 한 문장, proposals 는 정확히 3개(다음 달에 할 일: title 한 줄, detail 누가·무엇을·얼마나, expected 기대 효과 한 줄). 돈을 더 쓰는 제안은 '대표 승인 뒤' 전제. summary 는 2문장.`,
      `[재료]\n${mat}`, { type: 'object', properties: { summary: { type: 'string' }, good: { type: 'array', items: { type: 'string' } }, bad: { type: 'array', items: { type: 'string' } },
        proposals: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' }, expected: { type: 'string' } }, required: ['title', 'detail', 'expected'] } } }, required: ['summary', 'good', 'bad', 'proposals'] }, 'mkt_ads_month');
    if (out && Array.isArray(out.proposals) && out.proposals.length) source = 'ai';
  } catch { out = null; }
  const base = source === 'ai' ? { summary: String(out.summary ?? ''), good: (out.good ?? []).map(String).slice(0, 4), bad: (out.bad ?? []).map(String).slice(0, 4),
    proposals: out.proposals.slice(0, 3).map((p: any) => ({ title: String(p.title ?? '').slice(0, 120), detail: String(p.detail ?? '').slice(0, 600), expected: String(p.expected ?? '').slice(0, 200) })) } : templateAnalysis(ov);
  const a: AdsAnalysis = { month, ...base, source, generatedAt: new Date().toISOString(), fingerprint, cardId: null };
  await sql`insert into app_settings (key, value, updated_by) values (${key}, ${sql.json(a as never)}, ${u.id}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  return a;
}

/** 분석 → 운영실 승인 요청 카드(kind analysis). 같은 달 카드가 대기 중이면 그 카드를 돌려줌 */
export async function adsAnalysisCard(u: SessionUser, month: string) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('대표·관리자만');
  const sql = db(); const t = tenantOf(u);
  const a = await adsMonthAnalysis(u, month);
  const [dup] = await sql<{ id: string }[]>`select id from mkt_proposals where tenant = ${t} and kind = 'analysis' and status = 'pending' and body->>'adsMonth' = ${month} limit 1`;
  if (dup) return { id: dup.id, created: false };
  const [row] = await sql<{ id: string }[]>`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_by)
    values (${t}, 'analysis', ${`${month} 광고 성과 분석 — 다음 달 제안 3개`}, ${a.summary.slice(0, 1000)},
      ${sql.json({ items: a.proposals.map((p) => ({ title: p.title, detail: p.detail, expected: p.expected, cost: '승인 뒤 확정' })), rationale: `좋았던 점: ${a.good.join(' / ')}\n나빴던 점: ${a.bad.join(' / ')}`, adsMonth: month, link: `/s/marketing/ads?month=${month}` } as never)},
      ${a.source === 'ai' ? 'ai' : 'template'}, ${month}, ${u.id}) returning id`;
  await sql`update app_settings set value = value || ${sql.json({ cardId: row.id } as never)} where key = ${`mkt_ads_analysis:${t}:${month}`}`;
  const { approvers } = await import('./mktAuto');
  await notify(sql, { userIds: (await approvers(t)).filter((id) => id !== u.id), type: 'review_requested', title: `${month} 광고 성과 분석 — 승인 요청`, body: a.proposals.map((p) => p.title).join(' · '), link: '/s/marketing/approvals?tab=proposals', entityType: 'mkt_proposal', entityId: row.id, dedupeKey: `mktads:card:${t}:${month}` }).catch(() => {});
  return { id: row.id, created: true };
}
