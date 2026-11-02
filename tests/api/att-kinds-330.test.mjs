// 330차(대표 11/02 15:2x '업무에서 첨부파일들 hwp 인지 pdf 인지 종류를 확인할 수 있도록 표기'): 목록 API 가 업무마다 첨부의 종류(kind·확장자·형식)별 개수를 같이 준다(attachment_kinds)
// → 화면이 📎 칩에 'HWP 2 · PDF 1' 처럼 묶어 보임 · 지운 첨부는 빠짐 · 링크도 한 칸
// 332차 보완(로컬 16:3x: 94개 업무가 'JPG 29 · HWP 1'): 이름 목록 30개 제한 대신 서버가 전부 센다
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
const kinds = (t) => t.attachment_kinds.map((k) => `${k.kind}:${k.ext ?? '-'}:${k.mime ?? '-'}:${k.n}`).sort();

test('목록 업무마다 attachment_kinds = [{kind, ext(소문자 확장자·없으면 null), mime, n}] · 개수와 같음 · 링크 포함 · 지우면 빠짐 · 없으면 빈 배열', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 종류 시험', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  assert.deepEqual((await mine(t.id)).attachment_kinds, [], '첨부 없음 = 빈 배열');
  const pdf = await upload(t.id, '견적서.pdf', 'application/pdf', '%PDF-1.4');
  await upload(t.id, '제안서.hwp', 'application/x-hwp');
  await upload(t.id, '산출내역.HWP', 'application/x-hwp'); // 대문자 확장자도 같은 종류
  await upload(t.id, '산출내역', 'application/vnd.hancom.hwpx'); // 확장자 없는 이름 → 화면은 형식(mime)으로 HWPX
  await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'link', url: 'https://docs.google.com/document/d/abc', docTitle: '운영 매뉴얼' });
  const r = await mine(t.id);
  assert.equal(r.attachment_count, 5);
  assert.deepEqual(kinds(r), ['file:-:application/vnd.hancom.hwpx:1', 'file:hwp:application/x-hwp:2', 'file:pdf:application/pdf:1', 'link:-:-:1'].sort(), '종류별 개수 · 링크는 이름·형식 없음');
  assert.equal(r.attachment_kinds[0].n, 2, '많은 종류 먼저');
  await ctx.owner.ok('DELETE', `/api/attachments/${pdf}`);
  const r2 = await mine(t.id);
  assert.equal(r2.attachment_count, 4);
  assert.ok(!r2.attachment_kinds.some((k) => k.ext === 'pdf'), '지운 PDF 는 빠짐');
  const t2 = await ctx.owner.ok('POST', '/api/tasks', { title: '직원 첨부 종류', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  await upload(t2.id, '사진.JPG', 'image/jpeg');
  const s = (await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.find((x) => x.id === t2.id);
  assert.deepEqual(s.attachment_kinds, [{ kind: 'file', ext: 'jpg', mime: 'image/jpeg', n: 1 }]);
});

test('첨부가 많아도(94개) 종류별 개수는 전부 센다 — 332차 보완', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 많은 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  const ids = [];
  for (let i = 0; i < 94; i++) ids.push(sql`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, created_by, created_at)
    values (${t.id}, 'file', ${`test/${i}`}, ${i === 0 ? '공고문.hwp' : `IMG_${9200 + i}.JPG`}, ${i === 0 ? 'application/x-hwp' : 'image/jpeg'}, 3, 'ready', ${ctx.ownerId}, now() + make_interval(secs => ${i}))`);
  await Promise.all(ids);
  const r = await mine(t.id);
  assert.equal(r.attachment_count, 94);
  assert.deepEqual(r.attachment_kinds, [{ kind: 'file', ext: 'jpg', mime: 'image/jpeg', n: 93 }, { kind: 'file', ext: 'hwp', mime: 'application/x-hwp', n: 1 }], 'JPG 93 · HWP 1');
});
