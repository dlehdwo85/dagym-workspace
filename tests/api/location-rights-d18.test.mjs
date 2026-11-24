// D-18 ①(대표 11/24 승인 — 위치기반서비스사업 신고 준비): 위치정보 이용·제공 사실 확인자료 · 동의 철회(좌표 바로 파기) · 6개월 지난 좌표 파기 · 본인 열람
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, seoulToday, BASE } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('동의·수집·제공 기록(하루 한 줄) · 본인 열람 · 동의 철회 = 좌표 파기 · 6개월 지난 좌표 파기 · 약관 화면', async () => {
  const staff = ctx.staffA.client, sid = ctx.staffA.id;
  await ctx.owner.ok('POST', '/api/attendance/sites', { name: '본사', lat: 37.5665, lng: 126.978, radiusM: 200 }).catch(() => null);
  await staff.ok('POST', '/api/attendance', { type: 'in', lat: 37.5665, lng: 126.978, accuracy: 10, consent: true });
  const kinds = async () => (await sql`select kind from location_logs where subject_user_id = ${sid} order by id`).map((x) => x.kind);
  assert.deepEqual(await kinds(), ['consent', 'collect']);
  const [enc] = await sql`select in_lat, in_loc_enc from attendance where user_id = ${sid}`;
  assert.ok(enc.in_loc_enc?.startsWith('v1.') && enc.in_lat === null, 'D-18 ③ 좌표는 암호화 칸에만');
  assert.equal((await sql`select detail from location_logs where kind = 'collect' and subject_user_id = ${sid}`)[0].detail.lat, undefined, '좌표 값은 남기지 않음');
  // 관리자 표 = 제공(사람마다 하루 한 줄)
  await ctx.owner.ok('GET', `/api/attendance/sheet?day=${seoulToday()}`);
  await ctx.owner.ok('GET', `/api/attendance/sheet?day=${seoulToday()}`);
  const prov = await sql`select viewer_user_id from location_logs where kind = 'provide' and subject_user_id = ${sid}`;
  assert.equal(prov.length, 1); assert.equal(prov[0].viewer_user_id, ctx.ownerId);
  // 본인 열람
  const me = await staff.ok('GET', '/api/attendance/location');
  assert.equal(me.consent, true);
  assert.ok(me.logs.some((l) => l.kind === 'provide' && l.viewer), '누가 봤는지');
  // 동의 철회 → 좌표 파기 · 다음 출퇴근은 다시 동의 필요
  const w = await staff.ok('POST', '/api/attendance/location', { withdraw: true });
  assert.equal(w.purged, 1);
  const [a] = await sql`select in_lat, in_lng, in_loc_enc, in_at from attendance where user_id = ${sid}`;
  assert.deepEqual([a.in_lat, a.in_lng, a.in_loc_enc], [null, null, null]); assert.ok(a.in_at, '시각은 남음');
  assert.equal((await staff.ok('GET', '/api/attendance/location')).consent, false);
  assert.equal((await staff.req('POST', '/api/attendance', { type: 'out', lat: 37.5665, lng: 126.978, accuracy: 10 })).status, 400, '철회 뒤에는 다시 동의해야 위치를 받음');
  assert.ok((await kinds()).includes('withdraw'));
  // 6개월 지난 좌표 파기(정기 실행) · 1년 지난 확인자료 삭제
  await sql`insert into attendance (tenant, user_id, day, in_at, in_lat, in_lng) values ('default', ${ctx.ownerId}, (now() at time zone 'Asia/Seoul')::date - interval '200 days', now() - interval '200 days', 37.1, 127.1)`;
  await sql`insert into location_logs (tenant, subject_user_id, kind, created_at) values ('default', ${ctx.ownerId}, 'collect', now() - interval '400 days')`;
  await tick();
  const [old] = await sql`select in_lat, in_loc_enc from attendance where user_id = ${ctx.ownerId} and day < current_date - 100`;
  assert.deepEqual([old.in_lat, old.in_loc_enc], [null, null], '6개월 지난 좌표 파기(예전 평문을 암호화로 옮긴 뒤에도)');
  assert.equal((await sql`select count(*)::int n from location_logs where created_at < now() - interval '1 year'`)[0].n, 0, '1년 지난 확인자료 삭제');
  assert.equal((await sql`select count(*)::int n from location_logs where kind = 'purge'`)[0].n >= 1, true);
  // 약관 화면(로그인 없이)
  const page = await fetch(`${BASE}/lbs-terms`).then((r) => r.text());
  assert.match(page, /위치기반서비스 이용약관/); assert.match(page, /좌표는 6개월 보관한 뒤 지우고/);
});
