// 대표 지시(10/18): 공간별 자료실(저장소 하나) — 공간 칸·공간 멤버만 보기(다른 사람은 존재도 404)·[전체] = 볼 수 있는 공간 모두·업로드 공간 검사
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

async function up(c, name, space) {
  const r = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'text/plain', size: 4, folder: '공간시험', ...(space ? { space } : {}) });
  await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: Buffer.from('abcd') });
  await c.ok('POST', `/api/library/${r.id}/complete`);
  return r.id;
}

test('공간별 자료실', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const mk = await up(ctx.owner, '가을 행사 시안.txt', 'marketing');
  const wk = await up(ctx.owner, '업무 매뉴얼.txt');
  assert.equal((await sql`select space from library_files where id = ${mk}`)[0].space, 'marketing');
  assert.equal((await sql`select space from library_files where id = ${wk}`)[0].space, 'work', '기본은 업무 공간');
  // 대표(관리자): 공간별·전체
  const names = async (c, q) => (await c.ok('GET', `/api/library?${q}`)).files.map((f) => f.file_name).sort();
  assert.deepEqual(await names(ctx.owner, 'space=marketing'), ['가을 행사 시안.txt']);
  assert.deepEqual(await names(ctx.owner, 'space=work'), ['업무 매뉴얼.txt']);
  assert.deepEqual(await names(ctx.owner, 'space=all'), ['가을 행사 시안.txt', '업무 매뉴얼.txt']);
  const all = await ctx.owner.ok('GET', '/api/library?space=all');
  assert.deepEqual(all.spaces, ['work', 'marketing']); assert.equal(all.spaceCounts.marketing, 1);
  // 마케팅 배정 직원은 보이고, 미배정 직원은 목록·주소 모두 없음
  assert.deepEqual(await names(ctx.staffA.client, 'space=marketing'), ['가을 행사 시안.txt']);
  assert.ok(!(await names(ctx.staffB.client, 'space=all')).includes('가을 행사 시안.txt'));
  assert.equal((await ctx.staffB.client.req('GET', '/api/library?space=marketing')).status, 404);
  assert.equal((await ctx.staffB.client.req('GET', `/api/library/${mk}/download?json=1`)).status, 404, '공간 밖 자료는 존재도 숨김');
  assert.equal((await ctx.staffB.client.req('POST', '/api/library', { fileName: 'x.txt', size: 1, space: 'marketing' })).status, 404, '배정 안 된 공간에 못 올림');
  // 마케팅 공간을 끄면 그 공간 자료도 안 보임(삭제는 아님)
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: false });
  assert.ok(!(await names(ctx.staffA.client, 'space=all')).includes('가을 행사 시안.txt'));
  assert.equal((await sql`select count(*)::int n from library_files where id = ${mk} and deleted_at is null`)[0].n, 1);
});
