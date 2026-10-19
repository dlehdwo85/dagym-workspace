'use client';
// V30 ③ 홈 [출근][퇴근] — 처음 1번 위치 동의(출퇴근 순간만 저장), 위치는 navigator.geolocation(앱 WebView 포함), 권한 없으면 위치 없이 기록.
// 회사 현장 밖이면 사유를 받는다. 관리자 설정으로 끈 회사는 카드가 안 보인다.
import { useState } from 'react';
import { LogIn, LogOut, MapPin } from 'lucide-react';
import { api, useApi } from './client';
import { Button, Modal, cx, inputCls, toast } from './ui';

type T = { on: boolean; day: string; consent: boolean; sites: number; workStart: string; today: { inTime: string | null; inSite: string | null; inInside: boolean | null; inReason: string | null; outTime: string | null; outSite: string | null; outInside: boolean | null; outReason: string | null } | null };
function getPos(): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((res) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }), () => res(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 });
  });
}

export function ClockCard() {
  const st = useApi<T>('/api/attendance');
  const [busy, setBusy] = useState<'in' | 'out' | null>(null);
  const [consent, setConsent] = useState<null | 'in' | 'out'>(null);
  const [outside, setOutside] = useState<null | { type: 'in' | 'out'; nearest?: { name: string; distance: number; radius: number }; reason: string }>(null);
  if (!st.data?.on) return null;
  const d = st.data;
  async function send(type: 'in' | 'out', extra: Record<string, unknown> = {}) {
    setBusy(type);
    try {
      const pos = await getPos();
      const r = await api('/api/attendance', { body: { type, ...(pos ? { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy } : { noLocation: true }), ...extra } });
      const t = r.today; const site = type === 'in' ? t.inSite : t.outSite; const inside = type === 'in' ? t.inInside : t.outInside;
      toast.ok(`${type === 'in' ? '출근' : '퇴근'} ${type === 'in' ? t.inTime : t.outTime}${site ? ` · ${site}${inside === false ? ' 밖' : ''}` : pos ? '' : ' · 위치 없음'}`);
      setOutside(null); setConsent(null); st.reload();
    } catch (e: any) {
      if (e.code === 'consent') setConsent(type);
      else if (e.code === 'outside') setOutside({ type, nearest: e.detail?.nearest, reason: '' });
      else toast.error(e.message);
    } finally { setBusy(null); }
  }
  const t = d.today;
  return (
    <section className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-white px-3 py-2 shadow-card" data-testid="home-clock">
      <MapPin className="size-4 shrink-0 text-emerald-600" />
      <div className="min-w-0 flex-1 text-sm" data-testid="home-clock-status">
        {!t?.inTime ? <span className="text-ink-2">아직 출근 전입니다{d.sites ? '' : ' (현장 미등록 — 시각만 기록)'}</span>
          : <span><b>출근 {t.inTime}</b>{t.inSite && <span className={cx('ml-1 text-xs', t.inInside === false ? 'text-amber-700' : 'text-ink-3')}>{t.inSite}{t.inInside === false ? ` 밖 · ${t.inReason}` : ''}</span>}
            {t.outTime && <> · <b>퇴근 {t.outTime}</b>{t.outSite && <span className={cx('ml-1 text-xs', t.outInside === false ? 'text-amber-700' : 'text-ink-3')}>{t.outSite}{t.outInside === false ? ` 밖 · ${t.outReason}` : ''}</span>}</>}</span>}
      </div>
      {!t?.inTime && <Button size="sm" onClick={() => send('in')} disabled={!!busy} data-testid="clock-in"><LogIn />출근</Button>}
      {t?.inTime && !t.outTime && <Button size="sm" variant="secondary" onClick={() => send('out')} disabled={!!busy} data-testid="clock-out"><LogOut />퇴근</Button>}
      {consent && (
        <Modal open onClose={() => setConsent(null)} title="위치 정보 동의">
          <p className="text-sm text-ink-2">출근·퇴근을 누르는 <b>그 순간의 위치</b>만 저장해 회사가 등록한 현장 안인지 표시합니다. 그 밖의 시간에는 위치를 받지 않고, 다른 용도로 쓰지 않습니다. 위치 권한을 거부해도 시각은 기록됩니다.</p>
          <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => { const c = consent; setConsent(null); void send(c, { noLocation: true }); }}>위치 없이 기록</Button><Button onClick={() => { const c = consent; void send(c, { consent: true }); }} data-testid="clock-consent">동의하고 {consent === 'in' ? '출근' : '퇴근'}</Button></div>
        </Modal>
      )}
      {outside && (
        <Modal open onClose={() => setOutside(null)} title="현장 밖입니다">
          <p className="text-sm text-ink-2">{outside.nearest ? `${outside.nearest.name}에서 ${outside.nearest.distance}m (반경 ${outside.nearest.radius}m)` : '등록된 현장 안이 아닙니다'} — 사유를 적어 주세요.</p>
          <input className={cx(inputCls, 'mt-2')} value={outside.reason} onChange={(e) => setOutside({ ...outside, reason: e.target.value })} placeholder="예: 외근 후 현장 방문, 재택" aria-label="현장 밖 사유" data-testid="clock-reason" autoFocus />
          <div className="mt-3 flex justify-end gap-2"><Button variant="secondary" onClick={() => setOutside(null)}>취소</Button><Button onClick={() => send(outside.type, { reason: outside.reason })} disabled={!outside.reason.trim()} data-testid="clock-reason-save">기록</Button></div>
        </Modal>
      )}
    </section>
  );
}
