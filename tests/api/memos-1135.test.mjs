// #1135(대표 11/23 · docs/research/SECURE_MEMO_DESIGN_2026-11-23.md): 메모 · 주요 메모
// 메모마다 볼 사람(사람·부서 + 보기/고치기), 기본 = 만든 사람만(대표도 자동 열람 없음) · 아이디·비밀번호는 암호문으로만 저장 ·
// [보기]·[복사]는 본인 확인 10분 안에만 + 열람 기록(값 없음) · 목록·상세 응답에 비밀번호 없음 · 다른 메모 줄로 옮긴 암호문은 안 풀림 · 휴지통
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, sql, ctx;
const PW = 'S3cret!비밀-pw-1135';
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const N = {};

test('일반 메모: 기본은 만든 사람만 — 대표도 직원의 메모를 못 봄(404), 직원도 대표 메모를 못 봄', async () => {
  const a = await ctx.staffA.client.ok('POST', '/api/memos', { kind: 'note', title: '거래처 응대 메모', body: '월요일 오전 통화' });
  const b = await ctx.owner.ok('POST', '/api/memos', { kind: 'note', title: '대표 개인 메모', body: '내용' });
  assert.equal((await ctx.owner.req('GET', `/api/memos/${a.id}`)).status, 404, '대표도 자동 열람 없음');
  assert.ok(!(await ctx.owner.ok('GET', '/api/memos')).memos.some((m) => m.id === a.id), '대표 목록에 없음');
  assert.equal((await ctx.staffA.client.req('GET', `/api/memos/${b.id}`)).status, 404);
  const mine = (await ctx.staffA.client.ok('GET', '/api/memos')).memos.find((m) => m.id === a.id);
  assert.deepEqual([mine.level, mine.share_users, mine.share_units, mine.preview], ['edit', 0, 0, '월요일 오전 통화']);
  N.note = a.id;
});

test('주요 메모: 아이디·비밀번호는 암호문으로만(DB·목록·상세 어디에도 평문 없음) · 사람에게 보기 공유 → 그 사람만 목록에 보임', async () => {
  const r = await ctx.staffA.client.ok('POST', '/api/memos', { kind: 'secret', title: '세금계산서 사이트', siteUrl: 'https://tax.example.com', username: 'dagym-admin', password: PW, note: '보안질문: 첫 학교',
    access: [{ userId: ctx.managerA.id, level: 'view' }] });
  N.secret = r.id;
  const [row] = await sql`select secret_ct, body, site_url, key_ver from memos where id = ${r.id}`;
  assert.ok(row.secret_ct.startsWith('v1.') && !row.secret_ct.includes(PW) && !row.secret_ct.includes('dagym-admin'), '암호문');
  assert.deepEqual([row.body, row.site_url, row.key_ver], [null, 'https://tax.example.com', 1]);
  const list = await ctx.managerA.client.ok('GET', '/api/memos');
  const seen = list.memos.find((m) => m.id === r.id);
  assert.equal(seen.level, 'view');
  const detail = await ctx.managerA.client.ok('GET', `/api/memos/${r.id}`);
  for (const v of [JSON.stringify(list), JSON.stringify(detail)]) assert.ok(!v.includes(PW) && !v.includes('dagym-admin') && !v.includes('첫 학교'), '목록·상세에 값 없음');
  assert.equal((await ctx.staffB.client.req('GET', `/api/memos/${r.id}`)).status, 404, '공유받지 않은 사람');
  assert.equal((await ctx.owner.req('GET', `/api/memos/${r.id}`)).status, 404, '대표도 공유받지 않으면 404');
  assert.equal((await ctx.managerA.client.req('PATCH', `/api/memos/${r.id}`, { title: '바꿈' })).status, 403, '보기만 받은 사람은 못 고침');
  assert.equal((await ctx.managerA.client.req('DELETE', `/api/memos/${r.id}`)).status, 403);
});

test('[보기]는 본인 확인(비밀번호) 10분 안에만 · 틀린 비밀번호 400 · 고른 칸만 돌려줌 · 열람 기록에 칸·목적만(값 없음)', async () => {
  const c = ctx.managerA.client;
  const locked = await c.req('POST', `/api/memos/${N.secret}/reveal`, { fields: ['password'] });
  assert.deepEqual([locked.status, locked.body.error.code], [403, 'memo_locked']);
  assert.equal((await c.ok('GET', '/api/memos/status')).method, 'password');
  assert.equal((await c.req('POST', '/api/memos/unlock', { password: 'wrong-pass' })).status, 400);
  const u = await c.ok('POST', '/api/memos/unlock', { password: ctx.managerA.password });
  const left = Date.parse(u.unlockedUntil) - Date.now();
  assert.ok(left > 9 * 60e3 && left <= 10 * 60e3 + 5e3, `10분 (${left})`);
  const r = await c.req('POST', `/api/memos/${N.secret}/reveal`, { fields: ['password'], purpose: 'copy' });
  assert.equal(r.status, 200); assert.deepEqual(r.body.values, { password: PW }, '고른 칸만');
  assert.match(r.headers.get('cache-control') ?? '', /no-store/);
  const [log] = await sql`select detail from audit_logs where action = 'memo.reveal' and target_id = ${N.secret} order by id desc limit 1`;
  assert.deepEqual([log.detail.fields, log.detail.purpose], [['password'], 'copy']);
  const all = await sql`select detail::text as d from audit_logs where target_id = ${N.secret} or action like 'memo.%'`;
  assert.ok(all.every((x) => !x.d.includes(PW) && !x.d.includes('dagym-admin')), '어떤 기록에도 값 없음');
  // 잠그기 → 다시 잠김
  await c.ok('DELETE', '/api/memos/unlock');
  assert.equal((await c.req('POST', `/api/memos/${N.secret}/reveal`, { fields: ['username'] })).status, 403);
  // 본인 확인은 세션마다 — 다른 사람(만든 사람)은 따로 확인해야 함
  assert.equal((await ctx.staffA.client.req('POST', `/api/memos/${N.secret}/reveal`, { fields: ['username'] })).status, 403);
});

test('아이디·비밀번호 고치기도 본인 확인 뒤에만 · 무엇을 바꿨는지만 기록 · 다른 메모 줄로 옮긴 암호문은 풀리지 않음', async () => {
  const c = ctx.staffA.client;
  const locked = await c.req('PATCH', `/api/memos/${N.secret}`, { password: 'new-pass-2' });
  assert.deepEqual([locked.status, locked.body.error.code], [403, 'memo_locked']);
  await c.ok('PATCH', `/api/memos/${N.secret}`, { title: '세금계산서 사이트(본사)' }); // 제목은 확인 없이
  await c.ok('POST', '/api/memos/unlock', { password: ctx.staffA.password });
  const u = await c.ok('PATCH', `/api/memos/${N.secret}`, { password: 'new-pass-2', username: 'dagym-admin' });
  assert.deepEqual(u.changed, ['password'], '바뀐 칸만');
  assert.deepEqual((await c.ok('POST', `/api/memos/${N.secret}/reveal`, { fields: ['username', 'password', 'note'] })).values, { username: 'dagym-admin', password: 'new-pass-2', note: '보안질문: 첫 학교' });
  const [lg] = await sql`select detail from audit_logs where action = 'memo.update' and target_id = ${N.secret} order by id desc limit 1`;
  assert.deepEqual(lg.detail, { fields: ['password'] });
  // 다른 메모(같은 회사)에 암호문을 옮겨 붙이면 안 풀림(메모 번호를 함께 묶음)
  const other = await c.ok('POST', '/api/memos', { kind: 'secret', title: '다른 사이트', username: 'x', password: 'y' });
  const [{ secret_ct }] = await sql`select secret_ct from memos where id = ${N.secret}`;
  await sql`update memos set secret_ct = ${secret_ct} where id = ${other.id}`;
  const bad = await c.req('POST', `/api/memos/${other.id}/reveal`, { fields: ['password'] });
  assert.deepEqual([bad.status, bad.body.error.code], [500, 'vault_open_failed']);
  assert.ok(!JSON.stringify(bad.body).includes('new-pass-2'));
});

test('부서 공유: 본사(위 부서)에 주면 아래 지점 사람 모두 · 지점에만 주면 다른 지점은 못 봄 · 볼 사람 바꾸면 바로 반영 · 기록', async () => {
  const c = ctx.staffA.client;
  await c.ok('PUT', `/api/memos/${N.secret}/access`, { access: [{ unitId: ctx.siteA, level: 'view' }] });
  assert.equal((await ctx.managerA.client.req('GET', `/api/memos/${N.secret}`)).status, 200, '같은 지점');
  assert.equal((await ctx.staffB.client.req('GET', `/api/memos/${N.secret}`)).status, 404, '다른 지점');
  await c.ok('PUT', `/api/memos/${N.secret}/access`, { access: [{ unitId: ctx.hq, level: 'view' }, { userId: ctx.managerA.id, level: 'edit' }, { userId: ctx.staffA.id, level: 'view' }] });
  assert.equal((await ctx.staffB.client.req('GET', `/api/memos/${N.secret}`)).status, 200, '본사 아래 다른 지점도');
  const d = await c.ok('GET', `/api/memos/${N.secret}`);
  assert.deepEqual(d.access.map((a) => [a.kind, a.level]).sort(), [['unit', 'view'], ['user', 'edit']].sort(), '만든 사람 본인은 목록에 안 넣음(늘 고치기)');
  assert.equal((await ctx.managerA.client.req('PATCH', `/api/memos/${N.secret}`, { title: '세금계산서(본사)' })).status, 200, '고치기 받은 사람');
  // 다른 회사 사람·없는 부서는 고를 수 없음
  assert.equal((await c.req('PUT', `/api/memos/${N.secret}/access`, { access: [{ unitId: '00000000-0000-0000-0000-00000000dead', level: 'view' }] })).status, 400);
  await c.ok('PUT', `/api/memos/${N.secret}/access`, { access: [] });
  assert.equal((await ctx.staffB.client.req('GET', `/api/memos/${N.secret}`)).status, 404, '빼면 바로 못 봄');
  const lg = await c.ok('GET', `/api/memos/${N.secret}/log`);
  const acts = lg.log.map((x) => x.action);
  for (const k of ['memo.create', 'memo.share', 'memo.reveal', 'memo.update']) assert.ok(acts.includes(k), `${k} in ${acts}`);
  assert.equal((await ctx.managerA.client.req('GET', `/api/memos/${N.secret}/log`)).status, 404, '빠진 사람은 기록도 못 봄');
});

test('본인 확인 15분에 5번 틀리면 잠김(429) · 사이트 주소는 http(s)만 · 메뉴를 끄면 메모 전체 404', async () => {
  const c = ctx.staffB.client;
  for (let i = 0; i < 5; i++) assert.equal((await c.req('POST', '/api/memos/unlock', { password: 'nope' })).status, 400);
  assert.equal((await c.req('POST', '/api/memos/unlock', { password: ctx.staffB.password })).status, 429, '맞는 비밀번호도 잠시 막힘');
  assert.equal((await ctx.owner.req('POST', '/api/memos', { kind: 'secret', title: 'x', siteUrl: 'javascript:alert(1)' })).status, 400);
  await sql`insert into menu_user_perms (menu, user_id, level) values ('memos', ${ctx.staffB.id}, 'none')`;
  assert.equal((await c.req('GET', '/api/memos')).status, 404);
  assert.equal((await c.req('GET', '/api/memos/status')).status, 404);
  await sql`delete from menu_user_perms where menu = 'memos' and user_id = ${ctx.staffB.id}`;
});

test('휴지통: 고치기 권한자만 지움 → 목록에서 빠지고 휴지통에 → 되살리기 · 30일 지난 것은 정기 실행이 완전히 지움', async () => {
  const c = ctx.staffA.client;
  await c.ok('DELETE', `/api/memos/${N.note}`);
  assert.ok(!(await c.ok('GET', '/api/memos')).memos.some((m) => m.id === N.note));
  assert.ok((await c.ok('GET', '/api/memos?deleted=1')).memos.some((m) => m.id === N.note));
  assert.equal((await c.req('GET', `/api/memos/${N.note}`)).status, 404, '휴지통 메모는 열지 않음');
  await c.ok('POST', `/api/memos/${N.note}/restore`);
  assert.ok((await c.ok('GET', '/api/memos')).memos.some((m) => m.id === N.note));
  await c.ok('DELETE', `/api/memos/${N.note}`);
  await sql`update memos set deleted_at = now() - interval '31 days' where id = ${N.note}`;
  await tick(); // 정기 실행(휴지통 단계)
  assert.equal((await sql`select 1 from memos where id = ${N.note}`).length, 0, '30일 지난 메모 완전 삭제');
  assert.equal((await sql`select 1 from memos where id = ${N.secret}`).length, 1, '휴지통 아닌 메모는 그대로');
});
