import webpush from 'web-push';
import { importPKCS8, SignJWT } from 'jose';
import { db } from './db';
import { actionsFor } from './notifActions';
import { logError } from './log';

const MAX_ATTEMPTS = 5;

export function webPushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}
export function fcmConfigured() {
  return !!process.env.FCM_SERVICE_ACCOUNT_JSON;
}

let fcmToken: { token: string; exp: number } | null = null;
async function fcmAccessToken(sa: { client_email: string; private_key: string; token_uri?: string }) {
  if (fcmToken && fcmToken.exp > Date.now() + 60_000) return fcmToken.token;
  const key = await importPKCS8(sa.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setAudience(sa.token_uri ?? 'https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error(`FCM 토큰 발급 실패 ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  fcmToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

interface Payload { title: string; body: string; link: string; notificationId: string; type?: string; taskId?: string | null; actions?: { id: string; label: string; input?: 'text' }[]; tag?: string }

class PermanentError extends Error {}

async function sendWebPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, p: Payload) {
  if (!webPushConfigured()) throw new PermanentError('VAPID 키 미설정');
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', process.env.VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  try {
    await webpush.sendNotification(sub, JSON.stringify(p), { TTL: 86400, urgency: 'high' });
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) throw new PermanentError(`구독 만료(${status})`);
    throw e;
  }
}

async function sendFcm(token: string, p: Payload) {
  if (!fcmConfigured()) throw new PermanentError('FCM 서비스 계정 미설정');
  const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON!);
  const access = await fcmAccessToken(sa);
  const base = process.env.FCM_API_BASE ?? 'https://fcm.googleapis.com';
  const res = await fetch(`${base}/v1/projects/${sa.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: p.title, body: p.body },
        // 로컬 10/20 알림에서 바로 처리: 앱이 액션 버튼(Android)·카테고리(iOS)를 그릴 수 있게 종류·버튼·업무 id 를 data 로(값은 문자열만)
        data: { link: p.link, notificationId: p.notificationId, type: p.type ?? '', taskId: p.taskId ?? '', actions: JSON.stringify(p.actions ?? []) },
        // click_action 없음: 기본(앱 실행 activity)으로 열려야 data(link·notificationId)가 앱의 notificationActionPerformed 로 전달된다
        // V37 5: 안드로이드 상태바 단색 아이콘(앱 res/drawable/ic_stat_workin, 로컬 48806da)·강조색
        android: { priority: 'HIGH', notification: { channel_id: 'work', icon: 'ic_stat_workin', color: '#0F766E', tag: p.tag ?? p.notificationId } },
        apns: { payload: { aps: { sound: 'default', category: p.type ?? 'default', 'thread-id': p.taskId || p.notificationId } } },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404 || text.includes('UNREGISTERED') || text.includes('INVALID_ARGUMENT')) {
      throw new PermanentError(`FCM 토큰 무효: ${text.slice(0, 200)}`);
    }
    throw new Error(`FCM 발송 실패 ${res.status}: ${text.slice(0, 300)}`);
  }
}

/**
 * 대기 중인 푸시를 발송한다. 행을 먼저 '선점'(next_attempt_at 를 미래로 미루고 attempts+1)한 뒤 보내므로
 * 여러 서버 인스턴스가 동시에 실행해도 같은 알림을 두 번 보내지 않는다.
 */
export async function dispatchPending(limit = 50) {
  const sql = db();
  const claimed = await sql<
    { id: number; channel: string; endpoint: string; keys: any; sub_id: string; title: string; body: string; link: string; nid: string; attempts: number; type: string; entity_type: string | null; entity_id: string | null; meta: any; action_done: string | null }[]
  >`
    with c as (
      select d.id from notification_deliveries d
      where d.status = 'pending' and d.next_attempt_at <= now()
      order by d.id limit ${limit} for update skip locked
    )
    update notification_deliveries d set attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes'
    from c, push_subscriptions p, notifications n
    where d.id = c.id and p.id = d.subscription_id and n.id = d.notification_id
    returning d.id, d.channel, p.endpoint, p.keys, p.id as sub_id, n.title, n.body, n.link, n.id as nid, d.attempts, n.type, n.entity_type, n.entity_id, n.meta, n.action_done`;
  // 구독이 삭제된 행 정리
  await sql`update notification_deliveries set status = 'skipped', error = '구독 없음' where status = 'pending' and subscription_id is null`;

  let sent = 0, failed = 0;
  for (const d of claimed) {
    if (d.action_done) { await sql`update notification_deliveries set status = 'skipped', error = '이미 처리됨' where id = ${d.id}`; continue; } // 처리된 알림은 다시 푸시하지 않음
    const payload: Payload = { title: d.title, body: d.body, link: d.link, notificationId: d.nid, type: d.type, taskId: d.entity_type === 'task' ? d.entity_id : null, tag: d.nid,
      actions: actionsFor({ id: d.nid, type: d.type, link: d.link, entity_type: d.entity_type, entity_id: d.entity_id, meta: d.meta, action_done: d.action_done }) };
    try {
      if (d.channel === 'webpush') await sendWebPush({ endpoint: d.endpoint, keys: d.keys }, payload);
      else await sendFcm(d.endpoint, payload);
      await sql`update notification_deliveries set status = 'sent', sent_at = now(), error = null where id = ${d.id}`;
      await sql`update push_subscriptions set last_success_at = now(), fail_count = 0 where id = ${d.sub_id}`;
      sent++;
    } catch (e) {
      failed++;
      const msg = (e as Error).message?.slice(0, 500) ?? String(e);
      if (e instanceof PermanentError) {
        await sql`update notification_deliveries set status = 'failed', error = ${msg} where id = ${d.id}`;
        if (!msg.includes('미설정')) await sql`update push_subscriptions set disabled_at = now() where id = ${d.sub_id}`;
      } else if (d.attempts >= MAX_ATTEMPTS) {
        await sql`update notification_deliveries set status = 'failed', error = ${msg} where id = ${d.id}`;
        await sql`update push_subscriptions set fail_count = fail_count + 1 where id = ${d.sub_id}`;
      } else {
        const backoffMin = 2 ** d.attempts; // 2,4,8,16분
        await sql`update notification_deliveries set error = ${msg}, next_attempt_at = now() + ${backoffMin + ' minutes'}::interval where id = ${d.id}`;
      }
      await logError('push', e, { delivery: d.id, channel: d.channel });
    }
  }
  return { claimed: claimed.length, sent, failed };
}

/**
 * 휴대폰 예약 알림: 일정·업무가 바뀌면 영향받는 사람의 앱(로컬 알림 사용 기기)에 조용한 데이터 메시지 → 앱이 7일치를 다시 예약.
 * 못 받아도 다음에 앱을 열 때 다시 예약된다. 화면에 알림을 띄우지 않음, 실패는 무시.
 */
export async function remindersChanged(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  if (!ids.length || !fcmConfigured()) return 0;
  const sql = db();
  const subs = await sql<{ endpoint: string }[]>`select endpoint from push_subscriptions where kind = 'fcm' and local_reminders and disabled_at is null and user_id = any(${ids}::uuid[])`;
  if (!subs.length) return 0;
  const sa = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON!);
  const access = await fcmAccessToken(sa);
  const base = process.env.FCM_API_BASE ?? 'https://fcm.googleapis.com';
  let n = 0;
  for (const s of subs) {
    const r = await fetch(`${base}/v1/projects/${sa.project_id}/messages:send`, {
      method: 'POST', headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: s.endpoint, data: { type: 'reminders-changed' }, android: { priority: 'HIGH' },
        apns: { headers: { 'apns-push-type': 'background', 'apns-priority': '5' }, payload: { aps: { 'content-available': 1 } } } } }),
    }).catch(() => null);
    if (r?.ok) n++;
  }
  return n;
}
