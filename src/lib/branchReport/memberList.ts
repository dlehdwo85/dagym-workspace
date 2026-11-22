/**
 * #1112(대표 11/22) 하이링크 '회원목록' 엑셀 → 월간 보고 회원(이용권) 현황. 계산은 프로그램(AI 아님).
 * - '전체' 시트만 읽음(동별 시트는 같은 내용 중복). 머리줄 이름으로 칸을 찾고, **이름·연락처 칸은 읽지 않음**(행에서 바로 버림)
 * - 동·호수는 세대 수·동별 수를 세는 데만 쓰고 저장하지 않음. 원본 파일은 보관하지 않고 집계 숫자만 저장
 * - '이용권 상태'를 믿음(만료인데 종료일 빈칸·활성인데 종료일 있음이 섞여 있음)
 * - 시험·직원 줄 제외(기본 켬, 끌 수 있음): 이용권명 '테스트' · 동 999·9999·111·빈칸 — 두 경우를 모두 계산해 두고 화면에서 고름
 * #1115 이용권/수강권: 이용권명별로 모아 두고(v2) 분류는 보일 때 적용 — 분류를 바꿔도 다시 올릴 필요 없음.
 * 순수 함수(서버·화면·시험 공용).
 */
export const MEMBER_GROUPS = ['헬스', '통합(헬스+골프+수영)', 'GX', '수영 강습', '독서실', '락커', '골프 레슨', 'PT', '기타'] as const;
export type MemberGroup = (typeof MEMBER_GROUPS)[number];

const norm = (s: string) => String(s ?? '').replace(/\s+/g, '').trim();
/** 이용권명 → 묶음(순서가 중요: 락커 → 통합 → 독서실 → 골프 레슨 → PT → 수영 → GX → 헬스) */
export function groupOf(pass: string): MemberGroup {
  const p = norm(pass);
  if (/락커/.test(p)) return '락커';
  if (/헬스\+|\+골프|\+수영/.test(p)) return '통합(헬스+골프+수영)';
  if (/독서실/.test(p)) return '독서실';
  if (/골프레슨/.test(p)) return '골프 레슨';
  if (/^PT|PT\d|PT$/i.test(p)) return 'PT';
  if (/수영/.test(p)) return '수영 강습';
  if (/요가|줌바|필라|댄스/.test(p)) return 'GX';
  if (/헬스/.test(p)) return '헬스';
  return '기타';
}

/** 머리줄 → 칸 번호(이름·연락처는 찾지 않음) */
const COLS = { dong: /^동$/, ho: /^호수?$/, pass: /^이용권명$/, amount: /^금액/, start: /^시작일$/, end: /^종료일$/, status: /^이용권상태$|^상태$/, locker: /^락커$/ } as const;
type Col = keyof typeof COLS;
export function headerIndex(header: string[]): Partial<Record<Col, number>> {
  const out: Partial<Record<Col, number>> = {};
  header.forEach((h, i) => { const n = norm(h); for (const [k, re] of Object.entries(COLS) as [Col, RegExp][]) if (out[k] === undefined && re.test(n)) out[k] = i; });
  return out;
}

const EXCLUDE_DONG = new Set(['999', '9999', '111', '']);
const dongKey = (d: string) => norm(d).replace(/동$/, '');
const isTest = (pass: string, dong: string) => /테스트/.test(norm(pass)) || EXCLUDE_DONG.has(dongKey(dong));

/** #1115(대표 11/22) 이용권 / 수강권 — 이용권명 글자로 기본 분류, 이용권명마다 바꿀 수 있음(회사 전체 기억) */
export type PassKind = 'use' | 'class';
export const PASS_KIND_LABEL: Record<PassKind, string> = { use: '이용권', class: '수강권' };
/** 같은 이용권명 판단: 앞뒤·사이 띄어쓰기 무시('여자독서실' = '여자 독서실') */
export const nameKey = (s: string) => norm(s);
/** 기본 분류: 강습·레슨·PT·요가·줌바·필라·댄스·어린이 수영·N회 → 수강권, 나머지(헬스권·통합·독서실·락커 등) → 이용권 */
export function defaultKind(name: string): PassKind {
  return /강습|레슨|PT|요가|줌바|필라|댄스|어린이수영|\d+회/i.test(norm(name)) ? 'class' : 'use';
}

/** 이용권명별 집계(이름·연락처·동호수 없음 — 동은 동별 수로만) */
export type NameAgg = { name: string; active: number; billing: number; newThisMonth: number; endedThisMonth: number; byDong: Record<string, number> };
/**
 * 저장 형태(v2). hh = 세대마다 가진 '활성' 이용권명 묶음(이름 키를 띄어쓰기로 이은 것) → 그런 세대 수.
 * 동·호수는 저장하지 않고, 분류를 바꿔도 이용권/수강권별 세대 수를 다시 셀 수 있게 묶음 수만 남김.
 */
export type MemberAgg = { v: 2; rows: number; names: Record<string, NameAgg>; hh: Record<string, number> };
export const isV2 = (a: unknown): a is MemberAgg => !!a && (a as MemberAgg).v === 2 && !!(a as MemberAgg).names;

/**
 * 행(머리줄 다음부터)을 집계 — month 'YYYY-MM'. 이름·연락처 칸은 headerIndex 가 찾지 않으므로 읽히지 않음.
 * 돌려주는 것: 제외 켬(stats) · 제외 끔(statsAll) · 제외한 줄 수
 */
export function aggregateMembers(header: string[], rows: string[][], month: string) {
  const ix = headerIndex(header);
  const need: Col[] = ['dong', 'ho', 'pass', 'status'];
  const missing = need.filter((k) => ix[k] === undefined);
  if (missing.length) return { ok: false as const, missing };
  const make = () => ({ a: { v: 2, rows: 0, names: {}, hh: {} } as MemberAgg, hh: new Map<string, Set<string>>() });
  const inc = make(), all = make();
  let excluded = 0;
  const cell = (r: string[], k: Col) => (ix[k] === undefined ? '' : String(r[ix[k]!] ?? '').trim());
  for (const r of rows) {
    const pass = cell(r, 'pass'); const dong = cell(r, 'dong'); const ho = cell(r, 'ho');
    if (!pass && !dong && !ho) continue; // 빈 줄
    const test = isTest(pass, dong);
    if (test) excluded++;
    const status = norm(cell(r, 'status'));
    const amount = Number(cell(r, 'amount').replace(/[^\d-]/g, '')) || 0;
    const start = cell(r, 'start').slice(0, 7), end = cell(r, 'end').slice(0, 7);
    for (const t of test ? [all] : [inc, all]) {
      t.a.rows++;
      if (!pass || pass === '-') continue; // '-' = 이용권 없는 등록 세대원
      const k = nameKey(pass);
      const n = (t.a.names[k] ??= { name: pass.replace(/\s+/g, ' '), active: 0, billing: 0, newThisMonth: 0, endedThisMonth: 0, byDong: {} });
      if (start === month) n.newThisMonth++;
      if (end === month) n.endedThisMonth++;
      if (status !== '활성') continue;
      n.active++;
      n.billing += amount;
      const d = dongKey(dong) || '미분류';
      n.byDong[d] = (n.byDong[d] ?? 0) + 1;
      const h = `${dongKey(dong)}|${norm(ho)}`;
      if (!t.hh.has(h)) t.hh.set(h, new Set());
      t.hh.get(h)!.add(k);
    }
  }
  for (const t of [inc, all]) for (const set of t.hh.values()) { const sig = [...set].sort().join(' '); t.a.hh[sig] = (t.a.hh[sig] ?? 0) + 1; }
  return { ok: true as const, stats: inc.a, statsAll: all.a, excluded };
}

/** 화면·인쇄·엑셀이 보는 숫자 — sel: 전체 / 이용권 / 수강권 */
export type MemberSel = 'all' | PassKind;
export type MemberView = {
  active: number; households: number; billing: number; newThisMonth: number; endedThisMonth: number;
  groups: Record<string, number>; byDong: Record<string, number>;
  courses: { key: string; name: string; active: number; billing: number }[]; kinds: number;
};
export const kindOf = (kinds: Record<string, PassKind> | undefined, key: string, name: string): PassKind => kinds?.[key] ?? defaultKind(name);
/** 집계(v2) → 선택한 쪽 숫자. 예전 형태(구분 전에 올린 것)는 '전체'만 돌려주고 이용권/수강권은 null */
export function viewOf(a: unknown, kinds: Record<string, PassKind> | undefined, sel: MemberSel): MemberView | null {
  if (!a) return null;
  if (!isV2(a)) {
    if (sel !== 'all') return null;
    const o = a as Partial<MemberView>;
    return { active: o.active ?? 0, households: o.households ?? 0, billing: o.billing ?? 0, newThisMonth: o.newThisMonth ?? 0, endedThisMonth: o.endedThisMonth ?? 0, groups: o.groups ?? {}, byDong: o.byDong ?? {}, courses: [], kinds: 0 };
  }
  const v: MemberView = { active: 0, households: 0, billing: 0, newThisMonth: 0, endedThisMonth: 0, groups: Object.fromEntries(MEMBER_GROUPS.map((g) => [g, 0])), byDong: {}, courses: [], kinds: 0 };
  const inSel = (k: string) => sel === 'all' || kindOf(kinds, k, a.names[k]?.name ?? k) === sel;
  for (const [k, n] of Object.entries(a.names)) {
    if (!inSel(k)) continue;
    v.kinds++; v.active += n.active; v.billing += n.billing; v.newThisMonth += n.newThisMonth; v.endedThisMonth += n.endedThisMonth;
    v.groups[groupOf(n.name)] += n.active;
    for (const [d, c] of Object.entries(n.byDong)) v.byDong[d] = (v.byDong[d] ?? 0) + c;
    v.courses.push({ key: k, name: n.name, active: n.active, billing: n.billing });
  }
  for (const [sig, c] of Object.entries(a.hh)) if (sig.split(' ').some(inSel)) v.households += c;
  v.courses.sort((x, y) => y.active - x.active || x.name.localeCompare(y.name, 'ko'));
  return v;
}

/** 보고서 표(화면·인쇄·엑셀 공용) — 이용권 현황 · 수강권 현황 · 전체 합계 */
export type MemberRow = { label: string; cur: number; prev: number | null; diff: number | null; rate: number | null; drop: boolean; money?: boolean; total?: boolean };
export type MemberTable = { key: MemberSel; title: string; rows: MemberRow[]; notes: string[]; folded?: string[] };
type MembersLike = { fileName: string; excluded: number; exclude: boolean; stats: unknown; statsAll: unknown; prev: { month: string; stats: unknown; statsAll: unknown } | null; kinds?: Record<string, PassKind> };
const row = (label: string, cur: number, prev: number | null, o: Partial<MemberRow> = {}): MemberRow => {
  const c = compare(cur, prev);
  return { label, cur, prev, diff: c?.diff ?? null, rate: c?.rate ?? null, drop: c?.drop ?? false, ...o };
};
export function memberTables(m: MembersLike, only?: MemberSel): MemberTable[] {
  const cur = m.exclude ? m.stats : m.statsAll; const pa = m.prev ? (m.exclude ? m.prev.stats : m.prev.statsAll) : null;
  const src = `출처: 하이링크 회원목록(${m.fileName}) · ${m.exclude ? `시험·직원 줄 ${m.excluded}건 제외(이용권명 '테스트', 동 999·9999·111·빈칸)` : '시험·직원 줄 제외 안 함'} · ${m.prev ? `전달(${m.prev.month}) 대비` : '비교할 지난달 없음'}`;
  const dongs = (v: MemberView) => Object.keys(v.byDong).length ? [`동별 활성: ${Object.entries(v.byDong).sort(([a], [b]) => a.localeCompare(b, 'ko', { numeric: true })).map(([d, n]) => `${d === '미분류' ? d : `${d}동`} ${n}`).join(' · ')}`] : [];
  const totals = (v: MemberView, p: MemberView | null, unit: string, hh: string): MemberRow[] => [
    row(`활성 ${unit} 합계`, v.active, p?.active ?? null, { total: true }), row(hh, v.households, p?.households ?? null),
  ];
  const tail = (v: MemberView, p: MemberView | null): MemberRow[] => [
    row('이번 달 신규', v.newThisMonth, p?.newThisMonth ?? null), row('이번 달 종료', v.endedThisMonth, p?.endedThisMonth ?? null), row('월 부과 합계', v.billing, p?.billing ?? null, { money: true }),
  ];
  const groups = (v: MemberView, p: MemberView | null) => Object.entries(v.groups).filter(([g, n]) => n > 0 || (p?.groups?.[g] ?? 0) > 0).map(([g, n]) => row(`· ${g}`, n, p ? (p.groups?.[g] ?? 0) : null));
  if (!isV2(cur)) { // 구분 전에 올린 파일(예전 형태) — 전체 한 표
    const v = viewOf(cur, m.kinds, 'all')!; const p = viewOf(pa, m.kinds, 'all');
    return [{ key: 'all', title: '회원(이용권) 현황', rows: [...totals(v, p, '이용권', '활성 세대'), ...groups(v, p), ...tail(v, p)], notes: [...dongs(v), '이용권/수강권 구분 전에 올린 파일입니다 — 다시 올리면 나뉩니다.', src] }];
  }
  const out: MemberTable[] = [];
  if (!only || only === 'use' || only === 'all') {
    const v = viewOf(cur, m.kinds, 'use')!; const p = viewOf(pa, m.kinds, 'use');
    out.push({ key: 'use', title: '이용권 현황', rows: [...totals(v, p, '이용권', '이용 세대'), ...groups(v, p), ...tail(v, p)], notes: [`이용권명 ${v.kinds}종`, ...(only === 'use' ? [...dongs(v), src] : [])] });
  }
  if (!only || only === 'class' || only === 'all') {
    const v = viewOf(cur, m.kinds, 'class')!; const p = viewOf(pa, m.kinds, 'class');
    const pk = new Map((p?.courses ?? []).map((c) => [c.key, c]));
    const shown = v.courses.filter((c) => c.active > 0 || (pk.get(c.key)?.active ?? 0) > 0);
    const gone = (p?.courses ?? []).filter((c) => c.active > 0 && !v.courses.some((x) => x.key === c.key)); // 이번 달 파일에 아예 없는 강좌
    const folded = v.courses.filter((c) => c.active === 0 && !(pk.get(c.key)?.active ?? 0)).map((c) => c.name);
    out.push({ key: 'class', title: '수강권 현황', rows: [...totals(v, p, '수강권', '수강 세대'), ...[...shown, ...gone.map((c) => ({ ...c, active: 0 }))].map((c) => row(`· ${c.name}`, c.active, p ? (pk.get(c.key)?.active ?? 0) : null)), ...tail(v, p)],
      notes: [`강좌(이용권명) ${v.kinds}종${folded.length ? ` · 활성 0인 강좌 ${folded.length}개 접어 둠` : ''}`, ...(only === 'class' ? [...dongs(v), src] : [])], folded });
  }
  if (!only || only === 'all') {
    const v = viewOf(cur, m.kinds, 'all')!; const p = viewOf(pa, m.kinds, 'all');
    out.push({ key: 'all', title: '전체 합계(이용권 + 수강권)', rows: [row('활성 건수', v.active, p?.active ?? null, { total: true }), row('활성 세대', v.households, p?.households ?? null), ...tail(v, p)], notes: [...dongs(v), src] });
  }
  return out;
}

/** 전달 대비: 증감·증감률, 30% 넘게 줄면 drop=true(빨간 표시) — 전달이 없으면 null */
export function compare(cur: number, prev: number | null | undefined) {
  if (prev === null || prev === undefined) return null;
  const diff = cur - prev;
  const rate = prev === 0 ? null : Math.round((diff / prev) * 1000) / 10;
  return { diff, rate, drop: rate !== null && rate < -30 };
}

/** 파일 이름의 날짜(회원목록_YYYY-MM-DD.xlsx) → 'YYYY-MM' */
export const monthFromName = (name: string) => name.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?\d{2}/)?.slice(1, 3).join('-') ?? null;
