'use client';
import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import { useSession } from '@/components/session';
import { Avatar, Button, cx } from '@/components/ui';
import { UserSelect } from '@/components/pickers';

/** #475 첫 담당자 말고 함께 맡은 사람 — 목록·상세가 같이 쓰는 모양 */
export type Co = { id: string; name: string; acked: boolean; done: boolean; doneAt?: string | null };
export const coOf = (t: { co_assignees?: Co[] | null }) => t.co_assignees ?? [];
/** 이 사람이 담당인지 — 캘린더 '내 일정'·사람 필터·묶음 */
export const assignedTo = (t: { assignee_id: string | null; co_assignees?: Co[] | null }, uid: string) => t.assignee_id === uid || coOf(t).some((c) => c.id === uid);

type PartTask = { assignee_id: string | null; assignee_name?: string | null; assignee_ack_at?: string | null; assignee_done?: boolean | null; status: string; co_assignees?: Co[] | null };
/**
 * 대표 10/24 '담당자가 따로 있고 공동담당자가 따로 있는 느낌' → 담당자 전원이 같은 무게: 첫 담당자(알림·통계 호환) + 함께 맡은 사람.
 * done = 내 몫 완료(업무가 완료면 모두 완료). 담당자가 여럿이면 각자 [완료] = 내 몫 완료, 마지막 사람이 끝내면 업무 완료 — 서버(tasks.updateTask)와 같은 규칙.
 */
export function partsOf(t: PartTask) {
  if (!t.assignee_id) return [];
  const all = t.status === 'done';
  return [{ id: t.assignee_id, name: t.assignee_name ?? '', acked: !!t.assignee_ack_at, done: all || !!t.assignee_done },
    ...coOf(t).map((c) => ({ id: c.id, name: c.name, acked: c.acked, done: all || c.done }))];
}
export const multiOf = (t: PartTask) => !!t.assignee_id && coOf(t).length > 0;
export function progressOf(t: PartTask) {
  const p = partsOf(t);
  return { done: p.filter((x) => x.done).length, total: p.length, left: p.filter((x) => !x.done) };
}
/** 내 몫은 끝냈지만 다른 담당자가 남은 업무 — 목록에 흐리게 '내 몫 완료 · k/n' */
export const myPartDone = (t: PartTask, uid: string) => multiOf(t) && t.status !== 'done' && t.status !== 'review' && !!partsOf(t).find((p) => p.id === uid)?.done;
/** 서버 응답(part·left·partsDone/partsTotal)으로 안내 한 줄 */
export const partMsg = (r: { part?: string; left?: string[]; partsDone?: number; partsTotal?: number }) => r.part === 'done'
  ? `내 몫 완료(${r.partsDone}/${r.partsTotal}) — ${r.left?.length ? `${r.left.join(', ')}님까지 끝내면 업무가 완료됩니다` : '업무를 완료했습니다'}`
  : '내 몫 완료를 취소했습니다';
/** 마지막 사람이 끝내 업무 상태가 바뀐 응답 */
export const finishMsg = (r: { status?: string }) => (r.status === 'review' ? '모두 마쳐 검토를 요청했습니다' : '모두 마쳐 업무를 완료했습니다');

/**
 * 대표 10/24 '담당자 칸 하나에 담당 직원을 모두 나란히': 사람 칩(같은 크기·같은 색 — 내 몫 완료 ✓·확인 전) · 빼기(×) · [+ 담당자 추가].
 * 추가·빼기는 요청자(없으면 만든 사람)·관리자 — 서버가 다시 확인. 첫 칩을 빼면 다음 사람이 첫 담당자가 된다.
 */
export function Assignees({ t, canEdit, onPatch, onAdded, extra }: { t: any; canEdit: boolean; onPatch: (body: Record<string, unknown>, okMsg?: string) => void; onAdded?: (id: string) => void; extra?: ReactNode }) {
  const parts = partsOf(t);
  const multi = parts.length > 1;
  const ids = parts.map((p) => p.id);
  const save = (next: string[], msg: string) => onPatch({ assigneeId: next[0] ?? null, coAssigneeIds: next.slice(1) }, msg);
  return (
    <span className="flex flex-wrap items-center gap-1.5 pl-2" data-testid="assignees">
      {parts.map((p) => (
        <span key={p.id} className={cx('inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5 text-xs', multi && p.done ? 'border-green-300 bg-green-50 text-green-800' : 'border-line bg-white text-ink')}
          data-testid="assignee-chip" data-user={p.id} data-done={multi && p.done ? '1' : undefined}>
          <Avatar id={p.id} name={p.name} size={18} badge={false} />{p.name}
          {multi && p.done ? <span className="inline-flex items-center font-semibold" title="내 몫 완료"><Check className="size-3" />완료</span>
            : !p.acked && t.status !== 'done' && <span className="text-[10.5px] text-red-600">확인 전</span>}
          {canEdit && <button type="button" onClick={() => save(ids.filter((x) => x !== p.id), `${p.name}님을 담당에서 뺐습니다`)} className="rounded-full p-0.5 text-ink-3 hover:bg-slate-100 hover:text-ink"
            aria-label={`${p.name} 담당에서 빼기`} data-testid="assignee-remove"><X className="size-3" /></button>}
        </span>
      ))}
      {!parts.length && !canEdit && <span className="text-sm text-ink-3">담당자 없음</span>}
      {canEdit && <UserSelect className="h-7 w-auto max-w-[9rem] rounded-full border border-dashed border-line bg-white px-2 text-xs text-ink-2" placeholder="+ 담당자 추가" value={null} ariaLabel="담당자 추가" exclude={ids}
        onChange={(v) => { if (!v || ids.includes(v)) return; save([...ids, v], parts.length ? '담당자를 추가하고 알렸습니다' : '담당자를 정했습니다'); onAdded?.(v); }} />}
      {extra}
    </span>
  );
}

/** 상세 위쪽(담당자가 여럿일 때): 담당자에게 [내 몫 완료]·취소 + '담당 n명 중 k명 완료 · 남은 사람' — 담당자가 아니면 진행 상황만 */
export function PartBox({ t, onPatch }: { t: any; onPatch: (body: Record<string, unknown>, okMsg?: string | ((r: any) => string)) => void }) {
  const { user } = useSession();
  if (t.status === 'done' || !multiOf(t)) return null;
  const { done, total, left } = progressOf(t);
  const me = partsOf(t).find((p) => p.id === user.id);
  const review = t.status === 'review';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-input bg-violet-50 px-3 py-2 text-sm text-violet-950" data-testid="part-box" data-done={me?.done ? '1' : undefined}>
      <span className="min-w-0 flex-1">
        <b className="tabular-nums" data-testid="part-progress">담당 {total}명 중 {done}명 완료</b>
        {review ? ' — 모두 마쳐 검토 중입니다' : left.length ? ` — 남은 사람: ${left.map((p) => p.name).join(', ')}` : ' — 모두 마쳤습니다'}
        {me && !review && <span className="block text-xs text-violet-800">{me.done ? '내 몫을 마쳤습니다 ✓ 다른 담당자가 끝낼 때까지 내 업무에 흐리게 남고, 모두 끝나면 업무가 완료됩니다'
          : '각자 [내 몫 완료]를 누르면 마지막 사람이 끝낼 때 업무가 완료됩니다'}</span>}
      </span>
      {me && !review && (left.length
        ? <Button size="sm" variant={me.done ? 'secondary' : 'primary'} onClick={() => onPatch({ myPart: me.done ? 'open' : 'done' }, finishMsg)} data-testid="part-btn">{me.done ? '내 몫 완료 취소' : '내 몫 완료'}</Button>
        : <Button size="sm" onClick={() => onPatch({ myPart: 'done' }, finishMsg)} data-testid="part-finish">업무 완료</Button>)}
    </div>
  );
}
