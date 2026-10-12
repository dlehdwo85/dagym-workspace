import { RRule, rrulestr } from 'rrule';
import { DateTime } from 'luxon';
import { badRequest } from './errors';
import { TZ } from './time';

/** "FREQ=WEEKLY;BYDAY=MO" 형태(또는 "RRULE:" 접두어)를 검증하고 정규화 */
export function normalizeRule(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const r = rule.trim().replace(/^RRULE:/i, '');
  if (!r) return null;
  if (/DTSTART|TZID/i.test(r)) throw badRequest('반복 규칙에 DTSTART 를 넣지 마세요');
  try {
    const parsed = RRule.parseString(r);
    if (parsed.freq === undefined) throw new Error('FREQ 없음');
    if (parsed.freq > RRule.DAILY) throw new Error('시간 단위 반복은 지원하지 않습니다');
  } catch (e) {
    throw badRequest(`반복 규칙이 올바르지 않습니다: ${(e as Error).message}`);
  }
  return r.toUpperCase();
}

// 벽시계 시각을 UTC 인 것처럼 다루는 "floating" 변환 (rrule 권장 방식)
function wallToFloating(dt: DateTime): Date {
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}
function floatingToWall(d: Date, zone = TZ): DateTime {
  return DateTime.fromObject(
    { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds() },
    { zone },
  );
}

/**
 * UNTIL=...Z 는 실제 UTC 시각(iCalendar 표준, Google 과 동일)으로 저장하고,
 * 계산할 때만 floating 으로 바꿔 쓴다.
 */
function build(rule: string, dtstart: Date, zone = TZ) {
  const m = /UNTIL=(\d{8}T\d{6}Z)/i.exec(rule);
  if (m) {
    const real = DateTime.fromFormat(m[1].toUpperCase(), "yyyyMMdd'T'HHmmss'Z'", { zone: 'UTC' });
    const fl = wallToFloating(real.setZone(zone)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    rule = rule.replace(m[0], `UNTIL=${fl}`);
  }
  return rrulestr(`RRULE:${rule}`, { dtstart }) as RRule;
}

/** 날짜 기반(업무) 다음 반복일: current 이후 첫 날짜 */
export function nextDate(rule: string, anchorDate: string, after: string): string | null {
  const a = DateTime.fromISO(anchorDate, { zone: 'UTC' });
  const r = build(rule, new Date(Date.UTC(a.year, a.month - 1, a.day)));
  const af = DateTime.fromISO(after, { zone: 'UTC' });
  const n = r.after(new Date(Date.UTC(af.year, af.month - 1, af.day)), false);
  if (!n) return null;
  return n.toISOString().slice(0, 10);
}

/** 일정 반복: [from, to) 사이 발생 시작 시각들 (실제 UTC Date) */
export function occurrences(rule: string, start: Date, from: Date, to: Date, zone = TZ, limit = 500): Date[] {
  const dtstart = wallToFloating(DateTime.fromJSDate(start).setZone(zone));
  const r = build(rule, dtstart);
  // 범위도 floating 으로 변환 (+-1일 여유 후 실제 시각으로 다시 거른다)
  const f = wallToFloating(DateTime.fromJSDate(from).setZone(zone).minus({ days: 1 }));
  const t = wallToFloating(DateTime.fromJSDate(to).setZone(zone).plus({ days: 1 }));
  const out: Date[] = [];
  for (const d of r.between(f, t, true)) {
    const real = floatingToWall(d, zone).toJSDate();
    if (real >= from && real < to) out.push(real);
    if (out.length >= limit) break;
  }
  return out;
}

/** "이후 일정" 분할용: 해당 발생 직전까지로 UNTIL 을 넣은 규칙 */
export function ruleUntilBefore(rule: string, occurrenceStart: Date, _zone = TZ): string {
  const until = new Date(occurrenceStart.getTime() - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const parts = rule.split(';').filter((p) => !/^(UNTIL|COUNT)=/i.test(p));
  parts.push(`UNTIL=${until}`);
  return parts.join(';');
}

/** 규칙이 해당 시각 이후 발생이 하나라도 있는지 */
export function hasOccurrenceFrom(rule: string, start: Date, from: Date, zone = TZ): boolean {
  const dtstart = wallToFloating(DateTime.fromJSDate(start).setZone(zone));
  const r = build(rule, dtstart);
  return !!r.after(wallToFloating(DateTime.fromJSDate(from).setZone(zone)), true);
}

export function describeRule(rule: string | null): string {
  if (!rule) return '';
  const p = RRule.parseString(rule);
  const days = ['월', '화', '수', '목', '금', '토', '일'];
  const iv = p.interval && p.interval > 1 ? p.interval : 1;
  let s = '';
  switch (p.freq) {
    case RRule.DAILY: s = iv > 1 ? `${iv}일마다` : '매일'; break;
    case RRule.WEEKLY: {
      const by = (Array.isArray(p.byweekday) ? p.byweekday : p.byweekday ? [p.byweekday] : [])
        .map((w: any) => days[typeof w === 'number' ? w : w.weekday]).join('·');
      s = `${iv > 1 ? iv + '주마다' : '매주'}${by ? ' ' + by + '요일' : ''}`; break;
    }
    case RRule.MONTHLY: s = `${iv > 1 ? iv + '개월마다' : '매월'}${p.bymonthday ? ' ' + p.bymonthday + '일' : ''}`; break;
    case RRule.YEARLY: s = iv > 1 ? `${iv}년마다` : '매년'; break;
    default: s = '반복';
  }
  if (p.count) s += ` (${p.count}회)`;
  if (p.until) s += ` (~${p.until.toISOString().slice(0, 10)})`;
  return s;
}

/** COUNT 가 있는 규칙을 occurrenceStart 부터 나머지 횟수로 바꾼 규칙 (이후 일정 분할용) */
export function ruleRemainingFrom(rule: string, start: Date, occurrenceStart: Date, zone = TZ): string {
  const parts = rule.split(';');
  if (!parts.some((p) => /^COUNT=/i.test(p))) return rule;
  const all = occurrences(rule, start, start, new Date(start.getTime() + 1000 * 86400 * 365 * 30), zone, 5000);
  const remaining = all.filter((d) => d >= occurrenceStart).length;
  return parts.map((p) => (/^COUNT=/i.test(p) ? `COUNT=${Math.max(1, remaining)}` : p)).join(';');
}
