// 269차 #806(대표 10/29 '문서 고치기 빈 화면' — 글 0자·사진 16장 docx): 사진만 든 Word 는 워크인 문서로 바꾸지 않고 안내 →
// [PDF 로 만들어 글자 넣기] = 사진을 쪽마다 PDF 로 같은 업무에 새 첨부(원본 Word 그대로·두 번째는 같은 PDF) · 예전에 바꿔 둔 빈 문서는 원래 첨부로 되돌림
// · 글+사진 Word 는 바꾸되 '사진 n장 못 옮김' 안내 · 업무 첨부에서 연 문서는 [목록] 대신 그 업무로(문서 열기 응답에 task_id)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import sharp from 'sharp';
import * as Y from 'yjs';
import { PDFDocument } from 'pdf-lib';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, taskId;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 806 사진 문서', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id; });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name), comp = deflateRawSync(f.data), crc = crc32(f.data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(f.data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(f.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
/** 사진(그림) n장 + 글 문단 → docx. 사진은 <w:drawing><a:blip r:embed> (Word 가 붙인 꼴) */
async function docx(n, text = '') {
  const pics = await Promise.all(Array.from({ length: n }, (_, k) => sharp({ create: { width: 300, height: 420, channels: 3, background: { r: 40 * k, g: 120, b: 200 } } }).png().toBuffer()));
  const draw = (k) => `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId${10 + k}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const body = (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '') + pics.map((_, k) => draw(k)).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}</w:body></w:document>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pics.map((_, k) => `<Relationship Id="rId${10 + k}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${k + 1}.png"/>`).join('')}</Relationships>`;
  return zip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/></Types>') },
    { name: 'word/document.xml', data: Buffer.from(doc) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(rels) },
    ...pics.map((p, k) => ({ name: `word/media/image${k + 1}.png`, data: p })),
  ]);
}
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const upload = async (c, name, bytes) => {
  const init = await c.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: name, mimeType: DOCX, size: bytes.length });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: bytes });
  await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
  return init.id;
};
const fetchBytes = async (c, path) => { const r = await fetch(BASE + path, { headers: { cookie: c.cookie, origin: BASE }, redirect: 'follow' }); assert.equal(r.status, 200, `${path} ${r.status}`); return Buffer.from(await r.arrayBuffer()); };

test('사진만 든 Word: 바꾸지 않고 안내 → [PDF 로 만들어 글자 넣기] = 쪽마다 사진 PDF 새 첨부(원본 그대로) · 두 번째는 같은 PDF · 참여자 아니면 못 만듦', async () => {
  const id = await upload(ctx.staffA.client, '현장 점검표(사진).docx', await docx(3, '현장 사진'));
  const r = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc`, {});
  assert.deepEqual([r.imageOnly, r.images, r.pdf, r.link], [true, 3, null, undefined], '빈 문서로 바꾸지 않음');
  assert.equal((await sql`select count(*)::int n from library_files where task_id = ${taskId} and source = 'doc'`)[0].n, 0);
  assert.equal((await sql`select doc_id from attachments where id = ${id}`)[0].doc_id, null);
  assert.ok([403, 404].includes((await ctx.staffB.client.req('POST', `/api/attachments/${id}/doc/pdf`, {})).status), '참여자 아니면 못 만듦');
  const p = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc/pdf`, {});
  assert.deepEqual([p.created, p.pages, p.skipped, p.pdf.file_name, p.pdf.mime_type], [true, 3, 0, '현장 점검표(사진).pdf', 'application/pdf']);
  const [row] = await sql`select task_id, pdf_of, upload_status, kind from attachments where id = ${p.pdf.id}`;
  assert.deepEqual([row.task_id, row.pdf_of, row.upload_status, row.kind], [taskId, id, 'ready', 'file']);
  const pdf = await PDFDocument.load(await fetchBytes(ctx.owner, `/api/attachments/${p.pdf.id}/download`));
  assert.equal(pdf.getPageCount(), 3, '사진 3장 = 3쪽');
  const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
  assert.ok(Math.abs(h / w - 420 / 300) < 0.01, '쪽 모양 = 사진 비율');
  const [orig] = await sql`select version, mime_type, file_name from attachments where id = ${id}`;
  assert.deepEqual([orig.version, orig.mime_type, orig.file_name], [1, DOCX, '현장 점검표(사진).docx'], '원본 Word 그대로');
  assert.deepEqual(await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc/pdf`, {}).then((x) => [x.created, x.pdf.id]), [false, p.pdf.id], '두 번째는 같은 PDF');
  assert.equal((await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc`, {})).pdf.id, p.pdf.id, '다시 열면 [만든 PDF 열기]');
  assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'file_attached' and changes->>'from' = 'doc_pdf'`).length, '업무 기록');
});

test('예전에 바꿔 둔 빈 문서(+빈 Word 로 [업무로 저장]까지 한 것) → 다시 열면 원래 첨부로 되돌림 · 글을 적은 문서는 그대로', async () => {
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const oldDoc = async (attId, text) => {
    const d = new Y.Doc(); const p = new Y.XmlElement('paragraph'); const t = new Y.XmlText(); t.insert(0, text); p.insert(0, [t]); d.getXmlFragment('default').insert(0, [p]);
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, tags, created_by, source, upload_status, security, task_id)
      values (${tenant}, 'work', '업무 첨부/2026-10', '현장 사진', '현장 사진.wdoc', 'application/x-workin-doc', 0, ${['문서']}, ${ctx.staffA.id}, 'doc', 'ready', 'internal', ${taskId}) returning id`;
    await sql`insert into lib_docs (library_file_id, tenant, snapshot) values (${f.id}, ${tenant}, ${Buffer.from(Y.encodeStateAsUpdate(d))})`;
    await sql`update attachments set doc_id = ${f.id} where id = ${attId}`;
    return f.id;
  };
  const id = await upload(ctx.staffA.client, '현장 사진.docx', await docx(2));
  const [{ storage_key: origKey }] = await sql`select storage_key from attachments where id = ${id}`;
  const docId = await oldDoc(id, '');
  const s = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc/save`, {});
  assert.equal(s.version, 2, '예전처럼 빈 Word 로 저장된 상태');
  const r = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc`, {});
  assert.deepEqual([r.imageOnly, r.images, r.reverted], [true, 2, true]);
  const [a] = await sql`select doc_id, version, storage_key, file_name from attachments where id = ${id}`;
  assert.deepEqual([a.doc_id, a.version, a.storage_key, a.file_name], [null, 3, origKey, '현장 사진.docx'], '처음 올린 판으로 되돌림');
  assert.ok((await sql`select deleted_at from library_files where id = ${docId}`)[0].deleted_at, '빈 문서는 지운 것으로');
  assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'file_doc_reverted'`).length);
  // 글을 적어 둔 문서는 그대로 연다
  const id2 = await upload(ctx.staffA.client, '현장 사진2.docx', await docx(2));
  const doc2 = await oldDoc(id2, '사진 아래에 점검 결과를 적었습니다');
  const r2 = await ctx.staffA.client.ok('POST', `/api/attachments/${id2}/doc`, {});
  assert.equal(r2.docId, doc2); assert.equal(r2.imageOnly, undefined);
  assert.match(r2.link, /lostImg=2/, '원본 사진 2장 못 옮김 안내');
});

test('글+사진 Word: 바꾸되 link 에 lostImg(사진 못 옮김) · 문서 열기 응답 file.task_id = 업무(목록 단추 → 업무로)', async () => {
  const id = await upload(ctx.staffA.client, '견적 안내.docx', await docx(2, '견적 내용과 공사 일정을 안내드립니다. 자세한 금액은 첨부한 견적서를 확인해 주시고, 아래 사진은 현장 모습입니다.'));
  const r = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/doc`, {});
  assert.equal(r.created, true);
  assert.match(r.link, new RegExp(`/library/doc/${r.docId}\\?att=${id}&lostImg=2$`));
  const open = await ctx.staffA.client.ok('GET', `/api/library/docs/${r.docId}`);
  assert.equal(open.file.task_id, taskId);
  // 사진 없는 보통 Word 는 안내 없음
  const id3 = await upload(ctx.staffA.client, '회의록.docx', await docx(0, '회의 안건과 결정 사항을 정리했습니다. 다음 회의는 다음 주입니다.'));
  const r3 = await ctx.staffA.client.ok('POST', `/api/attachments/${id3}/doc`, {});
  assert.match(r3.link, new RegExp(`\\?att=${id3}$`));
});
