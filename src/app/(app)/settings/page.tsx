'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Loading, fmtDateTime, inputCls, toast } from '@/components/ui';
import { isNativeApp, subscribeWebPush } from '@/components/native';
import { ROLE_LABEL } from '@/lib/types';

export default function Settings() {
  const { user } = useSession();
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
      <section className="rounded-lg border bg-white p-4 text-sm">
        <div className="font-semibold">{user.name}</div>
        <div className="text-slate-500">{user.email} · {ROLE_LABEL[user.role]}</div>
        <Link href="/settings/google" className="mt-2 inline-block text-brand-600 hover:underline">Google Calendar 연동 →</Link>
      </section>
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
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="마감 임박 알림 (시간 전)"><input type="number" min={1} max={168} className={inputCls} value={s.dueSoonHours} onChange={(e) => setS({ ...s, dueSoonHours: Number(e.target.value) })} /></Field>
          <Field label="푸시 받지 않는 시간 시작"><input type="time" className={inputCls} value={s.quietStart ?? ''} onChange={(e) => setS({ ...s, quietStart: e.target.value || null })} /></Field>
          <Field label="끝"><input type="time" className={inputCls} value={s.quietEnd ?? ''} onChange={(e) => setS({ ...s, quietEnd: e.target.value || null })} /></Field>
        </div>
        <p className="mt-1 text-xs text-slate-500">방해 금지 시간에 생긴 푸시는 끝나는 시각에 발송됩니다. 앱 내 알림은 바로 쌓입니다.</p>
        <Button className="mt-3" onClick={save}>저장</Button>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">알림 받는 기기</h2>
        <ul className="space-y-1 text-sm">
          {data.subscriptions.map((d: any) => (
            <li key={d.id} className="flex justify-between"><span>{d.kind === 'fcm' ? `앱 (${d.platform})` : '웹 브라우저'} · 등록 {fmtDateTime(d.created_at)}</span>
              <span className="text-xs text-slate-500">{d.disabled_at ? '해제됨' : d.last_success_at ? `최근 수신 ${fmtDateTime(d.last_success_at)}` : '수신 기록 없음'}</span></li>
          ))}
          {!data.subscriptions.length && <li className="text-xs text-slate-400">등록된 기기가 없습니다</li>}
        </ul>
        <div className="mt-3 flex gap-2">
          {!isNativeApp() && <Button variant="secondary" onClick={enablePush}>이 브라우저에서 알림 받기</Button>}
          <Button variant="secondary" onClick={test}>시험 알림 보내기</Button>
        </div>
      </section>
    </div>
  );
}
