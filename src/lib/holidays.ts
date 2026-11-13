import { db, type Sql } from './db';
import { tenantOf, type SessionUser } from './types';

/**
 * 범용화 1단계 S-05(대표 11/13 승인): 공휴일을 회사별로.
 *  · 기본 회사(default): 예전처럼 holidays 표 그대로(법정 공휴일 씨앗 + 다짐이 고친 것) — 읽기·쓰기 모두 바뀌지 않는다.
 *  · 다른 회사: 법정 공휴일(아래 목록, 010 마이그레이션 씨앗과 같음)을 바탕으로 company_holidays 에 자기 회사의 추가·이름 바꾸기·빼기만 적는다.
 *    예전엔 다짐이 넣은 휴무일이 모든 회사의 근태·아침 브리핑에 적용됐고, 다른 회사는 자기 휴무일을 넣을 수 없었다.
 */
export const NATIONAL_HOLIDAYS: [string, string][] = [
  ['2026-01-01', '신정'], ['2026-02-16', '설날 연휴'], ['2026-02-17', '설날'], ['2026-02-18', '설날 연휴'],
  ['2026-03-01', '삼일절'], ['2026-03-02', '대체공휴일(삼일절)'], ['2026-05-05', '어린이날'], ['2026-05-24', '부처님오신날'],
  ['2026-05-25', '대체공휴일(부처님오신날)'], ['2026-06-03', '전국동시지방선거'], ['2026-06-06', '현충일'], ['2026-08-15', '광복절'],
  ['2026-08-17', '대체공휴일(광복절)'], ['2026-09-24', '추석 연휴'], ['2026-09-25', '추석'], ['2026-09-26', '추석 연휴'],
  ['2026-10-03', '개천절'], ['2026-10-05', '대체공휴일(개천절)'], ['2026-10-09', '한글날'], ['2026-12-25', '기독탄신일'],
  ['2027-01-01', '신정'], ['2027-02-06', '설날'], ['2027-02-05', '설날 연휴'], ['2027-02-07', '설날 연휴'], ['2027-02-08', '대체공휴일(설날)'],
  ['2027-03-01', '삼일절'], ['2027-05-05', '어린이날'], ['2027-05-13', '부처님오신날'], ['2027-06-06', '현충일'],
  ['2027-08-15', '광복절'], ['2027-08-16', '대체공휴일(광복절)'], ['2027-09-14', '추석 연휴'], ['2027-09-15', '추석'], ['2027-09-16', '추석 연휴'],
  ['2027-10-03', '개천절'], ['2027-10-04', '대체공휴일(개천절)'], ['2027-10-09', '한글날'], ['2027-10-11', '대체공휴일(한글날)'],
  ['2027-12-25', '기독탄신일'], ['2027-12-27', '대체공휴일(기독탄신일)'],
];
const NATIONAL = new Map(NATIONAL_HOLIDAYS);
/** 기본 회사인가 — 회사가 없는(옛) 호출은 기본 회사로 본다 */
const isBase = (tenant: string | null | undefined) => !tenant || tenant === 'default';

/** 그 회사의 공휴일(from~to 포함, 날짜순) */
export async function holidaysBetween(tenant: string | null | undefined, from: string, to: string, sql: Sql = db()): Promise<{ date: string; name: string }[]> {
  if (isBase(tenant)) return sql<{ date: string; name: string }[]>`select to_char(date, 'YYYY-MM-DD') as date, name from holidays where date between ${from} and ${to} order by date`;
  const own = await sql<{ date: string; name: string; removed: boolean }[]>`select to_char(date, 'YYYY-MM-DD') as date, name, removed from company_holidays where tenant = ${tenant!} and date between ${from} and ${to}`;
  const out = new Map<string, string>(NATIONAL_HOLIDAYS.filter(([d]) => d >= from && d <= to));
  for (const r of own) { if (r.removed) out.delete(r.date); else out.set(r.date, r.name); }
  return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, name]) => ({ date, name }));
}
/** 날짜 집합(영업일 계산용) */
export async function holidaySet(tenant: string | null | undefined, from: string, to: string, sql: Sql = db()) {
  return new Set((await holidaysBetween(tenant, from, to, sql)).map((h) => h.date));
}
/** 그날이 공휴일이면 이름, 아니면 null */
export async function holidayName(tenant: string | null | undefined, day: string, sql: Sql = db()) {
  return (await holidaysBetween(tenant, day, day, sql))[0]?.name ?? null;
}
/** 사람 기준(회사를 모르는 호출 — 근무 가능 시간 계산) */
export async function holidaysForUser(userId: string, from: string, to: string, sql: Sql = db()) {
  const [u] = await sql<{ tenant: string }[]>`select tenant from users where id = ${userId}`;
  return holidaysBetween(u?.tenant, from, to, sql);
}

/** 추가·이름 바꾸기(권한 확인은 부르는 쪽) */
export async function saveHoliday(u: SessionUser, date: string, name: string, sql: Sql = db()) {
  const t = tenantOf(u);
  if (isBase(t)) {
    await sql`insert into holidays (date, name, updated_by) values (${date}, ${name}, ${u.id})
      on conflict (date) do update set name = excluded.name, updated_by = excluded.updated_by, updated_at = now()`;
    return;
  }
  await sql`insert into company_holidays (tenant, date, name, removed, updated_by) values (${t}, ${date}, ${name}, false, ${u.id})
    on conflict (tenant, date) do update set name = excluded.name, removed = false, updated_by = excluded.updated_by, updated_at = now()`;
}
/** 지우기 — 다른 회사가 법정 공휴일을 지우면 '뺀 날'로 적어 둔다(그 회사만 근무일) */
export async function removeHoliday(u: SessionUser, date: string, sql: Sql = db()) {
  const t = tenantOf(u);
  if (isBase(t)) { await sql`delete from holidays where date = ${date}`; return; }
  if (NATIONAL.has(date)) await sql`insert into company_holidays (tenant, date, name, removed, updated_by) values (${t}, ${date}, ${NATIONAL.get(date)!}, true, ${u.id})
    on conflict (tenant, date) do update set removed = true, updated_by = excluded.updated_by, updated_at = now()`;
  else await sql`delete from company_holidays where tenant = ${t} and date = ${date}`;
}
