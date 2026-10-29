'use client';
import { useEffect, useState } from 'react';
import { STATUS_LABEL, type TaskStatus } from '@/lib/types';
import { cx } from './ui';
import { multiOf, partsOf, type Co } from './CoAssignees';

/**
 * 대표 #799(10/29 19:10 "담당자가 2명 이상 협업해야 할 업무는 그 위에 협업 업무로 — 입찰이나 주요 공동 진행 프로젝트는 개인 업무 위에"):
 * 협업 업무 = 아직 안 끝난 업무 중 함께 담당(공동 담당)이거나 같이 받은 묶음(각자 1건씩)이 있는 것. 내 업무·홈 맨 위 칸에서 같이 씀.
 */
type CollabTask = {
  id: string; status: string; assignee_id: string | null; assignee_name?: string | null; assignee_ack_at?: string | null; assignee_done?: boolean | null; co_assignees?: Co[] | null;
  batch?: { total: number; done: number } | null; batch_people?: { id: string | null; name: string | null; status: string }[] | null;
  sales_ref?: unknown; project_id?: string | null; due_date?: string | null; due_time?: string | null;
};
export const isCollab = (t: CollabTask) => t.status !== 'done' && (multiOf(t) || (t.batch?.total ?? 0) > 1);
/** 입찰·프로젝트 업무 먼저 → 마감 가까운 순(마감 없는 것 뒤) → 시각 */
const lead = (t: CollabTask) => (t.sales_ref || t.project_id ? 0 : 1);
export const collabSort = <T extends CollabTask>(a: T, b: T) => lead(a) - lead(b) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || (a.due_time ?? '99').localeCompare(b.due_time ?? '99');
/** 함께하는 사람(나 말고)과 진행 — 공동 담당은 '내 몫 완료·진행 중·확인 전', 묶음은 그 사람 업무의 상태 */
export function collabPeople(t: CollabTask, uid: string): { id: string; name: string; state: string; done: boolean }[] {
  if (multiOf(t)) return partsOf(t).filter((p) => p.id !== uid).map((p) => ({ id: p.id, name: p.name || '이름 없음', state: p.done ? '내 몫 완료' : !p.acked ? '확인 전' : '진행 중', done: p.done }));
  return (t.batch_people ?? []).map((p, k) => ({ id: p.id ?? `none-${k}`, name: p.name ?? '담당 없음', state: STATUS_LABEL[p.status as TaskStatus] ?? p.status, done: p.status === 'done' }));
}
export function CollabPeople({ t, uid, className }: { t: CollabTask; uid: string; className?: string }) {
  const people = collabPeople(t, uid);
  if (!people.length) return null;
  return (
    <div className={cx('flex flex-wrap items-center gap-1 text-[11px]', className)} data-testid="collab-people">
      <span className="text-ink-3">{multiOf(t) ? '함께 담당' : '같이 받은 사람'}</span>
      {people.map((p) => <span key={p.id} className={cx('rounded-full border px-1.5 py-0.5', p.done ? 'border-green-200 bg-green-50 text-green-800' : 'border-line bg-white text-ink-2')} data-testid="collab-person">{p.name} <b className="font-medium">{p.state}</b></span>)}
    </div>
  );
}
/** 칸 접기 상태 — 사람마다 기억(이 기기) */
export function useCollabOpen(uid: string): [boolean, (v: boolean) => void] {
  const key = `collabOpen:${uid}`;
  const [open, setOpen] = useState(true);
  useEffect(() => { try { const v = localStorage.getItem(key); if (v !== null) setOpen(v === '1'); } catch { /* 저장소를 못 쓰면 펼친 채 */ } }, [key]);
  return [open, (v: boolean) => { setOpen(v); try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* 무시 */ } }];
}
export const COLLAB_SHOWN = 5;
