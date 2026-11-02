// 330차(대표 11/02 15:2x '업무에서 첨부파일들 hwp 인지 pdf 인지 종류를 확인할 수 있도록 표기'): 목록 API 가 업무마다 첨부 파일의 종류(kind·이름·형식)를
// 올린 순으로 같이 준다(attachment_files) → 화면이 📎 칩에 'HWP 2 · PDF 1' 처럼 묶어 보임 · 지운 첨부는 빠짐 · 링크도 한 칸 · 30개까지
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

async function upload(taskId, fileName, mimeType, body = 'x') {
  const up = await ctx.owner.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName, mimeType, size: body.length });
  await fetch(BASE + up.upload.url, { method: 'PUT', headers: up.upload.headers, body: Buffer.from(body) });
  await ctx.owner.ok('POST', `/api/attachments/${up.id}/complete`, {});
  return up.id;
}
const mine = async (id) => (await ctx.owner.ok('GET', '/api/tasks?view=my')).tasks.find((t) => t.id === id);

test('목록 업무마다 attachment_files = [{kind, file_name, mime_type}] 올린 순 · 개수와 같음 · 링크 포함 · 지우면 빠짐 · 없으면 빈 배열', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 종류 시험', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  assert.deepEqual((await mine(t.id)).attachment_files, [], '첨부 없음 = 빈 배열');
  const pdf = await upload(t.id, '견적서.pdf', 'application/pdf', '%PDF-1.4');
  await upload(t.id, '제안서.hwp', 'application/x-hwp');
  await upload(t.id, '산출내역', 'application/vnd.hancom.hwpx'); // 확장자 없는 이름 → 화면은 형식(mime)으로 HWPX
  await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'link', url: 'https://docs.google.com/document/d/abc', docTitle: '운영 매뉴얼' });
  const r = await mine(t.id);
  assert.equal(r.attachment_count, 4);
  assert.deepEqual(r.attachment_files, [
    { kind: 'file', file_name: '견적서.pdf', mime_type: 'application/pdf' },
    { kind: 'file', file_name: '제안서.hwp', mime_type: 'application/x-hwp' },
    { kind: 'file', file_name: '산출내역', mime_type: 'application/vnd.hancom.hwpx' },
    { kind: 'link', file_name: null, mime_type: null },
  ], '올린 순 · 링크는 이름·형식 없음');
  await ctx.owner.ok('DELETE', `/api/attachments/${pdf}`);
  const r2 = await mine(t.id);
  assert.equal(r2.attachment_count, 3);
  assert.deepEqual(r2.attachment_files.map((f) => f.file_name), ['제안서.hwp', '산출내역', null], '지운 PDF 는 빠짐');
  // 다른 담당자 업무도 같은 칸(직원이 보는 목록)
  const t2 = await ctx.owner.ok('POST', '/api/tasks', { title: '직원 첨부 종류', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  await upload(t2.id, '사진.JPG', 'image/jpeg');
  const s = (await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.find((x) => x.id === t2.id);
  assert.deepEqual(s.attachment_files, [{ kind: 'file', file_name: '사진.JPG', mime_type: 'image/jpeg' }]);
});

test('30개 넘으면 30개까지만(개수는 전부)', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 많은 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  const ids = [];
  for (let i = 0; i < 32; i++) ids.push(sql`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, created_by, created_at)
    values (${t.id}, 'file', ${`test/${i}`}, ${`파일${i}.${i % 2 ? 'hwp' : 'pdf'}`}, ${i % 2 ? 'application/x-hwp' : 'application/pdf'}, 3, 'ready', ${ctx.ownerId}, now() + make_interval(secs => ${i}))`);
  await Promise.all(ids);
  const r = await mine(t.id);
  assert.equal(r.attachment_count, 32); assert.equal(r.attachment_files.length, 30);
  assert.equal(r.attachment_files[0].file_name, '파일0.pdf'); assert.equal(r.attachment_files[29].file_name, '파일29.hwp');
});
