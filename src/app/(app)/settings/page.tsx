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
      <CalendarFeed />
      <TwoFactor />
      <AccountSection />
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
            <select className={inputCls} value={s.eventReminderMinutes ?? 60} onChange={(e) => setS({ ...s, eventReminderMinutes: Number(e.target.value) })}>
              {[[0, '받지 않음'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [120, '2시간 전'], [1440, '하루 전']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="마감 임박 알림 (시간 전, 0 = 받지 않음)"><input type="number" min={0} max={168} className={inputCls} value={s.dueSoonHours} onChange={(e) => setS({ ...s, dueSoonHours: Number(e.target.value) })} /></Field>
          {/* V8 8번 업무 미리 알림 기본값 (업무마다 🔔 로 바꿀 수 있음) */}
          <Field label="업무 미리 알림 (기본 — 날짜만 있으면 18시 기준)">
            <select className={inputCls} value={s.taskReminderMinutes ?? 60} onChange={(e) => setS({ ...s, taskReminderMinutes: Number(e.target.value) })} aria-label="업무 미리 알림 기본">
              {[[10, '10분 전'], [30, '30분 전'], [60, '1시간 전'], [120, '2시간 전'], [1440, '하루 전']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          {/* V13 6번 내가 지시한 업무도 마감 알림 */}
          <Field label="내가 지시한 업무의 마감 알림">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.requesterDueAlerts ?? false} onChange={(e) => setS({ ...s, requesterDueAlerts: e.target.checked })} aria-label="내가 지시한 업무의 마감 알림" data-testid="requester-due-alerts" />받기 (담당자 이름·상태 표시)</label>
          </Field>
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

/** V12 3번: 캘린더 구독 주소(ICS) — 구글·아웃룩·애플 캘린더에 "URL로 추가" (읽기 전용, 연결 없이 링크만) */
function CalendarFeed() {
  const { data, reload } = useApi<{ exists: boolean; createdAt: string | null; lastUsedAt: string | null }>('/api/calendar-feed');
  const [url, setUrl] = useState('');
  async function make() {
    if (data?.exists && !confirm('새 주소를 만들면 이전 주소는 더 이상 동작하지 않습니다. 계속할까요?')) return;
    try { const r = await api('/api/calendar-feed', { body: {} }); setUrl(r.url); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function remove() {
    if (!confirm('구독 주소를 끌까요? 캘린더 앱에서 워크인 일정이 더 이상 갱신되지 않습니다.')) return;
    await api('/api/calendar-feed', { method: 'DELETE' }); setUrl(''); reload();
  }
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" data-testid="calendar-feed">
      <h2 className="font-semibold">캘린더 구독 주소 (구글·아웃룩·애플)</h2>
      <p className="mt-1 text-xs text-ink-2">내 일정·참석 일정·내 업무 마감을 다른 캘린더 앱에서 볼 수 있습니다(읽기 전용, 한 시간쯤마다 갱신). 주소를 아는 사람은 누구나 볼 수 있으니 공유하지 마세요.</p>
      {url ? (
        <div className="mt-2 space-y-1.5">
          <input readOnly className={cx(inputCls, 'font-mono text-xs')} value={url} onFocus={(e) => e.currentTarget.select()} aria-label="캘린더 구독 주소" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.ok('복사했습니다'))}>주소 복사</Button>
            <a className="inline-flex h-8 items-center rounded-input border border-line px-3 text-xs" href={url.replace(/^https?:/, 'webcal:')}>애플·아웃룩에서 열기</a>
          </div>
          <p className="text-xs text-ink-3">구글 캘린더: 다른 캘린더 + → URL로 추가 → 위 주소 붙여넣기. 이 주소는 지금 한 번만 보입니다.</p>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={make} data-testid="feed-make">{data?.exists ? '새 주소 만들기' : '구독 주소 만들기'}</Button>
          {data?.exists && <><span className="text-xs text-ink-2">사용 중 · 마지막 갱신 {data.lastUsedAt ? fmtDateTime(data.lastUsedAt) : '아직 없음'}</span><Button size="sm" variant="secondary" onClick={remove}>끄기</Button></>}
        </div>
      )}
    </section>
  );
}

/** V12 3번: 2단계 인증(OTP 앱) · 로그인한 기기 · 다른 기기 로그아웃 */
function TwoFactor() {
  const st = useApi<{ enabled: boolean; enabledAt: string | null }>('/api/auth/2fa');
  const ss = useApi<{ sessions: any[] }>('/api/auth/sessions');
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  async function start() { try { setSetup(await api('/api/auth/2fa', { body: {} })); setCode(''); } catch (e: any) { toast.error(e.message); } }
  async function enable() { try { await api('/api/auth/2fa', { method: 'PUT', body: { code } }); setSetup(null); st.reload(); toast.ok('2단계 인증을 켰습니다 — 다음 로그인부터 코드를 묻습니다'); } catch (e: any) { toast.error(e.message); } }
  async function disable() {
    const c = prompt('끄려면 OTP 앱의 6자리를 입력하세요'); if (!c) return;
    try { await api('/api/auth/2fa', { method: 'DELETE', body: { code: c } }); st.reload(); toast.ok('2단계 인증을 껐습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function logoutOthers() {
    if (!confirm('이 기기를 빼고 모든 기기에서 로그아웃할까요?')) return;
    const r = await api('/api/auth/sessions', { method: 'DELETE' }); ss.reload(); toast.ok(`${r.revoked}개 기기에서 로그아웃했습니다`);
  }
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" data-testid="security">
      <h2 className="font-semibold">보안</h2>
      <div className="mt-2">
        <b className="font-medium">2단계 인증 (OTP 앱)</b>{' '}
        {st.data?.enabled ? <span className="text-green-700">켜짐 · {fmtDateTime(st.data.enabledAt!)}</span> : <span className="text-ink-2">꺼짐</span>}
        <p className="text-xs text-ink-2">켜면 로그인할 때 비밀번호 다음에 휴대폰 OTP 앱(구글·마이크로소프트 Authenticator 등)의 6자리 코드를 입력합니다.</p>
        {st.data?.enabled ? <Button size="sm" variant="secondary" className="mt-1" onClick={disable}>끄기</Button> : !setup ? <Button size="sm" className="mt-1" onClick={start} data-testid="2fa-start">2단계 인증 설정</Button> : (
          <div className="mt-2 space-y-2 rounded-input bg-slate-50 p-3">
            <p className="text-xs">① OTP 앱에서 &ldquo;설정 키 입력&rdquo;을 고르고 아래 키를 입력하세요 (계정: 워크인).</p>
            <input readOnly className={cx(inputCls, 'font-mono')} value={setup.secret.replace(/(.{4})/g, '$1 ').trim()} aria-label="2단계 인증 설정 키" data-testid="2fa-secret" onFocus={(e) => e.currentTarget.select()} />
            <a className="text-xs text-brand-600 underline" href={setup.otpauthUrl}>이 휴대폰의 OTP 앱으로 바로 열기</a>
            <p className="text-xs">② 앱에 보이는 6자리를 입력하세요.</p>
            <div className="flex gap-2"><input className={cx(inputCls, 'w-32 font-mono')} inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} aria-label="OTP 코드" /><Button size="sm" onClick={enable} disabled={code.length < 6}>켜기</Button></div>
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="flex items-center justify-between"><b className="font-medium">로그인한 기기</b><Button size="sm" variant="secondary" onClick={logoutOthers}>다른 기기 모두 로그아웃</Button></div>
        <ul className="mt-1 divide-y divide-line text-xs" data-testid="sessions">
          {ss.data?.sessions.map((x) => (
            <li key={x.id} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{x.client === 'web' ? '웹' : x.client === 'android' ? 'Android 앱' : 'iPhone 앱'} · {(x.user_agent ?? '').replace(/\(.*?\)/g, '').slice(0, 40)}{x.ip ? ` · ${x.ip}` : ''}{x.current && <b className="ml-1 text-green-700">지금 이 기기</b>}</span><span className="shrink-0 text-ink-3">{fmtDateTime(x.last_seen_at)}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** V28-3 워크인 지원 모드 허용(대표만): 켜면 워크인 운영팀이 문제 확인을 위해 이 공간을 읽기 전용으로 30분 볼 수 있음(모든 조회 기록) */
function SupportConsent() {
  const c = useApi<{ consent: boolean; since: string | null }>('/api/account/support-consent');
  if (!c.data) return null;
  async function toggle(on: boolean) {
    try { await api('/api/account/support-consent', { method: 'PUT', body: { on } }); c.reload(); toast.ok(on ? '지원 모드를 허용했습니다' : '지원 모드 허용을 껐습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <label className="mt-4 flex items-start gap-2 rounded-input border border-line p-3" data-testid="support-consent">
      <input type="checkbox" className="mt-0.5" checked={c.data.consent} onChange={(e) => toggle(e.target.checked)} />
      <span><b className="font-medium">워크인 지원 모드 허용</b><span className="block text-xs text-ink-3">문제를 확인할 때 워크인 운영팀이 이 공간을 <b>읽기 전용</b>으로 최대 30분 볼 수 있습니다. 화면을 본 기록이 모두 남고, 언제든 끌 수 있습니다(끄면 진행 중인 지원도 바로 끝남).</span></span>
    </label>
  );
}

/** V15 계정: 내 데이터 내려받기 · 회원 탈퇴 · 공간 삭제(가입한 공간 대표) */
function AccountSection() {
  const { user, tenant } = useSession();
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [space, setSpace] = useState('');
  const [team, setTeam] = useState('');
  const own = !!tenant && !tenant.internal;
  const ids = useApi<{ hasPassword: boolean }>('/api/account/identities');
  const needPw = ids.data?.hasPassword !== false;
  async function leave() {
    try { await api('/api/account/delete', { body: { password: pw, confirm } }); location.href = '/login'; } catch (e: any) { toast.error(e.message); }
  }
  async function dropSpace() {
    if (!window.confirm(`"${tenant?.name}" 공간의 모든 사람·업무·일정이 삭제됩니다. 계속할까요?`)) return;
    try { await api('/api/account/space', { method: 'DELETE', body: { password: pw, confirmName: space } }); location.href = '/login'; } catch (e: any) { toast.error(e.message); }
  }
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" data-testid="account">
      <h2 className="font-semibold">계정</h2>
      <p className="mt-1 text-ink-2">내 업무·일정·댓글·메시지를 파일(JSON)로 내려받을 수 있습니다.</p>
      <a href="/api/account/export" className="mt-2 inline-block rounded-input border border-line px-3 py-1.5 font-medium hover:bg-slate-50" data-testid="account-export">내 데이터 내려받기</a>
      <LinkedAccounts />
      {user.role === 'owner' && <SupportConsent />}
      {tenant?.personal && user.role === 'owner' && (
        <form className="mt-4 flex flex-wrap items-end gap-2 rounded-input border border-line p-3" onSubmit={async (e) => { e.preventDefault(); try { await api('/api/account/upgrade', { body: { company: team } }); location.reload(); } catch (er: any) { toast.error(er.message); } }} data-testid="upgrade-team">
          <Field label="팀으로 바꾸기 — 데이터는 그대로, 사람을 초대해 함께"><input className={inputCls} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="회사(팀) 이름" aria-label="팀 이름" /></Field>
          <Button type="submit" disabled={!team.trim()}>팀 만들기</Button>
        </form>
      )}
      {/* V28-5: 회사(초대) 계정은 스스로 탈퇴 대신 삭제 요청 — 회사 관리자·개인정보 담당에게 */}
      {!own && (
        <details className="mt-4 rounded-input border border-red-200 p-3" data-testid="deletion-request">
          <summary className="cursor-pointer font-medium text-red-700">계정 삭제 요청</summary>
          <p className="mt-2 text-xs text-ink-2">회사가 만든 계정은 회사 관리자가 정리합니다. 요청을 보내면 회사 관리자와 워크인 개인정보 담당에게 전달됩니다. <a href="/account-deletion" target="_blank" className="underline">삭제 안내</a></p>
          <Field label="사유 (선택)"><input className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={200} aria-label="삭제 요청 사유" /></Field>
          <Button variant="danger" className="mt-2" onClick={async () => { try { const r = await api('/api/account/deletion-request', { body: { reason: confirm || undefined } }); toast.ok(r.message); setConfirm(''); } catch (e: any) { toast.error(e.message); } }} data-testid="deletion-request-send">삭제 요청 보내기</Button>
        </details>
      )}
      {own && (
        <details className="mt-4 rounded-input border border-red-200 p-3">
          <summary className="cursor-pointer font-medium text-red-700">회원 탈퇴{user.role === 'owner' ? ' · 공간 삭제' : ''}</summary>
          <div className="mt-3 space-y-2">
            {needPw ? <Field label="비밀번호"><input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" aria-label="탈퇴 비밀번호" /></Field>
              : <p className="text-xs text-ink-2">소셜 계정으로 가입해 비밀번호가 없습니다 — 로그인한 지 15분 안에만 진행할 수 있습니다(지났으면 로그아웃 후 다시 로그인).</p>}
            <Field label='확인 문구 "탈퇴합니다"'><input className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="탈퇴 확인 문구" /></Field>
            <Button variant="danger" onClick={leave} disabled={(needPw && !pw) || confirm !== '탈퇴합니다'}>탈퇴하기</Button>
            <p className="text-xs text-ink-3">탈퇴하면 이름·이메일이 지워지고 다시 로그인할 수 없습니다. 혼자 쓰던 공간은 함께 삭제됩니다(30일 뒤 완전 삭제).</p>
            {user.role === 'owner' && <>
              <hr className="my-2 border-line" />
              <Field label={`공간 삭제 — 공간 이름 "${tenant?.name}" 입력`}><input className={inputCls} value={space} onChange={(e) => setSpace(e.target.value)} aria-label="삭제할 공간 이름" /></Field>
              <Button variant="danger" onClick={dropSpace} disabled={(needPw && !pw) || space !== tenant?.name}>공간 삭제</Button>
            </>}
          </div>
        </details>
      )}
    </section>
  );
}

const PROVIDER_NAME: Record<string, string> = { google: 'Google', kakao: '카카오', naver: '네이버' };
/** V29 로그인 연결: 소셜 계정 연결·해제(로그인 방법이 하나는 남아야 함) */
function LinkedAccounts() {
  const r = useApi<{ identities: { provider: string; email: string | null; last_login_at: string | null }[]; enabled: string[]; hasPassword: boolean }>('/api/account/identities');
  const [justLinked, setJustLinked] = useState<string | null>(null);
  useEffect(() => { const p = new URLSearchParams(location.search).get('linked'); if (p) { setJustLinked(p); toast.ok(`${PROVIDER_NAME[p] ?? p} 계정을 연결했습니다`); } }, []);
  if (!r.data || (!r.data.enabled.length && !r.data.identities.length)) return null;
  const linked = new Set(r.data.identities.map((x) => x.provider));
  async function unlink(p: string) {
    if (!window.confirm(`${PROVIDER_NAME[p]} 연결을 끊을까요?`)) return;
    try { await api(`/api/account/identities?provider=${p}`, { method: 'DELETE' }); r.reload(); toast.ok('연결을 끊었습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="mt-4 rounded-input border border-line p-3" data-testid="linked-accounts">
      <b className="font-medium">로그인 연결</b><span className="ml-1 text-xs text-ink-3">연결하면 그 계정 버튼 한 번으로 로그인합니다{r.data.hasPassword ? '' : ' · 비밀번호 없이 소셜로 가입한 계정'}</span>
      <ul className="mt-2 space-y-1.5">
        {Array.from(new Set([...r.data.enabled, ...linked])).map((p) => {
          const it = r.data!.identities.find((x) => x.provider === p);
          return (
            <li key={p} className="flex flex-wrap items-center gap-2" data-testid={`linked-${p}`}>
              <span className="w-16 font-medium">{PROVIDER_NAME[p] ?? p}</span>
              {it ? <><span className="text-xs text-ink-2">{it.email ?? '연결됨'}{justLinked === p ? ' · 방금 연결' : ''}</span><Button size="sm" variant="ghost" onClick={() => unlink(p)}>연결 끊기</Button></>
                : <a href={`/api/auth/oauth/${p}/start?mode=link`} className="rounded-input border border-line px-2.5 py-1 text-xs font-medium hover:bg-slate-50">연결하기</a>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
