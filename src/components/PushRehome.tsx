'use client';
import { useEffect, useState } from 'react';
import { api } from './client';
import { isNativeApp, subscribeWebPush } from './native';
import { toast } from './ui';

/**
 * 198차 결정 15-29 주소 분리: 브라우저 알림 허용·웹 푸시 구독은 주소(출처)마다 따로라 www → app. 로 옮기면 PC·안드로이드 크롬·아이폰 홈 화면 웹앱의 알림이 끊긴다.
 * app. 에서(스위치를 켰을 때만) 이 사람이 다른 곳에서 웹 푸시를 받던 기록이 있고, 이 브라우저는 아직 묻지 않은 상태면 한 줄 안내 + [알림 켜기](허용은 브라우저가 묻는다).
 * 앱(휴대폰 앱 푸시)은 주소와 상관없어 띄우지 않는다. [나중에] = 이 브라우저에서 다시 안 띄움
 */
export function PushRehome({ appHost }: { appHost?: string | null }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!appHost || location.hostname !== appHost.split(':')[0] || isNativeApp()) return;
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission !== 'default') return;
    try { if (localStorage.getItem('wos_push_rehome') === '1') return; } catch { /* 없음 */ }
    api<{ web: number }>('/api/push/subscribe').then((r) => { if (r.web > 0) setShow(true); }).catch(() => {});
  }, [appHost]);
  if (!show) return null;
  const later = () => { try { localStorage.setItem('wos_push_rehome', '1'); } catch { /* 없음 */ } setShow(false); };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2 text-xs text-brand-900" role="status" data-testid="push-rehome">
      <span className="min-w-0 flex-1">워크인 주소가 <b>{appHost}</b> 로 바뀌어 이 브라우저의 알림을 한 번 더 켜야 합니다.</span>
      <button type="button" className="rounded-input bg-brand-600 px-3 py-1 font-semibold text-white" onClick={async () => { try { await subscribeWebPush(); toast.ok('이 브라우저에서 다시 알림을 받습니다'); setShow(false); } catch (e: any) { toast.error(e.message); } }} data-testid="push-rehome-on">알림 켜기</button>
      <button type="button" className="px-2 py-1 text-brand-800 underline" onClick={later} data-testid="push-rehome-later">나중에</button>
    </div>
  );
}
