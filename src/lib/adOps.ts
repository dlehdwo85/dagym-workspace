import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { decrypt } from './crypto';
import { audit } from './log';
import { notify } from './notifications';
import { tenantOf, type SessionUser } from './types';

/**
 * V44 ① AI 광고 운영실 — 네이버 검색광고 '쓰기'(파워링크 먼저, 플레이스 다음).
 * 원칙(대표 10/19, 결정 전 기본값): 월 광고비 상한 필수 입력 · 초과 시 워크인이 만든 광고 자동 중지 · 이상 징후 선제 중지는 알림만.
 * - 세팅안(draft) → [승인하고 시작] = 네이버에 **꺼진 상태(userLock)** 로 생성 → [켜기](돈이 나가는 변경, 관리자 승인 = 누름 + 상한 검사).
 * - 모든 변경은 mkt_ad_changes 에 전후 값으로 기록, [되돌리기] 가능. 서버는 승인된 요청만 실행(AI 는 제안까지).
 * - 네이버 API 경로·필드는 공식 문서 기준(확인일 10/19, AI_ADS_API_SURVEY.md) — 실계정 생성 시험 전까지 '구조 시험'.
 */
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
const NAVER = () => (T() ? `${T()}/naver` : 'https://api.searchad.naver.com');
const ymKst = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(d); // YYYY-MM
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('광고 운영은 관리자가 합니다'); }
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

type NaverAcc = { id: string; tenant: string; external_id: string; secret_enc: string | null };
async function naverReq(a: NaverAcc, method: 'GET' | 'POST' | 'PUT', path: string, query = '', body?: unknown) {
  const s = a.secret_enc ? JSON.parse(decrypt(a.secret_enc)) : {};
  const ts = String(Date.now());
  const sig = createHmac('sha256', String(s.secretKey ?? '')).update(`${ts}.${method}.${path}`).digest('base64');
  const r = await fetch(`${NAVER()}${path}${query}`, { method, signal: AbortSignal.timeout(20000),
    headers: { 'X-Timestamp': ts, 'X-API-KEY': String(s.apiKey ?? ''), 'X-Customer': a.external_id, 'X-Signature': sig, 'content-type': 'application/json; charset=UTF-8' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok) throw new HttpError(502, 'naver_upstream', `네이버 검색광고 API 오류 ${r.status} ${method} ${path} ${String(j?.title ?? j?.message ?? '').slice(0, 200)}${j?.code ? ` [code ${j.code}]` : ''}`.trim());
  return j;
}

// ---------------- 세팅안 검사(광고 심사 위반 문구·글자 수·입찰가) ----------------
/** 업종 공통 위험 표현(네이버 검색광고 심사·표시광고법 기준 요약 — 업종별 규칙은 다음 단계에서 추가) */
const RISKY: [RegExp, string][] = [
  [/최고|최상|최초|1위|넘버원|No\.?\s?1/i, '최상급·순위 표현은 객관적 근거가 있어야 합니다'],
  [/100\s?%|무조건|보장|확실/, '보장·단정 표현은 심사에서 반려될 수 있습니다'],
  [/완치|치료|효능|부작용\s?없/, '의료 효능 표현은 의료광고 심의 대상입니다'],
  [/원금|수익\s?보장|고수익/, '금융 수익 보장 표현은 쓸 수 없습니다'],
];
const NAVER_OK = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 .,!?%&()+\-/:'"~@#*\[\]]$/;
export const planInput = z.object({
  accountId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  dailyBudget: z.number().int().min(50).max(10_000_000),          // 원, 캠페인 하루 예산
  channelId: z.string().trim().min(1).max(60),                     // 비즈채널(웹사이트) id — 네이버에 먼저 등록된 것
  bidAmt: z.number().int().min(70).max(100_000),                   // 그룹 기본 입찰가
  keywords: z.array(z.string().trim().min(1).max(25)).min(1).max(50),
  ads: z.array(z.object({ headline: z.string().trim().min(1), description: z.string().trim().min(1), url: z.string().url().max(500) })).min(1).max(3),
});
export function precheck(p: z.infer<typeof planInput>) {
  const issues: string[] = [];
  p.ads.forEach((a, i) => {
    if ([...a.headline].length > 15) issues.push(`소재 ${i + 1} 제목은 15자 이내(지금 ${[...a.headline].length}자)`);
    if ([...a.description].length > 45) issues.push(`소재 ${i + 1} 설명은 45자 이내(지금 ${[...a.description].length}자)`);
    for (const [re, msg] of RISKY) if (re.test(`${a.headline} ${a.description}`)) issues.push(`소재 ${i + 1}: ${msg}`);
  });
  // 네이버 소재 허용 문자(운영 10/19: 가운데점 '·' 으로 400 code 1030) — 한글·영문·숫자·공백·일부 기호만
  p.ads.forEach((a, i) => { const bad = [...new Set([...`${a.headline}${a.description}`].filter((ch) => !NAVER_OK.test(ch)))];
    if (bad.length) issues.push(`소재 ${i + 1}: 네이버에서 쓸 수 없는 문자 ${bad.map((c) => `'${c}'`).join(' ')} — 빼거나 바꿔 주세요(예: · → ,)`); });
  const dup = p.keywords.filter((k, i) => p.keywords.indexOf(k) !== i);
  if (dup.length) issues.push(`겹치는 키워드: ${[...new Set(dup)].join(', ')}`);
  return issues;
}

// ---------------- 상한·이번 달 광고비 ----------------
async function monthSpend(tenant: string) {
  const [r] = await db()<{ spend: number }[]>`select coalesce(sum(s.cost_krw), 0)::float as spend from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${tenant} and s.day >= ((now() at time zone 'Asia/Seoul')::date - (extract(day from (now() at time zone 'Asia/Seoul'))::int - 1))`;
  return Number(r?.spend ?? 0);
}
async function capOf(tenant: string) {
  const [c] = await db()<{ monthly_cap: string; stopped_month: string | null }[]>`select monthly_cap, stopped_month from mkt_ad_caps where tenant = ${tenant}`;
  return c ? { monthlyCap: Number(c.monthly_cap), stoppedMonth: c.stopped_month } : null;
}
export const capInput = z.object({ monthlyCap: z.number().int().min(10_000).max(1_000_000_000) });
export async function setCap(u: SessionUser, i: z.infer<typeof capInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const prev = await capOf(tenantOf(u));
  await db()`insert into mkt_ad_caps (tenant, monthly_cap, updated_by) values (${tenantOf(u)}, ${i.monthlyCap}, ${u.id})
    on conflict (tenant) do update set monthly_cap = excluded.monthly_cap, updated_by = excluded.updated_by, updated_at = now(), stopped_month = case when excluded.monthly_cap > mkt_ad_caps.monthly_cap then null else mkt_ad_caps.stopped_month end`;
  await audit(db(), u.id, 'mkt_ads.cap', 'tenant', null, { before: prev?.monthlyCap ?? null, after: i.monthlyCap }).catch(() => {});
  return { ok: true };
}

// ---------------- 화면 데이터 ----------------
export async function adOpsOverview(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const [cap, spend] = await Promise.all([capOf(t), monthSpend(t)]);
  const accounts = await sql`select id, label, external_id from mkt_ad_accounts where tenant = ${t} and provider = 'naver' and status <> 'disconnected' order by created_at`;
  const plans = await sql<any[]>`select p.id, p.account_id, p.kind, p.name, p.plan, p.status, p.external, p.error, p.created_at, p.approved_at, a.label as account_label, ab.name as approved_by_name
    from mkt_ad_plans p join mkt_ad_accounts a on a.id = p.account_id left join users ab on ab.id = p.approved_by where p.tenant = ${t} and p.status <> 'archived' order by p.created_at desc limit 50`;
  const changes = await sql<any[]>`select c.id, c.plan_id, c.kind, c.before, c.after, c.money_up, c.status, c.error, c.revert_of, c.created_at, u.name as actor_name
    from mkt_ad_changes c left join users u on u.id = c.actor_id where c.tenant = ${t} order by c.created_at desc limit 100`;
  return { canEdit: isAdmin(u), cap, monthSpend: spend, month: ymKst(), accounts, plans: plans.map((p) => ({ ...p, issues: precheck(p.plan) })), changes };
}

/** 비즈채널(웹사이트) 목록 — 세팅안에서 고르기 */
export async function naverChannels(u: SessionUser, accountId: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const a = await naverAcc(tenantOf(u), accountId);
  const rows: any[] = (await naverReq(a, 'GET', '/ncc/channels')) ?? [];
  // 운영 10/19: 실제 계정에서 빈 목록 — 웹사이트 비즈채널 종류 값은 'SITE'(문서·계정마다 'WEB_SITE' 표기도 있음). 웹사이트를 먼저, 없으면 모든 채널(종류 표시)
  const all = (Array.isArray(rows) ? rows : []).map((c) => ({ id: String(c.nccBusinessChannelId ?? c.id ?? ''), name: String(c.name ?? c.channelKey ?? c.nccBusinessChannelId ?? ''), url: c.channelKey ?? c.businessInfo?.site ?? null, type: String(c.channelTp ?? c.type ?? '') })).filter((c) => c.id);
  const sites = all.filter((c) => /^(SITE|WEB_SITE)$/i.test(c.type) || (!c.type && /^https?:/i.test(String(c.url ?? ''))));
  return { channels: sites.length ? sites : all, total: all.length };
}
async function naverAcc(tenant: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [a] = await db()<NaverAcc[]>`select id, tenant, external_id, secret_enc from mkt_ad_accounts where id = ${id} and tenant = ${tenant} and provider = 'naver' and status <> 'disconnected'`;
  if (!a) throw notFound('네이버 검색광고 계정을 찾을 수 없습니다');
  return a;
}
async function planOf(tenant: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [p] = await db()<any[]>`select * from mkt_ad_plans where id = ${id} and tenant = ${tenant}`;
  if (!p) throw notFound('세팅안을 찾을 수 없습니다');
  return p;
}

// ---------------- 세팅안 → 생성(꺼진 상태) ----------------
export async function createPlan(u: SessionUser, i: z.infer<typeof planInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  await naverAcc(tenantOf(u), i.accountId);
  const { accountId, name, ...plan } = i;
  const [p] = await db()`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, created_by) values (${tenantOf(u)}, ${accountId}, 'naver', 'powerlink', ${name}, ${db().json(plan as never)}, ${u.id}) returning id`;
  return { id: p.id, issues: precheck(i) };
}

/** 세팅안 고치기(만들기 전·실패 뒤) — 이미 네이버에 만든 부분(캠페인·그룹)은 그대로, 남은 단계에 새 값 사용 */
export async function updatePlan(u: SessionUser, id: string, i: z.infer<typeof planInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const p = await planOf(tenantOf(u), id);
  if (p.status !== 'draft' && p.status !== 'failed') throw new HttpError(409, 'plan_locked', '네이버에 만든 뒤에는 세팅안을 고칠 수 없습니다 — 끄기·하루 예산만 바꿀 수 있습니다');
  const { accountId: _a, name, ...plan } = i;
  await db()`update mkt_ad_plans set name = ${name}, plan = ${db().json(plan as never)}, updated_at = now() where id = ${id}`;
  return { id, issues: precheck(i) };
}

/** [승인하고 시작]: 상한 필수 → 검사 통과 → 네이버에 캠페인·그룹·키워드·소재를 모두 꺼진 상태로 생성 */
export async function approvePlan(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (p.status !== 'draft' && p.status !== 'failed') throw new HttpError(409, 'plan_not_draft', '이미 만든 세팅안입니다');
  if (!(await capOf(t))) throw new HttpError(409, 'cap_required', '먼저 회사 월 광고비 상한을 정해 주세요');
  const issues = precheck(p.plan);
  if (issues.length) throw new HttpError(409, 'precheck_failed', `세팅안 검사를 통과하지 못했습니다: ${issues.join(' · ')}`);
  const a = await naverAcc(t, p.account_id);
  // 같은 세팅안을 동시에 두 번 만들지 않게(운영 10/19: 한 번 눌렀는데 요청 3번) — 만드는 중으로 바꾼 요청만 진행, 나머지는 409
  const [lock] = await sql`update mkt_ad_plans set status = 'creating', updated_at = now() where id = ${id} and status in ('draft', 'failed') returning id`;
  if (!lock) throw new HttpError(409, 'plan_busy', '이미 만드는 중입니다 — 잠시 뒤 새로 고쳐 확인해 주세요');
  const ext: Record<string, unknown> = { ...(p.external ?? {}) };
  try {
    // 실패하면 거기서 멈추고, 이미 만든 id 는 external 에 남김(다시 시도하면 이어서 만듦)
    if (!ext.campaignId) ext.campaignId = String((await naverReq(a, 'POST', '/ncc/campaigns', '', { customerId: Number(a.external_id), name: p.name, campaignTp: 'WEB_SITE', dailyBudget: p.plan.dailyBudget, useDailyBudget: true, userLock: true })).nccCampaignId);
    if (!ext.adgroupId) ext.adgroupId = String((await naverReq(a, 'POST', '/ncc/adgroups', '', { nccCampaignId: ext.campaignId, adgroupType: 'WEB_SITE', name: `${p.name} 그룹`, pcChannelId: p.plan.channelId, mobileChannelId: p.plan.channelId, bidAmt: p.plan.bidAmt, useDailyBudget: false, userLock: true })).nccAdgroupId);
    if (!ext.keywordIds) {
      const kws: any[] = await naverReq(a, 'POST', '/ncc/keywords', `?nccAdgroupId=${encodeURIComponent(String(ext.adgroupId))}`, p.plan.keywords.map((k: string) => ({ nccAdgroupId: ext.adgroupId, keyword: k, useGroupBidAmt: true, userLock: false })));
      ext.keywordIds = (kws ?? []).map((k) => String(k.nccKeywordId));
    }
    if (!ext.adIds) {
      const ids: string[] = [];
      for (const ad of p.plan.ads) ids.push(String((await naverReq(a, 'POST', '/ncc/ads', '', { nccAdgroupId: ext.adgroupId, type: 'TEXT_45', userLock: false, ad: { headline: ad.headline, description: ad.description, pc: { final: ad.url }, mobile: { final: ad.url } } })).nccAdId));
      ext.adIds = ids;
    }
  } catch (e: any) {
    await sql`update mkt_ad_plans set status = 'failed', external = ${sql.json(ext as never)}, error = ${String(e?.message ?? e).slice(0, 300)}, updated_at = now() where id = ${id}`;
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, after, status, error, actor_id) values (${t}, ${id}, 'create', ${sql.json(ext as never)}, 'failed', ${String(e?.message ?? e).slice(0, 300)}, ${u.id})`;
    throw e instanceof HttpError ? e : badRequest('네이버에 만들지 못했습니다');
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set status = 'created', external = ${tx.json(ext as never)}, error = null, approved_by = ${u.id}, approved_at = now(), updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, after, money_up, actor_id) values (${t}, ${id}, 'create', ${tx.json({ ...ext, userLock: true } as never)}, false, ${u.id})`;
  });
  await audit(sql, u.id, 'mkt_ads.plan_create', 'mkt_ad_plan', id, { campaignId: ext.campaignId }).catch(() => {});
  return { ok: true, external: ext };
}

// ---------------- 켜기·끄기·예산 + 되돌리기 ----------------
async function setLock(a: NaverAcc, campaignId: string, lock: boolean) {
  await naverReq(a, 'PUT', `/ncc/campaigns/${campaignId}`, '?fields=userLock', { nccCampaignId: campaignId, userLock: lock });
}
async function guardMoneyUp(t: string, addDaily = 0) {
  const cap = await capOf(t);
  if (!cap) throw new HttpError(409, 'cap_required', '먼저 회사 월 광고비 상한을 정해 주세요');
  const spend = await monthSpend(t);
  if (spend >= cap.monthlyCap) throw new HttpError(409, 'cap_reached', `이번 달 광고비 ${won(spend)} 가 상한 ${won(cap.monthlyCap)} 에 닿아 켤 수 없습니다 — 상한을 올리거나 다음 달에 켜 주세요`);
  return { cap: cap.monthlyCap, spend, addDaily };
}
export const planAction = z.object({ action: z.enum(['enable', 'pause', 'budget']), dailyBudget: z.number().int().min(50).max(10_000_000).optional() });
export async function actPlan(u: SessionUser, id: string, i: z.infer<typeof planAction>, revertOf: string | null = null) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'active', 'paused'].includes(p.status) || !p.external?.campaignId) throw new HttpError(409, 'plan_not_created', '네이버에 만든 뒤에 바꿀 수 있습니다');
  const a = await naverAcc(t, p.account_id);
  const cid = String(p.external.campaignId);
  let before: any, after: any, moneyUp = false, status = p.status;
  if (i.action === 'enable') {
    await guardMoneyUp(t, p.plan.dailyBudget); // 돈이 나가는 변경 — 관리자가 누름 = 승인, 상한 검사
    await setLock(a, cid, false); before = { userLock: true }; after = { userLock: false }; moneyUp = true; status = 'active';
  } else if (i.action === 'pause') {
    await setLock(a, cid, true); before = { userLock: false }; after = { userLock: true }; status = 'paused';
  } else {
    if (!i.dailyBudget) throw badRequest('하루 예산을 넣어 주세요');
    moneyUp = i.dailyBudget > Number(p.plan.dailyBudget);
    if (moneyUp && p.status === 'active') await guardMoneyUp(t, i.dailyBudget - Number(p.plan.dailyBudget));
    await naverReq(a, 'PUT', `/ncc/campaigns/${cid}`, '?fields=budget', { nccCampaignId: cid, dailyBudget: i.dailyBudget, useDailyBudget: true });
    before = { dailyBudget: p.plan.dailyBudget }; after = { dailyBudget: i.dailyBudget };
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set status = ${status}, plan = ${i.action === 'budget' ? tx.json({ ...p.plan, dailyBudget: i.dailyBudget } as never) : tx.json(p.plan as never)}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, ${i.action}, ${tx.json(before)}, ${tx.json(after)}, ${moneyUp}, ${u.id}, ${revertOf})`;
  });
  await audit(sql, u.id, `mkt_ads.${i.action}`, 'mkt_ad_plan', id, { before, after }).catch(() => {});
  return { ok: true, status };
}
/** 되돌리기: 기록의 전 값으로 다시 바꿈(돈이 늘면 같은 상한 검사) */
export async function revertChange(u: SessionUser, changeId: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(changeId)) throw notFound();
  const [c] = await db()<any[]>`select id, plan_id, kind, before, status from mkt_ad_changes where id = ${changeId} and tenant = ${tenantOf(u)}`;
  if (!c || !c.plan_id) throw notFound('변경 기록을 찾을 수 없습니다');
  if (c.status !== 'applied' || !['enable', 'pause', 'budget', 'auto_pause'].includes(c.kind)) throw new HttpError(409, 'not_revertible', '이 기록은 되돌릴 수 없습니다');
  const action = c.kind === 'budget' ? { action: 'budget' as const, dailyBudget: Number(c.before?.dailyBudget) } : { action: (c.before?.userLock ? 'pause' : 'enable') as 'pause' | 'enable' };
  return actPlan(u, c.plan_id, action, c.id);
}

// ---------------- tick: 월 상한 넘으면 워크인이 켠 광고 자동 중지 ----------------
export async function adCapGuard() {
  const sql = db(); const month = ymKst(); let stopped = 0;
  const caps = await sql<{ tenant: string; monthly_cap: string; stopped_month: string | null }[]>`select tenant, monthly_cap, stopped_month from mkt_ad_caps`;
  for (const c of caps) {
    const spend = await monthSpend(c.tenant);
    if (spend < Number(c.monthly_cap)) continue;
    const active = await sql<any[]>`select id, account_id, external from mkt_ad_plans where tenant = ${c.tenant} and status = 'active'`;
    for (const p of active) {
      try {
        const a = await naverAcc(c.tenant, p.account_id);
        await setLock(a, String(p.external.campaignId), true);
        await sql`update mkt_ad_plans set status = 'paused', updated_at = now() where id = ${p.id}`;
        await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up) values (${c.tenant}, ${p.id}, 'auto_pause', ${sql.json({ userLock: false })}, ${sql.json({ userLock: true, reason: 'monthly_cap', spend, cap: Number(c.monthly_cap) } as never)}, false)`;
        stopped++;
      } catch (e: any) {
        await sql`insert into mkt_ad_changes (tenant, plan_id, kind, status, error) values (${c.tenant}, ${p.id}, 'auto_pause', 'failed', ${String(e?.message ?? e).slice(0, 300)})`;
      }
    }
    if (c.stopped_month !== month && active.length) {
      await sql`update mkt_ad_caps set stopped_month = ${month} where tenant = ${c.tenant}`;
      const admins = await (await import('./mktAuto')).approvers(c.tenant);
      await notify(sql, { userIds: admins, type: 'usage_alert', title: `월 광고비 상한 도달 — 워크인 광고 ${active.length}개 중지`, body: `이번 달 ${won(spend)} / 상한 ${won(Number(c.monthly_cap))}`, link: '/s/marketing/ad-ops', dedupeKey: `adcap:${c.tenant}:${month}` });
    }
  }
  return { stopped };
}
