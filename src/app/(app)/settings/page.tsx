'use client';
import { ChatBubbleToggle } from '@/components/ChatBubble';
import { RoleBadge } from '@/components/RoleBadge';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, cx, Field, Loading, fmtDateTime, inputCls, toast } from '@/components/ui';
import { alarmDeviceStatus, enableNativePush, isNativeApp, openAlarmSettings, subscribeWebPush } from '@/components/native';
import { BioLockSetting } from '@/components/BioLock';
import { ROLE_LABEL } from '@/lib/types';
import { UserSelect } from '@/components/pickers';

/** #447 앱 1.1.3 전체화면 알람: 이 휴대폰이 잠금 화면 위 전체 화면을 막아 두었거나 정확한 시각 예약이 꺼져 있으면 안내(안드로이드 14+ 는 사용자가 설정에서 허용) */
function FullScreenAlarmNotice() {
  const [st, setSt] = useState<{ fullScreen: boolean; exact: boolean } | null>(null);
  useEffect(() => {
    let on = true; const load = () => alarmDeviceStatus().then((r) => { if (on) setSt(r); });
    load(); document.addEventListener('visibilitychange', load); // 설정에서 허용하고 돌아오면 다시 확인
    return () => { on = false; document.removeEventListener('visibilitychange', load); };
  }, []);
  if (!st || (st.fullScreen && st.exact)) return null;
  return (
    <p className="mt-2 rounded-input border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900" data-testid="alarm-fullscreen-notice">
      {!st.fullScreen ? <>이 휴대폰은 알람이 잠금 화면 위에 전체 화면으로 뜨지 않게 되어 있습니다. <button type="button" className="font-semibold underline" onClick={() => openAlarmSettings().catch(() => toast.error('설정 화면을 열 수 없습니다'))}>설정에서 허용하기</button></>
        : '이 휴대폰은 정확한 시각 알람이 꺼져 있어 알람이 몇 분 늦게 울릴 수 있습니다 — 휴대폰 설정 › 앱 › 워크인 › 알람 및 리마인더에서 허용해 주세요.'}
    </p>
  );
}

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
      <MyCard />
      {(user.role === 'owner' || user.role === 'admin') && <p className="text-sm text-ink-2">관리: <a href="/admin/holidays" className="font-medium text-accent-600 underline">공휴일</a> · <a href="/admin/users" className="font-medium text-accent-600 underline">사용자 관리</a> · <a href="/revenue" className="font-medium text-accent-600 underline">매출</a></p>}
      <section className="rounded-lg border bg-white p-4 text-sm">
        <div className="font-semibold">{user.name}</div>
        <div className="flex items-center gap-1.5 text-slate-500">{user.email} · {ROLE_LABEL[user.role]}<RoleBadge role={user.role} size="sm" /></div>
        {features.googleSync && <Link href="/settings/google" className="mt-2 inline-block text-brand-600 hover:underline">Google Calendar 연동 (선택 기능) →</Link>}
      </section>
      <SwipeToggle />
      <section className="rounded-lg border bg-white p-4"><ChatBubbleToggle /></section>
      <CalendarFeed />
      <TwoFactor />
      <AwaySection />
      <MyMailSection />
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
          {/* V13 6번 내가 요청한 업무도 마감 알림 */}
          <Field label="내가 요청한 업무의 마감 알림">
            <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.requesterDueAlerts ?? false} onChange={(e) => setS({ ...s, requesterDueAlerts: e.target.checked })} aria-label="내가 요청한 업무의 마감 알림" data-testid="requester-due-alerts" />받기 (담당자 이름·상태 표시)</label>
          </Field>
          {/* V8 1번 아침 브리핑 */}
          <Field label="아침 브리핑 (오늘의 일정·일정 요약 알림)">
            <span className="flex flex-wrap items-center gap-2" data-testid="briefing-settings">
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.briefingEnabled ?? true} onChange={(e) => setS({ ...s, briefingEnabled: e.target.checked })} aria-label="아침 브리핑 받기" />받기</label>
              <input type="time" step={900} className={cx(inputCls, '!w-32')} value={s.briefingTime ?? '08:30'} onChange={(e) => setS({ ...s, briefingTime: e.target.value })} aria-label="브리핑 시각" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!s.briefingWeekend} onChange={(e) => setS({ ...s, briefingWeekend: e.target.checked })} />주말·공휴일에도</label>
            </span>
          </Field>
          {/* 로컬 10/20(대표): 휴대폰 알람처럼(전체 화면·소리·[해제][10분 뒤]) 울릴 기본값 — 일정·업무마다 따로 켤 수도 있음 */}
          <Field label="알람처럼 울리기 (기본값 — 일정·업무마다 바꿀 수 있음)">
            <span className="flex flex-wrap items-center gap-3" data-testid="alarm-defaults">
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!s.alarmEvents} onChange={(e) => setS({ ...s, alarmEvents: e.target.checked })} aria-label="일정 알람" data-testid="alarm-events" />일정</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!!s.alarmTasks} onChange={(e) => setS({ ...s, alarmTasks: e.target.checked })} aria-label="업무 마감 알람" data-testid="alarm-tasks" />업무 마감</label>
              <label className="flex items-center gap-1.5 text-sm" title="대표 10/21: 일정 시작·업무 마감 기준 몇 분 전에 알람처럼 울릴지 (배정·검토 요청 같은 알림은 알람으로 울리지 않음)"><input type="number" min={1} max={1440} className={cx(inputCls, 'h-8 w-20 px-2 py-0 text-sm')} value={s.alarmMinutes ?? 10} onChange={(e) => setS({ ...s, alarmMinutes: Math.max(1, Math.min(1440, Number(e.target.value) || 10)) })} aria-label="알람 몇 분 전" data-testid="alarm-minutes" />분 전에</label>
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={s.alarmImportant ?? true} onChange={(e) => setS({ ...s, alarmImportant: e.target.checked })} aria-label="중요 업무 알람" data-testid="alarm-important" />높음·긴급 업무</label>
            </span>
            <FullScreenAlarmNotice />
            {isNativeApp() && <button type="button" className="mt-2 text-xs font-medium text-brand-700 underline" onClick={() => window.dispatchEvent(new Event('wos-perm-intro'))} data-testid="perm-intro-open">휴대폰 알림 맞추기(권한 안내) 다시 보기</button>}{/* #528 */}
          </Field>
          <Field label="조용한 시간 (기본 22:00~07:00)">
            <span className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!s.quietOff} onChange={(e) => setS({ ...s, quietOff: !e.target.checked })} aria-label="조용한 시간 쓰기" data-testid="quiet-on" />쓰기</label>
              <input type="time" className={cx(inputCls, '!w-32')} value={s.quietStart ?? ''} onChange={(e) => setS({ ...s, quietStart: e.target.value || null })} disabled={!!s.quietOff} aria-label="조용한 시간 시작" />
              <span className="text-ink-3">~</span>
              <input type="time" className={cx(inputCls, '!w-32')} value={s.quietEnd ?? ''} onChange={(e) => setS({ ...s, quietEnd: e.target.value || null })} disabled={!!s.quietOff} aria-label="조용한 시간 끝" />
            </span>
          </Field>
        </div>
        <p className="mt-1 text-xs text-slate-500">조용한 시간에 생긴 푸시는 모아서 끝나는 시각(아침)에 보냅니다. 앱 안 알림은 바로 쌓입니다. 종류별 푸시 기본값: 나에게 온 요청·내 일정·요청한 업무 완료는 켬, 내가 보낸 결과·자동 정리 결과는 끔(위 표에서 바꿀 수 있음).</p>
        <Button className="mt-3" onClick={save}>저장</Button>
      </section>
      {data.spaces?.length > 0 && <SpaceNotifyPrefs spaces={data.spaces} modeLabels={data.modeLabels} canSetCompany={data.canSetCompany} reload={reload} />}
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

/** 대표 10/20 16:00 (#104 ⑤) 공간별(영업·마케팅) 알림 방식 — 담당인 것만(기본)·모두(1시간 묶음)·받지 않음. 관리자는 회사 기본값도 */
type SpaceRow = { space: string; label: string; mode: 'mine' | 'all' | 'off'; own: boolean; companyDefault: 'mine' | 'all' | 'off' };
/** 회사 기본값 선택 칸은 괄호 설명을 뺀 짧은 이름(설명은 바로 위 라디오에 있음) — 긴 설명이 칸 폭을 키워 360·375px 에서 옆으로 넘쳤음(CI 1496 W-0) */
const shortMode = (label: string) => label.replace(/\s*\(.*\)\s*$/, '');
function SpaceNotifyPrefs({ spaces, modeLabels, canSetCompany, reload }: { spaces: SpaceRow[]; modeLabels: Record<string, string>; canSetCompany: boolean; reload: () => void }) {
  const [rows, setRows] = useState<SpaceRow[]>(spaces);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRows(spaces); }, [spaces]);
  const MODES = ['mine', 'all', 'off'] as const;
  async function save() {
    setBusy(true);
    try {
      const body: any = { spaces: Object.fromEntries(rows.map((r) => [r.space, r.own ? r.mode : null])) };
      if (canSetCompany) body.companySpaces = Object.fromEntries(rows.map((r) => [r.space, r.companyDefault]));
      await api('/api/notifications/prefs', { method: 'PUT', body }); toast.ok('공간별 알림 방식을 저장했습니다'); reload();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <section className="rounded-lg border bg-white p-4" data-testid="space-notify">
      <h2 className="mb-1 text-sm font-semibold">공간별 알림 (영업·마케팅)</h2>
      <p className="mb-2 text-xs text-ink-3">자동으로 생기는 영업·마케팅 알림은 <b>담당자(담당자 지정 규칙)</b>에게만 바로 갑니다. 승인 요청과 내가 한 일의 결과는 방식과 상관없이 받습니다. 담당이 정해지지 않은 건은 관리자 1명에게 하루 한 번 묶어서 1건.</p>
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={r.space} className="grid gap-1 rounded-card border border-line p-2 sm:grid-cols-[6rem_1fr] sm:items-start" data-testid={`space-notify-${r.space}`}>
            <div className="text-sm font-medium">{r.label}</div>
            <div className="space-y-1">
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm" role="radiogroup" aria-label={`${r.label} 알림 방식`}>
                {MODES.map((m) => <label key={m} className="flex items-center gap-1"><input type="radio" name={`sp-${r.space}`} checked={r.mode === m} onChange={() => setRows(rows.map((x, j) => (j === i ? { ...x, mode: m, own: true } : x)))} data-testid={`space-mode-${r.space}-${m}`} />{modeLabels[m]}</label>)}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                {r.own ? <button type="button" className="underline" onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, own: false, mode: x.companyDefault } : x)))} data-testid={`space-use-company-${r.space}`}>회사 기본값({modeLabels[r.companyDefault]})으로</button> : <span data-testid={`space-company-${r.space}`}>회사 기본값을 따르는 중</span>}
                {canSetCompany && <label className="flex items-center gap-1">회사 기본값
                  <select className={cx(inputCls, 'h-7 !w-auto max-w-[11rem] py-0 text-[11px]')} value={r.companyDefault} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, companyDefault: e.target.value as SpaceRow['mode'], mode: x.own ? x.mode : (e.target.value as SpaceRow['mode']) } : x)))} aria-label={`${r.label} 회사 기본값`} data-testid={`space-company-select-${r.space}`}>
                    {MODES.map((m) => <option key={m} value={m}>{shortMode(modeLabels[m])}</option>)}
                  </select></label>}
              </div>
            </div>
          </div>))}
      </div>
      <Button className="mt-3" onClick={save} disabled={busy} data-testid="space-notify-save">저장</Button>
    </section>
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
      <BioLockSetting />
      <div className="mt-4">
        <div className="flex items-center justify-between"><b className="font-medium">로그인한 기기</b><Button size="sm" variant="secondary" onClick={logoutOthers}>다른 기기 모두 로그아웃</Button></div>
        <ul className="mt-1 divide-y divide-line text-xs" data-testid="sessions">
          {ss.data?.sessions.map((x) => (
            <li key={x.id} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{x.client === 'web' ? '웹' : x.client === 'android' ? 'Android 앱' : 'iPhone 앱'} · {(x.user_agent ?? '').replace(/\(.*?\)/g, '').slice(0, 40)}{x.ip ? ` · ${x.ip}` : ''}{x.current && <b className="ml-1 text-green-700">지금 이 기기</b>}</span><span className="shrink-0 text-ink-3">{fmtDateTime(x.last_seen_at)}</span>{!x.current && <button type="button" className="shrink-0 text-red-600 underline" onClick={async () => { if (!confirm('이 기기에서 로그아웃할까요?')) return; try { await api(`/api/auth/sessions/${x.id}`, { method: 'DELETE' }); ss.reload(); toast.ok('그 기기에서 로그아웃했습니다'); } catch (e: any) { toast.error(e.message); } }} data-testid="session-revoke">로그아웃</button>}</li>
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
/** V33 4 (#184) 내 메일 계정: 회사가 허용했을 때 내 회사 메일 계정(SMTP)을 연결 — 연결 시험 메일 1통이 성공해야 저장, 이후 내 발송은 이 계정으로(보낸메일함에도 남음) */
function MyMailSection() {
  type Preset = { key: string; label: string; host: string; port: number; secure: boolean; help: string; steps?: [string, string][] };
  type Acc = { provider: string; providerLabel: string; host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName: string | null; lastOkAt: string | null; lastError: string | null };
  const st = useApi<{ account: Acc | null; presets: Preset[]; allowed: boolean; domains: string[]; workEmail: string }>('/api/account/mail');
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ provider: 'naver', host: '', port: '465', secure: true, username: '', fromEmail: '', fromName: '', password: '' });
  const a = st.data?.account ?? null;
  useEffect(() => { if (a) setF((x) => ({ ...x, provider: a.provider, host: a.host, port: String(a.port), secure: a.secure, username: a.username, fromEmail: a.fromEmail, fromName: a.fromName ?? '' })); }, [a]);
  if (!st.data) return null;
  const preset = st.data.presets.find((p) => p.key === f.provider);
  const pick = (key: string) => { const p = st.data!.presets.find((x) => x.key === key)!; setF({ ...f, provider: key, host: key === 'custom' ? f.host : p.host, port: String(p.port), secure: p.secure }); };
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/account/mail', { method: 'PUT', body: { provider: f.provider, host: f.host || undefined, port: Number(f.port) || undefined, secure: f.secure, username: f.username.trim(), fromEmail: f.fromEmail.trim(), fromName: f.fromName.trim() || null, password: f.password || undefined } });
      toast.ok(`연결됐습니다 — ${r.testSentTo} 로 시험 메일을 보냈습니다. 받은편지함·보낸메일함을 확인해 주세요.`); setF({ ...f, password: '' }); setEdit(false); st.reload();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('내 메일 계정 연결을 끊을까요? 끊으면 회사 기본 방식으로 보냅니다.')) return;
    try { await api('/api/account/mail', { method: 'DELETE' }); st.reload(); setEdit(false); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" data-testid="my-mail">
      <h2 className="font-semibold">내 메일 계정</h2>
      <p className="mt-1 text-ink-2">업무에서 고객에게 보내는 메일을 <b>내 회사 메일 계정</b>(예: 이름@회사도메인)으로 보내고 보낸메일함에도 남기려면 여기서 연결합니다. 연결하지 않으면 회사 기본 방식(워크인 발송 또는 회사 계정, 답장은 내 업무 이메일)으로 나갑니다.</p>
      {!st.data.allowed ? (
        <p className="mt-2 rounded-input bg-slate-50 px-2.5 py-1.5 text-xs text-ink-2" data-testid="my-mail-off">회사 설정에서 직원 개인 메일 계정 연결이 꺼져 있습니다 — 필요하면 대표·관리자에게 요청하세요(관리 › 메일 계정·명함).{a && ' 연결해 둔 계정은 허용될 때까지 쓰이지 않습니다.'}</p>
      ) : (
        <>
          {st.data.domains.length > 0 && <p className="mt-1 text-xs text-ink-3">허용 도메인: {st.data.domains.map((d) => '@' + d).join(', ')}</p>}
          {a && !edit && (
            <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="my-mail-connected">
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">연결됨</span>
              <b>{a.fromName ? `${a.fromName} <${a.fromEmail}>` : a.fromEmail}</b><span className="text-xs text-ink-3">{a.providerLabel}{a.lastOkAt ? ` · 마지막 성공 ${fmtDateTime(a.lastOkAt)}` : ''}</span>
              {a.lastError && <span className="text-xs text-red-600">최근 오류: {a.lastError}</span>}
              <span className="ml-auto flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => setEdit(true)}>바꾸기·다시 시험</Button><Button size="sm" variant="ghost" className="text-red-600" onClick={remove} data-testid="my-mail-remove">연결 끊기</Button></span>
            </div>
          )}
          {!a && !edit && <div className="mt-2"><Button size="sm" variant="secondary" onClick={() => { setF((x) => ({ ...x, fromEmail: x.fromEmail || st.data!.workEmail, username: x.username || st.data!.workEmail })); setEdit(true); }} data-testid="my-mail-connect">내 메일 계정 연결</Button></div>}
          {edit && (
            <form onSubmit={save} className="mt-2 space-y-2" data-testid="my-mail-form">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="메일 업체">
                {st.data.presets.map((p) => <button key={p.key} type="button" role="radio" aria-checked={f.provider === p.key} onClick={() => pick(p.key)} className={cx('rounded-full border px-3 py-1 text-sm', f.provider === p.key ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:bg-slate-50')}>{p.label}</button>)}
              </div>
              {preset && (preset.steps?.length ? <ol className="list-decimal space-y-1 rounded-input bg-slate-50 py-2 pl-7 pr-3 text-xs text-ink-2">{preset.steps.map(([t, url], k) => <li key={k}>{t}{url && <> — <a href={url} target="_blank" rel="noreferrer" className="underline">열기</a></>}</li>)}</ol>
                : <p className="rounded-input bg-slate-50 px-3 py-2 text-xs text-ink-2">{preset.help}</p>)}
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="보내는 주소(내 회사 메일)"><input className={inputCls} type="email" required value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value, username: f.username || e.target.value })} data-testid="my-mail-from" /></Field>
                <Field label="보내는 이름"><input className={inputCls} value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} placeholder="예: 홍길동 (회사명)" /></Field>
                <Field label="로그인 아이디"><input className={inputCls} required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" /></Field>
                <Field label={a ? '앱 비밀번호 (비우면 저장된 값으로 시험)' : '앱 비밀번호'}><input className={inputCls} type="password" required={!a} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" data-testid="my-mail-password" /></Field>
                {f.provider === 'custom' && <>
                  <Field label="SMTP 서버"><input className={inputCls} required value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.example.com" /></Field>
                  <Field label="포트·암호화"><span className="flex items-center gap-2"><input className={cx(inputCls, 'w-24')} inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} />
                    <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} />SSL(465)</label></span></Field>
                </>}
              </div>
              <p className="text-xs text-ink-3">[연결 시험]을 누르면 내 주소로 시험 메일 1통을 보내고, 성공해야 저장합니다. 비밀번호는 암호화해 서버에만 두고 화면에 다시 보이지 않습니다.</p>
              <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(false)}>취소</Button><Button type="submit" disabled={busy} data-testid="my-mail-save">{busy ? '시험 중…' : '연결 시험 후 저장'}</Button></div>
            </form>
          )}
        </>
      )}
    </section>
  );
}

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

/** V32 6 내 명함·회신 주소: 메일·문자 서명에 들어가는 직급·휴대폰, 내가 보낸 메일의 답장이 오는 업무 이메일 */
function MyCard() {
  const { user: me } = useSession(); // #101 명함 머리줄 권한 배지
  const c = useApi<{ title: string; phone: string; workEmail: string; loginEmail: string; replyToEditable: boolean }>('/api/account/card');
  const [f, setF] = useState<{ title: string; phone: string; workEmail: string } | null>(null);
  useEffect(() => { if (c.data) setF({ title: c.data.title, phone: c.data.phone, workEmail: c.data.workEmail }); }, [c.data]);
  if (!c.data || !f) return null;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/account/card', { method: 'PUT', body: c.data!.replyToEditable ? f : { title: f!.title, phone: f!.phone } }); toast.ok('저장했습니다'); c.reload(); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" data-testid="my-card">
      <h2 className="flex items-center gap-2 font-semibold">내 명함·회신 주소<RoleBadge role={me.role} size="sm" /></h2>
      <p className="mt-0.5 text-xs text-ink-3">고객에게 보내는 메일·문자 서명에 들어가고, 내가 보낸 메일의 답장은 업무 이메일로 옵니다.</p>
      <form onSubmit={save} className="mt-3 grid gap-2 sm:grid-cols-3">
        <Field label="직급"><input className={inputCls} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={50} /></Field>
        <Field label="휴대폰"><input className={inputCls} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={40} inputMode="tel" /></Field>
        <Field label="업무 이메일(회신 주소)" hint={c.data.replyToEditable ? undefined : '회사 설정으로 관리자만 바꿀 수 있습니다'}>
          <input className={inputCls} type="email" value={f.workEmail} onChange={(e) => setF({ ...f, workEmail: e.target.value })} placeholder={c.data.loginEmail} disabled={!c.data.replyToEditable} data-testid="my-work-email" />
        </Field>
        <div className="flex justify-end sm:col-span-3"><Button type="submit" size="sm" data-testid="my-card-save">저장</Button></div>
      </form>
    </section>
  );
}

/** V35 2 2차 (#76) 부재중 설정 — 기간·자동 응답·대리인·알림 보류. 근무 상태 '부재', 담당자 규칙은 부 담당, 1:1 대화 안내, 돌아오면 알림 요약 */
function AwaySection() {
  const st = useApi<{ away: { from: string; to: string; note: string; deputyId: string | null; deputyName: string | null; hold: boolean } | null; active: boolean; hold: boolean }>('/api/account/away');
  const [f, setF] = useState({ from: '', to: '', note: '', deputyId: '' as string | null, hold: true });
  const [busy, setBusy] = useState(false);
  const inited = useRef(false); // 처음 불러온 값만 칸에 넣음 — 입력 중에 응답이 늦게 와서 지워지지 않게
  useEffect(() => { if (st.data && !inited.current) { inited.current = true; const d = st.data; setF((prev) => (prev.from || prev.to || prev.note) ? prev : { from: d.away?.from ?? '', to: d.away?.to ?? '', note: d.away?.note ?? '', deputyId: d.away?.deputyId ?? '', hold: d.away?.hold ?? d.hold }); } }, [st.data]);
  const save = async () => {
    setBusy(true);
    try { await api('/api/account/away', { method: 'PUT', body: { from: f.from, to: f.to, note: f.note || undefined, deputyId: f.deputyId || null, hold: f.hold } }); toast.ok('부재중 설정을 저장했습니다'); st.reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };
  const clear = async () => { setBusy(true); try { await api('/api/account/away', { method: 'DELETE' }); toast.ok('부재중을 해제했습니다'); setF({ from: '', to: '', note: '', deputyId: '', hold: true }); st.reload(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  return (
    <section className="rounded-lg border bg-white p-4 text-sm" data-testid="away" data-loaded={st.data ? '1' : '0'}>
      <h2 className="font-semibold">부재중 설정</h2>
      <p className="mt-1 text-ink-2">기간을 정해 두면 동료에게 <b>부재 ~날짜</b>로 보이고, 자동 배정은 부 담당에게 가며, 1:1 대화에 안내가 뜹니다. 부재(연차 포함) 중 푸시는 보류했다가 돌아온 날 한 번에 알려 드립니다.</p>
      {st.data?.active && <p className="mt-2 rounded-input bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900" data-testid="away-active">지금 부재중으로 표시되고 있습니다 (~{st.data.away?.to}{st.data.away?.deputyName ? ` · 대리 ${st.data.away.deputyName}` : ''})</p>}
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <Field label="시작일"><input type="date" className={inputCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} data-testid="away-from" /></Field>
        <Field label="끝 날짜"><input type="date" className={inputCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} data-testid="away-to" /></Field>
        <Field label="자동 응답 문구 (1:1 대화에 안내)" className="sm:col-span-2"><input className={inputCls} maxLength={300} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="예: 10/25까지 연차입니다. 급한 일은 김OO 과장에게 연락 주세요" data-testid="away-note" /></Field>
        <div><div className="mb-1 text-xs font-medium text-slate-600">대리인 (급한 일·자동 배정 대신 받을 사람)</div><UserSelect value={f.deputyId} onChange={(v) => setF({ ...f, deputyId: v })} placeholder="대리인 없음" id="away-deputy" /></div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={f.hold} onChange={(e) => setF({ ...f, hold: e.target.checked })} data-testid="away-hold" />부재·연차 중 푸시 보류(돌아오면 요약 1건)</label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={save} disabled={busy || !f.from || !f.to} data-testid="away-save">저장</Button>
        {st.data?.away && <Button variant="secondary" onClick={clear} disabled={busy} data-testid="away-clear">부재 해제</Button>}
      </div>
    </section>
  );
}
