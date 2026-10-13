'use client';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// 네이티브 플러그인은 앱(mobile/)에 설치되어 있고, 웹 번들에는 프록시만 둔다
type L = (e: any) => void;
interface AppPlugin { addListener(ev: string, fn: L): Promise<PluginListenerHandle>; exitApp(): Promise<void> }
interface FcmPlugin { addListener(ev: string, fn: L): Promise<PluginListenerHandle>; requestPermissions(): Promise<{ receive: string }>; checkPermissions(): Promise<{ receive: string }>; getToken(): Promise<{ token: string }> }
const App = registerPlugin<AppPlugin>('App');
const FirebaseMessaging = registerPlugin<FcmPlugin>('FirebaseMessaging');
import { api } from './client';

type Router = { push: (href: string) => void };

/** 앱(안드로이드·iOS) 안에서 실행될 때만 동작: 푸시 토큰 등록, 알림 탭 → 해당 화면 이동, 딥링크, 뒤로가기 */
export async function initNative(router: Router) {
  if (!Capacitor.isNativePlatform()) return;
  const go = (link?: string) => {
    if (!link) return;
    try {
      const u = new URL(link, location.origin);
      router.push(u.pathname + u.search + u.hash);
    } catch {}
  };
  App.addListener('appUrlOpen', (e: any) => go(e.url.replace(/^[a-z]+:\/\/[^/]*/i, '') || '/'));
  App.addListener('backButton', ({ canGoBack }: any) => (canGoBack ? history.back() : App.exitApp()));

  FirebaseMessaging.addListener('notificationActionPerformed', (e: any) => go(e.notification?.data?.link));
  FirebaseMessaging.addListener('notificationReceived', () => window.dispatchEvent(new Event('wos-refresh')));
  FirebaseMessaging.addListener('tokenReceived', (e: any) => registerToken(e.token));
  // 첫 실행: 시스템 권한 창을 바로 띄우지 않고, 이유를 먼저 보여 주는 안내(AppShell)를 띄운다
  const perm = await FirebaseMessaging.checkPermissions().catch(() => ({ receive: 'prompt' }));
  if (perm.receive === 'granted') { await enableNativePush().catch(() => {}); return; }
  let asked = false;
  try { asked = localStorage.getItem('wos_push_asked') === '1'; } catch {}
  if (perm.receive !== 'denied' && !asked) window.dispatchEvent(new Event('wos-push-ask'));
}

/** 앱 알림 켜기: 권한 요청 → FCM 토큰 등록. 거부되면 오류 */
export async function enableNativePush() {
  try { localStorage.setItem('wos_push_asked', '1'); } catch {}
  const perm = await FirebaseMessaging.requestPermissions();
  if (perm.receive !== 'granted') throw new Error('알림 권한이 꺼져 있습니다. 휴대폰 설정 → 앱 → 워크인 → 알림에서 허용해 주세요.');
  const { token } = await FirebaseMessaging.getToken();
  await registerToken(token);
}

async function registerToken(token: string) {
  if (!token) return;
  await api('/api/push/subscribe', { body: { kind: 'fcm', endpoint: token, platform: Capacitor.getPlatform() } });
  try { localStorage.setItem('wos_push_endpoint', token); } catch {}
}

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

/** 웹 푸시 구독 (PC·안드로이드 크롬, iOS 홈 화면 웹앱 16.4+) */
export async function subscribeWebPush(): Promise<string> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('이 브라우저는 웹 푸시를 지원하지 않습니다. (iPhone 은 앱 또는 홈 화면에 추가한 웹앱에서 가능)');
  const { publicKey } = await api('/api/push/vapid');
  if (!publicKey) throw new Error('서버에 웹 푸시 키가 설정되지 않았습니다 (관리자 설정 필요)');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (publicKey.length % 4)) % 4)), (c) => c.charCodeAt(0));
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  const j = sub.toJSON() as any;
  await api('/api/push/subscribe', { body: { kind: 'webpush', endpoint: j.endpoint, keys: j.keys, platform: 'web' } });
  try { localStorage.setItem('wos_push_endpoint', j.endpoint); } catch {}
  return j.endpoint;
}
