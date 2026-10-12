'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, Loading, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const ERR: Record<string, string> = { state: '연결 요청이 만료되었습니다. 다시 시도하세요.', exchange: 'Google 인증 처리에 실패했습니다. 다시 시도하세요.',
  access_denied: 'Google 에서 권한을 허용하지 않았습니다.', scope_denied: '캘린더 일정 권한을 선택하지 않았습니다. 권한 화면에서 캘린더 항목을 체크해 주세요.' };

export default function GoogleSettings() {
  const sp = useSearchParams();
  const st = useApi<any>('/api/google/status');
  const cals = useApi<{ calendars: any[] }>('/api/calendars');
  const [gcals, setGcals] = useState<any[] | null>(null);
  const [f, setF] = useState<any>({ direction: 'both' });
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (sp.get('connected')) toast.ok('Google 계정을 연결했습니다. 동기화할 캘린더를 고르세요.');
    if (sp.get('error')) toast.error(ERR[sp.get('error')!] ?? `연결 실패: ${sp.get('error')}`);
  }, [sp]);
  useEffect(() => {
    if (st.data?.account?.status === 'active') api('/api/google/calendars').then((r) => setGcals(r.calendars)).catch((e) => toast.error(e.message));
  }, [st.data?.account?.status]);
  if (st.error) return <ErrorBox error={st.error} retry={st.reload} />;
  if (!st.data) return <Loading />;
  const d = st.data;
  const personal = cals.data?.calendars.find((c) => c.type === 'personal');

  async function link(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/google/links', { body: { googleCalendarId: f.googleCalendarId, localCalendarId: f.localCalendarId ?? personal?.id, direction: f.direction } }); toast.ok('연결했습니다. 첫 동기화를 시작합니다.'); setTimeout(st.reload, 1500); } catch (er: any) { toast.error(er.message); }
  }
  async function syncNow(id: string, full = false) {
    setBusy(id);
    try { const r = await api(`/api/google/links/${id}/sync`, { body: { full } }); r.error ? toast.error(r.error) : toast.ok('동기화했습니다'); } catch (er: any) { toast.error(er.message); }
    setBusy(''); st.reload();
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-bold">Google Calendar 연동</h1>
      {!d.configured && <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">관리자가 아직 Google OAuth 설정(클라이언트 ID)을 등록하지 않아 연결할 수 없습니다. 회사 캘린더는 그대로 사용할 수 있습니다.</div>}
      <section className="rounded-lg border bg-white p-4 text-sm">
        {!d.account ? (
          <>
            <p>Google 캘린더와 회사 캘린더를 연결합니다. 연결 범위를 고르세요. Google 권한 화면에서도 항목별로 허용 여부를 선택할 수 있습니다.</p>
            <ul className="my-2 list-disc pl-5 text-xs text-slate-600">
              <li><b>읽기·쓰기(양방향)</b>: 선택한 Google 캘린더의 일정을 가져오고, 회사 캘린더에서 만든 일정도 Google 에 반영합니다.</li>
              <li><b>읽기 전용(가져오기)</b>: Google 일정을 회사 캘린더에 보여 주기만 하고 Google 에는 아무것도 쓰지 않습니다.</li>
              <li>연결 전부터 있던 Google 일정은 사용자가 회사 캘린더에서 직접 수정·삭제한 것만 Google 에 반영됩니다. 일괄 수정·삭제는 하지 않습니다.</li>
            </ul>
            <div className="flex gap-2">
              <a href="/api/google/connect?mode=both"><Button disabled={!d.configured}>읽기·쓰기로 연결</Button></a>
              <a href="/api/google/connect?mode=import"><Button variant="secondary" disabled={!d.configured}>읽기 전용으로 연결</Button></a>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>연결된 계정: <b>{d.account.google_email ?? '(이메일 미확인)'}</b> · {d.canWrite ? '읽기·쓰기' : '읽기 전용'}
                <span className={cx('ml-2 rounded px-1.5 text-xs', d.account.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800')}>{d.account.status === 'active' ? '정상' : '다시 연결 필요'}</span></div>
              <div className="flex gap-2">
                {d.account.status !== 'active' && <a href={`/api/google/connect?mode=${d.canWrite ? 'both' : 'import'}`}><Button size="sm">다시 연결</Button></a>}
                <Button size="sm" variant="secondary" onClick={async () => { if (!confirm('Google 연결을 해제할까요? Google·회사 일정은 삭제되지 않습니다.')) return; await api('/api/google/disconnect', { body: {} }); st.reload(); }}>연결 해제</Button>
              </div>
            </div>
            {d.account.status !== 'active' && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-800">복구 방법: “다시 연결”을 눌러 Google 권한을 다시 허용하세요. 사유: {d.account.last_error}</p>}
          </>
        )}
      </section>
      {d.account?.status === 'active' && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">동기화할 캘린더 추가</h2>
          <form onSubmit={link} className="grid gap-3 sm:grid-cols-4">
            <Field label="Google 캘린더" className="sm:col-span-2">
              <select className={inputCls} required value={f.googleCalendarId ?? ''} onChange={(e) => setF({ ...f, googleCalendarId: e.target.value })}>
                <option value="">선택</option>{gcals?.map((g) => <option key={g.id} value={g.id}>{g.name}{g.primary ? ' (기본)' : ''}{['owner', 'writer'].includes(g.accessRole) ? '' : ' · 읽기만'}</option>)}
              </select>
            </Field>
            <Field label="회사 캘린더">
              <select className={inputCls} value={f.localCalendarId ?? personal?.id ?? ''} onChange={(e) => setF({ ...f, localCalendarId: e.target.value })}>
                {cals.data?.calendars.filter((c) => c.perms.edit).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="방향">
              <select className={inputCls} value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })}>
                <option value="both" disabled={!d.canWrite}>양방향</option><option value="import">가져오기만</option>
              </select>
            </Field>
            <div className="sm:col-span-4"><Button type="submit">연결</Button></div>
          </form>
        </section>
      )}
      {d.links.length > 0 && (
        <section className="rounded-lg border bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">연결된 캘린더</h2>
          <ul className="divide-y text-sm">{d.links.map((l: any) => (
            <li key={l.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><b>{l.google_calendar_name}</b> ↔ {l.local_calendar_name} · {l.direction === 'both' ? '양방향' : '가져오기'}</span>
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" disabled={busy === l.id} onClick={() => syncNow(l.id)}>{busy === l.id ? '동기화 중…' : '지금 동기화'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => syncNow(l.id, true)}>전체 재동기화</Button>
                  <Button size="sm" variant="ghost" onClick={async () => { if (!confirm('연결을 끊을까요? 양쪽 일정은 그대로 남습니다.')) return; await api(`/api/google/links/${l.id}`, { method: 'DELETE' }); st.reload(); }}>연결 끊기</Button>
                </span>
              </div>
              <div className="text-xs text-slate-500">
                상태 <b className={l.status === 'active' ? 'text-emerald-700' : 'text-red-700'}>{l.status === 'active' ? '정상' : l.status === 'error' ? '오류' : '일시중지'}</b>
                · 마지막 동기화 {l.last_synced_at ? fmtDateTime(l.last_synced_at) : '없음'}
                · 실시간 알림 {l.channel_expires_at ? `~${fmtDateTime(l.channel_expires_at)}` : '미등록(10분마다 확인)'}
              </div>
              {l.last_error && <p className="mt-1 rounded bg-red-50 p-1.5 text-xs text-red-800">최근 오류: {l.last_error} — “지금 동기화”로 다시 시도하고, 계속되면 “전체 재동기화” 또는 계정 “다시 연결”을 하세요.</p>}
            </li>))}
          </ul>
        </section>
      )}
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold">동기화 이력</h2>
        <ul className="max-h-80 space-y-1 overflow-y-auto text-xs" data-testid="sync-logs">{d.logs.map((g: any) => (
          <li key={g.id} className={cx(g.status === 'error' && 'text-red-700', g.status === 'conflict' && 'text-amber-700')}>
            {fmtDateTime(g.created_at)} · {g.direction}/{g.action} · {g.status} {g.detail?.error ?? ''}{g.detail?.pulled ? ` 가져옴 ${g.detail.pulled.created + g.detail.pulled.updated + g.detail.pulled.deleted}건, 보냄 ${g.detail.pushed.inserted + g.detail.pushed.patched + g.detail.pushed.deleted}건` : ''}{g.detail?.winner ? ` 충돌→${g.detail.winner === 'google' ? 'Google' : '회사'} 우선` : ''}
          </li>))}
          {!d.logs.length && <li className="text-slate-400">기록 없음</li>}
        </ul>
      </section>
    </div>
  );
}
