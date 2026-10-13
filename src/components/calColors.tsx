'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { Button, Modal, cx, toast } from './ui';

export type CalColors = { personal: string; company: string };
const FALLBACK: CalColors = { personal: '#039be5', company: '#0b8043' };
const NAMES: Record<string, string> = { '#d50000': '토마토', '#e67c73': '플라밍고', '#f4511e': '귤', '#f6bf26': '바나나', '#33b679': '세이지', '#0b8043': '바질', '#039be5': '공작', '#3f51b5': '블루베리', '#7986cb': '라벤더', '#8e24aa': '포도', '#616161': '흑연', '#795548': '코코아' };

/** V7 4번: 캘린더·홈 공통 — 개인/회사 두 색 */
export function useCalColors() {
  const { data, reload } = useApi<{ colors: CalColors; default: CalColors; palette: string[] }>('/api/calendar-colors');
  useEffect(() => { const h = () => reload(); window.addEventListener('wos-cal-colors', h); return () => window.removeEventListener('wos-cal-colors', h); }, [reload]);
  return { colors: data?.colors ?? FALLBACK, palette: data?.palette ?? Object.keys(NAMES), defaults: data?.default ?? FALLBACK };
}
/** 일정: 개인 캘린더 = 개인, 회사·조직 캘린더 = 회사 */
export const isPersonalEvent = (e: { calendarType?: string }) => e.calendarType === 'personal';
/** 업무: 프로젝트에 속하면 회사, 프로젝트 없는 담당자 업무면 개인 */
export const isPersonalTask = (t: { project_id?: string | null }) => !t.project_id;

export function CalColorsDialog({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const { colors, palette } = useCalColors();
  const [c, setC] = useState<CalColors>(colors);
  const [asDefault, setAsDefault] = useState(false);
  useEffect(() => setC(colors), [colors.personal, colors.company]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    try {
      await api('/api/calendar-colors', { method: 'PUT', body: { ...c, asDefault } });
      toast.ok(asDefault ? '내 색과 모두의 기본값을 바꿨습니다' : '캘린더 색을 바꿨습니다');
      window.dispatchEvent(new Event('wos-cal-colors')); broadcastRefresh(); onClose();
    } catch (e: any) { toast.error(e.message); }
  }
  const row = (k: keyof CalColors, label: string) => (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label={label}>
        {palette.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={c[k] === p} aria-label={`${label} ${NAMES[p] ?? p}`} onClick={() => setC({ ...c, [k]: p })}
            className={cx('flex size-9 items-center justify-center rounded-full ring-offset-2', c[k] === p && 'ring-2 ring-ink')} style={{ background: p }}>
            {c[k] === p && <Check className="size-4 text-white" strokeWidth={3} />}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <Modal open onClose={onClose} title="캘린더 색">
      <div className="space-y-4" data-testid="cal-colors">
        <p className="text-xs text-ink-2">업무와 일정은 같은 모양으로, 색은 <b>개인</b>(내·남의 개인 일정, 프로젝트 없는 업무)과 <b>회사</b>(회사·현장 일정, 프로젝트 업무) 두 가지로만 보입니다. 내 화면에만 적용됩니다.</p>
        {row('personal', '개인 일정 색')}
        {row('company', '회사 일정 색')}
        {user.role === 'owner' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />모두에게 기본값으로 (각자 바꾼 사람은 그대로)</label>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save}>저장</Button></div>
      </div>
    </Modal>
  );
}
