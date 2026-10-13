import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { listEvents } from '@/lib/events';
import { audit } from '@/lib/log';
import { badRequest } from '@/lib/errors';
import { describeRule } from '@/lib/recurrence';
import { writeXlsx, xlsxResponse, type Cell } from '@/lib/xlsx';

const fmt = (d: Date | string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...o }).format(new Date(d));
const day = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const hm = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));

/** V6 6번 캘린더 엑셀(표형 + 주간 달력 표). 남의 비공개 일정은 "바쁨"만 */
export const GET = handler(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams;
  const start = sp.get('start'), end = sp.get('end');
  if (!start || !end || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) throw badRequest('기간(start·end)을 정하세요');
  const from = new Date(`${start}T00:00:00+09:00`), to = new Date(new Date(`${end}T00:00:00+09:00`).getTime() + 86400000);
  if (to.getTime() - from.getTime() > 400 * 86400000) throw badRequest('기간은 400일까지입니다');
  const who = (sp.get('who') ?? '').split(',').filter(Boolean);
  let evs = await listEvents(user, from, to);
  if (who.length) evs = evs.filter((e: any) => who.includes(e.ownerId) || who.includes(e.createdBy) || (e.attendees ?? []).some((a: any) => who.includes(a.user_id)));
  const head: Cell[] = ['날짜', '요일', '시작', '종료', '제목', '주인', '참석자', '장소', '반복', '연결 업무', '비공개'];
  const rows: Cell[][] = evs.map((e: any) => [day(e.start), fmt(e.start, { weekday: 'short' }), e.allDay ? '종일' : hm(e.start), e.allDay ? '' : hm(e.end),
    e.title, e.ownerName ?? '', e.masked ? '' : (e.attendees ?? []).map((a: any) => a.name).join(', '), e.masked ? '' : e.location ?? '',
    e.recurring ? describeRule(e.rrule ?? null) : '', e.linkedTask ? '예' : '', e.isPrivate ? '예' : '']);
  // 주간 달력 표: 시작일이 든 주(월~일), 행 = 시간, 열 = 요일
  const s0 = new Date(`${start}T00:00:00Z`); const mon = new Date(s0.getTime() - ((s0.getUTCDay() + 6) % 7) * 86400000);
  const days = Array.from({ length: 7 }, (_, i) => new Date(mon.getTime() + i * 86400000).toISOString().slice(0, 10));
  const grid: Cell[][] = [['시간', ...days.map((d) => `${d.slice(5)} (${'일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()]})`)]];
  grid.push(['종일', ...days.map((d) => evs.filter((e: any) => e.allDay && day(e.start) <= d && day(new Date(new Date(e.end).getTime() - 1)) >= d).map((e: any) => e.title).join('\n'))]);
  for (let h = 6; h <= 22; h++) {
    grid.push([`${String(h).padStart(2, '0')}:00`, ...days.map((d) => evs.filter((e: any) => !e.allDay && day(e.start) === d && Number(hm(e.start).slice(0, 2)) === h).map((e: any) => `${hm(e.start)} ${e.title}`).join('\n'))]);
  }
  await audit(db(), user.id, 'export', 'user', user.id, { kind: 'calendar', count: evs.length, start, end });
  return xlsxResponse(writeXlsx([{ name: '일정 목록', rows: [head, ...rows] }, { name: '주간 달력', rows: grid, widths: [8, ...days.map(() => 24)] }]), `워크인_캘린더_${start.slice(0, 7)}.xlsx`);
});
