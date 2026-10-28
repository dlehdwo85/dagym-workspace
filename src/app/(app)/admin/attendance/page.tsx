'use client';
import { dtf } from '@/lib/dtf';
// V30 ③ 관리자 근태: 날짜별 출퇴근표(지각·미기록·현장 밖·연차/출장) · 월 요약 · 엑셀 · 현장(주소·위치·반경) · 설정(켬/끔·지각 기준)
import { useState } from 'react';
import { Download, MapPin, Plus, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Field, PageHeader, Skeleton, cx, inputCls, toast } from '@/components/ui';

type DayRow = { id: string; name: string; title: string | null; inTime: string | null; inSite: string | null; inInside: boolean | null; inReason: string | null; outTime: string | null; outSite: string | null; outInside: boolean | null; outReason: string | null; late: boolean; missing: boolean; away: string | null };
type MonRow = { id: string; name: string; title: string | null; present: number; late: number; outside: number; away: number; missing: number };
type Site = { id: string; name: string; address: string | null; lat: number; lng: number; radius_m: number; active: boolean };
const todayKst = () => dtf('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export default function AttendanceAdminPage() {
  const [tab, setTab] = useState<'day' | 'month' | 'sites'>('day');
  const [day, setDay] = useState(todayKst());
  const [month, setMonth] = useState(todayKst().slice(0, 7));
  const dayQ = useApi<{ day: string; workday: boolean; holiday: string | null; workStart: string; rows: DayRow[] }>(tab === 'day' ? `/api/attendance/sheet?day=${day}` : null, [day, tab]);
  const monQ = useApi<{ month: string; days: number; rows: MonRow[] }>(tab === 'month' ? `/api/attendance/sheet?month=${month}` : null, [month, tab]);
  return (
    <div className="space-y-4" data-testid="attendance-admin">
      <PageHeader title="근태(출퇴근)" icon={MapPin} sub="홈 [출근][퇴근]로 기록된 시각과 현장 안/밖. 급여·52시간 계산은 하지 않습니다. 위치는 출퇴근 순간만 저장됩니다."
        actions={<a href={`/api/attendance/export?month=${month}`} className="inline-flex h-9 items-center gap-1 rounded-input border border-line bg-white px-3 text-sm hover:bg-slate-50" data-testid="attendance-export"><Download className="size-4" />{month} 엑셀</a>} />
      <div className="flex gap-1.5" role="tablist">{([['day', '날짜별'], ['month', '월 요약'], ['sites', '현장·설정']] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1 text-xs font-medium', tab === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2')} data-testid={`attendance-tab-${k}`}>{l}</button>)}</div>
      {tab === 'day' && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2"><input type="date" className={cx(inputCls, 'w-auto')} value={day} onChange={(e) => setDay(e.target.value)} aria-label="날짜" />
            {dayQ.data && <span className="text-xs text-ink-3">{dayQ.data.holiday ? `공휴일 · ${dayQ.data.holiday}` : dayQ.data.workday ? `근무일 · 지각 기준 ${dayQ.data.workStart}` : '휴일'}</span>}</div>
          {!dayQ.data ? <Skeleton rows={5} /> : (
            <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
              <table className="w-full text-sm" data-testid="attendance-day">
                <thead><tr className="text-left text-xs text-ink-3"><th className="px-3 py-2">이름</th><th className="px-3 py-2">출근</th><th className="px-3 py-2">퇴근</th><th className="px-3 py-2">표시</th></tr></thead>
                <tbody>{dayQ.data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-line" data-testid="attendance-row">
                    <td className="px-3 py-1.5"><b>{r.name}</b>{r.title && <span className="ml-1 text-xs text-ink-3">{r.title}</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.inTime ?? <span className="text-ink-3">—</span>}{r.inSite && <span className={cx('ml-1 text-xs', r.inInside === false ? 'text-amber-700' : 'text-ink-3')}>{r.inSite}{r.inInside === false ? ` 밖 · ${r.inReason ?? ''}` : ''}</span>}{!r.inSite && r.inReason && <span className="ml-1 text-xs text-ink-3">{r.inReason}</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums">{r.outTime ?? <span className="text-ink-3">—</span>}{r.outSite && <span className={cx('ml-1 text-xs', r.outInside === false ? 'text-amber-700' : 'text-ink-3')}>{r.outSite}{r.outInside === false ? ` 밖 · ${r.outReason ?? ''}` : ''}</span>}</td>
                    <td className="px-3 py-1.5 text-xs">{r.away && <span className="rounded bg-slate-100 px-1.5 py-0.5">{r.away}</span>} {r.late && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">지각</span>} {r.missing && <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">미기록</span>}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === 'month' && (
        <section className="space-y-2">
          <input type="month" className={cx(inputCls, 'w-auto')} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="월" />
          {!monQ.data ? <Skeleton rows={5} /> : (
            <div className="overflow-x-auto rounded-card border border-line bg-white shadow-card">
              <table className="w-full text-sm" data-testid="attendance-month">
                <thead><tr className="text-left text-xs text-ink-3"><th className="px-3 py-2">이름</th><th className="px-3 py-2 text-right">출근</th><th className="px-3 py-2 text-right">지각</th><th className="px-3 py-2 text-right">현장 밖</th><th className="px-3 py-2 text-right">연차·출장</th><th className="px-3 py-2 text-right">미기록</th></tr></thead>
                <tbody>{monQ.data.rows.map((r) => <tr key={r.id} className="border-t border-line"><td className="px-3 py-1.5"><b>{r.name}</b></td><td className="px-3 py-1.5 text-right tabular-nums">{r.present} / {monQ.data!.days}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.late}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.outside}</td><td className="px-3 py-1.5 text-right tabular-nums">{r.away}</td><td className={cx('px-3 py-1.5 text-right tabular-nums', r.missing && 'text-red-700')}>{r.missing}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {tab === 'sites' && <Sites />}
    </div>
  );
}

function Sites() {
  const st = useApi<{ sites: Site[]; canEdit: boolean; settings: { on: boolean; workStart: string } }>('/api/attendance/sites');
  const [f, setF] = useState({ name: '', address: '', lat: '', lng: '', radiusM: '200' });
  const [busy, setBusy] = useState(false);
  if (!st.data) return <Skeleton rows={4} />;
  const { sites, canEdit, settings } = st.data;
  const save = async () => {
    setBusy(true);
    try { await api('/api/attendance/sites', { body: { name: f.name.trim(), address: f.address.trim() || undefined, lat: Number(f.lat), lng: Number(f.lng), radiusM: Number(f.radiusM) || 200 } }); toast.ok('현장을 저장했습니다'); setF({ name: '', address: '', lat: '', lng: '', radiusM: '200' }); st.reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const here = () => { if (!navigator.geolocation) { toast.error('이 기기에서 위치를 받을 수 없습니다'); return; } navigator.geolocation.getCurrentPosition((p) => setF((x) => ({ ...x, lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) })), () => toast.error('위치를 받지 못했습니다 — 브라우저 권한을 확인하세요'), { enableHighAccuracy: true, timeout: 8000 }); };
  const setting = async (patch: { attendanceOn?: boolean; workStart?: string }) => { try { await api('/api/attendance/settings', { method: 'PUT', body: patch }); st.reload(); toast.ok('저장했습니다'); } catch (e: any) { toast.error(e.message); } };
  return (
    <section className="space-y-3">
      <div className="rounded-card border border-line bg-white p-4 text-sm shadow-card">
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.on} disabled={!canEdit} onChange={(e) => setting({ attendanceOn: e.target.checked })} data-testid="attendance-on" /><b>홈에 [출근][퇴근] 버튼 보이기</b><span className="text-xs text-ink-2">끄면 출퇴근 기록을 쓰지 않는 회사</span></label>
        <label className="mt-2 flex items-center gap-2">지각 기준 시각 <input type="time" className={cx(inputCls, 'w-auto py-1')} defaultValue={settings.workStart} disabled={!canEdit} onBlur={(e) => e.target.value && e.target.value !== settings.workStart && setting({ workStart: e.target.value })} aria-label="지각 기준" data-testid="attendance-workstart" /></label>
      </div>
      <ul className="divide-y divide-line rounded-card border border-line bg-white shadow-card" data-testid="site-list">
        {!sites.length && <li className="p-4 text-sm text-ink-3">현장이 없습니다 — 등록하면 출퇴근 때 현장 안/밖이 표시됩니다(없으면 시각만 기록).</li>}
        {sites.map((s) => (
          <li key={s.id} className={cx('flex items-center gap-3 px-4 py-2.5 text-sm', !s.active && 'opacity-50')}>
            <MapPin className="size-4 shrink-0 text-emerald-600" /><div className="min-w-0 flex-1"><b>{s.name}</b>{s.address && <span className="ml-1 text-xs text-ink-3">{s.address}</span>}<div className="text-xs text-ink-3">{s.lat.toFixed(5)}, {s.lng.toFixed(5)} · 반경 {s.radius_m}m{!s.active && ' · 사용 안 함'}</div></div>
            {canEdit && s.active && <button onClick={async () => { if (!confirm(`${s.name} 현장을 지울까요?`)) return; try { await api(`/api/attendance/sites/${s.id}`, { method: 'DELETE' }); st.reload(); } catch (e: any) { toast.error(e.message); } }} className="inline-flex size-8 items-center justify-center rounded-input text-red-600 hover:bg-red-50" aria-label={`${s.name} 지우기`}><Trash2 className="size-4" /></button>}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="grid gap-2 rounded-card border border-line bg-white p-4 shadow-card sm:grid-cols-6" data-testid="site-form">
          <Field label="현장 이름" className="sm:col-span-2"><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="현장 이름" data-testid="site-name" /></Field>
          <Field label="주소(선택)" className="sm:col-span-4"><input className={inputCls} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} aria-label="주소" /></Field>
          <Field label="위도"><input className={inputCls} value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} inputMode="decimal" aria-label="위도" data-testid="site-lat" /></Field>
          <Field label="경도"><input className={inputCls} value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} inputMode="decimal" aria-label="경도" data-testid="site-lng" /></Field>
          <Field label="반경(m)"><input className={inputCls} value={f.radiusM} onChange={(e) => setF({ ...f, radiusM: e.target.value })} inputMode="numeric" aria-label="반경" /></Field>
          <div className="flex items-end gap-2 sm:col-span-3"><Button variant="secondary" onClick={here}>현재 위치로 채우기</Button><Button onClick={save} disabled={busy || !f.name.trim() || !f.lat || !f.lng} data-testid="site-save"><Plus />현장 추가</Button></div>
          <p className="text-[11px] text-ink-3 sm:col-span-6">위도·경도는 지도 앱에서 현장을 길게 눌러 복사하거나, 현장에서 [현재 위치로 채우기]를 누르면 됩니다.</p>
        </div>
      )}
    </section>
  );
}
