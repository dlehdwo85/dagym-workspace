import { DateTime } from 'luxon';
export const TZ = 'Asia/Seoul';

/** 서울 기준 오늘 날짜 YYYY-MM-DD */
export function todaySeoul(now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(TZ).toISODate()!;
}
export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: TZ }).plus({ days }).toISODate()!;
}
/** 서울 기준 그 날짜의 자정(UTC Date) */
export function seoulMidnight(date: string): Date {
  return DateTime.fromISO(date, { zone: TZ }).startOf('day').toJSDate();
}
export function toSeoulDate(d: Date): string {
  return DateTime.fromJSDate(d).setZone(TZ).toISODate()!;
}
/** 마감 시각: 날짜만 있으면 그날 23:59:59 (서울) */
export function dueInstant(dueDate: string, dueTime: string | null): Date {
  const base = DateTime.fromISO(dueDate, { zone: TZ });
  if (!dueTime) return base.endOf('day').toJSDate();
  const [h, m] = dueTime.split(':').map(Number);
  return base.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toJSDate();
}
export function weekRangeSeoul(now: Date = new Date()) {
  const d = DateTime.fromJSDate(now).setZone(TZ);
  const start = d.startOf('week'); // 월요일 시작 (ISO)
  return { start: start.toISODate()!, end: start.plus({ days: 6 }).toISODate()! };
}
