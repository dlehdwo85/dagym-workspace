'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, cx, Field, Loading, fmtDateTime, inputCls, toast } from '@/components/ui';
import { enableNativePush, isNativeApp, subscribeWebPush } from '@/components/native';
import { ROLE_LABEL } from '@/lib/types';

export default function Settings() {
  const { user, features } = useSession();
  const { data, error, loading, reload } = useApi<any>('/api/notifications/prefs');
  const [types, setTypes] = useState<any[]>([]);
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (data) { setTypes(data.types); setS(data.settings); } }, [data]);
  if (error) return <ErrorBox error={error} retry={reload} />;
  if (loading || !s) return <Loading />;
  async function save() {
    try { await api('/api/notifications/prefs', { method: 'PUT', body: { types, settings: s } }); toast.ok('저장했습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function enablePush() {
    try { await subscribeWebPush(); toast.ok('이 기기에서 알림을 받습니다'); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function test() {
    try {
      const r = await api('/api/push/test', { body: {} });
      const d = r.deliveries as any[];
      if (!d.length) toast.info('등록된 기기가 없어 앱 내 알림만 만들었습니다');
      else toast[d.every((x) => x.status === 'sent') ? 'ok' : 'error'](d.map((x) => `${x.channel}: ${x.status === 'sent' ? '발송됨' : x.error ?? x.status}`).join(' / '));
      reload();
    } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">설정</h1>
      {(user.role === 'owner' || user.role === 'admin') && <p className="text-sm text-ink-2">관리: <a href="/admin/holidays" className="font-medium text-accent-600 underline">공휴일</a> · <a href="/admin/users" className="font-medium text-accent-600 underline">사용자 관리</a> · <a href="/revenue" className="font-medium text-accent-600 underline">매출</a></p>}
      <section className="rounded-lg border bg-white p-4 text-sm">
        <div className="font-semibold">{user.name}</div>
        <div className="text-slate-500">{user.email} · {ROLE_LABEL[user.role]}</div>
        {features.googleSync && <Link href="/settings/google" className="mt-2 inline-block text-brand-600 hover:underline">Google Calendar 연동 (선택 기능) →</Link>}
      </section>
      <SwipeToggle />
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">알림 종류별 수신</h2>
        <table className="w-full text-sm" data-testid="prefs">
          <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">종류</th><th className="py-1 text-center">앱 내 알림</th><th className="py-1 text-center">푸시</th></tr></thead>
          <tbody className="divide-y">{types.map((t, i) => (
            <tr key={t.type}><td className="py-1.5">{t.label}</td>
              <td className="text-center"><input type="checkbox" aria-label={`${t.label} 앱 내`} checked={t.inApp} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, inApp: e.target.checked } : x)))} /></td>
              <td className="text-center"><input type="checkbox" aria-label={`${t.label} 푸시`} checked={t.push} onChange={(e) => setTypes(types.map((x, j) => (j === i ? { ...x, push: e.target.checked } : x)))} /></td></tr>
          ))}</tbody>
        </table>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="일정 시작 전 알림">
            <select className={inputCls} value={s.eventReminderMinutes ?? 30} onChange={(e) => setS({ ...s, eventReminderMinutes: Number(e.target.value) })}>
              {[[0, '받지 않음'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [120, '2시간 전'], [1440, '하루 전']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="마감 임박 알림 (시간 전)"><input type="number" min={1} max={168} className={inputCls} value={s.dueSoonHours} onChange={(e) => setS({ ...s, dueSoonHours: Number(e.target.value) })} /></Field>
          {/* V8 1번 아침 브리핑 */}
          <Field label="아침 브리핑 (오늘 할 일·일정 요약 알림)">
            <span className="flex flex-wrap items-center gap-2" data-testid="briefing-settings">
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.briefingEnabled ?? true} onChange={(e) => setS({ ...s, briefingEnabled: e.target.checked })} aria-label="아침 브리핑 받기" />받기</label>
              <input type="time" step={900} className={cx(inputCls, '!w-32')} value={s.briefingTime ?? '08:30'} onChange={(e) => setS({ ...s, briefingTime: e.target.value })} aria-label="브리핑 시각" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!s.briefingWeekend} onChange={(e) => setS({ ...s, briefingWeekend: e.target.checked })} />주말·공휴일에도</label>
            </span>
          </Field>
          <Field label="푸시 받지 않는 시간 시작"><input type="time" className={inputCls} value={s.quietStart ?? ''} onChange={(e) => setS({ ...s, quietStart: e.target.value || null })} /></Field>
          <Field label="끝"><input type="time" className={inputCls} value={s.quietEnd ?? ''} onChange={(e) => setS({ ...s, quietEnd: e.target.value || null })} /></Field>
        </div>
        <p className="mt-1 text-xs text-slate-500">방해 금지 시간에 생긴 푸시는 끝나는 시각에 발송됩니다. 앱 내 알림은 바로 쌓입니다.</p>
        <Button className="mt-3" onClick={save}>저장</Button>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">알림 받는 기기 (앱·브라우저)</h2>
        <ul className="space-y-1 text-sm">
          {data.subscriptions.map((d: any) => (
            <li key={d.id} className="flex justify-between"><span>{d.kind === 'fcm' ? `앱 (${d.platform})` : '웹 브라우저'} · 등록 {fmtDateTime(d.created_at)}</span>
              <span className="text-xs text-slate-500">{d.disabled_at ? '해제됨' : d.last_success_at ? `최근 수신 ${fmtDateTime(d.last_success_at)}` : '수신 기록 없음'}</span></li>
          ))}
          {!data.subscriptions.length && <li className="text-xs text-slate-400">등록된 기기가 없습니다</li>}
        </ul>
        <div className="mt-3 flex gap-2">
          {isNativeApp() ? <Button variant="secondary" onClick={async () => { try { await enableNativePush(); toast.ok('이 기기에서 앱 알림을 받습니다'); reload(); } catch (e: any) { toast.error(e.message); } }}>이 기기에서 앱 알림 받기</Button>
            : <Button variant="secondary" onClick={enablePush}>이 브라우저에서 알림 받기</Button>}
          <Button variant="secondary" onClick={test}>시험 알림 보내기</Button>
        </div>
      </section>
    </div>
  );
}

/** 휴대폰 목록에서 행을 밀어 완료 (이 기기 설정, 기본 꺼짐 — 옆으로 밀다 실수로 완료되는 일을 막기 위해) */
function SwipeToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => { try { setOn(localStorage.getItem('wos_swipe_done') === '1'); } catch {} }, []);
  return (
    <section className="rounded-lg border bg-white p-4">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" role="switch" className="mt-0.5 size-4" checked={on} aria-label="밀어서 완료"
          onChange={(e) => { setOn(e.target.checked); try { localStorage.setItem('wos_swipe_done', e.target.checked ? '1' : '0'); } catch {} toast.ok(e.target.checked ? '켰습니다' : '껐습니다'); }} />
        <span><b className="font-semibold">밀어서 완료 (휴대폰, 이 기기)</b><span className="block text-xs text-ink-2">켜면 업무 목록에서 행을 오른쪽 끝까지(절반 가까이) 밀었다 놓을 때 완료됩니다. 실수로 완료되지 않도록 기본은 꺼져 있습니다. 완료한 업무는 목록 위 &ldquo;방금 완료한 업무&rdquo;에서 되돌릴 수 있습니다.</span></span>
      </label>
    </section>
  );
}
