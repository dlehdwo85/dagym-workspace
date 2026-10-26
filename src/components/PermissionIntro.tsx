'use client';
import { useEffect, useState } from 'react';
import { AlarmClock, Bell, Check, LayoutGrid } from 'lucide-react';
import { enableNativePush, openAlarmSettings, openNotificationSettings, permissionStatus, requestPinWidget, type PermissionStatus } from './native';
import { cx, toast } from './ui';

/**
 * #528(대표 10/23 "앱 받고 시작할 때 자연스럽게 허용하도록 창") 처음 시작 '휴대폰 알림 맞추기' 안내 — 웹 몫. 네이티브 몫은 로컬 7819a4c('android-permissions-1').
 * - 앱(안드로이드 1.1.3+)에서 사람·기기마다 한 번: 알림 허용 · 잠금 화면 알람 · 정확한 시각 알람 · 바탕화면 위젯 네 줄을 상태(허용됨/꺼짐)와 단추로.
 *   [나중에] = 하루 뒤 다시, [다 했어요] = 끝. 네 가지가 다 돼 있으면 아예 안 띄움. 설정에서 허용하고 돌아오면(visibilitychange) 다시 읽음.
 * - 실행 애니메이션(#443)·다른 창(회사 첫 안내·투어 등) 뒤에 뜨고, 이 창이 떠 있는 동안 투어(#83)는 기다림(role=dialog).
 * - 설정 › 알림 [휴대폰 알림 맞추기 다시 보기] → 'wos-perm-intro' 이벤트로 다시 염.
 * - 시연·E2E: localStorage wos_perm_demo 에 상태 JSON 을 넣으면 네이티브 없이도 그림(단추는 안내만).
 */
export type PermRow = { key: 'notifications' | 'fullScreen' | 'exact' | 'widgets'; title: string; why: string; ok: boolean; action?: string; hint?: string };
const KEY = (uid: string) => `wos_perm_intro:${uid}`;
const DEMO = 'wos_perm_demo';
const LATER_MS = 24 * 60 * 60 * 1000;

export function rowsOf(s: PermissionStatus): PermRow[] {
  return [
    { key: 'notifications', title: '알림 허용', why: '일정 시작 전·업무 배정·멘션·마감을 앱이 닫혀 있어도 알려 드립니다', ok: !!s.notifications, action: '허용' },
    { key: 'fullScreen', title: '잠금 화면 알람', why: '알람처럼 울리기를 켠 일정·마감은 잠금 화면 위에 전체 화면으로 뜹니다', ok: !!s.fullScreen, action: '설정 열기' },
    { key: 'exact', title: '정확한 시각 알람', why: '꺼져 있으면 알람이 몇 분 늦게 울릴 수 있습니다', ok: !!s.exact, action: '설정 열기' },
    { key: 'widgets', title: '바탕화면 위젯', why: "앱을 열지 않아도 '워크인 오늘'(오늘 할 일·일정)이 바탕화면에 보입니다", ok: (s.widgets ?? 0) > 0, action: s.widgetPin ? '위젯 추가' : undefined, hint: s.widgetPin ? undefined : '홈 화면을 길게 눌러 위젯 → 워크인 오늘' },
  ];
}
const allDone = (s: PermissionStatus) => rowsOf(s).every((r) => r.ok);
const readDemo = (): PermissionStatus | null => { try { const v = localStorage.getItem(DEMO); return v ? (JSON.parse(v) as PermissionStatus) : null; } catch { return null; } };

export function PermissionIntro({ userId }: { userId: string }) {
  const [st, setSt] = useState<PermissionStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const demo = !!readDemo();
  const read = async () => readDemo() ?? (await permissionStatus());
  const remember = (v: string) => { try { localStorage.setItem(KEY(userId), v); } catch {} };
  useEffect(() => {
    let on = true; let t: ReturnType<typeof setTimeout> | undefined;
    const mark = (() => { try { return localStorage.getItem(KEY(userId)) ?? ''; } catch { return 'done'; } })();
    if (mark === 'done' || (mark.startsWith('later:') && Date.now() - Number(mark.slice(6)) < LATER_MS)) return;
    const start = async () => {
      if (!on) return;
      const introPlaying = document.getElementById('wos-intro') && !document.documentElement.classList.contains('wi-done');
      if (introPlaying || document.querySelector('[role="dialog"]:not([data-perm-intro])')) { t = setTimeout(start, 400); return; }
      const s = await read(); if (!on || !s) return;
      if (allDone(s)) { remember('done'); return; } // 다 돼 있으면 안 띄움
      setSt(s); setOpen(true);
    };
    t = setTimeout(start, 600);
    return () => { on = false; if (t) clearTimeout(t); };
  }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const re = () => { if (open && document.visibilityState === 'visible') read().then((s) => s && setSt(s)); }; // 설정에서 허용하고 돌아오면
    const show = () => read().then((s) => { if (s) { setSt(s); setOpen(true); } else toast.error('앱(안드로이드 1.1.3 이상)에서만 볼 수 있습니다'); });
    document.addEventListener('visibilitychange', re); window.addEventListener('wos-perm-intro', show);
    return () => { document.removeEventListener('visibilitychange', re); window.removeEventListener('wos-perm-intro', show); };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open || !st) return null;
  const rows = rowsOf(st);
  const done = rows.every((r) => r.ok);
  const later = () => { remember(`later:${Date.now()}`); setOpen(false); };
  const finish = () => { remember('done'); setOpen(false); };
  const act = async (r: PermRow) => {
    if (demo) { toast.ok(`(시연) ${r.title}: ${r.action}`); return; }
    setBusy(r.key);
    try {
      if (r.key === 'notifications') { try { await enableNativePush(); toast.ok('이 기기에서 알림을 받습니다'); } catch (e: any) { toast.error(e.message); await openNotificationSettings().catch(() => {}); } }
      else if (r.key === 'widgets') { if (!(await requestPinWidget())) toast.ok('홈 화면을 길게 눌러 위젯 → 워크인 오늘을 추가해 주세요'); }
      else await openAlarmSettings().catch(() => toast.error('설정 화면을 열 수 없습니다'));
      const s = await read(); if (s) setSt(s);
    } finally { setBusy(null); }
  };
  const Icon = ({ k }: { k: PermRow['key'] }) => (k === 'notifications' ? <Bell className="size-5" /> : k === 'widgets' ? <LayoutGrid className="size-5" /> : <AlarmClock className="size-5" />);
  return (
    <div className="fixed inset-0 z-[70] bg-black/40" onClick={later} data-testid="perm-intro-backdrop">
      <div role="dialog" aria-modal="true" aria-labelledby="perm-intro-title" data-perm-intro data-testid="perm-intro" onClick={(e) => e.stopPropagation()}
        className="absolute inset-x-0 bottom-0 max-h-[90dvh] animate-fade-up overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 pb-[calc(var(--sab)+16px)] shadow-pop sm:inset-auto sm:left-1/2 sm:top-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card sm:pb-4">
        <div className="flex items-center gap-3"><img src="/icon.svg" alt="" width={36} height={36} className="size-9" />
          <div><h2 id="perm-intro-title" className="text-base font-bold">휴대폰 알림 맞추기</h2><p className="text-xs text-ink-2">{done ? '모두 준비됐습니다.' : '워크인이 제때 알려 드리려면 아래를 허용해 주세요. 1분이면 됩니다.'}</p></div></div>
        <ul className="mt-3 divide-y divide-line rounded-card border border-line">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-3 px-3 py-2.5" data-testid={`perm-row-${r.key}`} data-ok={r.ok ? '1' : '0'}>
              <span className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-full', r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-ink-2')}><Icon k={r.key} /></span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1.5 text-sm font-semibold">{r.title}<span className={cx('rounded-full px-1.5 text-[11px] font-medium', r.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800')}>{r.ok ? (r.key === 'widgets' ? `${st.widgets}개` : '허용됨') : '꺼짐'}</span></div>
                <p className="text-xs text-ink-2">{r.ok ? '' : (r.hint ?? r.why)}</p></div>
              {r.ok ? <Check className="size-5 shrink-0 text-emerald-600" aria-label="허용됨" />
                : r.action ? <button type="button" disabled={busy === r.key} onClick={() => act(r)} className="h-8 shrink-0 rounded-input bg-brand-600 px-3 text-xs font-semibold text-white disabled:opacity-60" data-testid={`perm-act-${r.key}`}>{busy === r.key ? '여는 중…' : r.action}</button> : null}
            </li>))}
        </ul>
        <p className="mt-2 text-[11px] text-ink-3">허용은 언제든 휴대폰 설정 › 앱 › 워크인에서 바꿀 수 있습니다. 설정 › 알림에서 이 안내를 다시 볼 수 있습니다.</p>
        <div className="mt-3 flex justify-end gap-2">
          {!done && <button type="button" onClick={later} className="h-9 rounded-input px-3 text-sm text-ink-2 hover:bg-slate-100" data-testid="perm-later">나중에</button>}
          <button type="button" onClick={finish} className="h-9 rounded-input bg-brand-600 px-4 text-sm font-semibold text-white" data-testid="perm-done">{done ? '확인' : '다 했어요'}</button>
        </div>
      </div>
    </div>
  );
}
