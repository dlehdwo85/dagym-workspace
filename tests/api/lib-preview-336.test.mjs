// 336차(대표 11/02 17:3x ① 자료실에서 파일 고르는 창에서 고르기 전 내용 확인): GET /api/library/:id/preview — 본문 앞부분(올릴 때 뽑아 둔 글자 1,500자) ·
// 사진은 본문 없음(text null) · 권한은 자료 열기와 같음(내 파일은 올린 사람만) · 창 안에 띄우는 주소(download?inline=1)는 PDF·사진·영상만 inline, 한글·엑셀은 내려받기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
async function up(c, name, mime, data, extra = {}) {
  const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder: '회사 소개', ...extra });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data }); await c.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}
before(async () => { await resetDb(); await ensureTls(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('글이 있는 문서(txt)는 본문 앞부분 · 긴 글은 1,500자에서 끊고 more=true · 사진은 text null · 목록 줄에 패널이 쓰는 칸(올린 사람·올린 때·폴더·형식·크기)', async () => {
  const body = ['다짐 피트니스 회사소개서', '1. 회사 개요: 커뮤니티 시설 위탁 운영', '2. 주요 실적'].join('\n');
  const id = await up(ctx.owner, '회사소개.txt', 'text/plain', Buffer.from(body));
  const p = await ctx.owner.ok('GET', `/api/library/${id}/preview`);
  assert.equal(p.ready, true); assert.match(p.text, /회사 개요/); assert.equal(p.more, false); assert.equal(p.text_error, null);
  const long = await up(ctx.owner, '긴 문서.txt', 'text/plain', Buffer.from('가나다라마바사 '.repeat(400)));
  const q = await ctx.owner.ok('GET', `/api/library/${long}/preview`);
  assert.equal(q.text.length, 1500); assert.equal(q.more, true); assert.ok(q.chars > 1500);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const img = await up(ctx.owner, '현장.png', 'image/png', png);
  const r = await ctx.owner.ok('GET', `/api/library/${img}/preview`);
  assert.equal(r.text, null); assert.equal(r.more, false);
  const list = await ctx.owner.ok('GET', '/api/library?limit=5&q=회사소개');
  const row = list.files.find((f) => f.id === id);
  assert.ok(row && row.created_by_name && row.created_at && row.mime_type === 'text/plain' && Number(row.size_bytes) === Buffer.byteLength(body) && row.folder === '회사 소개', JSON.stringify(row));
});

test('권한은 자료 열기와 같음: 내 파일(scope mine)은 다른 사람에게 404 · 없는 id 404 · 다른 사람이 볼 수 있는 회사 자료는 미리보기 가능', async () => {
  const mine = await up(ctx.owner, '대표 메모.txt', 'text/plain', Buffer.from('나만 보는 메모'), { scope: 'mine' });
  assert.equal((await ctx.staffA.client.req('GET', `/api/library/${mine}/preview`)).status, 404);
  assert.equal((await ctx.staffA.client.req('GET', '/api/library/00000000-0000-4000-8000-000000000000/preview')).status, 404);
  const pub = await up(ctx.owner, '안내문.txt', 'text/plain', Buffer.from('모두 보는 안내문'));
  const ok = await ctx.staffA.client.ok('GET', `/api/library/${pub}/preview`); assert.match(ok.text, /안내문/);
});

test('창 안에 띄우는 주소(download?inline=1): PDF·사진은 inline, 한글은 내려받기(attachment) — 패널은 문서에 [내려받기]로 안내', async () => {
  const pdf = await up(ctx.owner, '공고문.pdf', 'application/pdf', Buffer.from('%PDF-1.4 abc'));
  const a = await ctx.owner.ok('GET', `/api/library/${pdf}/download?inline=1&json=1`); assert.match(a.url, /inline=1/);
  const pv = await ctx.owner.ok('GET', `/api/library/${pdf}/preview`); assert.equal(pv.text, null); assert.ok(pv.text_error, '글자 없는 PDF 는 사유 한 줄');
  const hwp = await up(ctx.owner, '제안서.hwp', 'application/x-hwp', Buffer.from('HWP Document File'));
  const b = await ctx.owner.ok('GET', `/api/library/${hwp}/download?inline=1&json=1`); assert.match(b.url, /inline=0/);
});
