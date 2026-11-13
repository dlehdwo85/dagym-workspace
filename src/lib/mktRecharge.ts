import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { forbidden, notFound } from './errors';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';
import { notify } from './notifications';
import { sendMail } from './mail';
import { todaySeoul } from './time';
import { appUrl } from './mail';

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
/** 322차 #897(대표 11/02 00:0x): 잔액 알림 기준 기본값(원) — 회사 설정 low_balance_krw 로 바꿈 */
export const LOW_BALANCE_DEFAULT_KRW = 10000;
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
export type BalanceRow = { id: string; provider: string; label: string; account_id: string | null; balance: number; currency: string; source: 'manual' | 'api'; checked_at: string; pace: number; days: number | null; level: 'ok' | 'warn' | 'action'; link: string; how: string;
  /** 402차 #1028 끊기면 안 되는 계정(남은 날 14·7·3일·잔액 0 에 대표 메일) */ guard: boolean; guard_stage: number | null; guard_on: string | null };
/** 끊김 방지 메일 단계(남은 날) — 이 날수 아래로 내려갈 때마다 메일. 3일 아래와 잔액 0 은 채워질 때까지 하루 1번 다시 */
export const GUARD_STAGES = [14, 7, 3] as const;
export const guardStageOf = (r: { balance: number; days: number | null }): number | null =>
  r.balance <= 0 ? 0 : r.days === null ? null : r.days < 3 ? 3 : r.days < 7 ? 7 : r.days < 14 ? 14 : null;

/**
 * 광고 계정별 최근 7일 하루 평균 지출(원, 예전과 같은 기간 — 서울 오늘 기준 7일 전부터 ÷ 7).
 * 364차(노트북 11/05): 예전엔 매체(네이버) 전체 합계를 계정마다 똑같이 써서 '다짐·하이링크'와 '바디랩 두정점' 비즈머니가 같은 하루 평균(10,517원)으로
 * 계산됨 → 바디랩 3.2일(실제 약 10일)로 잘못 '충전 필요'. 잔액은 계정마다 따로 빠지므로 그 계정 캠페인 비용으로 나눔.
 */
async function paceByAccount(tenant: string) {
  const rows = await db()<{ id: string; provider: string; label: string; cost: number }[]>`select a.id, a.provider, a.label, coalesce(sum(s.cost_krw), 0)::float8 / 7 as cost
    from mkt_ad_accounts a left join mkt_ad_stats s on s.account_id = a.id and s.day >= (now() at time zone 'Asia/Seoul')::date - 7
    where a.tenant = ${tenant} and a.status <> 'disconnected' group by a.id, a.provider, a.label`;
  return rows.map((r) => ({ ...r, cost: Number(r.cost) }));
}
/** 잔액 줄 → 그 잔액을 쓰는 계정의 하루 평균: 연결된 계정(account_id) → 같은 매체·같은 이름 계정 → 그 매체 계정이 하나뿐이면 그 계정 → 아니면 매체 합계(직접 입력한 잔액이 어느 계정 것인지 모를 때) */
function paceOf(r: { provider: string; label: string; account_id: string | null }, accs: Awaited<ReturnType<typeof paceByAccount>>) {
  const same = accs.filter((a) => a.provider === r.provider);
  const hit = (r.account_id && same.find((a) => a.id === r.account_id)) || same.find((a) => a.label.trim() === r.label.trim()) || (same.length === 1 ? same[0] : null);
  return hit ? hit.cost : same.reduce((s, a) => s + a.cost, 0);
}
export async function balancesView(tenant: string): Promise<BalanceRow[]> {
  const accs = await paceByAccount(tenant);
  const rows = await db()<any[]>`select id, provider, label, account_id, balance_krw::float8 as balance, currency, source, checked_at, guard, guard_stage, guard_on::text as guard_on from mkt_ad_balances where tenant = ${tenant} order by provider, label`;
  return rows.map((r) => {
    const p = paceOf(r, accs); const days = p > 0 ? r.balance / p : null;
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
  const low = await lowBalanceAlerts(tenant, rows).catch(() => 0); // 322차 #897: 기준 금액 미만 → 대표 알림 + 메일(페이스 카드와 별개)
  const guard = await guardAlerts(tenant, rows).catch(() => 0); // 402차 #1028: 끊기면 안 되는 계정 — 남은 날 14·7·3일·잔액 0 에 대표 메일
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
    await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'usage_alert', title, body: `${detail} 승인 뒤 충전 페이지로 이동할 수 있습니다.`, link: '/s/marketing/approvals?tab=proposals', entityType: 'mkt_proposal', dedupeKey: `mkt:recharge:${tenant}:${key}:${new Date().toISOString().slice(0, 10)}`, push: r.level === 'action' });
  }
  return { cards, done, balances: rows.length, low, guard };
}

/**
 * 402차 #1028(대표 11/13 "하이링크는 절대 네이버 광고 비용이 닳아서 광고가 진행 안 되는 상황이 연출되어선 안 됩니다. 이 부분은 메일로 따로 알려 주세요"):
 * 끊김 방지(guard)를 켠 매체 잔액 줄 — 남은 날이 14일·7일·3일 아래로 내려갈 때마다 회사 대표(소유자)에게 메일 + 워크인 알림(충전 카드·금액 기준 알림과 별개).
 * 같은 단계는 하루 1번을 넘지 않고, 3일 아래와 잔액 0(광고 멈춤)은 채워질 때까지 하루 1번 다시 알린다. 14일 위로 올라오면 표시를 비워 다음에 내려가면 또 알림.
 * 충전 자체는 매체 화면에서(돈 쓰는 일은 자동으로 안 함). 잔액은 켠 계정만 1시간마다 다시 읽는다(marketingAds.syncBalances).
 */
export async function guardAlerts(tenant: string, rows: BalanceRow[]) {
  const sql = db(); const today = todaySeoul();
  const targets = rows.filter((r) => r.guard);
  if (!targets.length) return 0;
  const owners = await sql<{ id: string; email: string | null }[]>`select id, email from users where tenant = ${tenant} and status = 'active' and not is_demo and role = 'owner' order by created_at`;
  let n = 0;
  for (const r of targets) {
    const stage = guardStageOf(r); const prev = r.guard_stage;
    if (stage === null) { if (prev !== null) await sql`update mkt_ad_balances set guard_stage = null, guard_on = null where id = ${r.id}`; continue; }
    const worse = prev === null || stage < prev;           // 새로 내려감(더 급한 단계)
    const again = stage <= 3 && r.guard_on !== today;       // 3일 아래·잔액 0 은 하루 1번 다시
    if (!worse && !again) { if (stage !== prev) await sql`update mkt_ad_balances set guard_stage = ${stage} where id = ${r.id}`; continue; } // 조금 채워 덜 급해진 것은 조용히 단계만 맞춤
    const name = `${RECHARGE_LINKS[r.provider]?.label ?? r.provider}${r.label ? ` ${r.label}` : ''}`;
    const daysTxt = r.days === null ? '계산 못함(최근 지출 없음)' : `약 ${r.days}일`;
    const title = stage === 0 ? `광고가 멈춥니다 — ${name} 잔액 ${won(r.balance)}` : `광고 잔액 ${daysTxt}분 남음(${stage}일 아래) — ${name} ${won(r.balance)}`;
    const when = new Date(r.checked_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const L = RECHARGE_LINKS[r.provider];
    const lines = [
      stage === 0 ? `${name} 잔액이 0원입니다. 충전할 때까지 광고가 나가지 않습니다.` : `${name} 잔액이 지금 속도로 ${daysTxt}분 남았습니다(${stage}일 아래로 내려감).`,
      '',
      `잔액: ${won(r.balance)} (${r.source === 'api' ? '매체 조회' : '직접 입력'} ${when})`,
      `하루 평균 지출(최근 7일): ${won(r.pace)}`,
      `남은 날: ${daysTxt}`,
      '',
      `충전 경로: ${L?.label ?? r.provider} › ${L?.how ?? ''}`,
      ...(L?.url ? [`충전 페이지: ${L.url}`] : []),
      `워크인 매체 잔액 화면: ${appUrl()}/s/marketing/connections`,
      '',
      stage <= 3 ? '잔액이 채워질 때까지 하루에 한 번 다시 알려 드립니다.' : `다음 알림: 남은 날이 ${stage === 14 ? 7 : 3}일 아래로 내려갈 때.`,
      '이 메일은 마케팅 › 연결 계정 › 매체 잔액에서 [끊김 방지 메일]을 켠 계정에만 갑니다.',
    ];
    if (owners.length) {
      await notify(sql, { userIds: owners.map((o) => o.id), type: 'usage_alert', title, body: lines[0], link: '/s/marketing/connections', entityType: 'mkt_balance', entityId: r.id, space: 'marketing', dedupeKey: `mktguard:${r.id}:${stage}:${today}` }).catch(() => {});
      for (const o of owners) if (o.email) await sendMail(o.email, `[워크인] ${title}`, lines.join('\n')).catch(() => {});
    }
    await sql`update mkt_ad_balances set guard_stage = ${stage}, guard_on = ${today}::date where id = ${r.id}`;
    n++;
  }
  return n;
}
export const guardInput = z.object({ id: z.string().uuid(), guard: z.boolean() });
/** 끊김 방지 메일 켜기·끄기(관리자) — 켜면 바로 한 번 확인해 이미 기준 아래면 메일 */
export async function setGuard(u: SessionUser, i: z.infer<typeof guardInput>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('끊김 방지 메일 설정은 관리자가 합니다');
  const t = tenantOf(u);
  const r = await db()`update mkt_ad_balances set guard = ${i.guard}, guard_stage = null, guard_on = null where id = ${i.id} and tenant = ${t} returning id`;
  if (!r.length) throw notFound('잔액 줄이 없습니다');
  const sent = i.guard ? await guardAlerts(t, await balancesView(t)).catch(() => 0) : 0;
  return { ok: true, sent, balances: await balancesView(t) };
}

/**
 * 322차 #897(대표 11/02 00:0x '잔여 비즈머니로 우선 진행하고 10,000원 미만으로 떨어졌을 때 대표자한테 워크인에서 알림'):
 * 페이스(며칠분) 카드와 별개로, 잔액이 기준 금액(회사 설정 low_balance_krw, 기본 1만 원) 미만이면 회사 대표(소유자)에게 워크인 알림 + 메일.
 * 매체 잔액 줄마다 하루(서울) 1번 · 잔액이 기준 위로 올라오면 표시를 비워 다음에 다시 내려가면 또 알림. 충전 자체는 매체에서(돈 쓰는 일은 자동으로 안 함)
 */
async function lowBalanceAlerts(tenant: string, rows: BalanceRow[]) {
  const sql = db();
  const S = await (await import('./mktAuto')).settingsOf(tenant);
  const min = S.low_balance_krw ?? LOW_BALANCE_DEFAULT_KRW;
  if (!(min > 0) || !rows.length) return 0;
  const today = todaySeoul();
  const marks = Object.fromEntries((await sql<{ id: string; on: string | null }[]>`select id, low_alerted_on::text as on from mkt_ad_balances where tenant = ${tenant}`).map((r) => [r.id, r.on]));
  const owners = await sql<{ id: string; email: string | null }[]>`select id, email from users where tenant = ${tenant} and status = 'active' and not is_demo and role = 'owner' order by created_at`;
  let n = 0;
  for (const r of rows) {
    if (r.balance >= min) { if (marks[r.id]) await sql`update mkt_ad_balances set low_alerted_on = null where id = ${r.id}`; continue; }
    if (marks[r.id] === today) continue;
    const name = `${RECHARGE_LINKS[r.provider]?.label ?? r.provider}${r.label ? ` ${r.label}` : ''}`;
    const title = `광고 잔액 ${won(r.balance)} — ${won(min)} 미만: ${name}`;
    const when = new Date(r.checked_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const body = `${name} 잔액이 ${won(r.balance)}입니다(${r.source === 'api' ? '매체 조회' : '직접 입력'} ${when}). 광고가 멈추지 않게 충전해 주세요.${r.link ? ` 충전: ${RECHARGE_LINKS[r.provider]?.how ?? ''}` : ''}`;
    if (owners.length) {
      // 하루 1번은 low_alerted_on 이 막음 — 같은 날 기준 위로 올랐다가 다시 내려가면 새 알림(금액이 달라 알림 중복 키도 다름)
      await notify(sql, { userIds: owners.map((o) => o.id), type: 'usage_alert', title, body, link: '/s/marketing/connections', entityType: 'mkt_balance', entityId: r.id, space: 'marketing', dedupeKey: `mktlow:${r.id}:${today}:${Math.round(r.balance)}` }).catch(() => {});
      for (const o of owners) if (o.email) await sendMail(o.email, `[워크인] ${title}`, `${body}\n\n매체 잔액 화면: ${appUrl()}/s/marketing/connections${r.link ? `\n충전 페이지: ${r.link}` : ''}\n\n알림 기준은 마케팅 › 연결 계정 › 매체 잔액에서 바꿀 수 있습니다.`).catch(() => {});
    }
    await sql`update mkt_ad_balances set low_alerted_on = ${today}::date where id = ${r.id}`;
    n++;
  }
  return n;
}
