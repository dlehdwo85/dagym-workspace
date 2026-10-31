// 292차 #804·#814(대표 10/29 결정): 자료실 '회사 전체 · 우리 팀 · 내 파일'
// 팀 자료 = 그 팀 구성원 + 위 단위 구성원 + 대표·관리자 · 내 파일 = 올린 사람만(대표·관리자도 존재를 모름) · 주 팀 = 조직도에서 가장 위 단위
// 업무 공간 자료실에 직접 올리는 파일에만 — 기존·비운 값은 회사 전체. 다른 팀 자료는 목록에 없고 주소로 열어도 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql; const T = {}; const F = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  T.dept = (await ctx.owner.ok('POST', '/api/teams', { name: '운영부', kind: 'dept', members: [{ userId: ctx.managerA.id, lead: true }] })).id;
  T.team1 = (await ctx.owner.ok('POST', '/api/teams', { name: '운영1팀', kind: 'team', parentId: T.dept, members: [{ userId: ctx.staffA.id, lead: true }] })).id;
  T.sales = (await ctx.owner.ok('POST', '/api/teams', { name: '영업팀', kind: 'dept', members: [{ userId: ctx.staffB.id, lead: true }] })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

async function up(c, name, extra = {}) {
  const r = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'text/plain', size: 4, folder: extra.folder ?? '범위시험', ...extra });
  await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: Buffer.from('abcd') });
  await c.ok('POST', `/api/library/${r.id}/complete`);
  return r.id;
}
const names = async (c, q = '') => (await c.ok('GET', `/api/library?${q}`)).files.map((f) => f.file_name);

test('우리 팀 자료: 같은 팀·위 단위·관리자만 · 다른 팀은 목록·주소·내려받기·검색 모두 없음', async () => {
  F.team = await up(ctx.staffA.client, '운영1팀 점검표.txt', { scope: 'team' }); // 팀 안 고르면 주 팀
  const [row] = await sql`select scope, team_id from library_files where id = ${F.team}`;
  assert.deepEqual([row.scope, row.team_id], ['team', T.team1]);
  for (const c of [ctx.staffA.client, ctx.managerA.client, ctx.owner]) assert.ok((await names(c)).includes('운영1팀 점검표.txt'));
  assert.ok((await names(ctx.managerA.client, 'scope=team')).includes('운영1팀 점검표.txt'), '위 단위(운영부) 구성원도 봄');
  assert.ok(!(await names(ctx.staffB.client)).includes('운영1팀 점검표.txt'));
  assert.ok(!(await names(ctx.staffB.client, 'q=점검표')).includes('운영1팀 점검표.txt'), '검색에도 없음');
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${F.team}`)).status, 404);
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${F.team}/download?json=1`)).status, 404);
  const one = (await ctx.staffA.client.ok('GET', '/api/library?scope=team')).files.find((f) => f.id === F.team);
  assert.equal(one.team_name, '운영1팀');
  assert.equal((await ctx.staffB.client.req('POST', '/api/library', { fileName: 'x.txt', size: 1, scope: 'team', teamId: T.team1 })).status, 400, '다른 팀으로는 못 올림');
});

test('내 파일: 올린 사람만(대표·관리자도 목록·주소에 없음) · 폴더 이름도 회사 목록에 안 섞임', async () => {
  F.mine = await up(ctx.staffA.client, '이력서 초안.txt', { scope: 'mine', folder: '비밀 메모' });
  assert.ok((await names(ctx.staffA.client, 'scope=mine')).includes('이력서 초안.txt'));
  for (const c of [ctx.owner, ctx.managerA.client, ctx.staffB.client]) {
    assert.ok(!(await names(c)).includes('이력서 초안.txt'));
    assert.equal((await c.req('GET', `/api/library/${F.mine}`)).status, 404);
    assert.ok(!(await c.ok('GET', '/api/library?scope=company')).folders.some((f) => f.folder === '비밀 메모'), '폴더 이름도 안 보임');
  }
  await ctx.staffA.client.ok('POST', '/api/library/folders', { path: '개인 보관', scope: 'mine' });
  assert.ok((await ctx.staffA.client.ok('GET', '/api/library?scope=mine')).folders.some((f) => f.folder === '개인 보관'));
  assert.ok(!(await ctx.staffA.client.ok('GET', '/api/library?scope=company')).folders.some((f) => f.folder === '개인 보관'), '내 파일 빈 폴더는 회사 폴더와 따로');
  assert.ok(!(await ctx.staffB.client.ok('GET', '/api/library?scope=mine')).folders.some((f) => f.folder === '개인 보관'));
  const doc = await ctx.staffA.client.ok('POST', '/api/library/docs', { title: '내 일기', scope: 'mine' });
  assert.equal((await ctx.owner.req('GET', `/api/library/${doc.id}`)).status, 404, '내 파일 새 문서도 나만');
});

test('옮기기: 내 파일 → 회사 전체(다른 사람에게 보임) · 남의 파일을 내 파일로는 못 옮김 · 업무 공간 밖·업무 첨부는 회사 전체 그대로', async () => {
  await ctx.staffA.client.ok('PATCH', `/api/library/${F.mine}`, { scope: 'company' });
  assert.ok((await names(ctx.staffB.client)).includes('이력서 초안.txt'));
  assert.equal((await ctx.owner.req('PATCH', `/api/library/${F.mine}`, { scope: 'mine' })).status, 403);
  await ctx.staffA.client.ok('PATCH', `/api/library/${F.mine}`, { scope: 'team' });
  assert.equal((await sql`select team_id from library_files where id = ${F.mine}`)[0].team_id, T.team1);
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${F.mine}`)).status, 404);
  const log = await sql`select detail from audit_logs where action = 'library.scope_set' and target_id = ${F.mine} order by id`;
  assert.deepEqual(log.map((l) => l.detail.to), ['company', 'team']);
  const r = await ctx.staffA.client.ok('POST', '/api/library/move', { ids: [F.team], folder: '팀 보관', scope: 'team' });
  assert.equal(r.moved, 1);
  assert.ok((await ctx.staffA.client.ok('GET', '/api/library?scope=team')).folders.some((f) => f.folder === '팀 보관'));
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  assert.equal((await ctx.owner.req('POST', '/api/library', { fileName: 'm.txt', size: 1, space: 'marketing', scope: 'mine' })).status, 400, '마케팅 공간은 회사 전체만');
});

test('주 팀 = 조직도에서 가장 위 단위 · 팀 없으면 팀 자료로 못 둠 · 비우면 회사 전체(예전처럼)', async () => {
  await sql`insert into team_members (team_id, user_id) values (${T.team1}, ${ctx.managerA.id}) on conflict do nothing`;
  const mt = (await ctx.managerA.client.ok('GET', '/api/library')).myTeams.map((t) => t.name);
  assert.deepEqual(mt, ['운영부', '운영1팀'], '위 단위가 앞');
  const id = await up(ctx.managerA.client, '부서 공지.txt', { scope: 'team' });
  assert.equal((await sql`select team_id from library_files where id = ${id}`)[0].team_id, T.dept);
  assert.ok(!(await names(ctx.staffA.client)).includes('부서 공지.txt'), '아래 팀(운영1팀) 구성원은 위 단위 자료를 못 봄');
  const plain = await up(ctx.staffA.client, '회사 양식.txt');
  assert.equal((await sql`select scope from library_files where id = ${plain}`)[0].scope, 'company');
  assert.ok((await names(ctx.staffB.client)).includes('회사 양식.txt'));
});
