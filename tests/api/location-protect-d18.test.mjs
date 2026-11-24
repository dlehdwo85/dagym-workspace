// D-18 보호조치(로컬 11/24 위임): ③ 예전 평문 좌표 → 암호화 칸 · ④ 확인자료 고치기·1년 전 지우기 금지(트리거) + 매일 요약 해시 사슬
// ⑤⑥ 플랫폼 '위치정보 월 점검'(요약·자체 점검·[점검 완료] 기록) · 자체 점검 문제 = 플랫폼 운영자 알림
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, seoulToday } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('평문 좌표 옮기기 · 확인자료 고치기/지우기 금지 · 요약 해시 · 바뀌면 자체 점검이 잡음 · 월 점검 화면·기록', async () => {
  const sid = ctx.staffA.id;
  // ③ 예전 평문 좌표(어제) → 정기 실행이 암호화 칸으로
  await sql`insert into attendance (tenant, user_id, day, in_at, in_lat, in_lng) values ('default', ${sid}, (now() at time zone 'Asia/Seoul')::date - 1, now() - interval '1 day', 37.5, 127.0)`;
  // ④ 어제 날짜 확인자료 2줄
  for (const k of ['collect', 'provide']) await sql`insert into location_logs (tenant, subject_user_id, viewer_user_id, kind, day, created_at) values ('default', ${sid}, ${k === 'provide' ? ctx.ownerId : null}, ${k}, (now() at time zone 'Asia/Seoul')::date - 1, now() - interval '1 day')`;
  await tick();
  const [a] = await sql`select in_lat, in_lng, in_loc_enc from attendance where user_id = ${sid}`;
  assert.deepEqual([a.in_lat, a.in_lng], [null, null]); assert.ok(a.in_loc_enc?.startsWith('v1.'), '암호화 칸으로 옮김');
  const [dg] = await sql`select rows, digest from location_log_digests where day = (now() at time zone 'Asia/Seoul')::date - 1`;
  assert.ok(dg && dg.rows >= 2 && dg.digest.length === 64, '어제 요약 해시');

  // 트리거: 고치기·최근 기록 지우기 금지(정기 파기 표시가 있어도 1년 전만) · 계정 지움(null)은 허용
  const [row] = await sql`select id from location_logs where kind = 'provide' limit 1`;
  await assert.rejects(sql`update location_logs set kind = 'consent' where id = ${row.id}`, /고칠 수 없습니다/);
  await assert.rejects(sql`delete from location_logs where id = ${row.id}`, /지울 수 없습니다/);
  await assert.rejects(sql.begin(async (tx) => { await tx`select set_config('app.location_purge', 'on', true)`; await tx`delete from location_logs where id = ${row.id}`; }), /지울 수 없습니다/);
  // 계정을 지울 때(on delete set null)처럼 사람 칸만 비우는 것은 허용 — 오늘 기록으로(어제 해시에 영향 없음) · 다시 채우기는 막힘
  const [today] = await sql`insert into location_logs (tenant, subject_user_id, kind) values ('default', ${sid}, 'consent') returning id`;
  await sql`update location_logs set subject_user_id = null where id = ${today.id}`;
  await assert.rejects(sql`update location_logs set subject_user_id = ${sid} where id = ${today.id}`, /고칠 수 없습니다/);

  // ⑤ 월 점검 화면(이번 달) — 운영자만
  const month = seoulToday().slice(0, 7);
  const v = await ctx.owner.ok('GET', `/api/platform/location-check?month=${month}`);
  assert.ok(v.kinds.some((k) => k.kind === 'provide') && v.viewers.length >= 1);
  assert.equal((await ctx.staffA.client.get('/api/platform/location-check')).status, 404);

  // 누군가 트리거를 끄고 기록을 고치면 → 요약 해시와 달라 자체 점검이 잡음 · 운영자 알림
  await sql`alter table location_logs disable trigger location_logs_guard`;
  try { await sql`update location_logs set detail = '{"x":1}'::jsonb where kind = 'collect' and day = (now() at time zone 'Asia/Seoul')::date - 1`; }
  finally { await sql`alter table location_logs enable trigger location_logs_guard`; }
  const v2 = await ctx.owner.ok('GET', `/api/platform/location-check?month=${month}`);
  assert.ok(v2.issues.some((i) => i.code === 'digest_mismatch'), JSON.stringify(v2.issues));
  await tick();
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and title like '위치정보 자체 점검%'`).length, '운영자 알림');
  // [점검 완료] 기록
  const r = await ctx.owner.ok('POST', '/api/platform/location-check', { month, note: '시험 점검' });
  assert.ok(r.issues.length >= 1);
  const [log] = await sql`select detail from audit_logs where action = 'lbs.monthly_check' order by id desc limit 1`;
  assert.deepEqual([log.detail.month, log.detail.note], [month, '시험 점검']);
  assert.equal((await ctx.owner.ok('GET', `/api/platform/location-check?month=${month}`)).checks[0].note, '시험 점검');
});
