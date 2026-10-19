// 로컬 10/19(대표) 자동 로그인: 웹 '로그인 유지'(30일 갱신형, Max-Age 쿠키) / 끄면 세션 쿠키(Max-Age 없음)·1일·갱신 없음, 앱은 항상 유지,
// 기기 목록에서 그 기기만 원격 로그아웃(지금 기기는 400), 비밀번호 변경·관리자 비활성화 = 모든 기기 만료
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const cookieOf = (r) => (r.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('wos_session=')) ?? '';

test('로그인 유지 켬/끔·앱 항상 유지·갱신·기기별 로그아웃·비밀번호 변경 전체 만료', async () => {
  const email = ctx.staffA.email, password = ctx.staffA.password;
  const [{ password_hash }] = await sql`select password_hash from users where id = ${ctx.staffA.id}`;
  assert.ok(password_hash, '시험 계정 비밀번호 있음');
  const off = new Client('off'); const r1 = await off.req('POST', '/api/auth/login', { email, password, remember: false });
  assert.equal(r1.status, 200);
  assert.ok(!/max-age=/i.test(cookieOf(r1)), `로그인 유지 끔 = 세션 쿠키: ${cookieOf(r1)}`);
  const on = new Client('on'); const r2 = await on.req('POST', '/api/auth/login', { email, password });
  assert.match(cookieOf(r2), /Max-Age=2592000/i, '기본 = 30일');
  const app = new Client('app'); const r3 = await app.req('POST', '/api/auth/login', { email, password, client: 'android', remember: false });
  assert.match(cookieOf(r3), /Max-Age=2592000/i, '앱은 끄기를 보내도 항상 유지');
  const sessions = await sql`select id, client, persistent, expires_at from sessions where user_id = ${ctx.staffA.id} and revoked_at is null order by created_at`;
  const [sOff, sOn, sApp] = sessions.slice(-3);
  assert.deepEqual([sOff.persistent, sOn.persistent, sApp.persistent], [false, true, true]);
  assert.ok(new Date(sOff.expires_at) - Date.now() < 2 * 86400e3 && new Date(sOn.expires_at) - Date.now() > 29 * 86400e3, '끄면 1일·켜면 30일');
  // 갱신: 이틀 전 마지막 사용으로 두고 다시 쓰면 켠 쪽만 30일 연장
  await sql`update sessions set last_seen_at = now() - interval '2 days', expires_at = now() + interval '10 days' where id in (${sOff.id}, ${sOn.id})`;
  await off.ok('GET', '/api/auth/me'); await on.ok('GET', '/api/auth/me');
  const after2 = Object.fromEntries((await sql`select id, expires_at from sessions where id in (${sOff.id}, ${sOn.id})`).map((x) => [x.id, new Date(x.expires_at) - Date.now()]));
  assert.ok(after2[sOn.id] > 29 * 86400e3, '유지 세션은 연장');
  assert.ok(after2[sOff.id] < 11 * 86400e3, '끈 세션은 연장 없음');
  // 기기 목록·기기별 로그아웃
  const list = (await on.ok('GET', '/api/auth/sessions')).sessions;
  assert.ok(list.length >= 3 && list.some((x) => x.current));
  const mine = list.find((x) => x.current), other = list.find((x) => x.id === sOff.id.slice(0, 8));
  assert.equal((await on.req('DELETE', `/api/auth/sessions/${mine.id}`)).status, 400, '지금 기기는 못 끊음');
  assert.equal((await on.ok('DELETE', `/api/auth/sessions/${other.id}`)).revoked, 1);
  assert.equal((await off.get('/api/auth/me')).status, 401, '끊긴 기기는 바로 로그아웃');
  assert.equal((await on.req('DELETE', `/api/auth/sessions/${other.id}`)).status, 404, '이미 끊김');
  assert.equal((await app.get('/api/auth/me')).status, 200);
  // 관리자 비활성화 = 모든 기기 만료
  await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.staffA.id}`, { status: 'disabled' });
  assert.equal((await app.get('/api/auth/me')).status, 401);
  assert.equal((await on.get('/api/auth/me')).status, 401);
});
