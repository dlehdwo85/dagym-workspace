'use client';
import { useState } from 'react';
import { Merge, Users } from 'lucide-react';
import { api, broadcastRefresh, useApi } from './client';
import { Button, Modal, cx, toast } from './ui';

export type DupeSet = { key: string; title: string; batch: boolean; requesterId: string; requesterName: string | null; createdAt: string;
  tasks: { id: string; assigneeId: string | null; assigneeName: string | null; status: string; dueDate: string | null }[] };

/** 327차(로컬 11/02 9 — 대표 '사람별로 따로 만든 같은 업무를 내용 합쳐서 공동 업무로'): 업무 목록 위 [공동 업무로 합치기 n] → 묶음 고르기 → 한 건으로.
 *  묶음 = '각자 1건씩'(batch) 또는 같은 제목·같은 요청자·만든 시각 10분 안(담당이 서로 다름). 서버(taskMerge.duplicateSets)가 이 사람이 합칠 수 있는 것만 준다 */
export function useDupeSets(on: boolean) {
  const r = useApi<{ sets: DupeSet[] }>(on ? '/api/tasks/dupes' : null);
  return { sets: r.data?.sets ?? [], reload: r.reload };
}

export function DupeMergeButton({ sets, onDone, className }: { sets: DupeSet[]; onDone: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!sets.length) return null;
  return (
    <>
      <Button variant="secondary" className={className} onClick={() => setOpen(true)} data-testid="dupes-open" title="사람마다 따로 만든 같은 업무를 공동 업무 1건으로 합칩니다">
        <Users />공동 업무로 합치기<span className="rounded-full bg-violet-600 px-1.5 text-[11px] leading-4 text-white tabular-nums">{sets.length}</span>
      </Button>
      {open && <DupeMergeModal sets={sets} onClose={() => setOpen(false)} onDone={onDone} />}
    </>
  );
}

function DupeMergeModal({ sets, onClose, onDone }: { sets: DupeSet[]; onClose: () => void; onDone: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sets.map((s) => s.key)));
  const [busy, setBusy] = useState(false);
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const go = async () => {
    const chosen = sets.filter((s) => picked.has(s.key));
    if (!chosen.length) return;
    setBusy(true);
    try {
      const r = await api<{ merged: { keep: string; merged: number; title: string }[]; skipped: { ids: string[]; why: string }[] }>('/api/tasks/dupes', { body: { sets: chosen.map((s) => s.tasks.map((t) => t.id)) } });
      toast.ok(`${r.merged.length}묶음을 공동 업무로 합쳤습니다${r.skipped.length ? ` · ${r.skipped.length}묶음은 건너뜀(이미 합쳐졌거나 끝남)` : ''}`);
      broadcastRefresh(); onDone(); onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="사람별로 따로 만든 업무 → 공동 업무로 합치기">
      <p className="mb-3 text-sm text-ink-2">같은 업무가 사람마다 1건씩 있는 묶음입니다. 합치면 한 건만 남고 담당자들은 <b className="text-ink">함께 담당</b>이 됩니다(이미 끝낸 사람은 내 몫 완료, 모두 끝내면 업무 완료). 댓글·첨부·체크리스트·하위 업무는 남는 업무로 옮기고 나머지는 휴지통(30일)으로 갑니다.</p>
      <ul className="max-h-[50vh] space-y-2 overflow-y-auto" data-testid="dupe-sets">
        {sets.map((s) => (
          <li key={s.key}>
            <label className={cx('flex cursor-pointer items-start gap-2 rounded-input border p-2.5 text-sm', picked.has(s.key) ? 'border-violet-300 bg-violet-50/50' : 'border-line')} data-testid="dupe-set">
              <input type="checkbox" className="mt-0.5 size-4 accent-violet-600" checked={picked.has(s.key)} onChange={() => toggle(s.key)} aria-label={`${s.title} 합치기`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{s.title}</span>
                <span className="block text-xs text-ink-2">{s.tasks.length}건 · 담당 {s.tasks.map((t) => t.assigneeName ?? '없음').join('·')}{s.requesterName ? ` · 요청 ${s.requesterName}` : ''} · {s.batch ? "'각자 1건씩'으로 만든 묶음" : '같은 제목·요청자·만든 시각'}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-ink-3">요청한 사람·관리자만 합칠 수 있습니다</span>
        <span className="flex gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button disabled={busy || !picked.size} onClick={go} data-testid="dupes-merge"><Merge />{picked.size}묶음 합치기</Button></span>
      </div>
    </Modal>
  );
}
