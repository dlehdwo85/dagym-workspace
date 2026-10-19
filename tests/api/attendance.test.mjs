// V30 ③ 간이 근태: 위치 동의(처음 1번) → [출근]/[퇴근] + 현장 반경 안/밖(밖이면 사유 필수), 중복·순서 400, 관리자 표(지각·미기록·연차)·월 요약·엑셀, 현장·설정 권한, 근무 상태 점(출근 전/퇴근), 기능 끄기
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, addDays, seoulToday } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const GANGNAM = { lat: 37.4979, lng: 127.0276 };
const today = seoulToday();

describe('V30 ③ 출퇴근', () => {
  let siteId;
  test('현장 등록은 관리자(근태 관리 편집)만 · 직원은 목록만(편집 불가)', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/attendance/sites', { name: '강남점', ...GANGNAM, radiusM: 150 })).status, 403);
    siteId = (await ctx.owner.ok('POST', '/api/attendance/sites', { name: '강남점', address: '서울 강남구', ...GANGNAM, radiusM: 150 })).id;
    const l = await ctx.staffA.client.ok('GET', '/api/attendance/sites');
    assert.deepEqual([l.sites.length, l.canEdit, l.settings.on, l.settings.workStart], [1, false, true, '09:00']);
    assert.equal((await ctx.owner.req('POST', '/api/attendance/sites', { name: 'x', lat: 1, lng: 2, radiusM: 10 })).status, 400, '반경 30m 미만');
  });
  test('위치 동의 없으면 400 consent → 동의하고 출근(현장 안) · 같은 날 두 번 출근 400 · 퇴근 전 상태 · 근무 상태 점', async () => {
    const me = await ctx.staffA.client.ok('GET', '/api/attendance');
    assert.deepEqual([me.on, me.consent, me.sites, me.today], [true, false, 1, null]);
    const noc = await ctx.staffA.client.req('POST', '/api/attendance', { type: 'in', lat: GANGNAM.lat, lng: GANGNAM.lng });
    assert.deepEqual([noc.status, noc.body.error.code], [400, 'consent']);
    const pres0 = await ctx.owner.ok('GET', '/api/people/presence');
    assert.equal(pres0.people[ctx.staffA.id]?.s, 'before', '현장 등록된 회사: 출근 전 빈 점');
    const r = await ctx.staffA.client.ok('POST', '/api/attendance', { type: 'in', lat: GANGNAM.lat + 0.0003, lng: GANGNAM.lng, accuracy: 20, consent: true });
    assert.deepEqual([r.today.inSite, r.today.inInside, r.nearest.name, r.today.inReason], ['강남점', true, '강남점', null]);
    assert.ok(r.nearest.distance < 150);
    assert.equal((await ctx.staffA.client.req('POST', '/api/attendance', { type: 'in', lat: GANGNAM.lat, lng: GANGNAM.lng })).status, 400, '두 번 출근');
    assert.equal((await ctx.owner.ok('GET', '/api/people/presence')).people[ctx.staffA.id], undefined, '출근 중 = 근무 중(점 없음)');
    assert.equal((await sql`select location_consent_at from user_settings where user_id = ${ctx.staffA.id}`)[0].location_consent_at !== null, true);
  });
  test('현장 밖은 사유 필수(400 outside + 가장 가까운 현장) → 사유 넣으면 퇴근 기록 · 퇴근 뒤 점 · 퇴근 먼저 400', async () => {
    assert.equal((await ctx.staffB.client.req('POST', '/api/attendance', { type: 'out', noLocation: true })).status, 400, '출근 없이 퇴근');
    const far = await ctx.staffA.client.req('POST', '/api/attendance', { type: 'out', lat: 37.3948, lng: 127.1112 }); // 판교
    assert.deepEqual([far.status, far.body.error.code, far.body.error.detail.nearest.name], [400, 'outside', '강남점']);
    assert.ok(far.body.error.detail.nearest.distance > 10000);
    const r = await ctx.staffA.client.ok('POST', '/api/attendance', { type: 'out', lat: 37.3948, lng: 127.1112, reason: '판교 현장 외근 후 퇴근' });
    assert.deepEqual([r.today.outInside, r.today.outReason, r.today.outSite], [false, '판교 현장 외근 후 퇴근', '강남점']);
    assert.equal((await ctx.owner.ok('GET', '/api/people/presence')).people[ctx.staffA.id]?.s, 'done');
    assert.equal((await ctx.staffA.client.req('POST', '/api/attendance', { type: 'out', noLocation: true })).status, 400, '두 번 퇴근');
    // 위치 권한 거부: 동의 없이도 위치 없이 기록(사유 '위치 없음')
    const nl = await ctx.staffB.client.ok('POST', '/api/attendance', { type: 'in', noLocation: true });
    assert.deepEqual([nl.today.inSite, nl.today.inInside, nl.today.inReason], [null, null, '위치 없음']);
  });
  test('관리자 표: 날짜별(지각·미기록·연차)·월 요약·엑셀 · 직원 403 · 지각 기준 변경', async () => {
    assert.equal((await ctx.staffA.client.req('GET', `/api/attendance/sheet?day=${today}`)).status, 403);
    // 최매니저 연차(오늘) → 표에 '연차', 미기록 아님
    const cals = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars;
    const mine = cals.find((c) => c.type === 'personal') ?? cals[0];
    await ctx.managerA.client.ok('POST', '/api/events', { calendarId: mine.id, title: '연차', kind: 'vacation', allDay: true, start: `${today}T00:00:00+09:00`, end: `${addDays(today, 1)}T00:00:00+09:00` });
    const d = await ctx.owner.ok('GET', `/api/attendance/sheet?day=${today}`);
    const a = d.rows.find((r) => r.id === ctx.staffA.id), b = d.rows.find((r) => r.id === ctx.staffB.id), m = d.rows.find((r) => r.id === ctx.managerA.id);
    assert.ok(a.inTime && a.outTime && a.outInside === false, JSON.stringify(a));
    assert.deepEqual([b.inTime !== null, b.inReason], [true, '위치 없음']);
    assert.equal(m.inTime, null); assert.deepEqual([m.away, m.missing], ['연차', false], '연차는 미기록 아님');
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date()));
    assert.equal(a.late, hour >= 9, '지각 = 출근 시각 > 09:00');
    await ctx.owner.ok('PUT', '/api/attendance/settings', { workStart: '23:59' });
    assert.equal((await ctx.owner.ok('GET', `/api/attendance/sheet?day=${today}`)).rows.find((r) => r.id === ctx.staffA.id).late, false, '기준 바꾸면 지각 아님');
    const mo = await ctx.owner.ok('GET', `/api/attendance/sheet?month=${today.slice(0, 7)}`);
    const ma = mo.rows.find((r) => r.id === ctx.staffA.id);
    assert.deepEqual([ma.present, ma.outside], [1, 1]); assert.ok(mo.days >= 0);
    const x = await fetch(`${BASE}/api/attendance/export?month=${today.slice(0, 7)}`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/); assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await fetch(`${BASE}/api/attendance/export`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE } })).status, 403);
    // 현장 관리자는 조회만
    assert.equal((await ctx.managerA.client.req('GET', `/api/attendance/sheet?day=${today}`)).status, 200);
    assert.equal((await ctx.managerA.client.req('PUT', '/api/attendance/settings', { workStart: '08:00' })).status, 403);
  });
  test('기능 끄기: 홈 카드 숨김·출근 400·근무 상태 점 없음 · 현장 지우기(사용 안 함)', async () => {
    await ctx.owner.ok('PUT', '/api/attendance/settings', { attendanceOn: false });
    assert.equal((await ctx.managerA.client.ok('GET', '/api/attendance')).on, false);
    assert.equal((await ctx.managerA.client.req('POST', '/api/attendance', { type: 'in', noLocation: true })).status, 400);
    assert.equal((await ctx.owner.ok('GET', '/api/people/presence')).people[ctx.staffB.id], undefined);
    await ctx.owner.ok('PUT', '/api/attendance/settings', { attendanceOn: true });
    await ctx.owner.ok('DELETE', `/api/attendance/sites/${siteId}`);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/attendance/sites')).sites.length, 0, '직원에겐 사용 안 함 현장 안 보임');
    assert.equal((await ctx.owner.ok('GET', '/api/attendance/sites')).sites[0].active, false);
    assert.equal((await ctx.owner.req('DELETE', `/api/attendance/sites/00000000-0000-0000-0000-000000000001`)).status, 404);
  });
});
