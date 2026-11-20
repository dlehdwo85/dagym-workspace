// 점검 4단계 가운데 "점검 리포트"(숫자·표) — docs/check-feature-design.md 12절 · 원문 범위 4번
//  곳·분야·항목별 양호율 · 반복 항목 · 보완 처리 기간. AI 요약·고객사 보고용 문장은 대표 결정 뒤(여기에는 없음).
//  읽기만 한다(새 표 없음). 점검자 이름·사람별 순위는 싣지 않는다 — 직원 평가표가 아니라 기준이 지켜지는지 보는 표.
//  대표 11/20: 보완 요청을 받은 담당자별 처리 표(받은 수·닫힌 수·평균 처리 기간·기한 넘긴 수)는 넣는다 — 순위·점수 없이 이름순.
import { db } from '../db';
import { accessibleUnitIds, isUuid } from '../access';
import { badRequest, notFound } from '../errors';
import { requireMenu } from '../menuPerms';
import { addDays, todaySeoul } from '../time';
import { tenantOf, type SessionUser } from '../types';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 달력에 있는 날짜인지(2월 31일 같은 값은 DB 가 오류를 내므로 여기서 거름) — 아니면 기본 기간을 씀 */
const realDate = (s: string | null) => { if (!s || !DATE.test(s)) return false; const d = new Date(`${s}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
/** 양호율(%) — 해당 없음은 나누는 수에서 뺌. 본 것이 없으면 null */
export const passRate = (ok: number, fix: number) => (ok + fix > 0 ? Math.round((ok / (ok + fix)) * 1000) / 10 : null);
type Tally = { ok: number; fix: number; na: number };
const tally = (): Tally => ({ ok: 0, fix: 0, na: 0 });
const withRate = <T extends Tally>(x: T) => ({ ...x, rate: passRate(x.ok, x.fix) });

/** 기간 정하기: 없으면 이번 달 1일 ~ 오늘(서울). 최대 366일 */
export function reportPeriod(from: string | null, to: string | null) {
  const today = todaySeoul();
  const t = realDate(to) ? to! : today;
  const f = realDate(from) ? from! : `${t.slice(0, 7)}-01`;
  if (f > t) throw badRequest('기간의 시작이 끝보다 뒤입니다');
  const days = dayDiff(t, f) + 1;
  if (days > 366) throw badRequest('기간은 366일까지 고를 수 있습니다');
  return { from: f, to: t, days, prevFrom: addDays(f, -days), prevTo: addDays(f, -1) };
}

export async function checkReport(u: SessionUser, q: { from?: string | null; to?: string | null; unitId?: string | null }) {
  await requireMenu(u, 'check_report', 'view');
  const sql = db(); const t = tenantOf(u); const today = todaySeoul();
  const p = reportPeriod(q.from ?? null, q.to ?? null);
  const mine = await accessibleUnitIds(u, sql);
  const unitId = q.unitId || null;
  if (unitId) {
    if (!isUuid(unitId)) throw notFound(); // 주소에 엉뚱한 값이 와도 서버 오류가 아니라 없는 곳으로
    const [o] = await sql`select 1 from org_units where id = ${unitId} and tenant = ${t}`;
    if (!o || (mine !== null && !mine.includes(unitId))) throw notFound();
  }
  const scopeR = sql`${mine === null ? sql`` : sql`and r.org_unit_id = any(${mine}::uuid[])`} ${unitId ? sql`and r.org_unit_id = ${unitId}` : sql``}`;
  const scopeF = sql`${mine === null ? sql`` : sql`and f.org_unit_id = any(${mine}::uuid[])`} ${unitId ? sql`and f.org_unit_id = ${unitId}` : sql``}`;
  const endedIn = (a: string, b: string) => sql`r.ended_at is not null and (r.ended_at at time zone 'Asia/Seoul')::date between ${a}::date and ${b}::date`;

  // 끝낸 점검 · 항목별 결과
  const rounds = await sql<{ id: string; org_unit_id: string; unit_name: string; kind: 'regular' | 'sample' | 'adhoc' }[]>`select r.id, r.org_unit_id, o.name as unit_name, r.kind
    from chk_rounds r join org_units o on o.id = r.org_unit_id where r.tenant = ${t} and ${endedIn(p.from, p.to)} ${scopeR}`;
  const results = await sql<{ org_unit_id: string; item_id: string; item_title: string; verdict: 'ok' | 'fix' | 'na'; cat_id: string | null; cat_name: string | null }[]>`select r.org_unit_id, x.item_id, x.item_title, x.verdict,
      coalesce(pc.id, c.id) as cat_id, coalesce(pc.name, c.name) as cat_name
    from chk_results x join chk_rounds r on r.id = x.round_id left join chk_items i on i.id = x.item_id
      left join chk_categories c on c.id = i.category_id left join chk_categories pc on pc.id = c.parent_id
    where x.tenant = ${t} and r.tenant = ${t} and ${endedIn(p.from, p.to)} ${scopeR} order by x.created_at`;
  const [prev] = await sql<{ ok: number; fix: number }[]>`select count(*) filter (where x.verdict = 'ok')::int as ok, count(*) filter (where x.verdict = 'fix')::int as fix
    from chk_results x join chk_rounds r on r.id = x.round_id where x.tenant = ${t} and r.tenant = ${t} and ${endedIn(p.prevFrom, p.prevTo)} ${scopeR}`;
  const [{ n: openRounds }] = await sql<{ n: number }[]>`select count(*)::int as n from chk_rounds r where r.tenant = ${t} and r.ended_at is null ${scopeR}`;

  // 기간 안에 보낸 보완 요청
  const fus = await sql<{ id: string; org_unit_id: string; status: 'requested' | 'ok' | 'canceled'; round_no: number; due: string | null; asked: string; closed: string | null; task_status: string | null; assignee_id: string | null; assignee_name: string | null }[]>`select f.id, f.org_unit_id, f.status, f.round_no, f.assignee_id, au.name as assignee_name,
      f.due_date::text as due, (f.created_at at time zone 'Asia/Seoul')::date::text as asked, (f.closed_at at time zone 'Asia/Seoul')::date::text as closed, tk.status as task_status
    from chk_followups f left join tasks tk on tk.id = f.task_id and tk.deleted_at is null left join users au on au.id = f.assignee_id
    where f.tenant = ${t} and (f.created_at at time zone 'Asia/Seoul')::date between ${p.from}::date and ${p.to}::date ${scopeF}`;

  // 묶기
  const total = tally();
  const units = new Map<string, Tally & { id: string; name: string; rounds: number }>();
  for (const r of rounds) { const x = units.get(r.org_unit_id) ?? { id: r.org_unit_id, name: r.unit_name, rounds: 0, ...tally() }; x.rounds++; units.set(r.org_unit_id, x); }
  const cats = new Map<string, Tally & { id: string | null; name: string }>();
  const items = new Map<string, Tally & { itemId: string; title: string }>();
  const pairs = new Map<string, { itemId: string; title: string; unitId: string; fix: number }>();
  for (const x of results) {
    total[x.verdict]++;
    const un = units.get(x.org_unit_id); if (un) un[x.verdict]++;
    const ck = x.cat_id ?? ''; const c = cats.get(ck) ?? { id: x.cat_id, name: x.cat_name ?? '분야 없음', ...tally() }; c[x.verdict]++; cats.set(ck, c);
    const it = items.get(x.item_id) ?? { itemId: x.item_id, title: x.item_title, ...tally() }; it[x.verdict]++; it.title = x.item_title; items.set(x.item_id, it); // 이름은 가장 나중 기록의 것
    if (x.verdict === 'fix') { const k = `${x.item_id}:${x.org_unit_id}`; const pr = pairs.get(k) ?? { itemId: x.item_id, title: x.item_title, unitId: x.org_unit_id, fix: 0 }; pr.fix++; pr.title = x.item_title; pairs.set(k, pr); }
  }

  // 보완 처리 기간
  const state = (f: (typeof fus)[number]) => (f.status === 'ok' ? 'closed' : f.status === 'canceled' ? 'canceled' : f.task_status === 'done' ? 'waiting' : 'requested');
  const closedDays = fus.filter((f) => f.status === 'ok' && f.closed).map((f) => Math.max(0, dayDiff(f.closed!, f.asked)));
  const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, n) => s + n, 0) / a.length) * 10) / 10 : null);
  const overdue = (f: (typeof fus)[number]) => !!f.due && ((f.status === 'requested' && today > f.due) || (f.status === 'ok' && !!f.closed && f.closed > f.due));
  const followups = {
    total: fus.length, closed: fus.filter((f) => state(f) === 'closed').length, waiting: fus.filter((f) => state(f) === 'waiting').length, requested: fus.filter((f) => state(f) === 'requested').length,
    canceled: fus.filter((f) => state(f) === 'canceled').length, avgDays: avg(closedDays), maxDays: closedDays.length ? Math.max(...closedDays) : null,
    buckets: { d0: closedDays.filter((d) => d === 0).length, d1_3: closedDays.filter((d) => d >= 1 && d <= 3).length, d4_7: closedDays.filter((d) => d >= 4 && d <= 7).length, d8: closedDays.filter((d) => d >= 8).length },
    overdue: fus.filter(overdue).length, again: fus.filter((f) => f.round_no >= 2).length,
  };
  // 담당자별 보완 처리(대표 11/20): 받은 수 · 닫힌 수 · 열린 수 · 평균 처리 기간 · 기한 넘긴 수 — 취소한 요청은 빼고, 이름순
  const people = new Map<string, { id: string | null; name: string; received: number; closed: number; open: number; overdue: number; days: number[] }>();
  for (const f of fus) {
    if (f.status === 'canceled') continue;
    const k = f.assignee_id ?? ''; const x = people.get(k) ?? { id: f.assignee_id, name: f.assignee_name ?? '담당자 없음', received: 0, closed: 0, open: 0, overdue: 0, days: [] };
    x.received++; if (f.status === 'ok') { x.closed++; if (f.closed) x.days.push(Math.max(0, dayDiff(f.closed, f.asked))); } else x.open++;
    if (overdue(f)) x.overdue++;
    people.set(k, x);
  }
  const byAssignee = [...people.values()].map(({ days, ...x }) => ({ ...x, avgDays: avg(days) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const fuByUnit = new Map<string, { open: number; days: number[] }>();
  for (const f of fus) { const x = fuByUnit.get(f.org_unit_id) ?? { open: 0, days: [] }; if (f.status === 'requested') x.open++; if (f.status === 'ok' && f.closed) x.days.push(Math.max(0, dayDiff(f.closed, f.asked))); fuByUnit.set(f.org_unit_id, x); }

  // 반복 항목: 기간 안에 같은 항목·같은 곳 보완 필요 2번 이상 — 지금 몇 번 연속인지(끝낸 점검 기준, 해당 없음은 건너뜀) · 열린 개선 과제
  const rep = [...pairs.values()].filter((x) => x.fix >= 2).sort((a, b) => b.fix - a.fix || a.title.localeCompare(b.title, 'ko')).slice(0, 30);
  const repeats: { itemId: string; title: string; unitId: string; unitName: string; fix: number; streak: number; improvement: boolean }[] = [];
  if (rep.length) {
    const openImp = await sql<{ item_id: string; org_unit_id: string }[]>`select item_id, org_unit_id from chk_improvements where tenant = ${t} and status = 'open' and item_id = any(${rep.map((x) => x.itemId)}::uuid[])`;
    for (const x of rep) {
      const last = await sql<{ verdict: string }[]>`select x2.verdict from chk_results x2 join chk_rounds r2 on r2.id = x2.round_id
        where x2.tenant = ${t} and x2.item_id = ${x.itemId} and r2.org_unit_id = ${x.unitId} and r2.ended_at is not null and x2.verdict <> 'na' order by r2.ended_at desc, x2.created_at desc limit 12`;
      let streak = 0; for (const l of last) { if (l.verdict === 'fix') streak++; else break; }
      repeats.push({ ...x, unitName: units.get(x.unitId)?.name ?? '', streak, improvement: openImp.some((m) => m.item_id === x.itemId && m.org_unit_id === x.unitId) });
    }
  }
  const [{ n: improvementsOpen }] = await sql<{ n: number }[]>`select count(*)::int as n from chk_improvements m where m.tenant = ${t} and m.status = 'open'
    ${mine === null ? sql`` : sql`and m.org_unit_id = any(${mine}::uuid[])`} ${unitId ? sql`and m.org_unit_id = ${unitId}` : sql``}`;

  const byRate = <T extends { rate: number | null; fix: number }>(a: T, b: T) => b.fix - a.fix || (a.rate ?? 101) - (b.rate ?? 101);
  return {
    period: p,
    summary: { rounds: rounds.length, roundsByKind: { regular: rounds.filter((r) => r.kind === 'regular').length, sample: rounds.filter((r) => r.kind === 'sample').length, adhoc: rounds.filter((r) => r.kind === 'adhoc').length },
      openRounds, ...total, rate: passRate(total.ok, total.fix), prevRate: passRate(prev.ok, prev.fix), followups: followups.total, followupsOpen: followups.requested + followups.waiting, avgDays: followups.avgDays, improvementsOpen },
    byUnit: [...units.values()].map((x) => ({ ...withRate(x), followupsOpen: fuByUnit.get(x.id)?.open ?? 0, avgDays: avg(fuByUnit.get(x.id)?.days ?? []) })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    byCategory: [...cats.values()].map(withRate).sort((a, b) => byRate(a, b) || a.name.localeCompare(b.name, 'ko')),
    byItem: [...items.values()].map(withRate).sort((a, b) => byRate(a, b) || a.title.localeCompare(b.title, 'ko')).slice(0, 200),
    repeats, followups, byAssignee,
  };
}

const pct = (r: number | null) => (r === null ? '' : r);
/** 엑셀: 요약 · 곳별 · 분야별 · 항목별 · 보완 요청 · 담당자별 */
export async function exportCheckReport(u: SessionUser, q: { from?: string | null; to?: string | null; unitId?: string | null }) {
  const r = await checkReport(u, q);
  const { writeXlsx } = await import('../xlsx');
  const s = r.summary; const f = r.followups;
  const data = writeXlsx([
    { name: '요약', rows: [['기간', `${r.period.from} ~ ${r.period.to}`], ['끝낸 점검(회)', s.rounds], ['양호', s.ok], ['보완 필요', s.fix], ['해당 없음', s.na], ['양호율(%)', pct(s.rate)], ['지난 기간 양호율(%)', pct(s.prevRate)],
      ['보완 요청(건)', s.followups], ['열린 보완 요청(건)', s.followupsOpen], ['평균 처리 기간(일)', s.avgDays ?? ''], ['열린 개선 과제(건)', s.improvementsOpen], [],
      ['셈 규칙', '기간 안에 끝낸 점검 기준 · 양호율 = 양호 ÷ (양호 + 보완 필요), 해당 없음 제외 · 처리 기간 = 보완 요청을 보낸 날 → 양호 확인으로 닫힌 날']] },
    { name: '곳별', rows: [['곳', '점검(회)', '양호', '보완 필요', '해당 없음', '양호율(%)', '열린 보완 요청', '평균 처리 기간(일)'], ...r.byUnit.map((x) => [x.name, x.rounds, x.ok, x.fix, x.na, pct(x.rate), x.followupsOpen, x.avgDays ?? ''])] },
    { name: '분야별', rows: [['분야', '양호', '보완 필요', '해당 없음', '양호율(%)'], ...r.byCategory.map((x) => [x.name, x.ok, x.fix, x.na, pct(x.rate)])] },
    { name: '항목별', rows: [['항목', '양호', '보완 필요', '해당 없음', '양호율(%)'], ...r.byItem.map((x) => [x.title, x.ok, x.fix, x.na, pct(x.rate)]), [],
      ['반복 항목(같은 곳에서 보완 필요 2번 이상)'], ['항목', '곳', '보완 필요(번)', '지금 연속(번)', '개선 과제'], ...r.repeats.map((x) => [x.title, x.unitName, x.fix, x.streak, x.improvement ? '열림' : ''])] },
    { name: '보완 요청', rows: [['보낸 보완 요청(건)', f.total], ['닫힘(양호 확인)', f.closed], ['확인 대기', f.waiting], ['조치 중', f.requested], ['취소', f.canceled], ['평균 처리 기간(일)', f.avgDays ?? ''], ['가장 긴 처리 기간(일)', f.maxDays ?? ''],
      ['당일', f.buckets.d0], ['1~3일', f.buckets.d1_3], ['4~7일', f.buckets.d4_7], ['8일 이상', f.buckets.d8], ['기한을 넘긴 것', f.overdue], ['다시 보완(2차 이상)', f.again]] },
    { name: '담당자별', rows: [['담당자', '받은 보완 요청', '닫힘(양호 확인)', '열린 것', '평균 처리 기간(일)', '기한을 넘긴 것'], ...r.byAssignee.map((x) => [x.name, x.received, x.closed, x.open, x.avgDays ?? '', x.overdue])] },
  ]);
  return { fileName: `점검리포트_${r.period.from}_${r.period.to}.xlsx`, data };
}
