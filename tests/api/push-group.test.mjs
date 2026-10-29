// #542 같은 종류·같은 시각 알림 묶기(로컬 10/24, 대표 휴대폰 캡처 '승인 마감 6시간 전: …' 6개·'시안을 붙여 다시 올렸습니다(v2)' 여러 개):
// 마케팅·영업 '머리: 항목' 알림은 알림 목록에는 한 줄씩 그대로, 휴대폰 푸시는 한 번에 나가는 것끼리 1건 — '승인 마감 72시간 전 3건: A 외 2건'(링크 = 승인함, 버튼 없음)
// · 정기 실행이 만든 것은 실행 끝 발송에서 한꺼번에(실행 중에는 요청 뒤 발송이 묶음 알림을 남겨 둠 — 중간에 갈라지지 않게)
// · data.group = 묶음(1.1.3 앱이 같은 묶음을 접음) · tag = 묶음+날짜(1.1.2 시스템 알림·웹은 앞 알림을 바꿈) · 업무 알림 등 다른 종류는 예전처럼
// 가짜 FCM 구조 시험 — 실제 휴대폰에서 묶여 보이는지는 로컬이 실기기에서 확인(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FAKE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, sql, ctx, fake;
const state = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const G = 'marketing:승인 마감 72시간 전';
const TOKEN = 'fcm-group-owner';
const sentGroup = async () => (await state()).fcm.filter((m) => m.token === TOKEN && m.data?.group === G);
/** 정기 실행을 돌려 가며 묶음 푸시가 n건이 될 때까지 기다림 */
async function flush(n) {
  for (let i = 0; i < 30; i++) { await tick(); if ((await sentGroup()).length >= n) return sentGroup(); await new Promise((r) => setTimeout(r, 300)); }
  const dbg = await sql`select d.status, d.error, d.attempts, d.next_attempt_at, d.channel, n.meta->>'group' as g from notification_deliveries d join notifications n on n.id = d.notification_id order by d.id`;
  const st = (await state()).fcm.map((m) => [m.token, m.data?.group, m.notification?.title]);
  throw new Error(`묶음 푸시 ${n}건이 오지 않음: ${(await sentGroup()).length}건 ${JSON.stringify(dbg)} ${JSON.stringify(st)}`);
}
/** 승인 대기 자동 글(시안 붙음 — 정기 실행이 다시 그리지 않게) · 이틀 뒤 게시 = 72시간 전 알림 시각이 지남 */
async function pending(title) {
  const [c] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values ('default', ${title}, 'instagram', 'feed', now() + interval '2 days', 'pending', 1, ${ctx.ownerId}, true, now(), '{"passed": true, "issues": []}') returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${title}, ${[randomUUID()]}, 'AI 자동 제작', ${ctx.ownerId})`;
  return c.id;
}

before(async () => { fake = await startFakeGoogle(); await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('승인 마감 알림 3건(같은 정기 실행) → 목록은 3줄 · 푸시는 실행 끝에 1건 요약(승인함·버튼 없음·group·묶음+날짜 tag) · 다음 건은 같은 tag 로 바꿈 · 읽은 것은 요약에서 빠짐 · 업무 알림은 예전처럼', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', remindHours: 72, approvalHour: 9, quietStart: 0, quietEnd: 0 });
  await ctx.owner.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: TOKEN, platform: 'android' }); // 1.1.2(caps 없음) = 시스템 알림
  for (const t of ['퇴근길 운동', '주말 필라테스', '가을 회원 모집']) await pending(t);
  // 정기 실행이 도는 중(잠금) — 그동안 요청 뒤 발송은 묶음 알림을 남겨 두고, 다른 알림(업무 배정)은 예전처럼 바로 보냄
  await sql`insert into job_locks (name, locked_until, holder) values ('tick', now() + interval '4 minutes', 'push-group-test')
    on conflict (name) do update set locked_until = excluded.locked_until, holder = excluded.holder`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const list = await sql`select title, meta->>'group' as g from notifications where user_id = ${ctx.ownerId} and title like '승인 마감 72시간 전:%' order by created_at`;
  assert.deepEqual(list.map((n) => [n.title, n.g]), ['퇴근길 운동', '주말 필라테스', '가을 회원 모집'].map((t) => [`승인 마감 72시간 전: ${t}`, G]), '알림 목록에는 한 줄씩');
  const t = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '묶음 아닌 업무 알림', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  let task;
  for (let i = 0; i < 30 && !task; i++) { task = (await state()).fcm.find((x) => x.token === TOKEN && x.data?.link === `/tasks/${t}`); if (!task) await new Promise((r) => setTimeout(r, 300)); }
  assert.ok(task, '업무 알림 푸시(정기 실행 중에도 바로)');
  assert.deepEqual([task.data.group, task.android.notification.tag], ['task_assigned', task.data.notificationId], '묶음 아닌 알림: group = 종류, tag = 알림 id');
  const held = await sql`select d.status, d.attempts from notification_deliveries d join notifications n on n.id = d.notification_id where n.meta->>'group' = ${G}`;
  assert.deepEqual(held.map((d) => [d.status, d.attempts]), [['pending', 0], ['pending', 0], ['pending', 0]], '묶음 알림은 정기 실행 끝까지 남겨 둠');
  assert.equal((await sentGroup()).length, 0);
  await sql`delete from job_locks where name = 'tick' and holder = 'push-group-test'`;
  const [m, ...more] = await flush(1);
  assert.equal(more.length, 0, '푸시는 1건');
  assert.deepEqual([m.notification.title, m.data.link, m.android.notification.tag, m.data.actions], ['승인 마감 72시간 전 3건: 퇴근길 운동 외 2건', '/s/marketing/approvals', `${G}:${day}`, JSON.stringify([{ id: 'ack', label: '확인' }, { id: 'view', label: '열기', open: true }])]); // 184차 #676: 묶음 푸시도 [확인](묶음 전체 읽음)·[열기]
  assert.equal(m.apns.payload.aps.category, 'wn.ack.view', 'iOS 는 이미 등록된 [확인][열기] 묶음');
  assert.equal(m.notification.body, '· 퇴근길 운동\n· 주말 필라테스\n· 가을 회원 모집');
  const st = await sql`select d.status, d.error from notification_deliveries d join notifications n on n.id = d.notification_id where n.meta->>'group' = ${G} order by d.id`;
  assert.deepEqual(st.map((d) => d.status).sort(), ['sent', 'skipped', 'skipped']);
  assert.ok(st.filter((d) => d.status === 'skipped').every((d) => d.error === '묶어서 보냄'));
  // 다음 정기 실행에서 1건 더 → 그날 안 읽은 같은 묶음 4건 요약, 같은 tag(1.1.2·웹은 앞 알림을 바꿈)
  await pending('겨울 PT 할인');
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const all = await flush(2);
  assert.equal(all.length, 2);
  assert.deepEqual([all[1].notification.title, all[1].android.notification.tag], ['승인 마감 72시간 전 4건: 퇴근길 운동 외 3건', `${G}:${day}`]);
  // 다 읽은 뒤 새 1건 → 요약 아님(제목·글 링크·버튼 그대로), tag 는 같은 묶음+날짜
  const ids = (await sql`select id from notifications where user_id = ${ctx.ownerId} and meta->>'group' = ${G}`).map((r) => r.id);
  await ctx.owner.ok('POST', '/api/notifications/read', { ids });
  const last = await pending('설 연휴 운영 안내');
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const one = (await flush(3)).at(-1);
  assert.deepEqual([one.notification.title, one.data.link, one.android.notification.tag], ['승인 마감 72시간 전: 설 연휴 운영 안내', `/s/marketing/approvals?c=${last}`, `${G}:${day}`]);
  assert.notEqual(one.data.actions, JSON.stringify([{ id: 'ack', label: '확인' }, { id: 'view', label: '열기', open: true }]), '한 건이면 그 알림 종류의 버튼(승인함 열기 등)');
});
