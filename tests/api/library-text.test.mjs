// V14 32: 자료실 본문 추출 — HWP 5.0(OLE+zlib 레코드)·HWPX(zip XML)·PDF 글자가 text_content 에 들어가 검색·AI 정리에 쓰임,
// 기존 파일 일괄 재추출(정기 실행, 시도 시각 기록), 정리 = 기존 폴더 우선·인사/재무 폴더면 기밀 제안, 올린 직후 알림 1건으로 묶음(건수 갱신)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { bootstrap, resetDb, startServer, testDb, tick, BASE, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const organized = (folder, security = 'internal') => say(JSON.stringify({ folder, tags: ['시험'], title: '', summary: '시험 파일', confidence: 0.9, security }));

// ---- 시험용 파일 만들기 ----
/** zip(저장만, 압축 없음) — 자료실 unzip 은 CRC 를 보지 않는다 */
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, d); central.push(ch, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
const hwpx = (paras) => zip([['mimetype', 'application/hwp+zip'], ['Contents/section0.xml', `<?xml version="1.0"?><hs:sec xmlns:hp="x">${paras.map((t) => `<hp:p><hp:run><hp:t>${t}</hp:t></hp:run></hp:p>`).join('')}</hs:sec>`]]);
/** HWP 5.0 레코드 묶음(압축) */
function hwpRecords(paras) {
  const recs = [];
  const rec = (tag, body) => { const h = Buffer.alloc(4); h.writeUInt32LE((tag & 0x3ff) | (body.length << 20), 0); recs.push(h, body); };
  for (const t of paras) {
    rec(0x10 + 50, Buffer.alloc(22)); // PARA_HEADER
    // 글자 + 확장 컨트롤 하나(코드 2, 8 WCHAR) + 문단 끝(13)
    const ctl = Buffer.alloc(16); ctl.writeUInt16LE(2, 0);
    rec(0x10 + 51, Buffer.concat([Buffer.from(t, 'utf16le'), ctl, Buffer.from('\r', 'utf16le')]));
  }
  return deflateRawSync(Buffer.concat(recs));
}
/** OLE 복합 문서(CFB): 작은 스트림은 mini stream 에 — 실제 HWP 와 같은 구조 */
function cfb(streams) {
  const SS = 512, MSS = 64, END = 0xfffffffe, FREE = 0xffffffff;
  const ents = [{ name: 'Root Entry', type: 5, left: -1, right: -1, child: 1, start: 0, size: 0 }];
  const chunks = []; let miniPos = 0; const miniFat = [];
  const add = (name, data, left, right) => {
    const nsec = Math.ceil(data.length / MSS); const first = miniPos / MSS;
    for (let i = 0; i < nsec; i++) miniFat.push(i === nsec - 1 ? END : first + i + 1);
    chunks.push(data, Buffer.alloc(nsec * MSS - data.length)); miniPos += nsec * MSS;
    ents.push({ name, type: 2, left, right, child: -1, start: first, size: data.length });
    return ents.length - 1;
  };
  add('FileHeader', streams.FileHeader, -1, 2);
  ents.push({ name: 'BodyText', type: 1, left: -1, right: -1, child: 3, start: 0, size: 0 });
  add('Section0', streams.Section0, -1, -1);
  const mini = Buffer.concat(chunks); const nMiniSec = Math.ceil(mini.length / SS);
  ents[0].start = 3; ents[0].size = mini.length;
  const dir = Buffer.alloc(SS);
  ents.forEach((e, i) => { const p = i * 128; const n = Buffer.from(e.name + '\0', 'utf16le'); n.copy(dir, p); dir.writeUInt16LE(n.length, p + 64); dir[p + 66] = e.type; dir[p + 67] = 1;
    dir.writeInt32LE(e.left, p + 68); dir.writeInt32LE(e.right, p + 72); dir.writeInt32LE(e.child, p + 76); dir.writeUInt32LE(e.start, p + 116); dir.writeUInt32LE(e.size, p + 120); });
  const fat = Buffer.alloc(SS, 0xff); fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(END, 4); fat.writeUInt32LE(END, 8);
  for (let i = 0; i < nMiniSec; i++) fat.writeUInt32LE(i === nMiniSec - 1 ? END : 3 + i + 1, (3 + i) * 4);
  const mf = Buffer.alloc(SS, 0xff); miniFat.forEach((v, i) => mf.writeUInt32LE(v, i * 4));
  const h = Buffer.alloc(SS); h.writeUInt32LE(0xe011cfd0, 0); h.writeUInt32LE(0xe11ab1a1, 4); h.writeUInt16LE(0x3e, 24); h.writeUInt16LE(3, 26); h.writeUInt16LE(0xfffe, 28); h.writeUInt16LE(9, 30); h.writeUInt16LE(6, 32);
  h.writeUInt32LE(1, 44); h.writeUInt32LE(1, 48); h.writeUInt32LE(4096, 56); h.writeUInt32LE(2, 60); h.writeUInt32LE(1, 64); h.writeUInt32LE(END, 68); h.writeUInt32LE(0, 72);
  h.writeUInt32LE(0, 76); for (let i = 1; i < 109; i++) h.writeUInt32LE(FREE, 76 + i * 4);
  const padded = Buffer.concat([mini, Buffer.alloc(nMiniSec * SS - mini.length)]);
  return Buffer.concat([h, fat, dir, mf, padded]);
}
function hwp(paras, flags = 1) {
  const fh = Buffer.alloc(256); fh.write('HWP Document File', 0, 'latin1'); fh.writeUInt32LE(0x05000300, 32); fh.writeUInt32LE(flags, 36);
  return cfb({ FileHeader: fh, Section0: flags & 1 ? hwpRecords(paras) : hwpRecords(paras) });
}
const pdf = (text) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${text.length + 30}>>stream\nBT /F1 18 Tf 20 100 Td (${text}) Tj ET\nendstream\nendobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>`);

async function up(c, name, mime, data, folder = '') {
  const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  const done = await c.ok('POST', `/api/library/${init.id}/complete`, {});
  return { id: init.id, done };
}
const text = async (id) => (await sql`select text_content, text_tried_at, folder, security_suggested from library_files where id = ${id}`)[0];

describe('V14 32 자료실 본문 추출·정리', () => {
  test('HWP 5.0: OLE + 압축 레코드에서 문단 글자(컨트롤 건너뜀) → 검색됨', async () => {
    await queue([organized('인사/근로계약')]);
    const { id, done } = await up(ctx.owner, '근로계약서_홍길동.hwp', 'application/x-hwp', hwp(['근로계약서', '제1조 근무 장소는 강남점으로 한다.']));
    assert.equal(done.hasText, true);
    const t = await text(id);
    assert.ok(t.text_content.includes('근로계약서') && t.text_content.includes('제1조 근무 장소는 강남점으로 한다.'), t.text_content);
    assert.ok(!/[\u0000-\u0008]/.test(t.text_content), '컨트롤 문자 없음'); assert.ok(t.text_tried_at);
    assert.ok((await ctx.owner.ok('GET', '/api/library?q=' + encodeURIComponent('근무 장소'))).files.some((f) => f.id === id), '본문 검색');
    assert.deepEqual([t.folder, t.security_suggested], ['인사/근로계약', 'confidential'], 'AI 가 고른 기존 폴더로 + 인사 폴더 = 기밀 제안');
  });
  test('비밀번호·배포용 HWP 는 읽지 않음(null) → 올리기는 됨', async () => {
    await queue([organized('인사/근로계약')]);
    const { id, done } = await up(ctx.owner, '배포용.hwp', 'application/x-hwp', hwp(['비밀'], 1 | 0b100));
    assert.equal(done.hasText, false); assert.equal((await text(id)).text_content, null);
  });
  test('HWPX: Contents/section0.xml 의 <hp:t>', async () => {
    await queue([organized('운영/업무 보고')]);
    const { id } = await up(ctx.owner, '10월 업무보고.hwpx', 'application/hwp+zip', hwpx(['10월 업무 보고', '매출 &amp; 회원 현황 정리']));
    const t = await text(id);
    assert.ok(t.text_content.includes('10월 업무 보고') && t.text_content.includes('매출 & 회원 현황 정리'), t.text_content);
    assert.deepEqual([t.folder, t.security_suggested], ['운영/업무 보고', 'internal'], '운영 폴더는 기밀 제안 없음');
  });
  test('PDF: 글자 있는 PDF 는 pdfjs 로, 글자 없는 PDF 는 null(정리 때 AI 비전)', async () => {
    await queue([organized('재무/손익분기점')]);
    const { id } = await up(ctx.owner, 'bep-2026.pdf', 'application/pdf', pdf('Break Even Point 2026'));
    const t = await text(id);
    assert.ok(t.text_content.includes('Break Even Point 2026'), t.text_content);
    assert.equal(t.security_suggested, 'confidential', '재무 폴더 = 기밀 제안');
    await queue([organized('미분류')]);
    const scan = await up(ctx.owner, 'scan.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%garbage'));
    assert.equal((await text(scan.id)).text_content, null);
  });
  test('기존 파일 일괄 재추출: 본문 없고 시도 안 한 HWP·PDF 만 정기 실행이 읽고 시도 시각을 남김', async () => {
    const [a] = await sql`select id from library_files where file_name = '근로계약서_홍길동.hwp'`;
    const [b] = await sql`select id from library_files where file_name = '배포용.hwp'`;
    await sql`update library_files set text_content = null, text_tried_at = null where id in (${a.id}, ${b.id})`;
    const r = await tick();
    assert.deepEqual(r.detail.textExtract, { tried: 2, got: 1 }, JSON.stringify(r.detail.textExtract));
    assert.ok((await text(a.id)).text_content.includes('근로계약서'));
    const bb = await text(b.id); assert.equal(bb.text_content, null); assert.ok(bb.text_tried_at, '못 읽은 것도 시도 기록 → 반복 안 함');
    assert.deepEqual((await tick()).detail.textExtract, { tried: 0, got: 0 });
  });
  test('올린 직후 알림: 같은 시간대는 1건으로 묶여 건수가 올라감 · AI 정리 실패면 알림 없음', async () => {
    const rows = await sql`select title, body from notifications where user_id = ${ctx.ownerId} and type = 'library_organized'`;
    assert.equal(rows.length, 1, '한 사람·한 시간 = 알림 1건');
    assert.match(rows[0].title, /^자료 정리 \d+개 — 마지막: /); assert.match(rows[0].body, /^\d+개를 올렸고/);
    const n = Number(/(\d+)개/.exec(rows[0].body)[1]);
    assert.ok(n >= 5, `건수 누적 ${n}`);
    const prefs = await ctx.owner.ok('GET', '/api/notifications/prefs');
    assert.ok(prefs.types.some((t) => t.type === 'library_organized'), '알림 설정에 종류 있음');
    await queue([say('그냥 글')]); // JSON 아님 → 파일명 규칙으로 정리(AI 실패) → 알림 안 늘어남
    await up(ctx.owner, '메모.txt', 'text/plain', Buffer.from('메모'));
    assert.equal(Number(/(\d+)개/.exec((await sql`select body from notifications where user_id = ${ctx.ownerId} and type = 'library_organized'`)[0].body)[1]), n);
  });
});
