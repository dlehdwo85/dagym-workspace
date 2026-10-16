// V38 4: 업무 첨부 → 자료실 자동 등록 — 같은 파일 하나·폴더 "업무 첨부/연-월"(프로젝트면 프로젝트 이름)·업무를 볼 수 있는 사람만, 자료실에서 지워도 업무 첨부는 그대로, 회사 설정 끄기
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql, taskId;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '현장 견학 자료 정리', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id; });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const upload = async (c, name, tid = taskId) => {
  const init = await c.ok('POST', '/api/attachments', { taskId: tid, kind: 'file', fileName: name, mimeType: 'application/pdf', size: 12 });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
  return { id: init.id, ...(await c.ok('POST', `/api/attachments/${init.id}/complete`, {})) };
};
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
const inList = async (c, title) => (await c.ok('GET', `/api/library?q=${encodeURIComponent(title)}`)).files.some((f) => f.title === title);

describe('V38 4 업무 첨부 → 자료실', () => {
  test('올리면 자료실에도 1건(같은 저장 파일·업무 첨부/연-월·업무 링크), 업무를 볼 수 있는 사람만 보임', async () => {
    const a = await upload(ctx.staffA.client, '견학 안내문.pdf');
    assert.ok(a.libraryId, '자료실 id 돌려줌');
    const [f] = await sql`select folder, title, source, task_id, storage_key, security from library_files where id = ${a.libraryId}`;
    const [at] = await sql`select storage_key from attachments where id = ${a.id}`;
    assert.equal(f.folder, `업무 첨부/${month}`); assert.equal(f.title, '견학 안내문'); assert.equal(f.source, 'task_attach'); assert.equal(f.task_id, taskId);
    assert.equal(f.storage_key, at.storage_key, '같은 파일 하나(복사 없음)');
    assert.equal(f.security, 'internal');
    assert.ok(await inList(ctx.staffA.client, '견학 안내문'), '올린 사람');
    assert.ok(await inList(ctx.owner, '견학 안내문'), '대표');
    assert.ok(await inList(ctx.managerA.client, '견학 안내문'), '같은 현장 관리자(업무를 볼 수 있음)');
    assert.ok(!(await inList(ctx.staffB.client, '견학 안내문')), '다른 현장 직원은 자료실에서도 안 보임');
    assert.equal((await ctx.staffB.client.get(`/api/library/${a.libraryId}`)).status, 404);
  });
  test('기밀 단어면 기밀 등급, 자료실에서 고른 파일 첨부는 또 등록하지 않음, 프로젝트 업무는 프로젝트 폴더', async () => {
    const c = await upload(ctx.owner, '급여 명세 정리.pdf');
    assert.equal((await sql`select security from library_files where id = ${c.libraryId}`)[0].security, 'confidential');
    const proj = (await ctx.owner.ok('POST', '/api/projects', { name: '강남점 리뉴얼', orgUnitId: ctx.siteA })).id;
    const pt = (await ctx.owner.ok('POST', '/api/tasks', { title: '리뉴얼 도면', projectId: proj, assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const p = await upload(ctx.owner, '도면 1차.pdf', pt);
    assert.equal((await sql`select folder from library_files where id = ${p.libraryId}`)[0].folder, '업무 첨부/강남점 리뉴얼');
    const n0 = (await sql`select count(*)::int n from library_files`)[0].n;
    await ctx.owner.ok('POST', `/api/library/${p.libraryId}/attach`, { taskId });
    assert.equal((await sql`select count(*)::int n from library_files`)[0].n, n0, '자료실 파일을 첨부하면 새로 만들지 않음');
  });
  test('자료실에서 지워도 업무 첨부는 그대로 내려받기 됨', async () => {
    const a = await upload(ctx.staffA.client, '지워도 남는 자료.pdf');
    await ctx.owner.ok('DELETE', `/api/library/${a.libraryId}`);
    assert.ok(!(await inList(ctx.owner, '지워도 남는 자료')));
    assert.ok((await ctx.staffA.client.ok('GET', `/api/attachments/${a.id}/download?json=1`)).url, '업무 첨부 내려받기 됨');
  });
  test('회사 설정 끄면 등록 안 함, 직원은 설정 못 바꿈', async () => {
    assert.equal((await ctx.owner.ok('GET', '/api/org/attach-library')).on, true);
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/attach-library', { on: false })).status));
    await ctx.owner.ok('PUT', '/api/org/attach-library', { on: false });
    const a = await upload(ctx.staffA.client, '설정 끈 뒤 자료.pdf');
    assert.equal(a.libraryId, null);
    await ctx.owner.ok('PUT', '/api/org/attach-library', { on: true });
  });
});
