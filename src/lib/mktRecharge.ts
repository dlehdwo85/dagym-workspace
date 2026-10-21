import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { forbidden } from './errors';
import { notify } from './notifications';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';

/**
 * 대표 10/21 14:30 #411 광고비 충전 흐름:
 * 매체 잔액이 최근 7일 지출 페이스 기준 n일분(경고 7일·조치 3일) 아래 → 운영실 신호 카드 "충전 필요: <매체> 잔액 x원(약 n일)" → 대표 승인 → 충전 안내(금액 제안 + 매체 충전 페이지 딥링크)
 * → 다음 동기화에서 잔액이 올라간 것을 감지하면 카드가 자동 '완료'. 결제(충전) 자체는 API 로 불가 — 알림·승인·딥링크·확인까지만 자동.
 * 잔액은 API 로 읽히는 매체(네이버 비즈머니·Meta 상한)는 자동, 구글 선불·Higgsfield 는 관리자가 직접 입력.
 */
export const RECHARGE_WARN_DAYS = 7, RECHARGE_ACTION_DAYS = 3, RECHARGE_TARGET_DAYS = 30;
export const RECHARGE_LINKS: Record<string, { label: string; url: string; how: string }> = {
  google: { label: 'Google Ads', url: 'https://ads.google.com/aw/billing/summary', how: '결제 › 요약 › [금액 추가]' },
  naver: { label: '네이버 검색광고', url: 'https://searchad.naver.com/', how: '광고주센터 › 비즈머니 › [충전하기]' },
  meta: { label: 'Meta 광고', url: 'https://business.facebook.com/billing_hub/payment_settings', how: '청구 및 결제 › 결제 수단·지출 상한' },
  higgsfield: { label: 'Higgsfield', url: 'https://open.higgsfield.ai/billing', how: 'Billing › 잔액 충전' },
};
export const PROVIDERS = Object.keys(RECHARGE_LINKS);
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export type BalanceRow = { id: string; provider: string; label: string; account_id: string | null; balance: number; currency: string; source: 'manual' | 'api'; checked_at: string; pace: number; days: number | null; level: 'ok' | 'warn' | 'action'; link: string; how: string };

/** 매체별 최근 7일 하루 평균 지출(원) */
async function paceByProvider(tenant: string) {
  const rows = await db()<{ provider: string; cost: number }[]>`select a.provider, coalesce(sum(s.cost_krw), 0)::float8 / 7 as cost from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${tenant} and s.day >= (now() at time zone 'Asia/Seoul')::date - 7 group by a.provider`;
  return Object.fromEntries(rows.map((r) => [r.provider, Number(r.cost)])) as Record<string, number>;
}
export async function balancesView(tenant: string): Promise<BalanceRow[]> {
  const pace = await paceByProvider(tenant);
  const rows = await db()<any[]>`select id, provider, label, account_id, balance_krw::float8 as balance, currency, source, checked_at from mkt_ad_balances where tenant = ${tenant} order by provider, label`;
  return rows.map((r) => {
    const p = pace[r.provider] ?? 0; const days = p > 0 ? r.balance / p : null;
    const level: BalanceRow['level'] = days === null ? 'ok' : days < RECHARGE_ACTION_DAYS ? 'action' : days < RECHARGE_WARN_DAYS ? 'warn' : 'ok';
    const L = RECHARGE_LINKS[r.provider] ?? { label: r.provider, url: '', how: '' };
    return { ...r, pace: Math.round(p), days: days === null ? null : Math.round(days * 10) / 10, level, link: L.url, how: L.how };
  });
}
export const balanceInput = z.object({ provider: z.enum(['google', 'naver', 'meta', 'higgsfield']), label: z.string().trim().max(80).default(''), balanceKrw: z.number().min(0).max(1e10), note: z.string().trim().max(200).optional() });
/** 관리자가 직접 입력(API 로 못 읽는 매체·확인용) — 같은 매체·라벨이면 덮어씀 */
export async function setBalance(u: SessionUser, i: z.infer<typeof balanceInput>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('잔액 입력은 관리자가 합니다');
  const t = tenantOf(u);
  await db()`insert into mkt_ad_balances (tenant, provider, label, balance_krw, currency, source, checked_at, updated_by, note) values (${t}, ${i.provider}, ${i.label}, ${i.balanceKrw}, 'KRW', 'manual', now(), ${u.id}, ${i.note ?? null})
    on conflict (tenant, provider, label) do update set balance_krw = excluded.balance_krw, source = 'manual', checked_at = now(), updated_by = excluded.updated_by, note = excluded.note`;
  const out = await rechargeCheck(t).catch(() => null);
  return { ok: true, balances: await balancesView(t), check: out };
}
/**
 * 정기 실행: ① API 잔액 갱신 ② 페이스 대비 n일분 아래면 카드(같은 매체 카드가 열려 있으면 중복 없음) ③ 열린 카드의 매체 잔액이 카드 만들 때보다 충분히 올랐으면 자동 완료
 */
export async function rechargeCheck(tenant: string) {
  const sql = db();
  await (await import('./marketingAds')).syncBalances(tenant).catch(() => null);
  const rows = await balancesView(tenant);
  let cards = 0, done = 0;
  const open = await sql<any[]>`select id, status, body from mkt_proposals where tenant = ${tenant} and kind = 'alert' and body->>'signal' like 'recharge:%' and status in ('pending', 'approved')`;
  for (const r of rows) {
    const key = `recharge:${r.provider}:${r.label}`;
    const cur = open.find((p) => p.body?.signal === key);
    // ③ 자동 완료: 잔액이 카드 당시보다 제안 금액의 절반 이상 올랐거나 경고 기준을 넘김
    if (cur) {
      const at = Number(cur.body?.balanceAt ?? 0), amt = Number(cur.body?.amount ?? 0);
      if (r.balance >= at + Math.max(amt * 0.5, 1) || (r.level === 'ok' && r.balance > at)) {
        await sql`update mkt_proposals set status = 'done', executed = ${sql.json({ auto: true, detected: '잔액 상승 감지', balanceNow: r.balance, at: new Date().toISOString() })}, updated_at = now() where id = ${cur.id}`;
        done++;
      }
      continue;
    }
    if (r.level === 'ok') continue;
    // ② 카드
    const amount = Math.max(10000, Math.ceil(Math.max(0, r.pace * RECHARGE_TARGET_DAYS - r.balance) / 10000) * 10000);
    const title = `충전 필요: ${RECHARGE_LINKS[r.provider]?.label ?? r.provider}${r.label ? ` ${r.label}` : ''} 잔액 ${won(r.balance)}(약 ${r.days}일)`;
    const detail = `최근 7일 하루 평균 지출 ${won(r.pace)} 기준 약 ${r.days}일분 남았습니다(${r.level === 'action' ? '3일 미만' : '7일 미만'}).`;
    await sql`insert into mkt_proposals (tenant, kind, title, summary, body, source, month) values (${tenant}, 'alert', ${title.slice(0, 200)}, ${detail},
      ${sql.json({ signal: key, level: r.level, provider: r.provider, label: r.label, balanceAt: r.balance, pace: r.pace, days: r.days, amount, link: r.link,
        items: [{ title: `충전 제안 ${won(amount)}`, detail: `약 ${RECHARGE_TARGET_DAYS}일분(하루 ${won(r.pace)} × ${RECHARGE_TARGET_DAYS}일 − 잔액)으로 맞추는 금액. 승인하면 아래 충전 페이지에서 결제하세요 — 충전은 매체 화면에서만 됩니다(API 불가).`, expected: '광고 중단 방지', cost: won(amount) },
          { title: '충전 방법', detail: `${RECHARGE_LINKS[r.provider]?.label ?? r.provider} › ${r.how}`, expected: '', cost: '' }],
        rationale: `잔액 ${won(r.balance)}(${r.source === 'api' ? '매체 API 조회' : '직접 입력'}, ${new Date(r.checked_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}) · 하루 평균 지출 ${won(r.pace)}. 충전이 확인되면(다음 동기화에서 잔액 상승) 이 카드는 자동 완료됩니다.` })}, 'ai', ${new Date().toISOString().slice(0, 7)})`;
    cards++;
    await notify(sql, { userIds: await (await import('./mktAuto')).approvers(tenant), type: 'usage_alert', title, body: `${detail} 승인 뒤 충전 페이지로 이동할 수 있습니다.`, link: '/s/marketing/approvals?tab=proposals', entityType: 'mkt_proposal', dedupeKey: `mkt:recharge:${tenant}:${key}:${new Date().toISOString().slice(0, 10)}`, push: r.level === 'action' });
  }
  return { cards, done, balances: rows.length };
}
