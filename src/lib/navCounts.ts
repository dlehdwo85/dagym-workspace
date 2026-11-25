import { type Sql } from './db';
import { AREA_SQL_RE, DOT_AREAS, HUB_AREA, menuArea, spaceOfArea, spaceSums, type SpaceKey } from './notifAreas';
import { tenantOf, type SessionUser } from './types';

/**
 * #1171(대표 11/26 "영업 알림이 14개인데 영업 메뉴에 표시된 건 7개"): 메뉴 숫자 한 곳에서 세기.
 * 규칙(슬랙 방식) — 공간 전환 칸의 숫자 = 그 공간 사이드바 숫자들의 합. 공간 전환에 세는 것은 반드시 사이드바 어느 메뉴에든 숫자로 보인다.
 *  · 메뉴 숫자 = 그 화면으로 가는 안 읽은 알림 수(394차 '화면별 알림'과 같은 기준, notifAreas)
 *  · 영업 기회 허브 = 안 본 오늘 공고: 오늘 아침 공고 알림(공고 메일과 같은 묶음)을 아직 안 열었으면 그 묶음의 공고 수(열면 0)
 *  · 결재 = 내가 결재할 것 · 마케팅 승인함 = 승인할 것(시안 + 운영 요청) — 안 읽은 알림 수보다 크면 이 수
 *  · 설정 경고(영업 데이터 설정의 수집 누락 · 마케팅 연결 계정)는 숫자 대신 빨간 점, 합계에서 뺌
 *  · 공통 메뉴(캘린더·알림·메시지·자료실 등)는 어느 공간에서나 보이므로 공간 합계에 넣지 않음
 */
export type NavCounts = { areas: Record<string, number>; counts: Record<string, number>; dots: string[]; sums: Record<SpaceKey, number>; hubUnseen: number; approvalsTodo: number;
  /** #1173 숫자 설명(메뉴에 마우스를 올리거나 길게 누르면) */ why: Record<string, string> };
export async function navCounts(sql: Sql, u: SessionUser, opt: { spaces?: string[]; approvalsTodo?: number } = {}): Promise<NavCounts> {
  const areas: Record<string, number> = Object.fromEntries((await sql<{ a: string; n: number }[]>`select regexp_replace(split_part(split_part(link, '?', 1), '#', 1), ${AREA_SQL_RE}, '\\1') as a, count(*)::int as n
      from notifications where user_id = ${u.id} and read_at is null and type <> 'chat' and link like '/%' group by 1`).map((r) => [r.a, r.n]));
  // 메뉴가 없는 하위 화면의 알림은 그 화면을 여는 메뉴 숫자로 접음(AREA_ALIAS)
  const notifs: Record<string, number> = {};
  for (const [a, n] of Object.entries(areas)) { const m = menuArea(a)!; notifs[m] = (notifs[m] ?? 0) + n; }
  const counts: Record<string, number> = { ...notifs };
  // 영업 기회 허브: 오늘 공고 알림(안 읽음)은 1건이 아니라 그 묶음의 공고 수로
  const dg = await sql<{ n: number }[]>`select greatest(coalesce((d.counts->>'total')::int, 0), 1) as n from notifications n
      join sales_digests d on d.tenant = ${tenantOf(u)} and d.day = (now() at time zone 'Asia/Seoul')::date and n.dedupe_key like 'salesdigest:' || d.tenant || ':' || d.day::text || '%'
      where n.user_id = ${u.id} and n.read_at is null and n.dedupe_key like 'salesdigest:%' and n.created_at > now() - interval '2 days'`;
  const hubUnseen = dg.reduce((a, r) => a + r.n, 0);
  if (dg.length) counts[HUB_AREA] = Math.max(0, (counts[HUB_AREA] ?? 0) - dg.length) + hubUnseen;
  // 결재할 것 · 마케팅 승인할 것
  const approvalsTodo = opt.approvalsTodo ?? (await (await import('./approvalForms')).todoCount(sql, u).catch(() => 0));
  if (approvalsTodo > (counts['/approvals'] ?? 0)) counts['/approvals'] = approvalsTodo;
  const spaces = opt.spaces ?? (await (await import('./spaces')).userSpaces(u, sql).catch(() => ['work']));
  let mk: { drafts: number; ops: number } | null = null;
  if (spaces.includes('marketing')) {
    mk = await (await import('./marketing')).approvalCounts(tenantOf(u)).catch(() => ({ drafts: 0, ops: 0 }));
    if (mk.drafts + mk.ops > (counts['/s/marketing/approvals'] ?? 0)) counts['/s/marketing/approvals'] = mk.drafts + mk.ops;
  }
  // 들어갈 수 없는 공간 화면의 숫자는 빼 둠(공간을 끈 뒤 남은 알림)
  for (const a of Object.keys(counts)) { const sp = spaceOfArea(a); if (sp && sp !== 'work' && !spaces.includes(sp)) delete counts[a]; }
  const dots = Object.keys(counts).filter((a) => DOT_AREAS.has(a) && counts[a] > 0);
  // #1173: 숫자마다 무엇을 세는지 — 메뉴에 마우스를 올리면(휴대폰은 길게 누르면) 보이는 글
  const why: Record<string, string> = {};
  const notif = (a: string, minus = 0) => { const n = (notifs[a] ?? 0) - minus; return n > 0 ? `안 읽은 알림 ${n}건` : ''; };
  const join = (...xs: string[]) => xs.filter(Boolean).join(' · ');
  for (const a of Object.keys(counts)) {
    if (!(counts[a] > 0)) continue;
    if (DOT_AREAS.has(a)) why[a] = `${notif(a) || '확인할 것 있음'} — 설정 경고·정보 알림이라 숫자 대신 점(공간 숫자에 넣지 않음)`;
    else if (a === HUB_AREA) why[a] = join(hubUnseen ? `안 본 오늘 공고 ${hubUnseen}건(오늘 아침 공고 알림을 아직 안 엶 — '오늘 새 공고'를 열면 0)` : '', notif(a, dg.length));
    else if (a === '/approvals') why[a] = join(approvalsTodo ? `내가 결재할 것 ${approvalsTodo}건` : '', approvalsTodo >= (notifs[a] ?? 0) ? '' : notif(a)) || notif(a);
    else if (a === '/s/marketing/approvals' && mk) why[a] = join(`승인할 것 ${mk.drafts + mk.ops}건(승인 대기 시안 ${mk.drafts} · 운영 승인 ${mk.ops})`, notif(a) ? `${notif(a)}(같은 일에 대한 알림 — 큰 쪽 숫자만 셈)` : '');
    else why[a] = `${notif(a)}(이 화면으로 가는 알림 — 열어 보면 줄어듦)`;
  }
  return { areas, counts, dots, sums: spaceSums(counts), hubUnseen, approvalsTodo, why };
}
