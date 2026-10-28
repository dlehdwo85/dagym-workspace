'use client';
import { dtf } from '@/lib/dtf';
// 219차 일정 [워크인 화상회의](결정 15-37, 설계 docs/research/VIDEO_MEETINGS_DESIGN_2026-10-28.md 6-1) — 기능 스위치 FEATURE_MEETINGS 일 때만 보임.
// 켜면 서버가 회의를 만들고 일정 '회의 주소' 칸에 /meet/<code> 를 넣는다(184차 칸 그대로 — 알림·초대·내보내기가 그 주소를 보여 줌). 끄면 칸을 비움.
import { useState } from 'react';
import { Copy, Loader2, Video } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { toast } from '@/components/ui';

/** 워크인 회의 주소인지(/meet/<22자 안팎>) — 줌·구글 미트 주소는 아님 */
export const isWorkinMeet = (url: string | null | undefined) => { if (!url) return false; try { return /^\/meet\/[A-Za-z0-9_-]{16,40}$/.test(new URL(url, 'https://x.invalid').pathname); } catch { return false; } };

type EM = { enabled: boolean; canEdit?: boolean; on?: boolean; meeting?: { url: string; code: string } | null; record?: Rec | null };
type Rec = { started: string | null; ended: string | null; minutes: number; staff: number; guests: number; people: { name: string; guest: boolean; first: string | null; left: string | null; minutes: number }[] };
const hm = (v: string | null) => (v ? dtf('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v)) : '');

/** 일정 창: [워크인 화상회의] 켜기 — 이미 있는 일정은 바로 켜고 끔, 새 일정은 저장할 때 켬(newOn) */
export function WorkinMeetingToggle({ eventId, canEdit, url, onUrl, newOn, setNewOn }: { eventId?: string; canEdit: boolean; url: string; onUrl: (u: string) => void; newOn: boolean; setNewOn: (v: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const on = eventId ? isWorkinMeet(url) : newOn;
  async function toggle() {
    if (!eventId) { setNewOn(!newOn); return; }
    setBusy(true);
    try { const r = await api<EM>(`/api/events/${eventId}/meeting`, { method: 'PUT', body: { on: !on } }); onUrl(r.meeting?.url ?? ''); toast.ok(r.on ? '워크인 화상회의를 켰습니다 — 회의 주소가 일정에 들어갔습니다' : '워크인 화상회의를 껐습니다'); }
    catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  async function copy() { try { await navigator.clipboard.writeText(url); toast.ok('회의 주소를 복사했습니다'); } catch { toast.error('복사하지 못했습니다'); } }
  return (
    <div className="rounded-input border border-line p-2.5" data-testid="ev-workin-meet">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="size-4 accent-brand-600" checked={on} disabled={!canEdit || busy} onChange={toggle} data-testid="ev-workin-meet-toggle" />
        {busy ? <Loader2 className="size-4 animate-spin text-ink-3" /> : <Video className="size-4 text-brand-600" />}워크인 화상회의
      </label>
      <p className="mt-1 text-xs text-ink-2">설치 없이 회의 주소 하나로 들어옵니다 · 외부 손님은 대기실에서 기다렸다가 주최자가 허락하면 입장</p>
      {on && eventId && url && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs">
          <span className="min-w-0 truncate font-mono text-ink-2" data-testid="ev-workin-meet-url">{url}</span>
          <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1 rounded-input border border-line px-2 py-0.5 text-ink-2 hover:bg-slate-50"><Copy className="size-3" />복사</button>
        </div>
      )}
      {on && !eventId && <p className="mt-1 text-xs text-ink-3">저장하면 회의 주소가 만들어져 일정에 들어갑니다</p>}
    </div>
  );
}

/** 일정 미리보기: 회의 기록(시작·시간·직원·손님) — 회의가 한 번이라도 열렸을 때만 */
export function MeetingRecordLine({ eventId }: { eventId: string }) {
  const { data } = useApi<EM>(`/api/events/${eventId}/meeting`);
  const r = data?.record;
  if (!r?.started) return null;
  return (
    <details className="mt-1.5 text-xs text-ink-2" data-testid="ev-meet-record">
      <summary className="cursor-pointer">회의 기록: {hm(r.started)} 시작{r.ended ? ` · ${r.minutes}분` : ' · 진행 중'} · 직원 {r.staff}{r.guests ? ` · 손님 ${r.guests}` : ''}</summary>
      <ul className="mt-1 space-y-0.5 pl-3">{r.people.map((p, k) => <li key={k}>{p.name}{p.guest ? '(손님)' : ''} · {hm(p.first)}~{p.left ? hm(p.left) : ''} · {p.minutes}분</li>)}</ul>
    </details>
  );
}

/** 새 일정 저장 뒤 켜기(일정 id 가 생긴 다음) */
export async function enableEventMeeting(eventId: string) {
  try { await api(`/api/events/${eventId}/meeting`, { method: 'PUT', body: { on: true } }); toast.ok('워크인 화상회의 주소를 일정에 넣었습니다'); }
  catch (e: any) { toast.error(`화상회의를 켜지 못했습니다: ${e.message}`); }
}
