'use client';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

// 네이티브 플러그인은 앱(mobile/)에 설치되어 있고, 웹 번들에는 프록시만 둔다
type L = (e: any) => void;
interface AppPlugin { addListener(ev: string, fn: L): Promise<PluginListenerHandle>; exitApp(): Promise<void> }
interface FcmPlugin { addListener(ev: string, fn: L): Promise<PluginListenerHandle>; requestPermissions(): Promise<{ receive: string }>; checkPermissions(): Promise<{ receive: string }>; getToken(): Promise<{ token: string }>; removeDeliveredNotifications(o: { notifications: { id: string }[] }): Promise<void> }
const App = registerPlugin<AppPlugin>('App');
// 로컬 10/19(대표) 앱 생체 인증 잠금: @aparajita/capacitor-biometric-auth(네이티브 이름 BiometricAuthNative). 앱에 설치되지 않았으면 기능을 숨긴다
interface BioPlugin { checkBiometry(): Promise<{ isAvailable: boolean; biometryType: number; reason?: string }>; authenticate(o: { reason?: string; cancelTitle?: string; allowDeviceCredential?: boolean; androidTitle?: string }): Promise<void> }
const BiometricAuth = registerPlugin<BioPlugin>('BiometricAuthNative');
export const bioAvailable = async () => { if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('BiometricAuthNative')) return false; try { return (await BiometricAuth.checkBiometry()).isAvailable; } catch { return false; } };
/** 지문·얼굴(또는 기기 잠금 번호)로 확인 — 성공 true */
export async function bioAuthenticate(reason = '워크인 잠금 해제') {
  try { await BiometricAuth.authenticate({ reason, cancelTitle: '취소', allowDeviceCredential: true, androidTitle: '워크인' }); return true; } catch { return false; }
}
export const BIO_KEY = 'wos_bio_lock';
export const onAppActive = (fn: () => void) => { if (!Capacitor.isNativePlatform()) return; App.addListener('appStateChange', ({ isActive }: any) => { if (isActive) fn(); }); };
const FirebaseMessaging = registerPlugin<FcmPlugin>('FirebaseMessaging');
interface LocalPlugin {
  addListener(ev: string, fn: L): Promise<PluginListenerHandle>;
  checkPermissions(): Promise<{ display: string }>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  schedule(o: { notifications: any[] }): Promise<unknown>;
  createChannel(c: { id: string; name: string; description?: string; importance?: number; visibility?: number; vibration?: boolean; sound?: string }): Promise<void>;
  registerActionTypes(o: { types: { id: string; actions: { id: string; title: string; destructive?: boolean; foreground?: boolean; input?: boolean; inputButtonTitle?: string; inputPlaceholder?: string }[] }[] }): Promise<void>;
  removeDeliveredNotifications(o: { notifications: any[] }): Promise<void>;
}
const LocalNotifications = registerPlugin<LocalPlugin>('LocalNotifications');
// 앱 1.1.3 네이티브(로컬 f10f7337): 이 앱이 할 수 있는 일(caps) — 옛 앱(1.1.2 이하)에는 플러그인이 없어 []
interface WorkinNativePlugin { getInfo(): Promise<{ platform?: string; caps?: string[] }> }
const WorkinNative = registerPlugin<WorkinNativePlugin>('WorkinNative');
export async function nativeCaps(): Promise<string[]> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('WorkinNative')) return [];
  try { return ((await WorkinNative.getInfo()).caps ?? []).filter((c) => typeof c === 'string').slice(0, 20); } catch { return []; }
}
// 52ec734(로컬): filesystem·share·browser 플러그인 — 이 플러그인이 없는 예전 앱은 지금처럼 동작
interface BrowserPlugin { open(o: { url: string; presentationStyle?: string }): Promise<void>; close(): Promise<void> }
interface FsPlugin { writeFile(o: { path: string; data: string; directory: string }): Promise<{ uri: string }> }
interface SharePlugin { share(o: { title?: string; files?: string[]; dialogTitle?: string }): Promise<unknown> }
const Browser = registerPlugin<BrowserPlugin>('Browser');
const Filesystem = registerPlugin<FsPlugin>('Filesystem');
const Share = registerPlugin<SharePlugin>('Share');
export const hasBrowser = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('Browser');
const canShareFiles = () => Capacitor.getPlatform() === 'ios' && Capacitor.isPluginAvailable('Filesystem') && Capacitor.isPluginAvailable('Share');
/** 예전 앱(플러그인 없음)에서는 서버 알림을 그대로 받는다 */
const hasLocal = () => Capacitor.isPluginAvailable('LocalNotifications');
import { api } from './client';
import { WN_ACTION_IDS, WN_SETS, wnCategory } from '@/lib/notifCategories';

type Router = { push: (href: string) => void };

/** 앱(안드로이드·iOS) 안에서 실행될 때만 동작: 푸시 토큰 등록, 알림 탭 → 해당 화면 이동, 딥링크, 뒤로가기 */
export async function initNative(router: Router) {
  if (!Capacitor.isNativePlatform()) return;
  document.documentElement.classList.add('native', `native-${Capacitor.getPlatform()}`); // 하단 시스템 바 여백 대체값(globals.css)
  // 점검 2026-10-16: 앱에서는 새 창(target=_blank)·직접 /api 내려받기 링크를 같은 창으로 — 새 창은 쿠키 없는 외부 브라우저로 가거나 빈 화면이 되고,
  // 같은 창 이동은 안드로이드 내려받기 처리기(쿠키 포함 DownloadManager)가 받는다. 다른 도메인 링크는 그대로(외부 브라우저)
  document.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented) return;
    let u: URL; try { u = new URL(a.href, location.href); } catch { return; }
    if (u.protocol === 'blob:' || u.origin !== location.origin) return;
    // iOS: WKWebView 는 파일을 내려받지 않고 보여 주기만 함 → 받아서 공유 시트(파일에 저장·카톡 등)로
    if (canShareFiles() && (u.pathname.startsWith('/api/') || a.hasAttribute('download'))) { e.preventDefault(); saveViaShare(u.pathname + u.search); return; }
    // 대표 실기기(10/16): 첨부·자료실 파일을 안드로이드 내려받기 관리자로 넘기면 "내려받는 중"만 뜨고 안 받아짐(짧은 수명의 저장소 주소) →
    // 서버에서 주소를 받아 기기 브라우저로 연다(한글 파일 이름·내려받기를 브라우저가 처리)
    if (/^\/api\/(attachments|library)\/[^/]+\/download$/.test(u.pathname)) { e.preventDefault(); openFileExternally(u.pathname + u.search); return; }
    if (a.target === '_blank' || u.pathname.startsWith('/api/') || a.hasAttribute('download')) { e.preventDefault(); location.assign(u.pathname + u.search); }
  }); // 버블 단계: 화면의 자체 처리(미리보기 등 preventDefault)가 먼저
  const go = (link?: string) => {
    if (!link) return;
    try {
      const u = new URL(link, location.origin);
      router.push(u.pathname + u.search + u.hash);
    } catch {}
  };
  // 알림 탭 리스너는 맨 먼저(어떤 await 보다 앞) 등록: 플러그인이 보관해 둔 탭 이벤트를 바로 받아 해당 화면으로 이동하고 그 알림을 읽음 처리
  // 로컬 10/21 13:05 #409(대표 실기기): 알람형 알림의 [해제]/[10분 뒤]/[열기]·본문 탭 — 전에는 link 이동만 하고 actionId 를 보지 않아
  // ongoing 알림이 그대로 남고 재예약·결과 보고도 없었다. 로컬 예약·FCM 둘 다 같은 처리: 뜬 알림 지우기 → 미루기는 기기에서 재예약(서버 재발송에 기대지 않음) → POST /api/reminders/alarm → 토스트
  const alarmAction = async (actionId: string, n: { id?: number | string; title?: string; body?: string; extra?: any }, from: 'local' | 'fcm') => {
    const x = n.extra ?? {}; const act = actionId === 'tap' || !actionId ? 'open' : actionId;
    // ① 뜬 알림 지우기(ongoing 은 스와이프로 못 지우므로 여기서)
    if (from === 'local' && n.id !== undefined && hasLocal()) {
      const id = Number(n.id);
      await LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
      await (LocalNotifications as any).removeDeliveredNotificationsById?.({ ids: [id] })?.catch?.(() => {});
      await LocalNotifications.removeDeliveredNotifications({ notifications: [{ id, title: n.title ?? '', body: n.body ?? '' } as any] }).catch(() => {});
    } else if (from === 'fcm' && n.id !== undefined) await FirebaseMessaging.removeDeliveredNotifications({ notifications: [{ id: String(n.id), tag: x.key ? String(x.key) : undefined } as any] }).catch(() => {}); // 서버가 tag = 알림 id 로 보냄 — tag 없이는 안 지워졌다
    const report = (action: 'dismiss' | 'snooze', minutes?: number) => (x.kind && x.entityId ? api('/api/reminders/alarm', { body: { kind: x.kind, id: x.entityId, action, minutes, key: x.key ? String(x.key).slice(0, 200) : undefined } }).catch(() => {}) : Promise.resolve());
    const { toast } = await import('./ui');
    if (act === 'snooze') {
      const minutes = Math.min(120, Math.max(1, Number(x.snoozeMinutes) || 10));
      await scheduleSnooze({ title: n.title ?? '알람', body: n.body ?? '', minutes, extra: x });
      await report('snooze', minutes); toast.ok(`${minutes}분 뒤 다시 알립니다`); window.dispatchEvent(new Event('wos-refresh'));
    } else if (act === 'dismiss') { await report('dismiss'); toast.ok('알람을 해제했습니다'); window.dispatchEvent(new Event('wos-refresh')); }
    else go(x.link);
  };
  // 앱 1.1.3 알림창 버튼(#130·#478, iOS): 알림의 [승인][수정 요청]·[답글][확인] 등 → 알림 액션 API(서버가 권한·상태 검사). 안드로이드 1.1.3 은 앱이 직접 처리(NotificationActionReceiver)
  const notifAction = async (nid: string, action: string, text: string | undefined, link?: string) => {
    const { toast } = await import('./ui');
    try {
      const r = await api<{ label?: string }>(`/api/notifications/${encodeURIComponent(nid)}/action`, { body: { action, ...(text?.trim() ? { text: text.trim() } : {}) } });
      toast.ok(`✓ ${r?.label ?? '처리했습니다'}`); window.dispatchEvent(new Event('wos-refresh'));
    } catch (err: any) { toast.error(err?.message ?? '처리하지 못했습니다 — 열어서 확인해 주세요'); go(link); }
  };
  FirebaseMessaging.addListener('notificationActionPerformed', (e: any) => {
    const d = e?.notification?.data ?? {};
    const aid = String(e?.actionId ?? 'tap');
    if (d.notificationId && d.alarm !== 'true' && d.alarm !== true && WN_ACTION_IDS.has(aid)) { notifAction(String(d.notificationId), aid, e?.inputValue, d.link).catch(() => go(d.link)); return; }
    if (d.notificationId) api('/api/notifications/read', { method: 'POST', body: { ids: [d.notificationId] } }).then(() => window.dispatchEvent(new Event('wos-refresh'))).catch(() => {});
    if (d.alarm === 'true' || d.alarm === true) { alarmAction(String(e?.actionId ?? 'tap'), { id: e?.notification?.id, title: e?.notification?.title, body: e?.notification?.body, extra: { link: d.link, kind: d.taskId ? 'task' : undefined, entityId: d.taskId || undefined, alarm: true, snoozeMinutes: d.snoozeMinutes, key: d.notificationId } }, 'fcm').catch(() => go(d.link)); return; }
    go(d.link);
  });
  // 휴대폰 예약 알림(서버 연결 없이 정시에 울림) 탭·액션 → 알람이면 위 처리, 아니면 해당 화면
  if (hasLocal()) {
    // 버튼 묶음은 한 번에 등록(iOS 는 등록할 때마다 전체가 바뀜): 알람 + 서버 푸시의 aps.category 'wn.*'(src/lib/notifCategories — 서버와 같은 표).
    // iOS 버튼은 앱을 열고 처리(foreground) — 앱이 꺼진 채 뒤에서 처리하면 결과를 보여 줄 수 없어서
    LocalNotifications.registerActionTypes({ types: [{ id: 'alarm', actions: [{ id: 'dismiss', title: '해제', destructive: true }, { id: 'snooze', title: '10분 뒤' }, { id: 'open', title: '열기' }] },
      ...WN_SETS.map((set) => ({ id: wnCategory(set), actions: set.map((a) => ({ id: a.id, title: a.label, foreground: true, ...(a.input ? { input: true, inputButtonTitle: '보내기', inputPlaceholder: a.id === 'changes' ? '고칠 내용' : '답글' } : {}) })) }))] }).catch(() => {});
    LocalNotifications.addListener('localNotificationActionPerformed', (e: any) => {
      const n = e?.notification ?? {}; const x = n.extra ?? {};
      if (x.alarm === true || x.alarm === 'true') { alarmAction(String(e?.actionId ?? 'tap'), { id: n.id, title: n.title, body: n.body, extra: x }, 'local').catch(() => go(x.link)); return; }
      go(x.link);
    });
  }
  App.addListener('appUrlOpen', (e: any) => go(e.url.replace(/^[a-z]+:\/\/[^/]*/i, '') || '/'));
  // V14 39번: 하드웨어 뒤로 = 열린 시트·모달 닫기 → 이전 화면(history) → 홈 → (홈에서) 2초 안에 한 번 더 누르면 종료
  let exitAt = 0;
  App.addListener('backButton', async ({ canGoBack }: any) => {
    const { closeTopSheet } = await import('./backClose');
    if (closeTopSheet()) return;
    if (canGoBack && history.length > 1 && location.pathname !== '/') { history.back(); return; }
    // 점검 2026-10-16: 알림으로 처음 연 업무·일정 상세에서 뒤로 → 홈 대신 그 목록
    if (/^\/tasks\/[^/]+/.test(location.pathname)) { router.push('/tasks'); return; }
    if (/^\/messages\/./.test(location.pathname)) { router.push('/messages'); return; }
    if (location.pathname !== '/') { router.push('/'); return; }
    if (Date.now() - exitAt < 2000) { App.exitApp(); return; }
    exitAt = Date.now();
    const { toast } = await import('./ui');
    toast.info('한 번 더 누르면 앱을 닫습니다');
  });

  FirebaseMessaging.addListener('notificationReceived', (e: any) => {
    // 일정·업무가 바뀌면 서버가 조용한 메시지를 보낸다 → 예약 다시 맞춤
    if (e?.notification?.data?.type === 'reminders-changed') { resyncReminders(); return; }
    window.dispatchEvent(new Event('wos-refresh'));
  });
  // 앱 시작·복귀·화면에서 저장했을 때 예약 다시 맞춤
  App.addListener('appStateChange', ({ isActive }: any) => { if (isActive) resyncReminders(); });
  let t: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('wos-refresh', () => { clearTimeout(t); t = setTimeout(() => resyncReminders(), 1500); });
  createAlarmChannel().catch(() => {});
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
  await api('/api/push/subscribe', { body: { kind: 'fcm', endpoint: token, platform: Capacitor.getPlatform(), localReminders: local, caps: await nativeCaps() } });
  try { localStorage.setItem('wos_push_endpoint', token); } catch {}
}

/**
 * 휴대폰 예약 알림: 앞으로 7일 미리 알림(최대 64개)을 받아 기기에 예약한다.
 * 서버 정기 실행이 늦어도 정시에 울리고, 이 기기는 서버가 같은 미리 알림을 보내지 않는다(localReminders).
 */
let syncing: Promise<void> | null = null, again = false, channel = false;

/**
 * 대표 10/22: 알람은 소리 없이 진동만. 안드로이드 채널 소리는 만든 뒤 못 바꿔서 새 채널(alarm_vibrate)을 만든다.
 * 플러그인은 sound 를 비우면 기본 알림음을 쓰므로 무음 파일(silence)을 지정 — 앱에 무음 파일(안드로이드 res/raw/silence.wav · iOS 번들 silence.wav)이 들어가면 확실히 무음,
 * 파일이 아직 없는 앱도 안드로이드는 열 수 없는 소리라 울리지 않는다. 진동은 채널 기본 진동.
 * FCM 알람 푸시도 같은 채널(서버 push.ts ALARM_CHANNEL) — 로컬 알림 권한이 없어도 채널은 만들어 둔다.
 */
export const ALARM_CHANNEL = 'alarm_vibrate';

/** 대표 10/22: 기기에 예약한 알람 id ↔ 업무·일정 — 앱 안 띠에서 [해제]/[10분 뒤]를 눌렀을 때 이미 울린(고정된) 휴대폰 알림을 찾아 지우려고 */
type AlarmRef = { id: number; entityId: string; at: number };
const ALARM_KEY = 'wos_alarm_ids';
function loadAlarms(): AlarmRef[] { try { return JSON.parse(localStorage.getItem(ALARM_KEY) || '[]'); } catch { return []; } }
function rememberAlarms(add: AlarmRef[], replaceFuture = false) {
  const now = Date.now();
  // 지난 하루치(이미 울린 것)는 남기고, 다시 맞출 때 앞으로 울릴 것은 새 목록으로
  const keep = loadAlarms().filter((a) => a.at > now - 86_400_000 && (!replaceFuture || a.at <= now));
  try { localStorage.setItem(ALARM_KEY, JSON.stringify([...keep, ...add].slice(-200))); } catch { /* 저장 못 함 */ }
}
async function scheduleSnooze(o: { title: string; body: string; minutes: number; extra: any }) {
  if (!hasLocal()) return;
  const id = (Math.floor(Date.now() / 1000) % 1_000_000_000) + 1_000_000_000, at = Date.now() + o.minutes * 60_000;
  await LocalNotifications.schedule({ notifications: [{
    id, title: o.title, body: o.body, channelId: ALARM_CHANNEL, sound: ALARM_SOUND, actionTypeId: 'alarm', ongoing: true,
    schedule: { at: new Date(at), allowWhileIdle: true }, extra: { ...o.extra, alarm: true, snoozed: (Number(o.extra?.snoozed) || 0) + 1 } }] }).catch(() => {});
  if (o.extra?.entityId) rememberAlarms([{ id, entityId: String(o.extra.entityId), at }]);
}
/**
 * 앱 안 알람 띠에서 [해제]/[10분 뒤]를 눌렀을 때 휴대폰 쪽 정리:
 * ① 이미 울려 알림창에 고정된 같은 업무·일정의 기기 예약 알람 지우기 ② 서버 푸시(FCM, tag = 알림 id) 지우기
 * ③ [10분 뒤]면 이 기기에 10분 뒤 알람 다시 예약(기기 예약을 쓰는 휴대폰은 서버가 같은 알림을 다시 푸시하지 않음)
 */
export async function settleAlarmOnDevice(n: { notificationId: string; entityId: string | null; entityType: string | null; title: string; body: string; link: string }, action: 'dismiss' | 'snooze') {
  if (!Capacitor.isNativePlatform()) return;
  const now = Date.now();
  if (hasLocal() && n.entityId) {
    const fired = loadAlarms().filter((a) => a.entityId === n.entityId && a.at <= now + 60_000);
    if (fired.length) await LocalNotifications.cancel({ notifications: fired.map((a) => ({ id: a.id })) }).catch(() => {});
  }
  const fcm = FirebaseMessaging as any;
  const d = await fcm.getDeliveredNotifications?.().catch(() => null);
  const mine = (d?.notifications ?? []).filter((x: any) => x?.tag === n.notificationId);
  if (mine.length) await FirebaseMessaging.removeDeliveredNotifications({ notifications: mine.map((x: any) => ({ id: String(x.id), tag: x.tag })) as any }).catch(() => {});
  if (action === 'snooze' && hasLocal() && (await LocalNotifications.checkPermissions().catch(() => ({ display: 'denied' }))).display === 'granted') {
    await scheduleSnooze({ title: n.title, body: n.body, minutes: 10, extra: { link: n.link, kind: n.entityType === 'event' ? 'event' : n.entityType === 'task' ? 'task' : undefined, entityId: n.entityId ?? undefined, key: n.notificationId, snoozeMinutes: 10 } });
  }
}
const ALARM_SOUND = 'silence.wav';
let alarmChannel = false;
async function createAlarmChannel() {
  if (alarmChannel || Capacitor.getPlatform() !== 'android') return;
  const c = { id: ALARM_CHANNEL, name: '알람(진동)', description: '알람처럼 울리는 일정·마감 — 소리 없이 진동', importance: 5, visibility: 1, vibration: true, sound: ALARM_SOUND };
  if (hasLocal()) await LocalNotifications.createChannel(c).catch(() => {});
  else await (FirebaseMessaging as any).createChannel?.(c)?.catch?.(() => {});
  alarmChannel = true;
}
export function resyncReminders(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !hasLocal()) return Promise.resolve();
  if (syncing) { again = true; return syncing; }
  syncing = (async () => {
    try {
      if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
      if (!channel && Capacitor.getPlatform() === 'android') {
        await LocalNotifications.createChannel({ id: 'reminders', name: '미리 알림', description: '일정·마감·아침 브리핑', importance: 4, visibility: 1, vibration: true }).catch(() => {});
        await createAlarmChannel();
        channel = true;
      }
      const { reminders } = await api('/api/reminders/upcoming');
      const pending = await LocalNotifications.getPending() as { notifications: { id: number; extra?: any }[] };
      // 대표 10/22: [10분 뒤]로 기기에 다시 예약한 알람(extra.snoozed)은 남긴다 — 전에는 직후 다시 맞춤이 지워 10분 뒤에 안 울렸다
      const stale = pending.notifications.filter((n) => !n.extra?.snoozed);
      if (stale.length) await LocalNotifications.cancel({ notifications: stale.map((n) => ({ id: n.id })) });
      const list = (reminders as { id: number; key: string; fireAt: string; title: string; body: string; link: string; kind?: string; entityId?: string; alarm?: boolean; snoozeMinutes?: number; actions?: { id: string; label: string }[] }[]).filter((r) => new Date(r.fireAt).getTime() > Date.now()).slice(0, 64);
      // 로컬 10/20(대표): alarm 이면 알람 채널(전체 화면·소리·[해제][10분 뒤] — 네이티브가 extra 를 보고 처리, 결과는 POST /api/reminders/alarm)
      rememberAlarms(list.filter((r) => r.alarm && r.entityId).map((r) => ({ id: r.id, entityId: r.entityId!, at: Date.parse(r.fireAt) })), true);
      if (list.length) await LocalNotifications.schedule({ notifications: list.map((r) => ({
        id: r.id, title: r.title, body: r.body, channelId: r.alarm ? ALARM_CHANNEL : 'reminders', ...(r.alarm ? { sound: ALARM_SOUND } : {}), ...(r.alarm ? { actionTypeId: 'alarm', ongoing: true } : {}),
        schedule: { at: new Date(r.fireAt), allowWhileIdle: true }, extra: { link: r.link, key: r.key, kind: r.kind, entityId: r.entityId, alarm: !!r.alarm, snoozeMinutes: r.snoozeMinutes ?? 10, actions: r.actions ?? [] },
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

/** iOS 내려받기: 쿠키 포함으로 받아 임시 저장 → 공유 시트("파일에 저장" 등) */
/** 첨부·자료실 파일: 서버가 권한 확인 후 주는 서명 주소를 기기 브라우저(없으면 앱 밖 이동)로 연다 */
export async function openFileExternally(path: string) {
  const { toast } = await import('./ui');
  try {
    const r = await api<{ url: string }>(`${path}${path.includes('?') ? '&' : '?'}json=1`);
    if (hasBrowser()) await Browser.open({ url: r.url });
    else window.location.href = r.url; // 다른 도메인 = 앱 밖 기기 브라우저
  } catch (e: any) { toast.error(e?.message ?? '파일을 열지 못했습니다'); }
}
async function saveViaShare(path: string) {
  const { toast } = await import('./ui');
  try {
    const r = await fetch(path, { credentials: 'include' });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? '내려받지 못했습니다');
    const cd = r.headers.get('content-disposition') ?? '';
    const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)/i.exec(cd)?.[1] ?? path.split('?')[0].split('/').pop() ?? 'file').replace(/[\\/:*?"<>|]/g, '_');
    const blob = await r.blob();
    const data = await new Promise<string>((ok, fail) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] ?? ''); fr.onerror = () => fail(fr.error); fr.readAsDataURL(blob); });
    const { uri } = await Filesystem.writeFile({ path: name, data, directory: 'CACHE' });
    await Share.share({ title: name, files: [uri], dialogTitle: '파일 저장·보내기' });
  } catch (e: any) { if (!/cancel/i.test(String(e?.message))) toast.error(e?.message || '내려받지 못했습니다'); }
}

/** 앱 소셜 로그인: 검증값(앱 보관) 만들고 시스템 브라우저로 시작 → 끝나면 workos://open/auth/app 으로 돌아옴 */
export async function openOAuthInBrowser(startPath: string) {
  const v = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const ac = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))), (b) => b.toString(16).padStart(2, '0')).join('');
  try { localStorage.setItem('wos_oauth_v', v); } catch {}
  await Browser.open({ url: `${location.origin}${startPath}${startPath.includes('?') ? '&' : '?'}ac=${ac}`, presentationStyle: 'popover' });
}
export function takeOAuthVerifier() {
  try { const v = localStorage.getItem('wos_oauth_v'); localStorage.removeItem('wos_oauth_v'); return v; } catch { return null; }
}
export function closeSystemBrowser() { if (hasBrowser()) Browser.close().catch(() => {}); }

/** V19 견적서: 앱에서 PDF 를 공유창으로(카카오톡·문자 등) — 서버 주소를 쿠키 포함으로 받아 임시 저장 후 Share. 웹이면 false(내려받기로) */
export async function shareServerFile(path: string, title = '파일'): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable('Filesystem') || !Capacitor.isPluginAvailable('Share')) return false;
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error('파일을 받지 못했습니다');
  const cd = r.headers.get('content-disposition') ?? '';
  const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)/i.exec(cd)?.[1] ?? 'file.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const buf = new Uint8Array(await r.arrayBuffer());
  let b64 = ''; for (let i = 0; i < buf.length; i += 0x8000) b64 += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const w = await Filesystem.writeFile({ path: name, data: btoa(b64), directory: 'CACHE' });
  await Share.share({ title, files: [w.uri], dialogTitle: title });
  return true;
}
