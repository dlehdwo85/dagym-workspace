import { db, type Sql } from './db';
import { notFound } from './errors';
import type { SessionUser } from './types';

/**
 * 마케팅 주간 퍼널(V28 마케팅 운영실 요청) — 숫자만, 개인정보 없음.
 * 가입 회사(회사형, 내부·데모 제외) → 팀 초대 완료(활성 2명 이상) → 실사용(가입 7일 안에 업무 5건 이상 또는 3일 이상 접속).
 * 주 = 서울 기준 월요일 시작. 출처 = 가입 때 남긴 utm_source(없으면 "direct").
 */
export async function funnelStats(weeks = 8) {
  const sql = db();
  const n = Math.min(Math.max(Math.floor(weeks) || 8, 1), 52);
  const rows = await sql<{ week: string; source: string; signups: number; invited: number; active: number; maturing: number }[]>`
    with t as (
      select t.id, t.created_at, coalesce(nullif(t.signup_utm->>'source', ''), 'direct') as source,
        to_char(date_trunc('week', t.created_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as week
      from tenants t
      where t.kind = 'company' and t.id not in ('default', 'demo') and t.status <> 'deleted' and not t.is_test
        and t.created_at >= (date_trunc('week', now() at time zone 'Asia/Seoul') - ${`${n - 1} weeks`}::interval) at time zone 'Asia/Seoul'
    ), m as (
      select t.*,
        (select count(*) from users u where u.tenant = t.id and u.status = 'active' and not u.signup_pending) as users,
        (select count(*) from tasks k join users u on u.id = k.created_by where u.tenant = t.id and k.created_at < t.created_at + interval '7 days') as tasks7,
        (select count(distinct d.day) from user_active_days d where d.tenant = t.id and d.day < (t.created_at at time zone 'Asia/Seoul')::date + 7) as days7
      from t
    )
    select week, source, count(*)::int signups, count(*) filter (where users >= 2)::int invited,
      count(*) filter (where tasks7 >= 5 or days7 >= 3)::int active,
      count(*) filter (where created_at > now() - interval '7 days')::int maturing
    from m group by week, source order by week desc, signups desc`;
  const weeksOut = [...new Set(rows.map((r) => r.week))].map((week) => {
    const rs = rows.filter((r) => r.week === week);
    const sum = (k: 'signups' | 'invited' | 'active' | 'maturing') => rs.reduce((s, r) => s + r[k], 0);
    return { week, signups: sum('signups'), invited: sum('invited'), active: sum('active'), maturing: sum('maturing'),
      bySource: rs.map(({ source, signups, invited, active, maturing }) => ({ source, signups, invited, active, maturing })) };
  });
  const total = { signups: 0, invited: 0, active: 0 };
  for (const w of weeksOut) { total.signups += w.signups; total.invited += w.invited; total.active += w.active; }
  return { generatedAt: new Date().toISOString(), steps: await stepStats(30), weeks: n, definition: { invited: '활성 사용자 2명 이상', active: '가입 7일 안 업무 5건 이상 또는 3일 이상 접속', maturing: '가입 7일이 안 지나 실사용 판정 진행 중' }, total, byWeek: weeksOut };
}

export async function platformFunnel(u: SessionUser, weeks?: number) {
  if (!u.platformAdmin) throw notFound();
  return funnelStats(weeks);
}

/** 읽기 전용 토큰(FUNNEL_STATS_TOKEN) — 없으면 API 자체가 없음(404) */
export function funnelTokenOk(header: string | null) {
  const want = process.env.FUNNEL_STATS_TOKEN;
  if (!want || want.length < 16) return null;
  if (!header?.startsWith('Bearer ')) return false;
  const got = header.slice(7);
  if (got.length !== want.length) return false;
  let d = 0; for (let i = 0; i < got.length; i++) d |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

// ---------------- V32 3 가입 단계별 이탈 ----------------
export const SIGNUP_STEPS = [['account_view', '① 계정 화면'], ['company_view', '② 회사 화면'], ['submitted', '가입 신청'], ['verified', '이메일 확인·회사 생성'], ['channels_done', '③ 연락 채널'], ['invite_done', '④ 동료 초대']] as const;
export type SignupStep = typeof SIGNUP_STEPS[number][0];
/** 같은 사람(브라우저 anon 또는 회사)의 같은 단계는 1번만 */
export async function recordStep(step: SignupStep, who: { anon?: string | null; tenant?: string | null }, sql: Sql = db()) {
  if (who.tenant && ['default', 'demo'].includes(who.tenant)) return;
  try {
    if (who.tenant) await sql`insert into signup_steps (tenant, step) values (${who.tenant}, ${step}) on conflict (tenant, step) where tenant is not null do nothing`;
    else if (who.anon) await sql`insert into signup_steps (anon, step) values (${who.anon}, ${step}) on conflict (anon, step) where anon is not null do nothing`;
  } catch { /* 기록 실패는 가입을 막지 않음 */ }
}
export async function stepStats(days = 30) {
  const rows = await db()<{ step: string; n: number }[]>`select s.step, count(*)::int n from signup_steps s left join tenants t on t.id = s.tenant
    where s.created_at > now() - make_interval(days => ${days}) and coalesce(t.is_test, false) = false group by s.step`;
  const n = (k: string) => rows.find((r) => r.step === k)?.n ?? 0;
  return SIGNUP_STEPS.map(([k, label], i) => {
    const prev = i ? n(SIGNUP_STEPS[i - 1][0]) : null;
    return { step: k, label, n: n(k), fromPrev: prev ? Math.round((n(k) / prev) * 100) : null };
  });
}
