// 앱 1.1.3 알림창 버튼(#130·#478, 로컬 f10f7337): 기기(토큰)마다 caps 저장 → 'android-actions-1' 앱에는 notification 없이 data 만(wn=1·title·body·tag·channel·actions)
// — 앱이 꺼져 있어도 앱이 버튼 달린 알림을 직접 그림. 옛 앱(caps 없음)은 지금처럼 시스템 알림 · iOS 는 aps.category 'wn.*'(앱이 등록한 버튼 묶음) · 버튼 처리는 기존 /api/notifications/{id}/action
// 가짜 FCM 으로 본 구조 시험 — 실제 휴대폰 표시·버튼은 로컬이 실기기에서 확인(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, sql, ctx, fake;
const state = () => fetch(`${FAKE}/__state`).then((r) => r.json());
/** 그 토큰으로 간 FCM(그 업무 링크) — 바로 안 갔으면 정기 실행을 돌려 가며 기다림 */
async function sentTo(token, link) {
  for (let i = 0; i < 30; i++) {
    const m = (await state()).fcm.find((x) => x.token === token && x.data?.link === link);
    if (m) return m;
    await tick(); await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`FCM 이 오지 않음: ${token} ${link}`);
}

before(async () => { fake = await startFakeGoogle(); await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('caps 저장: 중복 정리 · 옛 앱으로 다시 등록하면 비움 · 형식 검사', async () => {
  await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-reset-staffA', platform: 'android', caps: ['android-actions-1', 'android-widget-1', 'android-actions-1'] });
  const caps = async () => (await sql`select caps from push_subscriptions where endpoint = 'fcm-reset-staffA'`)[0].caps;
  assert.deepEqual(await caps(), ['android-actions-1', 'android-widget-1']);
  await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-reset-staffA', platform: 'android' });
  assert.deepEqual(await caps(), [], '1.1.2 이하 앱(caps 없음)으로 다시 등록 → 예전 방식');
  assert.equal((await ctx.staffA.client.req('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-bad-caps', caps: ['x'.repeat(41)] })).status, 400);
  await ctx.staffA.client.ok('DELETE', '/api/push/subscribe', { endpoint: 'fcm-reset-staffA' });
});

test('1.1.3 앱(android-actions-1) = data 전용(앱이 버튼 그림) · 옛 앱 = 시스템 알림 · iOS = 버튼 묶음 카테고리 · 버튼 처리 결과 문구', async () => {
  await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-new-staffA', platform: 'android', caps: ['android-actions-1'] });
  await ctx.managerA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-old-managerA', platform: 'android' });
  await ctx.owner.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-ios-owner', platform: 'ios' });
  // 1.1.3 안드로이드: notification 없음 · data 에 wn=1·제목·본문·tag(=알림 id)·채널·버튼
  const t1 = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 버튼 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  const m1 = await sentTo('fcm-new-staffA', `/tasks/${t1}`);
  assert.equal(m1.notification, undefined, 'notification 이 있으면 앱이 꺼져 있을 때 시스템이 그려 버튼이 안 붙음');
  assert.deepEqual([m1.data.wn, m1.data.channel, m1.data.tag, m1.data.alarm], ['1', 'work', m1.data.notificationId, '']);
  assert.ok(m1.data.title && typeof m1.data.body === 'string', JSON.stringify(m1.data));
  assert.deepEqual(JSON.parse(m1.data.actions).map((a) => a.id), ['ack', 'today']);
  assert.deepEqual([m1.android.priority, m1.android.notification], ['HIGH', undefined]);
  assert.ok(Object.values(m1.data).every((v) => typeof v === 'string'), 'FCM data 값은 문자열만');
  // 옛 앱: 지금처럼 시스템 알림(채널·아이콘·tag)
  const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '옛 앱 알림 시험 업무', assigneeId: ctx.managerA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  const m2 = await sentTo('fcm-old-managerA', `/tasks/${t2}`);
  assert.ok(m2.notification?.title, '옛 앱은 시스템 알림');
  assert.deepEqual([m2.data.wn, m2.android.notification.channel_id, m2.android.notification.tag], [undefined, 'work', m2.data.notificationId]);
  // iOS: 버튼 묶음(카테고리) 'wn.ack.today' — 앱이 등록한 묶음(src/lib/notifCategories)
  const t3 = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '아이폰 알림 시험 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  const m3 = await sentTo('fcm-ios-owner', `/tasks/${t3}`);
  assert.equal(m3.apns.payload.aps.category, 'wn.ack.today');
  // 버튼(앱이 열리지 않은 채 /action) → 결과 문구(앱이 '✓ 확인함'으로 알림을 바꿈) · 다시 눌러도 같은 결과
  const r = await ctx.staffA.client.ok('POST', `/api/notifications/${m1.data.notificationId}/action`, { action: 'ack' });
  assert.equal(r.label, '확인함');
  const again = await ctx.staffA.client.ok('POST', `/api/notifications/${m1.data.notificationId}/action`, { action: 'ack' });
  assert.deepEqual([again.label, again.already], ['확인함', true]);
  assert.equal((await ctx.managerA.client.req('POST', `/api/notifications/${m1.data.notificationId}/action`, { action: 'ack' })).status, 404, '남의 알림 404');
});
