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

// #618(대표 10/25) 모든 푸시 알림 [확인](읽음 + 지움) + 종류별 1개: 일정 [10분 뒤] · 마감 [완료](담당자만) · 승인 대기 [승인함 열기](서버 처리 없이 열기)
// 가짜 FCM 으로 본 payload·카테고리 구조 시험 — 실제 휴대폰 버튼 표시·iOS 카테고리 등록(앱 재시작 뒤)은 로컬이 실기기에서 확인
test('#618 [확인] 모든 알림 · 마감은 [확인]만(대표 10/25 15-13: [완료] 없음) · 일정 [10분 뒤] · 승인 대기 [승인함 열기] · 웹 목록은 안 읽은 줄이면 [확인]만이어도 보임(184차 #676)', async () => {
  // 기기: staffA 1.1.3 안드로이드(data 전용) · owner 아이폰(카테고리)
  const delivery = async (nid, endpoint) => {
    const [s] = await sql`select id from push_subscriptions where endpoint = ${endpoint}`;
    await sql`insert into notification_deliveries (notification_id, subscription_id, channel, status, next_attempt_at) values (${nid}, ${s.id}, 'fcm', 'pending', now()) on conflict do nothing`;
  };
  // 같은 업무 링크로 배정 푸시(task_assigned)도 가므로 알림 id 로 찾는다
  const sentFor = async (token, nid) => { for (let i = 0; i < 30; i++) { const m = (await state()).fcm.find((x) => x.token === token && x.data?.notificationId === nid); if (m) return m; await tick(); await new Promise((r) => setTimeout(r, 300)); } throw new Error(`FCM 이 오지 않음: ${token} ${nid}`); };
  const insert = async (userId, row) => (await sql`insert into notifications (user_id, type, title, body, link, entity_type, entity_id, meta, dedupe_key)
    values (${userId}, ${row.type}, ${row.title}, ${row.body ?? ''}, ${row.link}, ${row.entityType ?? null}, ${row.entityId ?? null}, ${sql.json(row.meta ?? {})}, ${`t618:${row.type}:${Math.random()}`}) returning id`)[0].id;
  // ① 마감 알림(담당자 staffA) → [확인][완료] · 요청자(owner)에게 간 '[요청] 마감' → [확인]만(task_mine=false)
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '마감 버튼 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  const nDue = await insert(ctx.staffA.id, { type: 'due_soon', title: '오늘 마감: 마감 버튼 시험 업무', link: `/tasks/${t}`, entityType: 'task', entityId: t, meta: { kind: 'due' } });
  await delivery(nDue, 'fcm-new-staffA');
  const nReq = await insert(ctx.ownerId, { type: 'due_soon', title: '[요청] 마감 임박: 마감 버튼 시험 업무', link: `/tasks/${t}`, entityType: 'task', entityId: t, meta: { kind: 'due' } });
  await delivery(nReq, 'fcm-ios-owner');
  // ② 일정 알림(알람 아님) → [확인][10분 뒤] · ③ 승인 대기(마케팅, 업무 아님) → [확인][승인함 열기] · ④ 공지 → [확인]만
  const nEv = await insert(ctx.staffA.id, { type: 'event_reminder', title: '일정 30분 전: 버튼 시험 회의', link: '/calendar', entityType: 'event', meta: { kind: 'event' } });
  await delivery(nEv, 'fcm-new-staffA');
  const nAp = await insert(ctx.ownerId, { type: 'review_requested', title: 'AI 마케터 승인 요청 1건: 버튼 시험', link: '/s/marketing/approvals?tab=proposals', meta: { approval: true } });
  await delivery(nAp, 'fcm-ios-owner');
  const nAn = await insert(ctx.staffA.id, { type: 'announcement', title: '공지 버튼 시험', link: '/announcements' });
  await delivery(nAn, 'fcm-new-staffA');
  const mDue = await sentFor('fcm-new-staffA', nDue);
  assert.deepEqual(JSON.parse(mDue.data.actions).map((a) => [a.id, a.label]), [['ack', '확인']], '마감 알림 = [확인]만(15-13: 알람형은 [해제][10분 뒤])');
  const mReq = await sentFor('fcm-ios-owner', nReq);
  assert.deepEqual([JSON.parse(mReq.data.actions).map((a) => a.id), mReq.apns.payload.aps.category], [['ack'], 'wn.ack'], '요청자에게 간 마감 알림은 [확인]만');
  const mEv = await sentFor('fcm-new-staffA', nEv);
  assert.deepEqual(JSON.parse(mEv.data.actions).map((a) => [a.id, a.label]), [['ack', '확인'], ['snooze', '10분 뒤']], '일정 = [확인][10분 뒤]');
  const mAp = await sentFor('fcm-ios-owner', nAp);
  assert.deepEqual([JSON.parse(mAp.data.actions).map((a) => [a.id, a.label, a.open]), mAp.apns.payload.aps.category], [[['ack', '확인', undefined], ['open', '승인함 열기', true]], 'wn.ack.open'], '승인 대기 = [확인][승인함 열기](open 표시)');
  const mAn = await sentFor('fcm-new-staffA', nAn);
  assert.deepEqual(JSON.parse(mAn.data.actions).map((a) => a.id), ['ack'], '그 밖의 알림도 [확인]');
  // 웹 알림 목록(184차 #676 대표 결정): 안 읽은 줄은 [확인]만 있어도 보임(읽은 뒤에는 숨김 — fixes-184 시험), 2개짜리는 그대로
  const list = await ctx.staffA.client.ok('GET', '/api/notifications');
  const row = (id) => list.items.find((x) => x.id === id);
  assert.deepEqual([row(nAn).actions.map((a) => a.id), row(nDue).actions.map((a) => a.id), row(nEv).actions.map((a) => a.id)], [['ack'], ['ack'], ['ack', 'snooze']]);
  // 대표 10/25 15-13: 마감 알림에 [완료]는 없음 → 서버로 보내면 400(업무는 그대로) · [확인]은 읽음 처리
  assert.equal((await ctx.staffA.client.req('POST', `/api/notifications/${nDue}/action`, { action: 'done' })).status, 400);
  assert.notEqual((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.status, 'done', '업무는 완료되지 않음');
  assert.equal((await ctx.staffA.client.ok('POST', `/api/notifications/${nDue}/action`, { action: 'ack' })).label, '확인함');
  const [afterDue] = await sql`select read_at from notifications where id = ${nDue}`;
  assert.ok(afterDue.read_at, '[확인] = 읽음');
  // 요청자는 [완료] 못 함(버튼에 없음 → 400) · [확인]은 됨
  assert.equal((await ctx.owner.req('POST', `/api/notifications/${nReq}/action`, { action: 'done' })).status, 400);
  assert.equal((await ctx.owner.ok('POST', `/api/notifications/${nReq}/action`, { action: 'ack' })).label, '확인함');
  // [승인함 열기]를 옛 안드로이드 앱이 서버로 보내면: 읽음 표시 + 400 '눌러서 승인함을 열어 주세요'(처리 표시는 안 남음)
  const open = await ctx.owner.req('POST', `/api/notifications/${nAp}/action`, { action: 'open' });
  assert.equal(open.status, 400);
  assert.match(open.body.error.message, /눌러서 승인함을 열어 주세요/);
  const [afterAp] = await sql`select action_done, read_at from notifications where id = ${nAp}`;
  assert.ok(!afterAp.action_done && afterAp.read_at, '열기는 읽음만');
  // 일정 [10분 뒤] → 10분 뒤 다시 푸시(처리 표시 없음)
  const sn = await ctx.staffA.client.ok('POST', `/api/notifications/${nEv}/action`, { action: 'snooze' });
  assert.equal(sn.label, '10분 뒤 다시 알림');
  const [d2] = await sql`select count(*)::int n from notification_deliveries where notification_id = ${nEv} and status = 'pending' and next_attempt_at > now() + interval '8 minutes'`;
  assert.equal(d2.n, 1, '10분 뒤 발송 예약');
});
