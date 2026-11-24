// D-18(위치기반서비스 신고 전 대비, 로컬 11/24): ATTENDANCE_LOCATION_ONLY 에 든 회사만 출퇴근 위치를 받음.
// 목록 밖 회사: 위치 동의를 묻지 않고, 좌표를 보내와도 저장하지 않음(시각만) · 목록 안(우리 회사)은 지금처럼 동의 → 위치 저장
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', ATTENDANCE_LOCATION_ONLY: 'default' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@loc-d18.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@loc-d18.test', password: 'signup-pass-1234', name: '위대표', mode: 'team', company: '위치상사', industry: '운동·피트니스', industries: ['운동·피트니스'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('목록 밖 회사는 위치 없이 시각만 · 우리 회사는 지금처럼 동의 → 위치 저장', async () => {
  const v = await T.c.ok('GET', '/api/attendance');
  assert.equal(v.location, false);
  await T.c.ok('POST', '/api/attendance', { type: 'in', lat: 37.5665, lng: 126.978, accuracy: 10 }); // 동의 없이도 됨(묻지 않음)
  const [a] = await sql`select in_at, in_lat, in_lng from attendance where user_id = ${T.id} and day = ${seoulToday()}`;
  assert.ok(a.in_at); assert.deepEqual([a.in_lat, a.in_lng], [null, null], '좌표를 저장하지 않음');
  assert.equal((await sql`select location_consent_at from user_settings where user_id = ${T.id}`)[0]?.location_consent_at ?? null, null, '동의 기록도 만들지 않음');

  const o = await ctx.owner.ok('GET', '/api/attendance');
  assert.equal(o.location, true);
  const no = await ctx.owner.req('POST', '/api/attendance', { type: 'in', lat: 37.5665, lng: 126.978, accuracy: 10 });
  assert.equal(no.status, 400, '우리 회사는 지금처럼 위치 동의 필요');
  await ctx.owner.ok('POST', '/api/attendance', { type: 'in', lat: 37.5665, lng: 126.978, accuracy: 10, consent: true });
  const [b] = await sql`select in_lat from attendance where user_id = ${ctx.ownerId} and day = ${seoulToday()}`;
  assert.ok(b.in_lat, '우리 회사는 위치 저장');
});
