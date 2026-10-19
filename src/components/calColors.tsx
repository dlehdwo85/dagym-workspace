'use client';
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { api, broadcastRefresh, useApi } from './client';
import { useSession } from './session';
import { Button, Modal, cx, toast } from './ui';

export type CalColors = { personal: string; company: string; cals?: Record<string, string>; people?: Record<string, string>; whoDot?: boolean };
const FALLBACK: CalColors = { personal: '#039be5', company: '#0b8043', cals: {}, people: {}, whoDot: false };
export const PALETTE_NAMES: Record<string, string> = { '#d50000': '토마토', '#e67c73': '플라밍고', '#f4511e': '귤', '#f6bf26': '바나나', '#33b679': '세이지', '#0b8043': '바질', '#039be5': '공작', '#3f51b5': '블루베리', '#7986cb': '라벤더', '#8e24aa': '포도', '#616161': '흑연', '#795548': '코코아' };

/** V7 4번: 캘린더·홈 공통 — 개인/회사 두 색 */
export function useCalColors() {
  const { data, reload } = useApi<{ colors: CalColors; default: CalColors; palette: string[] }>('/api/calendar-colors');
  useEffect(() => { const h = () => reload(); window.addEventListener('wos-cal-colors', h); return () => window.removeEventListener('wos-cal-colors', h); }, [reload]);
  return { colors: data?.colors ?? FALLBACK, palette: data?.palette ?? Object.keys(PALETTE_NAMES), defaults: data?.default ?? FALLBACK };
}
/** 대표 지적(10/19 ②) 색 우선순위: 일정별 색 → (남의 개인 일정) 사람 색 → 캘린더 색 → 개인/회사 기본 */
export function eventColorOf(e: { eventColor?: string | null; calendarType?: string; calendarId?: string; ownerId?: string }, c: CalColors, meId: string) {
  if (e.eventColor) return e.eventColor;
  if (e.calendarType === 'personal' && e.ownerId && e.ownerId !== meId && c.people?.[e.ownerId]) return c.people[e.ownerId];
  if (e.calendarId && c.cals?.[e.calendarId]) return c.cals[e.calendarId];
  return e.calendarType === 'personal' ? c.personal : c.company;
}
/** 캘린더·사람 색 한 칸 저장(나만) */
export async function saveColorPart(part: { cals?: Record<string, string | null>; people?: Record<string, string | null>; whoDot?: boolean }) {
  try { await api('/api/calendar-colors', { method: 'PUT', body: part }); window.dispatchEvent(new Event('wos-cal-colors')); broadcastRefresh(); }
  catch (e: any) { toast.error(e.message); }
}

/** 색 점: 누르면 12색 + 직접 선택 + 기본으로 (Google 캘린더 목록의 색 점) */
export function ColorDot({ color, label, onPick, testId, size = 'size-3' }: { color: string; label: string; onPick: (c: string | null) => void; testId?: string; size?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }} aria-label={`${label} 색 바꾸기`} aria-expanded={open} data-testid={testId}
        className={cx('shrink-0 rounded-full ring-offset-1 hover:ring-2 hover:ring-slate-300', size)} style={{ background: color }} />
      {open && <>
        <span className="fixed inset-0 z-40" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }} />
        <span className="absolute left-0 top-5 z-50 w-[188px] rounded-card border border-line bg-white p-2 shadow-pop" role="dialog" aria-label={`${label} 색`} data-testid="color-pop" onClick={(e) => e.stopPropagation()}>
          <span className="grid grid-cols-6 gap-1.5">
            {Object.keys(PALETTE_NAMES).map((p) => (
              <button key={p} type="button" aria-label={PALETTE_NAMES[p]} title={PALETTE_NAMES[p]} onClick={(e) => { e.preventDefault(); onPick(p); setOpen(false); }}
                className={cx('flex size-6 items-center justify-center rounded-full', color === p && 'ring-2 ring-ink ring-offset-1')} style={{ background: p }}>
                {color === p && <Check className="size-3 text-white" strokeWidth={3} />}
              </button>
            ))}
          </span>
          <span className="mt-2 flex items-center justify-between gap-2 text-xs">
            <label className="inline-flex cursor-pointer items-center gap-1 text-ink-2">
              <input type="color" value={color} onChange={(e) => onPick(e.target.value)} className="size-5 cursor-pointer border-0 bg-transparent p-0" aria-label="직접 선택" data-testid="color-custom" />직접 선택
            </label>
            <button type="button" className="text-ink-3 hover:text-ink" onClick={(e) => { e.preventDefault(); onPick(null); setOpen(false); }}>기본으로</button>
          </span>
        </span>
      </>}
    </span>
  );
}

/** 일정: 개인 캘린더 = 개인, 회사·조직 캘린더 = 회사 */
export const isPersonalEvent = (e: { calendarType?: string }) => e.calendarType === 'personal';
/** 업무: 프로젝트에 속하면 회사, 프로젝트 없는 담당자 업무면 개인 */
export const isPersonalTask = (t: { project_id?: string | null }) => !t.project_id;

export function CalColorsDialog({ onClose }: { onClose: () => void }) {
  const { user } = useSession();
  const { colors, palette } = useCalColors();
  const [c, setC] = useState<CalColors>(colors);
  const cals = useApi<{ calendars: { id: string; name: string; type: string }[] }>('/api/calendars');
  const dir = useApi<{ users: { id: string; name: string }[] }>('/api/directory');
  const [asDefault, setAsDefault] = useState(false);
  useEffect(() => setC(colors), [colors.personal, colors.company, colors.whoDot]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save() {
    try {
      await api('/api/calendar-colors', { method: 'PUT', body: { personal: c.personal, company: c.company, whoDot: !!c.whoDot, asDefault } });
      toast.ok(asDefault ? '내 색과 모두의 기본값을 바꿨습니다' : '캘린더 색을 바꿨습니다');
      window.dispatchEvent(new Event('wos-cal-colors')); broadcastRefresh(); onClose();
    } catch (e: any) { toast.error(e.message); }
  }
  const row = (k: keyof CalColors, label: string) => (
    <div>
      <p className="mb-1.5 text-sm font-medium">{label}</p>
      <div className="grid grid-cols-6 gap-2" role="radiogroup" aria-label={label}>
        {palette.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={c[k] === p} aria-label={`${label} ${PALETTE_NAMES[p] ?? p}`} onClick={() => setC({ ...c, [k]: p })}
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
        <p className="text-xs text-ink-2">업무와 일정은 같은 모양으로, 기본 색은 <b>개인</b>(내·남의 개인 일정, 프로젝트 없는 업무)과 <b>회사</b>(회사·현장 일정, 프로젝트 업무)입니다. 캘린더·사람마다, 일정마다(일정 상세의 색 점) 따로 바꿀 수 있고 내 화면에만 적용됩니다.</p>
        {row('personal', '개인 일정 색')}
        {row('company', '회사 일정 색')}
        {/* 대표 지적(10/19 ②): 캘린더별·사람별 색(바로 저장, 나만) */}
        <div data-testid="cal-colors-each">
          <p className="mb-1.5 text-sm font-medium">캘린더·사람별 색 <span className="text-xs font-normal text-ink-3">(색 점을 누르면 바로 바뀜)</span></p>
          <ul className="space-y-1 text-sm">
            {(cals.data?.calendars ?? []).map((k) => (
              <li key={k.id} className="flex items-center gap-2"><ColorDot color={colors.cals?.[k.id] ?? (k.type === 'personal' ? colors.personal : colors.company)} label={k.type === 'personal' ? '내 일정' : k.name} onPick={(v) => saveColorPart({ cals: { [k.id]: v } })} size="size-4" />{k.type === 'personal' ? '내 일정' : k.name}</li>
            ))}
            {(dir.data?.users ?? []).filter((p) => p.id !== user.id).map((p) => (
              <li key={p.id} className="flex items-center gap-2"><ColorDot color={colors.people?.[p.id] ?? colors.personal} label={`${p.name} 일정`} onPick={(v) => saveColorPart({ people: { [p.id]: v } })} size="size-4" />{p.name}<span className="text-xs text-ink-3">개인 일정</span></li>
            ))}
          </ul>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!c.whoDot} onChange={(e) => setC({ ...c, whoDot: e.target.checked })} data-testid="cal-who-dot" />다른 사람 일정 앞 약칭(민수 ·) 대신 색 점</label>
        {user.role === 'owner' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={asDefault} onChange={(e) => setAsDefault(e.target.checked)} />모두에게 기본값으로 (각자 바꾼 사람은 그대로)</label>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button onClick={save}>저장</Button></div>
      </div>
    </Modal>
  );
}
