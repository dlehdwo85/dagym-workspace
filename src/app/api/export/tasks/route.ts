import { z } from 'zod';
import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { audit } from '@/lib/log';
import { listQuery, listTasks } from '@/lib/tasks';
import { STATUS_LABEL, PRIORITY_LABEL } from '@/lib/types';
import { writeXlsx, xlsxResponse, type Cell } from '@/lib/xlsx';

const extra = z.object({
  basis: z.enum(['due', 'done', 'created']).catch('due'),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().catch(undefined),
  split: z.enum(['0', '1']).catch('0'),
});
const seoulDay = (d: Date | string | null) => (d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d)) : '');

/** V6 6번 업무 엑셀(목록형): 화면의 사람·상태·검색 필터 그대로 + 기간(마감일/완료일/생성일 기준). 보이는 업무만, 삭제 업무 제외 */
export const GET = handler(async ({ req, user }) => {
  const sp = Object.fromEntries(req.nextUrl.searchParams);
  const q = listQuery.parse({ ...sp, limit: 1000, includeDone: sp.includeDone ?? '1' });
  const x = extra.parse(sp);
  let tasks = await listTasks(user, q);
  const key = (t: any) => (x.basis === 'done' ? seoulDay(t.completed_at) : x.basis === 'created' ? seoulDay(t.created_at) : t.due_date ?? '');
  if (x.start || x.end) tasks = tasks.filter((t: any) => { const k = key(t); return !!k && (!x.start || k >= x.start) && (!x.end || k <= x.end); });
  const subs = tasks.length ? await db()`select parent_id, count(*)::int n from tasks where parent_id = any(${tasks.map((t: any) => t.id)}::uuid[]) and deleted_at is null group by parent_id` : [];
  const origin = req.nextUrl.origin;
  const head: Cell[] = ['번호', '업무명', '담당자', '요청자', '상태', '우선순위', '시작일', '마감일', '마감 시각', '완료일', '기한 준수', '프로젝트', '태그', '설명', '하위 업무 수', '링크'];
  const row = (t: any, i: number): Cell[] => {
    const done = seoulDay(t.completed_at);
    const onTime = t.status === 'done' && t.due_date ? (done <= t.due_date ? '예' : '아니오') : '';
    return [i + 1, t.title, t.assignee_name ?? '', t.requested_by_name ?? '', STATUS_LABEL[t.status as keyof typeof STATUS_LABEL] ?? t.status,
      PRIORITY_LABEL[t.priority as keyof typeof PRIORITY_LABEL] ?? t.priority, t.start_date ?? '', t.due_date ?? '', t.due_time ?? '', done, onTime,
      t.project_name ?? '', (t.tags ?? []).join(', '), (t.description ?? '').slice(0, 2000), subs.find((s: any) => s.parent_id === t.id)?.n ?? 0, `${origin}/tasks/${t.id}`];
  };
  const sheets = [{ name: '업무 목록', rows: [head, ...tasks.map(row)] }];
  if (x.split === '1') {
    const by = new Map<string, any[]>();
    for (const t of tasks.filter((t: any) => t.status === 'done')) { const m = seoulDay(t.completed_at).slice(0, 7) || '완료일 없음'; by.set(m, [...(by.get(m) ?? []), t]); }
    for (const [m, list] of [...by.entries()].sort((a, b) => b[0].localeCompare(a[0]))) sheets.push({ name: `완료 ${m}`, rows: [head, ...list.map(row)] });
  }
  await audit(db(), user.id, 'export', 'user', user.id, { kind: 'tasks', count: tasks.length, basis: x.basis, start: x.start ?? null, end: x.end ?? null });
  const month = (x.start ?? seoulDay(new Date())).slice(0, 7);
  return xlsxResponse(writeXlsx(sheets), `워크인_업무_${month}.xlsx`);
});
