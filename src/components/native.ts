'use client';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// 네이티브 플러그인은 앱(mobile/)에 설치되어 있고, 웹 번들에는 프록시만 둔다
type L = (e: any) => void;
interface AppPlugin { addListener(ev: string, fn: L): Promise<PluginListenerHandle>; exitApp(): Promise<void> }
interface FcmPlugin { addListener(ev: string, fn: L): Promise<PluginListenerHandle>; requestPermissions(): Promise<{ receive: string }>; checkPermissions(): Promise<{ receive: string }>; getToken(): Promise<{ token: string }> }
const App = registerPlugin<AppPlugin>('App');
const FirebaseMessaging = registerPlugin<FcmPlugin>('FirebaseMessaging');
interface LocalPlugin {
  addListener(ev: string, fn: L): Promise<PluginListenerHandle>;
  checkPermissions(): Promise<{ display: string }>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  schedule(o: { notifications: any[] }): Promise<unknown>;
  createChannel(c: { id: string; name: string; description?: string; importance?: number; visibility?: number; vibration?: boolean }): Promise<void>;
}
const LocalNotifications = registerPlugin<LocalPlugin>('LocalNotifications');
/** 예전 앱(플러그인 없음)에서는 서버 알림을 그대로 받는다 */
const hasLocal = () => Capacitor.isPluginAvailable('LocalNotifications');
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
  // 알림 탭 리스너는 맨 먼저(어떤 await 보다 앞) 등록: 플러그인이 보관해 둔 탭 이벤트를 바로 받아 해당 화면으로 이동하고 그 알림을 읽음 처리
  FirebaseMessaging.addListener('notificationActionPerformed', (e: any) => {
    const d = e?.notification?.data ?? {};
    go(d.link);
    if (d.notificationId) api('/api/notifications/read', { method: 'POST', body: { ids: [d.notificationId] } }).then(() => window.dispatchEvent(new Event('wos-refresh'))).catch(() => {});
  });
  // 휴대폰 예약 알림(서버 연결 없이 정시에 울림) 탭 → 해당 화면
  if (hasLocal()) LocalNotifications.addListener('localNotificationActionPerformed', (e: any) => go(e?.notification?.extra?.link));
  App.addListener('appUrlOpen', (e: any) => go(e.url.replace(/^[a-z]+:\/\/[^/]*/i, '') || '/'));
  App.addListener('backButton', ({ canGoBack }: any) => (canGoBack ? history.back() : App.exitApp()));

  FirebaseMessaging.addListener('notificationReceived', (e: any) => {
    // 일정·업무가 바뀌면 서버가 조용한 메시지를 보낸다 → 예약 다시 맞춤
    if (e?.notification?.data?.type === 'reminders-changed') { resyncReminders(); return; }
    window.dispatchEvent(new Event('wos-refresh'));
  });
  // 앱 시작·복귀·화면에서 저장했을 때 예약 다시 맞춤
  App.addListener('appStateChange', ({ isActive }: any) => { if (isActive) resyncReminders(); });
  let t: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('wos-refresh', () => { clearTimeout(t); t = setTimeout(() => resyncReminders(), 1500); });
  resyncReminders();
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
  const local = hasLocal() && (await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' }))).display === 'granted';
  await api('/api/push/subscribe', { body: { kind: 'fcm', endpoint: token, platform: Capacitor.getPlatform(), localReminders: local } });
  try { localStorage.setItem('wos_push_endpoint', token); } catch {}
}

/**
 * 휴대폰 예약 알림: 앞으로 7일 미리 알림(최대 64개)을 받아 기기에 예약한다.
 * 서버 정기 실행이 늦어도 정시에 울리고, 이 기기는 서버가 같은 미리 알림을 보내지 않는다(localReminders).
 */
let syncing: Promise<void> | null = null, again = false, channel = false;
export function resyncReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !hasLocal()) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    try {
      if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
      if (!channel && Capacitor.getPlatform() === 'android') {
        await LocalNotifications.createChannel({ id: 'reminders', name: '미리 알림', description: '일정·마감·아침 브리핑', importance: 4, visibility: 1, vibration: true }).catch(() => {});
        channel = true;
      }
      const { reminders } = await api('/api/reminders/upcoming');
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
      const list = (reminders as { id: number; fireAt: string; title: string; body: string; link: string }[]).filter((r) => new Date(r.fireAt).getTime() > Date.now()).slice(0, 64);
      if (list.length) await LocalNotifications.schedule({ notifications: list.map((r) => ({
        id: r.id, title: r.title, body: r.body, channelId: 'reminders',
        schedule: { at: new Date(r.fireAt), allowWhileIdle: true }, extra: { link: r.link },
      })) });
    } catch { /* 오프라인 등: 기존 예약 유지 */ } finally {
      syncing = null;
      if (again) { again = false; resyncReminders(); }
    }
  })();
  return syncing;
}

/** 로그아웃: 이 기기에 남은 예약 지우기 */
export async function clearReminders() {
  if (!Capacitor.isNativePlatform() || !hasLocal()) return;
  const p = await LocalNotifications.getPending().catch(() => ({ notifications: [] as { id: number }[] }));
  if (p.notifications.length) await LocalNotifications.cancel({ notifications: p.notifications.map((n) => ({ id: n.id })) }).catch(() => {});
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
