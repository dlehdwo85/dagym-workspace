// V30 ② 공지 + 읽음 확인: 대상(전체/팀/사람)에게만 보이고 알림, 열면 읽음, 작성자·관리자는 읽음 현황, 안 읽은 사람 다시 알림(하루 1번), 예약 게시(정기 실행), 쓰기 권한(직원 403), 다른 회사 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, Client } from '../helpers.mjs';

let srv, ctx, sql, other, teamId;
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  teamId = (await ctx.owner.ok('POST', '/api/teams', { name: '강남 운영팀', kind: 'dept', members: [{ userId: ctx.staffA.id, lead: true }, { userId: ctx.managerA.id, lead: false }] })).id;
  other = new Client('other');
  const r = await other.ok('POST', '/api/auth/signup', { email: 'n@other.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼짐', industry: '운동·피트니스', agree: { terms: true, privacy: true, ai: true } });
  await other.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const notif = (uid, like) => sql`select title, link from notifications where user_id = ${uid} and type = 'announcement' and title like ${like} order by created_at desc`;

describe('V30 ② 공지', () => {
  let all, team, pick;
  test('전체 공지: 모두에게 알림(작성자 제외), 목록·안 읽음 수·홈 카드, 직원은 쓰기 403', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/notices', { title: '직원 공지', body: 'x' })).status, 403, '직원은 기본 쓰기 없음');
    all = (await ctx.owner.ok('POST', '/api/notices', { title: '10월 전체 회의', body: '10/25 오전 10시 본사 회의실', important: true, pinned: true })).id;
    assert.equal((await notif(ctx.staffA.id, '%10월 전체 회의%')).length, 1); assert.equal((await notif(ctx.staffB.id, '%10월 전체 회의%')).length, 1);
    assert.equal((await notif(ctx.ownerId, '%10월 전체 회의%')).length, 0, '작성자에게는 안 감');
    assert.match((await notif(ctx.staffA.id, '%10월 전체 회의%'))[0].title, /^\[중요\] 공지:/);
    const l = await ctx.staffA.client.ok('GET', '/api/notices');
    assert.deepEqual([l.unread, l.canWrite, l.notices[0].title, l.notices[0].read, l.notices[0].pinned], [1, false, '10월 전체 회의', false, true]);
    const home = await ctx.staffA.client.ok('GET', '/api/notices?unread=1&limit=3');
    assert.deepEqual([home.unread, home.notices.length], [1, 1]);
    assert.equal((await other.req('GET', `/api/notices/${all}`)).status, 404, '다른 회사');
    assert.equal((await other.ok('GET', '/api/notices')).notices.length, 0);
  });
  test('팀 공지는 팀원에게만, 지정 공지는 그 사람에게만 · 부서장(팀 리더)은 쓸 수 있음', async () => {
    team = (await ctx.owner.ok('POST', '/api/notices', { title: '운영팀 주간 점검', body: '금요일', audience: { type: 'teams', ids: [teamId] } })).id;
    assert.equal((await notif(ctx.staffA.id, '%운영팀%')).length, 1); assert.equal((await notif(ctx.staffB.id, '%운영팀%')).length, 0, '다른 팀은 안 감');
    assert.equal((await ctx.staffB.client.req('GET', `/api/notices/${team}`)).status, 404, '대상 아니면 없는 것처럼');
    assert.equal((await ctx.staffA.client.ok('GET', `/api/notices/${team}?peek=1`)).notice.title, '운영팀 주간 점검');
    pick = (await ctx.owner.ok('POST', '/api/notices', { title: '박직원 개인 안내', body: '유니폼 수령', audience: { type: 'users', ids: [ctx.staffB.id] } })).id;
    assert.equal((await notif(ctx.staffB.id, '%박직원%')).length, 1); assert.equal((await notif(ctx.staffA.id, '%박직원%')).length, 0);
    assert.equal((await ctx.staffA.client.req('GET', `/api/notices/${pick}`)).status, 404);
    assert.equal((await ctx.owner.req('POST', '/api/notices', { title: 'x', audience: { type: 'teams', ids: [] } })).status, 400, '대상 비면 400');
    // 현장 관리자(site_manager)는 기본 쓰기 가능
    const m = await ctx.managerA.client.ok('POST', '/api/notices', { title: '매니저 공지', body: '청소 당번', audience: { type: 'teams', ids: [teamId] } });
    assert.ok(m.id);
  });
  test('열면 읽음 → 읽음 현황(작성자·관리자만) → 안 읽은 사람 다시 알림(하루 1번) · 직원은 현황 403', async () => {
    const before = await ctx.owner.ok('GET', `/api/notices/${all}/reads`);
    assert.deepEqual([before.read.length, before.unread.length, before.total], [0, 3, 3], '대상 = 직원 3명(작성자 제외)');
    await ctx.staffA.client.ok('GET', `/api/notices/${all}`); // 열면 읽음
    const after1 = await ctx.owner.ok('GET', `/api/notices/${all}/reads`);
    assert.deepEqual([after1.read.map((p) => p.name), after1.unread.map((p) => p.name).sort()], [['이직원'], ['박직원', '최매니저']]);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notices')).unread, 2, '전체 공지는 읽음, 팀 공지 2건(운영팀·매니저) 남음');
    assert.equal((await ctx.staffA.client.req('GET', `/api/notices/${all}/reads`)).status, 403);
    const r = await ctx.owner.ok('POST', `/api/notices/${all}/remind`, {});
    assert.equal(r.notified, 2, '안 읽은 2명에게만');
    assert.equal((await notif(ctx.staffB.id, '[다시 알림]%전체 회의%')).length, 1); assert.equal((await notif(ctx.staffA.id, '[다시 알림]%')).length, 0, '읽은 사람은 안 감');
    assert.equal((await ctx.owner.req('POST', `/api/notices/${all}/remind`, {})).status, 400, '하루 1번');
    assert.equal((await ctx.owner.ok('GET', `/api/notices/${all}/reads`)).remindCount, 1);
    await ctx.staffB.client.ok('POST', `/api/notices/${all}/read`, {});
    assert.equal((await ctx.owner.ok('GET', `/api/notices/${all}/reads`)).read.length, 2);
  });
  test('예약 게시: 시각 전에는 작성자만 보고 알림 없음 → 정기 실행이 시각에 게시·알림 · 고치기·지우기는 작성자·관리자', async () => {
    const at = new Date(Date.now() + 3600_000).toISOString();
    const s = await ctx.owner.ok('POST', '/api/notices', { title: '내일 휴무 안내', body: '정기 휴무', publishAt: at });
    assert.equal(s.scheduled, true);
    assert.equal((await notif(ctx.staffA.id, '%휴무%')).length, 0, '아직 알림 없음');
    assert.equal((await ctx.staffA.client.req('GET', `/api/notices/${s.id}`)).status, 404, '게시 전엔 안 보임');
    assert.equal((await ctx.owner.ok('GET', `/api/notices/${s.id}`)).notice.published, false);
    await sql`update announcements set publish_at = now() - interval '1 minute' where id = ${s.id}`;
    const t = await tick();
    assert.equal(t.detail.notices.published, 1);
    assert.equal((await notif(ctx.staffA.id, '%휴무%')).length, 1); assert.equal((await ctx.staffA.client.ok('GET', `/api/notices/${s.id}?peek=1`)).notice.published, true);
    assert.equal((await tick()).detail.notices.published, 0);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/notices/${s.id}`, { title: '바꿈' })).status, 403);
    await ctx.owner.ok('PATCH', `/api/notices/${s.id}`, { title: '내일 휴무 안내(수정)', important: true });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/notices/${s.id}?peek=1`)).notice.title, '내일 휴무 안내(수정)');
    assert.equal((await ctx.staffA.client.req('DELETE', `/api/notices/${s.id}`)).status, 403);
    await ctx.owner.ok('DELETE', `/api/notices/${s.id}`);
    assert.equal((await ctx.staffA.client.req('GET', `/api/notices/${s.id}`)).status, 404);
    const prefs = await ctx.owner.ok('GET', '/api/notifications/prefs');
    assert.ok(prefs.types.some((x) => x.type === 'announcement'));
  });
});
