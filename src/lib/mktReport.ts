import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden } from './errors';
import { tenantOf, type SessionUser } from './types';

/**
 * 상용화 ⑧ 월간 마케팅 보고: 게시 수(채널별)·승인 소요·자동 제작·광고 성과·전화 문의·크레딧·AI 사용.
 * 화면(/s/marketing/report, 인쇄 = PDF 저장) + 매월 1일 9시 이후 지난달 보고를 받는 사람에게 알림·메일(메일 설정이 있을 때).
 */
const kst = (d: string) => new Date(`${d}T00:00:00+09:00`);
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
export const prevMonth = (m = thisMonth()) => { const [y, mo] = m.split('-').map(Number); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`; };
const nextMonth = (m: string) => { const [y, mo] = m.split('-').map(Number); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`; };

export async function monthlyReport(tenant: string, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('달은 YYYY-MM');
  const sql = db();
  const from = kst(`${month}-01`), to = kst(`${nextMonth(month)}-01`);
  const [posts, byChannel, approvals, auto, ads, calls, credits, ai] = await Promise.all([
    sql<any[]>`select count(*) filter (where status = 'published' and published_at >= ${from} and published_at < ${to})::int as published,
        count(*) filter (where scheduled_at >= ${from} and scheduled_at < ${to} and status <> 'canceled')::int as scheduled,
        count(*) filter (where scheduled_at >= ${from} and scheduled_at < ${to} and status = 'canceled')::int as canceled
      from mkt_contents where tenant = ${tenant} and not is_test`,
    sql<any[]>`select channel, count(*)::int n from mkt_contents where tenant = ${tenant} and not is_test and status = 'published' and published_at >= ${from} and published_at < ${to} group by channel order by n desc`,
    // 승인 소요 = 그 버전이 올라온 때 → 승인한 때(시간)
    sql<any[]>`select count(*) filter (where d.decision = 'approve')::int as approved, count(*) filter (where d.decision = 'changes')::int as changes, count(*) filter (where d.decision = 'hold')::int as held,
        round((avg(extract(epoch from d.decided_at - v.created_at)) filter (where d.decision = 'approve') / 3600)::numeric, 1)::float8 as avg_hours
      from mkt_decisions d join mkt_contents c on c.id = d.content_id join mkt_versions v on v.content_id = d.content_id and v.version = d.version
      where c.tenant = ${tenant} and not c.is_test and d.decided_at >= ${from} and d.decided_at < ${to}`,
    sql<any[]>`select count(*)::int as produced, count(*) filter (where (quality->>'passed')::boolean is false)::int as quality_failed
      from mkt_contents where tenant = ${tenant} and auto and not is_test and produced_at >= ${from} and produced_at < ${to}`,
    sql<any[]>`select a.provider, coalesce(sum(s.impressions), 0)::float8 impressions, coalesce(sum(s.clicks), 0)::float8 clicks, coalesce(sum(s.cost_krw), 0)::float8 cost_krw, coalesce(sum(s.conversions), 0)::float8 conversions
      from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${tenant} and s.day >= ${`${month}-01`}::date and s.day < ${`${nextMonth(month)}-01`}::date group by a.provider order by a.provider`,
    sql<any[]>`select count(*)::int as total, count(*) filter (where status = 'lead')::int as leads from mkt_calls where tenant = ${tenant} and called_at >= ${from} and called_at < ${to}`,
    sql<any[]>`select kind, coalesce(sum(credits), 0)::float8 credits, count(*)::int n from mkt_credit_ledger where tenant = ${tenant} and created_at >= ${from} and created_at < ${to} group by kind order by kind`,
    sql<any[]>`select coalesce(sum(cost_usd), 0)::float8 usd, count(*)::int n from ai_usage where tenant = ${tenant} and purpose like 'marketing%' and created_at >= ${from} and created_at < ${to}`,
  ]);
  const adTotal = ads.reduce((a, r) => ({ impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, cost_krw: a.cost_krw + r.cost_krw, conversions: a.conversions + r.conversions }), { impressions: 0, clicks: 0, cost_krw: 0, conversions: 0 });
  // 대표 10/20 20:00 ③ CAC·ROI: 광고비 ÷ 새 리드(없으면 문의), (매출 − 광고비) ÷ 광고비 — 매출 = 영업 계약 등록 금액(+플랫폼 회사 워크인 결제는 화면에서)
  const roi = await (await import('./mktOps')).cacRoi(tenant, month, adTotal.cost_krw, false).catch(() => null);
  const savings = await (await import('./adOps')).agencySavings(tenant, adTotal.cost_krw); // 광고 최적화 1차 ④ 대행사 대비 절감액(추정)
  return { month, posts: { ...posts[0], byChannel }, approvals: approvals[0], auto: auto[0], roi, savings, ads: { byProvider: ads, total: { ...adTotal, ctr: adTotal.impressions ? Math.round((adTotal.clicks / adTotal.impressions) * 10000) / 100 : 0, cpc: adTotal.clicks ? Math.round(adTotal.cost_krw / adTotal.clicks) : 0 } },
    calls: calls[0], credits: { byKind: credits, total: Math.round(credits.reduce((a, r) => a + r.credits, 0) * 100) / 100 }, ai: { usd: Math.round(ai[0].usd * 10000) / 10000, requests: ai[0].n, krw: Math.round(ai[0].usd * (Number(process.env.USD_KRW) || 1400)) } };
}

export const reportQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
/** 화면: 마케팅 공간 멤버. 광고 비용·크레딧이 들어 있어 관리자만(광고 성과 화면과 같은 기준이 아니라 더 좁게) */
export async function reportView(u: SessionUser, q: z.infer<typeof reportQuery>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('월간 보고는 관리자가 봅니다');
  const t = tenantOf(u);
  const [co] = await db()<{ name: string }[]>`select name from tenants where id = ${t}`;
  return { company: co?.name ?? '', ...(await monthlyReport(t, q.month ?? prevMonth())), thisMonth: thisMonth() };
}

/** 1달러 미만은 소수 넷째 자리까지($0.0028), 그 이상은 둘째 자리 */
export const usd = (v: number) => (v > 0 && v < 1 ? String(Math.round(v * 10000) / 10000) : (Math.round(v * 100) / 100).toFixed(2));
function summaryText(company: string, r: Awaited<ReturnType<typeof monthlyReport>>, link: string) {
  const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
  return [`${company} ${r.month} 마케팅 월간 보고`, '',
    `게시 ${r.posts.published}건(예정 ${r.posts.scheduled} · 취소 ${r.posts.canceled})${r.posts.byChannel.length ? ` — ${r.posts.byChannel.map((c: any) => `${c.channel} ${c.n}`).join(', ')}` : ''}`,
    `승인 ${r.approvals.approved}건 · 수정 요청 ${r.approvals.changes} · 보류 ${r.approvals.held}${r.approvals.avg_hours != null ? ` · 평균 승인 소요 ${r.approvals.avg_hours}시간` : ''}`,
    `자동 제작 ${r.auto.produced}건(품질 검사 미통과 ${r.auto.quality_failed})`,
    `광고 노출 ${r.ads.total.impressions.toLocaleString('ko-KR')} · 클릭 ${r.ads.total.clicks.toLocaleString('ko-KR')}(클릭률 ${r.ads.total.ctr}%) · 비용 ${won(r.ads.total.cost_krw)} · 전환 ${r.ads.total.conversions}`,
    ...(r.savings.amount > 0 ? [`대행사 대비 절감액(추정) ${won(r.savings.amount)} — 광고비 × 대행 수수료율 ${r.savings.pct}%`] : []),
    `전화 문의 ${r.calls.total}건(영업 리드 ${r.calls.leads})`,
    `크레딧 ${r.credits.total} · 마케팅 AI 약 ${won(r.ai.krw)}($${usd(r.ai.usd)}, ${r.ai.requests}회)`, '', `자세히: ${link}`].join('\n');
}

/** 매월 1일 9시(서울) 이후 tick 1회: 지난달에 마케팅 활동이 있던 회사 → 받는 사람에게 알림 + 메일(설정 시). 회사·달마다 한 번 */
export async function monthlyReportJob() {
  const now = new Date();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(now));
  if (!day.endsWith('-01') && process.env.MKT_REPORT_ANYDAY !== '1') return { skipped: 'not first day' };
  if (hour < 9 && process.env.MKT_REPORT_ANYDAY !== '1') return { skipped: 'before 9' };
  const month = prevMonth(day.slice(0, 7));
  const sql = db();
  const from = kst(`${month}-01`), to = kst(`${nextMonth(month)}-01`);
  const tenants = await sql<{ tenant: string }[]>`select distinct tenant from mkt_contents where not is_test
    and ((published_at >= ${from} and published_at < ${to}) or (scheduled_at >= ${from} and scheduled_at < ${to}) or (created_at >= ${from} and created_at < ${to}))
    and not exists (select 1 from app_settings where key = 'mktreport:' || mkt_contents.tenant || ':' || ${month}) limit 5`;
  const { approvers } = await import('./mktAuto');
  const { sendMail, appUrl, mailConfigured } = await import('./mail');
  const out = [];
  for (const { tenant } of tenants) {
    const r = await monthlyReport(tenant, month);
    const [co] = await sql<{ name: string }[]>`select name from tenants where id = ${tenant}`;
    const ids = await approvers(tenant);
    const link = `${appUrl()}/s/marketing/report?month=${month}`;
    await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', userIds: ids, role: { kind: 'marketing_brand', ref: '' }, type: 'usage_alert', title: `${month} 마케팅 월간 보고`, body: `게시 ${r.posts.published}건 · 승인 ${r.approvals.approved}건 · 광고 비용 ${Math.round(r.ads.total.cost_krw).toLocaleString('ko-KR')}원`, link: `/s/marketing/report?month=${month}`, dedupeKey: `mktreport:${tenant}:${month}` });
    let mailed = 0;
    if (mailConfigured()) for (const u of await sql<{ email: string }[]>`select email from users where id = any(${ids}::uuid[]) and email is not null`) {
      await sendMail(u.email, `[워크인] ${month} 마케팅 월간 보고`, summaryText(co?.name ?? '', r, link)).then(() => { mailed++; }).catch(() => {});
    }
    await sql`insert into app_settings (key, value) values (${`mktreport:${tenant}:${month}`}, ${sql.json({ at: now.toISOString(), notified: ids.length, mailed })}) on conflict (key) do nothing`;
    out.push({ tenant, month, notified: ids.length, mailed });
  }
  return out;
}
