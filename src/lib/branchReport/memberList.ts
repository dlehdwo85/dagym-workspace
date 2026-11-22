/**
 * #1112(대표 11/22) 하이링크 '회원목록' 엑셀 → 월간 보고 회원(이용권) 현황. 계산은 프로그램(AI 아님).
 * - '전체' 시트만 읽음(동별 시트는 같은 내용 중복). 머리줄 이름으로 칸을 찾고, **이름·연락처 칸은 읽지 않음**(행에서 바로 버림)
 * - 동·호수는 세대 수·동별 수를 세는 데만 쓰고 저장하지 않음. 원본 파일은 보관하지 않고 집계 숫자만 저장
 * - '이용권 상태'를 믿음(만료인데 종료일 빈칸·활성인데 종료일 있음이 섞여 있음)
 * - 시험·직원 줄 제외(기본 켬, 끌 수 있음): 이용권명 '테스트' · 동 999·9999·111·빈칸 — 두 경우를 모두 계산해 두고 화면에서 고름
 * 순수 함수(서버·시험 공용).
 */
export const MEMBER_GROUPS = ['헬스', '통합(헬스+골프+수영)', 'GX', '수영 강습', '독서실', '락커', '골프 레슨', 'PT', '기타'] as const;
export type MemberGroup = (typeof MEMBER_GROUPS)[number];
export type MemberStats = {
  active: number; households: number; billing: number; newThisMonth: number; endedThisMonth: number;
  groups: Record<string, number>; byDong: Record<string, number>; rows: number;
};

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

/**
 * 행(머리줄 다음부터)을 집계 — month 'YYYY-MM'. 이름·연락처 칸은 headerIndex 가 찾지 않으므로 읽히지 않음.
 * 돌려주는 것: 제외 켬(stats) · 제외 끔(statsAll) · 제외한 줄 수
 */
export function aggregateMembers(header: string[], rows: string[][], month: string) {
  const ix = headerIndex(header);
  const need: Col[] = ['dong', 'ho', 'pass', 'status'];
  const missing = need.filter((k) => ix[k] === undefined);
  if (missing.length) return { ok: false as const, missing };
  const empty = (): MemberStats => ({ active: 0, households: 0, billing: 0, newThisMonth: 0, endedThisMonth: 0, groups: Object.fromEntries(MEMBER_GROUPS.map((g) => [g, 0])), byDong: {}, rows: 0 });
  const make = () => ({ s: empty(), hh: new Set<string>() });
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
      t.s.rows++;
      if (start === month) t.s.newThisMonth++;
      if (end === month) t.s.endedThisMonth++;
      if (status !== '활성' || !pass || pass === '-') continue; // '-' = 이용권 없는 등록 세대원
      t.s.active++;
      t.s.billing += amount;
      t.s.groups[groupOf(pass)]++;
      const d = dongKey(dong) || '미분류';
      t.s.byDong[d] = (t.s.byDong[d] ?? 0) + 1;
      t.hh.add(`${dongKey(dong)}|${norm(ho)}`);
    }
  }
  inc.s.households = inc.hh.size; all.s.households = all.hh.size;
  return { ok: true as const, stats: inc.s, statsAll: all.s, excluded };
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
