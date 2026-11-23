// #1128(대표 11/23 '자료실 50MB 제한 — 올리는 건 자유롭게 하되 최대 용량을 정할 수 있으면'): 파일 한 개 최대 크기 = 회사 설정(50MB·200MB·1GB·2GB, 기본 2GB, 영상 포함 같은 값)
// · 보기 = 회사 사람 누구나(올리기 안내 글) · 바꾸기 = 회사 정보 편집 권한 · 업무 첨부·자료실·메신저·계약서 파일 모두 같은 값 · 큰 파일은 조각 주소 · 감사 기록 · 회사마다 따로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
const MB = 1024 * 1024;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('기본 2GB · 직원도 볼 수 있음(안내 글) · 바꾸기는 회사 관리자만 · 고를 수 있는 값만', async () => {
  const d = await ctx.staffA.client.ok('GET', '/api/org/file-max');
  assert.deepEqual([d.mb, d.text, d.choices.map((c) => c.text)], [2048, '2GB', ['50MB', '200MB', '1GB', '2GB']]);
  assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/file-max', { mb: 50 })).status), '직원은 못 바꿈');
  assert.equal((await ctx.owner.req('PUT', '/api/org/file-max', { mb: 300 })).status, 400, '정해진 값만');
});

test('50MB 로 바꾸면 업무 첨부·자료실·메신저·계약서가 60MB 를 막음(안내 글에 50MB) → 2GB 로 되돌리면 1.5GB 도 조각 주소 · 감사 기록', async () => {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '큰 파일 시험', assigneeId: ctx.ownerId })).id;
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
  const agr = (await ctx.owner.ok('POST', '/api/agreements', { title: '큰 계약서 시험', counterparty: '상대', endDate: '2027-12-31' })).id;
  const tries = (size) => [
    ctx.owner.req('POST', '/api/attachments', { taskId: t, kind: 'file', fileName: '큰 도면.pdf', mimeType: 'application/pdf', size }),
    ctx.owner.req('POST', '/api/library', { fileName: '큰 도면.pdf', mimeType: 'application/pdf', size, folder: '' }),
    ctx.owner.req('POST', `/api/chat/rooms/${room}/files`, { fileName: '큰 도면.pdf', mime: 'application/pdf', size }),
    ctx.owner.req('POST', `/api/agreements/${agr}/files`, { fileName: '큰 계약서.pdf', mimeType: 'application/pdf', size }),
  ];
  for (const r of await Promise.all(tries(60 * MB))) assert.equal(r.status, 200, `기본 2GB 에서는 60MB 됨 ${JSON.stringify(r.body).slice(0, 120)}`);
  assert.equal((await ctx.owner.ok('PUT', '/api/org/file-max', { mb: 50 })).text, '50MB');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/org/file-max')).text, '50MB', '직원 화면 안내도 50MB');
  for (const r of await Promise.all(tries(60 * MB))) { assert.equal(r.status, 400); assert.match(JSON.stringify(r.body), /파일은 50MB까지 올릴 수 있습니다/); }
  for (const r of await Promise.all(tries(40 * MB))) assert.equal(r.status, 200, '50MB 아래는 됨');
  await ctx.owner.ok('PUT', '/api/org/file-max', { mb: 2048 });
  const big = await ctx.owner.ok('POST', '/api/library', { fileName: '현장 원본 영상.mp4', mimeType: 'video/mp4', size: 1536 * MB, folder: '' });
  assert.equal(big.upload.multipart.parts.length, 192, '1.5GB / 8MB = 192조각');
  const acts = await sql`select detail from audit_logs where action = 'tenant.file_max' order by created_at`;
  assert.deepEqual(acts.map((a) => [a.detail.from, a.detail.to]), [[2048, 50], [50, 2048]]);
  // 회사마다 따로: 다른 회사 값은 그대로(기본 2GB)
  const [{ n }] = await sql`select count(*)::int as n from tenants where file_max_mb is not null and id <> 'default'`;
  assert.equal(n, 0);
});
