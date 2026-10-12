import { featureGate } from '@/lib/google/gate';
import { after } from 'next/server';
import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { calendarPerms, type CalendarRow } from '@/lib/access';
import { badRequest, forbidden } from '@/lib/errors';
import { gapi } from '@/lib/google/client';
import { syncLink } from '@/lib/google/sync';

/** 사용자가 고른 Google 캘린더 1개를 회사 캘린더 1개와 연결 */
export const POST = handler(async ({ req, user }) => {
  featureGate();
  const i = await body(req, z.object({ googleCalendarId: z.string().min(1), localCalendarId: zUuid, direction: z.enum(['both', 'import']) }));
  const sql = db();
  const [cal] = await sql<CalendarRow[]>`select id, type, org_unit_id, owner_user_id from calendars where id = ${i.localCalendarId}`;
  if (!cal || !(await calendarPerms(user, cal)).edit) throw forbidden('연결할 회사 캘린더에 편집 권한이 없습니다');
  const [acct] = await sql`select scopes from google_accounts where user_id = ${user.id} and status = 'active'`;
  if (!acct) throw badRequest('먼저 Google 계정을 연결하세요');
  const writable = String(acct.scopes).split(' ').some((s: string) => s.endsWith('/calendar.events') || s.endsWith('/calendar'));
  if (i.direction === 'both' && !writable) throw badRequest('읽기 전용 권한으로 연결되어 있습니다. 양방향은 "읽기·쓰기"로 다시 연결하세요.');
  const g = await gapi(user.id, 'GET', `/users/me/calendarList/${encodeURIComponent(i.googleCalendarId)}`);
  if (i.direction === 'both' && !['owner', 'writer'].includes(g.accessRole)) throw badRequest('이 Google 캘린더는 쓰기 권한이 없어 가져오기만 가능합니다');
  const [l] = await sql<{ id: string }[]>`insert into google_calendar_links (user_id, google_calendar_id, google_calendar_name, local_calendar_id, direction)
    values (${user.id}, ${i.googleCalendarId}, ${g.summaryOverride ?? g.summary ?? i.googleCalendarId}, ${i.localCalendarId}, ${i.direction})
    on conflict (user_id, google_calendar_id) do update set local_calendar_id = excluded.local_calendar_id, direction = excluded.direction, status = 'active'
    returning id`;
  after(() => syncLink(l.id, 'link_created').catch(() => {}));
  return { id: l.id };
});
