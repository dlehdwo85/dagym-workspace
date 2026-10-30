import { db } from './db';
import { assertSpace } from './spaces';
import { isAdmin } from './access';
import { forbidden, notFound } from './errors';
import { tenantOf, type SessionUser } from './types';

/**
 * 275차 #809(대표 10/29 '월 실제 비용 한도 추천 — 상용화 했을 때 기준으로 시험해 보고 싶다'): 우리 회사(내부)를 고객처럼 요금제 그대로 돌려 보고
 * 브랜드별 이번 달 글 작성 AI 비용(원)·이미지·영상 생성 크레딧(원 환산)·승인률·수정 요청 수와, 요금제 가격 대비 원가율을 한 줄로.
 * 원가 구조라 우리 회사 관리자만 본다(고객사에는 404). 품질 문턱 = 결정 15-22 시안 승인률 70%
 */
export const TRIAL_BAR = 0.7;
export async function trialView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const A = await import('./mktAuto');
  const t = tenantOf(u);
  if (t !== A.INTERNAL_TENANT) throw notFound();
  if (!isAdmin(u)) throw forbidden('관리자만 봅니다');
  const sql = db();
  const [s, plans, cc] = await Promise.all([A.settingsOf(t), A.planTable(), A.creditCost()]);
  const plan = s.plan_code ? plans[s.plan_code] ?? null : null;
  const usdKrw = (await import('./ai/provider')).usdKrw();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const ms = new Date(`${today.slice(0, 7)}-01T00:00:00+09:00`);
  const krw = sql`coalesce(a.cost_krw, a.cost_usd * ${usdKrw})`;
  const rows = await sql<{ id: string; name: string; test: boolean; produced: number; text_krw: number; credits: number; approved: number; changes: number; decided: number }[]>`
    select b.id, b.name, b.test_mode as test,
      (select count(*)::int from mkt_contents c where c.brand_id = b.id and c.deleted_at is null and c.produced_at >= ${ms}) as produced,
      (select coalesce(sum(${krw}), 0)::float8 from ai_usage a join mkt_contents c on c.id = a.mkt_content_id where c.brand_id = b.id and a.tenant = ${t} and a.created_at >= ${ms}) as text_krw,
      (select coalesce(sum(l.credits), 0)::float8 from mkt_credit_ledger l join mkt_contents c on c.id = l.content_id where c.brand_id = b.id and l.tenant = ${t} and l.created_at >= ${ms} and l.kind <> 'text') as credits,
      (select count(*) filter (where d.decision = 'approve')::int from mkt_decisions d join mkt_contents c on c.id = d.content_id where c.brand_id = b.id and d.decided_at >= ${ms}) as approved,
      (select count(*) filter (where d.decision = 'changes')::int from mkt_decisions d join mkt_contents c on c.id = d.content_id where c.brand_id = b.id and d.decided_at >= ${ms}) as changes,
      (select count(*)::int from mkt_decisions d join mkt_contents c on c.id = d.content_id where c.brand_id = b.id and d.decided_at >= ${ms}) as decided
    from mkt_brands b where b.tenant = ${t} order by b.test_mode, b.name`;
  // 브랜드를 알 수 없는 글 작성 비용(275차 전 기록 · 키트 AI · 운영실 등 콘텐츠 없는 마케팅 AI)
  const [other] = await sql<{ krw: number }[]>`select coalesce(sum(${krw}), 0)::float8 as krw from ai_usage a where a.tenant = ${t} and a.created_at >= ${ms} and a.purpose like 'marketing%'
    and (a.mkt_content_id is null or not exists (select 1 from mkt_contents c where c.id = a.mkt_content_id and c.brand_id is not null))`;
  const per = cc.krwPerCreditMax; const r0 = (n: number) => Math.round(n);
  const brands = rows.filter((b) => !b.test || b.produced || b.decided || b.text_krw || b.credits).map((b) => {
    const creditKrw = b.credits * per;
    return { id: b.id, name: b.name, test: b.test, produced: b.produced, textKrw: r0(b.text_krw), credits: Math.round(b.credits * 10) / 10, creditKrw: r0(creditKrw), costKrw: r0(b.text_krw + creditKrw),
      approved: b.approved, changes: b.changes, decided: b.decided, approvalRate: b.decided ? Math.round((b.approved / b.decided) * 1000) / 1000 : null };
  });
  const sum = (k: 'textKrw' | 'creditKrw' | 'approved' | 'decided' | 'changes' | 'produced') => brands.reduce((a, b) => a + b[k], 0);
  const costKrw = sum('textKrw') + sum('creditKrw') + r0(other.krw);
  const decided = sum('decided');
  return { month: today.slice(0, 7), bar: TRIAL_BAR, perCreditKrw: per, plan: plan ? { code: plan.code, label: plan.label, price: plan.price } : null, brands, otherTextKrw: r0(other.krw),
    total: { produced: sum('produced'), textKrw: sum('textKrw') + r0(other.krw), creditKrw: sum('creditKrw'), costKrw, approved: sum('approved'), changes: sum('changes'), decided,
      approvalRate: decided ? Math.round((sum('approved') / decided) * 1000) / 1000 : null, ratio: plan?.price ? Math.round((costKrw / plan.price) * 1000) / 1000 : null } };
}
