'use client';
import { Check, X } from 'lucide-react';
import { useSession } from '@/components/session';
import { Avatar, Button, cx } from '@/components/ui';
import { UserSelect } from '@/components/pickers';

/** #475 공동 담당 한 사람 — 목록·상세가 같이 쓰는 모양 */
export type Co = { id: string; name: string; acked: boolean; done: boolean; doneAt?: string | null };
export const coOf = (t: { co_assignees?: Co[] | null }) => t.co_assignees ?? [];
/** 이 사람이 담당(주·공동)인지 — 캘린더 '내 일정'·사람 필터·묶음 */
export const assignedTo = (t: { assignee_id: string | null; co_assignees?: Co[] | null }, uid: string) => t.assignee_id === uid || coOf(t).some((c) => c.id === uid);

/**
 * 대표 10/23 #475 업무 공동 배정 — 상세 '공동 담당' 줄: 사람 칩(내 몫 완료 ✓·확인 전) · 빼기(×) · 추가 · 완료 규칙.
 * 추가·빼기는 요청자(없으면 만든 사람), 완료 규칙은 요청자·주 담당 — 서버(tasks.updateTask)와 같은 규칙.
 */
export function CoAssignees({ t, canEdit, canRule, onPatch }: { t: any; canEdit: boolean; canRule: boolean; onPatch: (body: Record<string, unknown>, okMsg?: string) => void }) {
  const list = coOf(t);
  const ids = list.map((c) => c.id);
  return (
    <span className="flex flex-wrap items-center gap-1.5 pl-2" data-testid="co-assignees">
      {list.map((c) => (
        <span key={c.id} className={cx('inline-flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-1.5 text-xs', c.done ? 'border-green-300 bg-green-50 text-green-800' : 'border-line bg-white text-ink-2')} data-testid="co-chip" data-user={c.id} data-done={c.done ? '1' : undefined}>
          <Avatar id={c.id} name={c.name} size={18} badge={false} />{c.name}
          {c.done ? <span className="inline-flex items-center font-semibold" title="내 몫 완료"><Check className="size-3" />완료</span> : !c.acked && <span className="text-[10.5px] text-red-600">확인 전</span>}
          {canEdit && <button type="button" onClick={() => onPatch({ coAssigneeIds: ids.filter((x) => x !== c.id) }, `${c.name}님을 공동 담당에서 뺐습니다`)} className="rounded-full p-0.5 text-ink-3 hover:bg-slate-100 hover:text-ink" aria-label={`${c.name} 공동 담당에서 빼기`} data-testid="co-remove"><X className="size-3" /></button>}
        </span>
      ))}
      {canEdit ? <UserSelect className="h-7 w-auto max-w-[9rem] rounded-full border border-dashed border-line bg-white px-2 text-xs text-ink-2" placeholder="+ 공동 담당 추가" value={null} ariaLabel="공동 담당 추가" exclude={[t.assignee_id, ...ids]}
        onChange={(v) => { if (v && v !== t.assignee_id && !ids.includes(v)) onPatch({ coAssigneeIds: [...ids, v] }, '공동 담당을 추가했습니다 — 알림을 보냈습니다'); }} />
        : !list.length && <span className="text-xs text-ink-3">없음 · 요청자가 추가해요</span>}
      {list.length > 0 && (
        <label className="flex w-full min-w-0 items-center gap-1 text-[11px] text-ink-3"><span className="shrink-0 whitespace-nowrap">완료 규칙</span>
          <select className="h-7 min-w-0 flex-1 rounded-input border border-line bg-white px-1 text-xs text-ink disabled:opacity-60" value={t.complete_rule ?? 'primary'} disabled={!canRule} aria-label="완료 규칙" data-testid="complete-rule"
            onChange={(e) => onPatch({ completeRule: e.target.value }, e.target.value === 'all' ? "모두 '내 몫 완료'해야 완료할 수 있게 바꿨습니다" : '주 담당이 완료하면 끝나게 바꿨습니다')}>
            <option value="primary">주 담당이 완료하면 끝</option><option value="all">모두 &apos;내 몫 완료&apos; 뒤에 완료</option>
          </select></label>
      )}
    </span>
  );
}

/** 상세 위쪽: 공동 담당 본인에게 [내 몫 완료] · 주 담당에게 '모두 완료' 규칙에서 남은 사람 */
export function CoPartBox({ t, onPatch }: { t: any; onPatch: (body: Record<string, unknown>, okMsg?: string) => void }) {
  const { user } = useSession();
  const list = coOf(t);
  const mine = list.find((c) => c.id === user.id);
  if (t.status === 'done' || !list.length) return null;
  if (mine && t.assignee_id !== user.id) return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-input bg-violet-50 px-3 py-2 text-sm text-violet-950" data-testid="co-part" data-done={mine.done ? '1' : undefined}>
      <span className="min-w-0 flex-1">공동 담당 — {mine.done ? '내 몫을 마쳤습니다 ✓' : '내 몫을 마치면 눌러 주세요'} · 업무 완료는 주 담당 {t.assignee_name ?? ''}님{t.complete_rule === 'all' ? '(모두 마쳐야 완료)' : ''}</span>
      <Button size="sm" variant={mine.done ? 'secondary' : 'primary'} onClick={() => onPatch({ myPart: mine.done ? 'open' : 'done' }, mine.done ? '내 몫 완료를 취소했습니다' : '내 몫 완료로 표시했습니다')} data-testid="co-part-btn">{mine.done ? '내 몫 완료 취소' : '내 몫 완료'}</Button>
    </div>
  );
  const left = list.filter((c) => !c.done);
  if (t.assignee_id === user.id && t.complete_rule === 'all' && left.length) return (
    <p className="mt-3 rounded-input bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="co-wait">공동 담당 {left.map((c) => c.name).join(', ')}님이 &apos;내 몫 완료&apos;를 하면 완료할 수 있어요 ({list.length - left.length}/{list.length})</p>
  );
  return null;
}
