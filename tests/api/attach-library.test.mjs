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
  test('기밀 단어면 자료실에서는 기밀(기밀 권한 없으면 목록에 없음)·업무 첨부 내려받기는 그대로, 자료실에서 고른 파일 첨부는 또 등록하지 않음, 프로젝트 업무는 프로젝트 폴더', async () => {
    const c = await upload(ctx.owner, '급여 명세 정리.pdf');
    const [cs] = await sql`select security, security_suggested from library_files where id = ${c.libraryId}`;
    assert.equal(cs.security, 'confidential'); assert.equal(cs.security_suggested, 'confidential');
    assert.ok(await inList(ctx.owner, '급여 명세 정리'), '대표(기밀 권한)는 자료실에서 보임');
    assert.ok(!(await inList(ctx.staffA.client, '급여 명세 정리')), '업무를 볼 수 있어도 기밀 권한 없으면 자료실 목록에 없음');
    assert.equal((await ctx.staffA.client.get(`/api/library/${c.libraryId}`)).status, 404);
    assert.ok((await ctx.staffA.client.ok('GET', `/api/attachments/${c.id}/download?json=1`)).url, '직원(기밀 권한 없음)도 업무 첨부 내려받기 그대로');
    const proj = (await ctx.owner.ok('POST', '/api/projects', { name: '강남점 리뉴얼', orgUnitId: ctx.siteA })).id;
    const pt = (await ctx.owner.ok('POST', '/api/tasks', { title: '리뉴얼 도면', projectId: proj, assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const p = await upload(ctx.owner, '도면 1차.pdf', pt);
    assert.equal((await sql`select folder from library_files where id = ${p.libraryId}`)[0].folder, '업무 첨부/강남점 리뉴얼');
    const n0 = (await sql`select count(*)::int n from library_files`)[0].n;
    await ctx.owner.ok('POST', `/api/library/${p.libraryId}/attach`, { taskId });
    assert.equal((await sql`select count(*)::int n from library_files`)[0].n, n0, '자료실 파일을 첨부하면 새로 만들지 않음');
  });
  test('업무에서 온 파일은 자료실에서 지워도 업무 첨부 그대로, 원래 자료실 파일을 붙인 첨부는 지우면 404(V34-C2)', async () => {
    const a = await upload(ctx.staffA.client, '지워도 남는 자료.pdf');
    await ctx.owner.ok('DELETE', `/api/library/${a.libraryId}`);
    assert.ok(!(await inList(ctx.owner, '지워도 남는 자료')));
    assert.ok((await ctx.staffA.client.ok('GET', `/api/attachments/${a.id}/download?json=1`)).url, '업무 첨부 내려받기 됨');
    const lf = await ctx.owner.ok('POST', '/api/library', { fileName: '원래 자료실 파일.pdf', mimeType: 'application/pdf', size: 12, folder: '영업자료' });
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
    await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
    const att = await ctx.owner.ok('POST', `/api/library/${lf.id}/attach`, { taskId });
    const attId = att.id ?? att.attachmentId;
    assert.ok((await ctx.staffA.client.ok('GET', `/api/attachments/${attId}/download?json=1`)).url);
    await ctx.owner.ok('DELETE', `/api/library/${lf.id}`);
    assert.equal((await ctx.staffA.client.get(`/api/attachments/${attId}/download?json=1`)).status, 404, '자료실 원본을 지우면 첨부도 404');
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
