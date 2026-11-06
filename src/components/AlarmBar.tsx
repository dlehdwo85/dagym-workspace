'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlarmClock, X } from 'lucide-react';
import { api } from '@/components/client';
import { cx, toast } from '@/components/ui';
import { openedFromOutside, opensAlarm } from './alarmOpened';

/** 로컬 10/20(대표): 웹은 전체 화면 알람이 없어 — 알람처럼 울리는 알림(일정·마감)이 오면 화면 맨 위 고정 띠 + [해제][10분 뒤][열기]
 *  378차(대표 11/06): [열기] = 해제 + 그 화면으로(전에는 진동만 멈추고 띠가 남았다)
 *  대표 10/22: 소리 없이 진동만(휴대폰·지원 브라우저). 전에는 1.5초마다 삐-삐 소리를 냈다 */
export type AlarmItem = { id: string; type: string; title: string; body: string | null; link: string; entityType?: string | null; entityId?: string | null; actions: { id: string; label: string }[] };

const PATTERN = [400, 200, 400]; // 진동 0.4초 · 쉼 0.2초 · 진동 0.4초
const REPEAT_MS = 5000, MAX_REPEAT = 12; // 5초마다, 최대 1분 — 띠는 해제·10분 뒤 전까지 남는다

export function AlarmBar({ items, onChange }: { items: AlarmItem[]; onChange: (id: string) => void }) {
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const key = items.map((n) => n.id).join(',');
  // 진동: 새 알람이 뜨면 5초마다(최대 1분). 사용자가 끄거나 알람이 없어지면 멈춤. 진동을 지원하지 않는 기기(PC 브라우저·iOS)는 조용히 띠만
  useEffect(() => {
    if (!key || muted) return;
    const buzz = () => { try { navigator.vibrate?.(PATTERN); } catch { /* 진동 없음 */ } };
    buzz();
    let n = 1;
    const t = setInterval(() => { if (n++ >= MAX_REPEAT) { clearInterval(t); return; } buzz(); }, REPEAT_MS);
    return () => { clearInterval(t); try { navigator.vibrate?.(0); } catch { /* 없음 */ } };
  }, [key, muted]);
  const doing = useRef(new Set<string>());
  /** quiet: [열기]·밖에서 열고 들어옴 = 해제하되 토스트 없이(화면을 여는 중) */
  async function act(n: AlarmItem, action: 'dismiss' | 'snooze', quiet = false) {
    if (doing.current.has(n.id)) return;
    doing.current.add(n.id);
    setBusy(n.id + action);
    try {
      await api(`/api/notifications/${n.id}/action`, { body: { action } });
      // 대표 10/22: 앱 안 띠에서 처리해도 휴대폰 알림창에 고정(ongoing)으로 남아 있던 같은 알람을 지우고, 10분 뒤면 휴대폰에 다시 예약
      const { settleAlarmOnDevice } = await import('./native');
      await settleAlarmOnDevice({ notificationId: n.id, entityId: n.entityId ?? null, entityType: n.entityType ?? null, title: n.title, body: n.body ?? '', link: n.link }, action).catch(() => {});
      if (!quiet) toast.ok(action === 'snooze' ? '10분 뒤 다시 알립니다' : '알람을 해제했습니다');
    } catch (e: any) { if (!quiet) toast.error(e.message); }
    finally { doing.current.delete(n.id); setBusy(null); onChange(n.id); }
  }
  // 378차(대표 11/06 '알람 울릴 때 열기 눌렀으면 알람 사라져야'): 휴대폰 알람·알림창의 [열기]로 그 업무·일정 화면을 열고 들어왔으면 이 띠의 같은 알람도 해제
  useEffect(() => {
    const check = () => { const o = openedFromOutside(); if (o) for (const n of items) if (opensAlarm(o.path, n)) void act(n, 'dismiss', true); };
    check();
    window.addEventListener('wos-opened', check);
    return () => window.removeEventListener('wos-opened', check);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!items.length) return null;
  return (
    <div className="sticky top-0 z-[60] border-b-2 border-red-500 bg-red-50 px-3 py-2 text-sm shadow-sm sm:px-6" role="alert" aria-live="assertive" data-testid="alarm-bar">
      {items.map((n) => (
        <div key={n.id} className="flex flex-wrap items-center gap-2 py-1" data-testid="alarm-item">
          <AlarmClock className="size-5 shrink-0 animate-pulse text-red-600" aria-hidden />
          <div className="min-w-0 flex-1"><b className="block truncate text-red-900">{n.title}</b>{n.body && <span className="block truncate text-xs text-red-800/80">{n.body}</span>}</div>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" onClick={() => act(n, 'dismiss')} disabled={busy === n.id + 'dismiss'} className="min-h-[36px] rounded-input bg-red-600 px-3 text-sm font-semibold text-white active:bg-red-700" data-testid="alarm-dismiss">해제</button>
            <button type="button" onClick={() => act(n, 'snooze')} disabled={busy === n.id + 'snooze'} className="min-h-[36px] rounded-input border border-red-300 bg-white px-3 text-sm font-medium text-red-800" data-testid="alarm-snooze">10분 뒤</button>
            <Link href={n.link} onClick={() => { setMuted(true); void act(n, 'dismiss', true); }} className="inline-flex min-h-[36px] items-center rounded-input border border-red-300 bg-white px-3 text-sm font-medium text-red-800" data-testid="alarm-open">열기</Link>
          </div>
        </div>))}
      <button type="button" onClick={() => setMuted(!muted)} className={cx('absolute right-1 top-1 rounded-full p-1 text-[11px] text-red-700', muted && 'line-through')} aria-label={muted ? '진동 켜기' : '진동 끄기'} data-testid="alarm-mute"><X className="size-3.5" aria-hidden /></button>
    </div>
  );
}
