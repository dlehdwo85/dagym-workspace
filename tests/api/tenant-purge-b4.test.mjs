// 상용화 B4(대표 위임 11/24): 회사 [영구 삭제 실행] = 실제 파기 — 개인정보처리방침 "공간 삭제는 복구 기간 30일 후 파기"와 맞춤.
// ① 회사 자료(업무·댓글·연락처·조직·알림·세션 등)와 파일(회사 경로·업무 첨부·회사 id 경로)이 지워짐
// ② 결제 기록·감사 기록·사람 계정 줄(익명화)은 남음 · 다른 회사(default) 자료·파일은 그대로 · 파기 완료 운영자 알림·감사 기록
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const UP = path.join(tmpdir(), 'workos-test', 'uploads');
const exists = (k) => access(path.join(UP, k)).then(() => true, () => false);
const put = async (k) => { await mkdir(path.dirname(path.join(UP, k)), { recursive: true }); await writeFile(path.join(UP, k), 'x'); };
let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = new Client('ceo@purge-b4.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@purge-b4.test', password: 'signup-pass-1234', name: '파대표', mode: 'team', company: '파기상사', industry: '운동·피트니스', industries: ['운동·피트니스'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('영구 삭제 실행 → 회사 자료·파일 파기 · 결제·감사 기록은 남음 · 다른 회사는 그대로', async () => {
  // 파기상사 자료
  const task = await T.c.ok('POST', '/api/tasks', { title: '파기될 업무' });
  await T.c.ok('POST', `/api/tasks/${task.id}/comments`, { body: '파기될 댓글' });
  await T.c.ok('POST', '/api/contacts', { name: '파기될 고객', phone: '010-9999-0000' });
  const attKey = `att/2026-11/purge-b4/첨부.txt`;
  await sql`insert into attachments (task_id, kind, storage_key, file_name, created_by) values (${task.id}, 'file', ${attKey}, '첨부.txt', ${T.id})`;
  for (const k of [attKey, `lib/${T.tenant}/a/자료.txt`, `chat/${T.tenant}/b.png`, `${T.tenant}/forms/c.jpg`]) await put(k);
  await sql`insert into payments (tenant, kind, plan_code, moid, amount, status) values (${T.tenant}, 'subscription', 'w_work', 'purge-b4-moid', 21890, 'paid')`;
  // 다른 회사(default) 자료·파일 — 그대로 남아야 함
  const ours = await ctx.owner.ok('POST', '/api/tasks', { title: '우리 회사 업무' });
  await put('lib/default/남길자료.txt');
  const orgs = (await sql`select id from org_units where tenant = ${T.tenant}`).map((x) => x.id);
  assert.ok(orgs.length > 0);
  assert.ok((await sql`select count(*)::int n from tasks where org_unit_id = any(${orgs})`)[0].n >= 1);

  await ctx.owner.ok('POST', `/api/platform/tenants/${T.tenant}/delete`, { action: 'schedule', confirmName: '파기상사' });
  await sql`update tenants set delete_scheduled_at = now() - interval '1 minute' where id = ${T.tenant}`;
  await ctx.owner.ok('POST', `/api/platform/tenants/${T.tenant}/delete`, { action: 'execute', confirmName: '파기상사' });
  for (let i = 0; i < 5 && (await sql`select purge->>'state' s from tenants where id = ${T.tenant}`)[0].s !== 'done'; i++) await tick();
  const [tn] = await sql`select status, purge from tenants where id = ${T.tenant}`;
  assert.equal(tn.status, 'deleted'); assert.equal(tn.purge.state, 'done');
  assert.deepEqual(tn.purge.errors, [], '모든 표를 지움(막힌 곳 없음)');

  // 회사 자료는 0줄
  for (const t of ['org_units', 'contacts', 'calendars', 'teams', 'memos']) assert.equal((await sql.unsafe(`select count(*)::int n from ${t} where tenant = $1`, [T.tenant]))[0].n, 0, `${t} 지움`);
  assert.equal((await sql`select count(*)::int n from tasks where id = ${task.id}`)[0].n, 0, '업무 지움');
  assert.equal((await sql`select count(*)::int n from comments where task_id = ${task.id}`)[0].n, 0, '댓글 지움');
  assert.equal((await sql`select count(*)::int n from attachments where storage_key = ${attKey}`)[0].n, 0, '첨부 줄 지움');
  assert.equal((await sql`select count(*)::int n from notifications n join users u on u.id = n.user_id where u.tenant = ${T.tenant}`)[0].n, 0, '알림 지움');
  assert.equal((await sql`select count(*)::int n from sessions s join users u on u.id = s.user_id where u.tenant = ${T.tenant}`)[0].n, 0, '세션 지움');
  assert.equal((await sql`select count(*)::int n from tenant_purge_files where tenant = ${T.tenant}`)[0].n, 0);
  // 파일
  for (const k of [attKey, `lib/${T.tenant}/a/자료.txt`, `chat/${T.tenant}/b.png`, `${T.tenant}/forms/c.jpg`]) assert.equal(await exists(k), false, `${k} 파일 지움`);
  assert.ok(tn.purge.files >= 4);
  // 남는 것
  assert.equal((await sql`select count(*)::int n from payments where tenant = ${T.tenant}`)[0].n, 1, '결제 기록은 법정 보관');
  const [u] = await sql`select email, name from users where id = ${T.id}`;
  assert.ok(u, '사람 줄은 익명화해서 남김'); assert.notEqual(u.email, 'ceo@purge-b4.test');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'platform.tenant_purged'`)[0].n, 1);
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and title = '회사 자료 파기 완료 — 파기상사'`)[0].n, 1);
  // 다른 회사는 그대로
  assert.equal((await sql`select count(*)::int n from tasks where id = ${ours.id}`)[0].n, 1, '우리 회사 업무 그대로');
  assert.equal(await exists('lib/default/남길자료.txt'), true, '우리 회사 파일 그대로');
  assert.ok((await sql`select count(*)::int n from org_units where tenant = 'default'`)[0].n > 0);
  assert.equal((await ctx.owner.get('/api/tasks')).status, 200);
});
