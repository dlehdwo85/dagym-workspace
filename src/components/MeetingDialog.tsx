'use client';
import { useState } from 'react';
import { MapPin } from 'lucide-react';
import { api, broadcastRefresh } from '@/components/client';
import { Button, Field, Modal, inputCls, toast, todayStr } from '@/components/ui';

/** V37 8(대표 10/17): 업무에 장소 칸 대신 [미팅 일정 만들기] — 장소·날짜·시간 → 장소 있는 연결 일정(이동 강조·출발 권장·30분 전 알림) */
export const MEETING_WORDS = /미팅|방문|현장|실사|설명회|회의|상담|답사/;

export function MeetingDialog({ taskId, title, defaultDate, defaultLocation, onClose, onDone }:
  { taskId: string; title: string; defaultDate?: string | null; defaultLocation?: string; onClose: () => void; onDone?: () => void }) {
  const [f, setF] = useState({ location: defaultLocation ?? '', date: defaultDate && defaultDate >= todayStr() ? defaultDate : todayStr(), start: '10:00', end: '11:00' });
  const [busy, setBusy] = useState(false);
  const iso = (d: string, t: string) => `${d}T${t}:00+09:00`;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!f.location.trim()) { toast.error('장소를 넣어 주세요'); return; }
    if (f.end <= f.start) { toast.error('끝나는 시각이 시작보다 늦어야 합니다'); return; }
    setBusy(true);
    try {
      await api(`/api/tasks/${taskId}/meeting`, { body: { location: f.location.trim(), start: iso(f.date, f.start), end: iso(f.date, f.end), title } });
      toast.ok('미팅 일정을 만들었습니다 — 캘린더에 장소·출발 권장 시각이 보입니다');
      broadcastRefresh(); onDone?.(); onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="미팅 일정 만들기">
      <form onSubmit={save} className="grid gap-3" data-testid="meeting-dialog">
        <p className="text-xs text-ink-2">장소는 일정에 한 번만 적습니다. 업무 목록에 📍장소·시간이 보이고, 캘린더에 이동(출발 권장)과 30분 전 알림이 붙습니다.</p>
        <Field label="장소"><input className={inputCls} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="예: 판교 OO아파트 관리사무소" maxLength={300} autoFocus data-testid="meeting-location" /></Field>
        <div className="grid grid-cols-3 gap-2">
          <Field label="날짜"><input type="date" className={inputCls} value={f.date} min={todayStr()} onChange={(e) => setF({ ...f, date: e.target.value })} data-testid="meeting-date" /></Field>
          <Field label="시작"><input type="time" step={900} className={inputCls} value={f.start} onChange={(e) => { const s = e.target.value; const [h, m] = s.split(':').map(Number); const end = `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; setF({ ...f, start: s, end: f.end > s ? f.end : end }); }} data-testid="meeting-start" /></Field>
          <Field label="끝"><input type="time" step={900} className={inputCls} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} data-testid="meeting-end" /></Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>취소</Button>
          <Button type="submit" disabled={busy} data-testid="meeting-save"><MapPin />{busy ? '만드는 중…' : '미팅 일정 만들기'}</Button>
        </div>
      </form>
    </Modal>
  );
}
