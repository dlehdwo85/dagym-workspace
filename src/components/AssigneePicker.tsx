'use client';
import { useEffect, useState } from 'react';
import { useApi } from '@/components/client';
import { Button, Modal, Skeleton, cx, inputCls } from '@/components/ui';

type People = { people: { id: string; name: string; title: string | null; inSpace: boolean; spaces?: string[] }[]; me: string; suggested: string | null };

/**
 * #1124: 담당 고르기(입찰 [넘기기]와 같은 모양) — 여러 명, 처음 고른 사람이 주 담당. 그 공간 권한이 없는 사람은 회색(고를 수 없음) + 안내.
 * value = 고른 순서대로의 사용자 id
 */
export function AssigneePicker({ space, kind, value, onChange }: { space: 'sales' | 'marketing'; kind?: string; value: string[]; onChange: (ids: string[]) => void }) {
  const d = useApi<People>(`/api/spaces/people?space=${space}${kind ? `&kind=${encodeURIComponent(kind)}` : ''}`, [space, kind]);
  useEffect(() => { if (d.data && !value.length) onChange([d.data.suggested ?? d.data.me]); }, [d.data]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d.data) return <Skeleton rows={1} />;
  const off = d.data.people.filter((p) => !p.inSpace).length;
  return (
    <div className="space-y-1.5" data-testid="assignee-picker">
      <div className="flex flex-wrap gap-1.5">
        {d.data.people.map((p) => {
          const on = value.includes(p.id); const i = value.indexOf(p.id);
          return (
            <label key={p.id} title={p.inSpace ? undefined : `${space === 'sales' ? '영업' : '마케팅'} 공간 권한이 없습니다 — 사용자 관리 › 공간 탭에서 권한을 주면 고를 수 있습니다`}
              className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs', !p.inSpace ? 'cursor-not-allowed border-line bg-slate-50 text-ink-3' : 'cursor-pointer', on ? 'border-brand-600 bg-brand-50 font-semibold text-brand-800' : p.inSpace && 'border-line bg-white')}
              data-testid="assignee-option" data-in-space={p.inSpace ? '1' : '0'}>
              <input type="checkbox" className="sr-only" disabled={!p.inSpace} checked={on} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
              {p.name}{p.id === d.data!.me ? ' (나)' : ''}{p.title ? <span className="text-ink-3"> {p.title}</span> : null}{p.spaces?.length ? <span className="text-[10px] text-ink-3" data-testid="assignee-spaces"> · {p.spaces.map((x) => (x === 'sales' ? '영업' : x === 'marketing' ? '마케팅' : x)).join('·')}</span> : null}{on && value.length > 1 ? <span className="text-[10px] text-ink-3">{i === 0 ? ' 주 담당' : ' 공동'}</span> : null}
            </label>);
        })}
      </div>
      <p className="text-[11px] text-ink-3">처음 고른 사람이 주 담당, 나머지는 공동 담당입니다.{off ? ` 회색 ${off}명은 ${space === 'sales' ? '영업' : '마케팅'} 공간 권한이 없습니다 — 사용자 관리 › 공간 탭에서 권한을 주면 고를 수 있습니다.` : ''}</p>
    </div>
  );
}

/** 담당을 고른 뒤 실행하는 작은 창 — [업무 만들기] 같은 단추가 열어 씀 */
export function AssignDialog({ open, onClose, title, note, space, kind, busy, okLabel, onOk, withMemo }: {
  open: boolean; onClose: () => void; title: string; note?: React.ReactNode; space: 'sales' | 'marketing'; kind?: string; busy?: boolean; okLabel: string;
  onOk: (ids: string[], memo: string) => void; withMemo?: boolean;
}) {
  const [sel, setSel] = useState<string[]>([]); const [memo, setMemo] = useState('');
  useEffect(() => { if (!open) { setSel([]); setMemo(''); } }, [open]);
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title={title}>
      <div className="space-y-3 text-sm" data-testid="assign-dialog">
        {note && <p className="text-xs text-ink-2">{note}</p>}
        <AssigneePicker space={space} kind={kind} value={sel} onChange={setSel} />
        {withMemo && <input className={inputCls} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모(선택) — 업무에 남습니다" aria-label="메모" maxLength={500} />}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={busy || !sel.length} onClick={() => onOk(sel, memo)} data-testid="assign-dialog-go">{busy ? '만드는 중…' : `${okLabel}(담당 ${sel.length}명)`}</Button></div>
      </div>
    </Modal>
  );
}
