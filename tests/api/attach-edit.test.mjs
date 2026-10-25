// 대표 10/20 23:05 업무 첨부 파일 열어서 편집·저장: docx → 워크인 문서(공동 편집, 참여자 편집 공유) → [업무로 저장] = Word 새 버전 · xlsx 칸 고치기 → 새 버전(서식 유지) · 새 버전 올리기·되돌리기·이전 버전 내려받기 · 타임라인·요청자 알림 · 권한(참여자만)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { assertPdfGlyphs } from '../pdfCheck.mjs';

let srv, ctx, sql, taskId;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '제안서 검토', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id; });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const fetchBytes = async (c, path) => { const r = await fetch(BASE + path, { headers: { cookie: c.cookie, origin: BASE }, redirect: 'follow' }); assert.equal(r.status, 200, `${path} ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
const upload = async (c, name, mime, bytes, tid = taskId) => {
  const init = await c.ok('POST', '/api/attachments', { taskId: tid, kind: 'file', fileName: name, mimeType: mime, size: bytes.length });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: bytes });
  await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
  return init.id;
};
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const P = {};

test('docx [열어서 편집]: 담당자가 워크인 문서로(1회 변환, 참여자 편집 공유) → 같이 고침 → [업무로 저장] = Word 새 버전 v2 + 타임라인 + 요청자 알림 · 참여자 아닌 직원 403/404', async () => {
  // 실제 .docx 는 워크인 문서 내보내기로 만든다(제목 + 글머리)
  const d = await ctx.owner.ok('POST', '/api/library/docs', { title: '제안서 초안', folder: '제안' });
  const docx = await fetchBytes(ctx.owner, `/api/library/docs/${d.id}/export?format=docx`);
  assert.ok(docx.length > 500 && docx.subarray(0, 2).toString() === 'PK', 'docx zip');
  P.att = await upload(ctx.owner, '제안서 초안.docx', DOCX, docx);
  assert.ok([403, 404].includes((await ctx.staffB.client.req('POST', `/api/attachments/${P.att}/doc`, {})).status), '참여자 아니면 못 엶');
  const r = await ctx.staffA.client.ok('POST', `/api/attachments/${P.att}/doc`, {});
  assert.equal(r.created, true); assert.match(r.link, new RegExp(`/library/doc/${r.docId}\\?att=${P.att}`));
  P.doc = r.docId;
  const shares = await sql`select user_id, role from lib_doc_shares where doc_id = ${P.doc}`;
  assert.deepEqual(shares.map((s) => [s.user_id, s.role]).sort(), [[ctx.ownerId, 'edit'], [ctx.staffA.id, 'edit']].sort(), '요청자·담당자 편집 공유');
  const open = await ctx.staffA.client.ok('GET', `/api/library/docs/${P.doc}`);
  assert.equal(open.canEdit, true); assert.ok(open.snapshot.length > 10, '변환된 내용');
  const [lf] = await sql`select task_id, folder, mime_type from library_files where id = ${P.doc}`;
  assert.equal(lf.task_id, taskId); assert.match(lf.folder, /^업무 첨부\//); assert.equal(lf.mime_type, 'application/x-workin-doc');
  assert.equal((await ctx.owner.ok('POST', `/api/attachments/${P.att}/doc`, {})).created, false, '두 번째는 같은 문서');
  assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'file_opened_doc'`).length);
  // [업무로 저장] → v2(docx), 원본은 v1 로 보관
  const s = await ctx.staffA.client.ok('POST', `/api/attachments/${P.att}/doc/save`, {});
  assert.equal(s.version, 2); assert.match(s.fileName, /\.docx$/);
  const v = await ctx.owner.ok('GET', `/api/attachments/${P.att}/versions`);
  assert.deepEqual([v.current, v.docId, v.editKind, v.canEdit, v.versions.map((x) => [x.version, x.kind])], [2, P.doc, 'doc', true, [[2, 'doc'], [1, 'original']]]);
  const [a] = await sql`select version, file_name, updated_by from attachments where id = ${P.att}`;
  assert.deepEqual([a.version, a.updated_by], [2, ctx.staffA.id]);
  const h = await sql`select changes from activities where entity_id = ${taskId} and action = 'file_edited' order by created_at desc limit 1`;
  assert.equal(h[0].changes.version, 2);
  const n = await sql`select title, link from notifications where user_id = ${ctx.ownerId} and type = 'comment' and title like '파일 수정 v2%'`;
  assert.equal(n.length, 1, '요청자(본인 제외) 알림'); assert.equal(n[0].link, `/tasks/${taskId}`);
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.staffA.id} and title like '파일 수정%'`)[0].n, 0, '고친 사람은 안 받음');
  const t = await ctx.owner.ok('GET', `/api/tasks/${taskId}`);
  assert.equal(t.attachments.find((x) => x.id === P.att).version, 2);
  // 새 버전 파일 내려받기 = docx
  const bytes = await fetchBytes(ctx.owner, `/api/attachments/${P.att}/download`);
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const v1 = v.versions.find((x) => x.version === 1);
  assert.equal((await ctx.owner.get(`/api/attachments/${P.att}/versions/${v1.id}/download`)).status, 302, '이전 버전 내려받기');
});

test('새 버전 올리기(pdf 등 편집 불가 파일) → v2, 되돌리기 → v3(원본 이름), 참여자 아닌 사람 403', async () => {
  const id = await upload(ctx.owner, '현장 사진.pdf', 'application/pdf', Buffer.from('%PDF-1.4 v1'));
  assert.ok([403, 404].includes((await ctx.staffB.client.req('POST', `/api/attachments/${id}/versions`, { fileName: 'x.pdf', size: 3 })).status));
  const st = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/versions`, { fileName: '현장 사진 수정.pdf', mimeType: 'application/pdf', size: 11 });
  await fetch(BASE + st.upload.url, { method: 'PUT', headers: st.upload.headers, body: Buffer.from('%PDF-1.4 v2') });
  const c = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/versions/complete`, { key: st.key, fileName: '현장 사진 수정.pdf', mimeType: 'application/pdf', note: '도장 추가' });
  assert.equal(c.version, 2);
  let v = await ctx.owner.ok('GET', `/api/attachments/${id}/versions`);
  assert.deepEqual(v.versions.map((x) => [x.version, x.kind, x.file_name]), [[2, 'upload', '현장 사진 수정.pdf'], [1, 'original', '현장 사진.pdf']]);
  assert.equal(v.versions[0].note, '도장 추가');
  const r = await ctx.owner.ok('POST', `/api/attachments/${id}/versions/${v.versions[1].id}/restore`, {});
  assert.equal(r.version, 3);
  const [a] = await sql`select version, file_name, storage_key from attachments where id = ${id}`;
  assert.deepEqual([a.version, a.file_name], [3, '현장 사진.pdf']); assert.equal(a.storage_key, v.versions[1].storage_key ?? a.storage_key);
  v = await ctx.owner.ok('GET', `/api/attachments/${id}/versions`);
  assert.deepEqual(v.versions.map((x) => x.kind), ['restore', 'upload', 'original']);
  assert.equal((await ctx.owner.req('POST', `/api/attachments/${id}/versions/complete`, { key: 'att/other/x', fileName: 'x' })).status, 400, '다른 자리 키');
});

test('xlsx [칸 고치기]: 값 있는 칸 읽기 → 값 바꿔 저장 = 새 버전(서식·수식 유지) → 다시 읽으면 바뀐 값', async () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  await ctx.owner.ok('POST', '/api/tasks', { title: '엑셀 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: today, approvalRequired: false });
  const xlsx = await fetchBytes(ctx.owner, `/api/export/tasks?basis=due&start=${today}&end=${today}`);
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
  const id = await upload(ctx.owner, '업무 목록.xlsx', XLSX, xlsx);
  const lay = await ctx.staffA.client.ok('GET', `/api/attachments/${id}/sheet`);
  assert.equal(lay.canEdit, true); assert.ok(lay.sheets.length >= 1 && Object.keys(lay.sheets[0].cells).length > 3, JSON.stringify(lay).slice(0, 300));
  const sheet = lay.sheets[0].name; const first = Object.keys(lay.sheets[0].cells)[0];
  assert.equal((await ctx.owner.req('POST', `/api/attachments/${P.att}/sheet`, { edits: [{ cell: 'A1', value: 'x' }] })).status, 400, 'docx 는 칸 고치기 아님');
  const r = await ctx.staffA.client.ok('POST', `/api/attachments/${id}/sheet`, { edits: [{ sheet, cell: first, value: '고친 제목' }, { sheet, cell: 'Z200', value: 123 }] });
  assert.equal(r.version, 2);
  const lay2 = await ctx.owner.ok('GET', `/api/attachments/${id}/sheet`);
  assert.equal(lay2.version, 2); assert.equal(lay2.sheets[0].cells[first], '고친 제목'); assert.equal(lay2.sheets[0].cells.Z200, 123);
  assert.ok([403, 404].includes((await ctx.staffB.client.req('GET', `/api/attachments/${id}/sheet`)).status));
  assert.equal((await sql`select count(*)::int n from activities where action = 'file_edited' and changes->>'kind' = 'sheet'`)[0].n, 1);
});

test('#533 [고치기]: 원본 읽기(고칠 사람만) · 글 고쳐 새 버전(글 고침) · PDF 에 가리기·글자·체크·서명 → 같은 자리에 찍힌 새 버전(PDF 에 써넣음)', async () => {
  const txt = await upload(ctx.owner, '회의 메모.txt', 'text/plain', Buffer.from('첫 줄\n둘째 줄', 'utf8'));
  assert.ok([403, 404].includes((await ctx.staffB.client.req('GET', `/api/attachments/${txt}/raw`)).status), '참여자 아니면 원본 못 읽음');
  assert.equal((await fetchBytes(ctx.staffA.client, `/api/attachments/${txt}/raw`)).toString('utf8'), '첫 줄\n둘째 줄');
  const body = Buffer.from('첫 줄 고침\n둘째 줄\n셋째 줄', 'utf8');
  const st = await ctx.staffA.client.ok('POST', `/api/attachments/${txt}/versions`, { fileName: '회의 메모.txt', mimeType: 'text/plain', size: body.length, note: '브라우저에서 글 고침' });
  await fetch(BASE + st.upload.url, { method: 'PUT', headers: st.upload.headers, body });
  assert.equal((await ctx.staffA.client.ok('POST', `/api/attachments/${txt}/versions/complete`, { key: st.key, fileName: '회의 메모.txt', mimeType: 'text/plain', note: '브라우저에서 글 고침', edit: 'text' })).version, 2);
  assert.equal((await fetchBytes(ctx.staffA.client, `/api/attachments/${txt}/raw`)).toString('utf8'), body.toString('utf8'));
  assert.deepEqual((await ctx.staffA.client.ok('GET', `/api/attachments/${txt}/versions`)).versions.map((v) => [v.version, v.kind]), [[2, 'text'], [1, 'original']]);
  assert.equal((await ctx.staffA.client.req('POST', `/api/attachments/${txt}/pdf`, { items: [{ type: 'check', page: 1, x: 0, y: 0, w: 0.1, h: 0.1 }] })).status, 400, 'PDF 아닌 첨부');

  const { PDFDocument } = await import('pdf-lib');
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); const pdf = Buffer.from(await d.save());
  const pid = await upload(ctx.owner, '견적서.pdf', 'application/pdf', pdf);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const T = { type: 'text', page: 1, x: 0.1, y: 0.2, w: 0.4, h: 0.04, value: '합계 1,200,000원' };
  assert.equal((await ctx.staffA.client.req('POST', `/api/attachments/${pid}/pdf`, { items: [{ ...T, page: 2 }] })).status, 400, '없는 쪽');
  assert.equal((await ctx.staffA.client.req('POST', `/api/attachments/${pid}/pdf`, { items: [{ ...T, value: '  ' }] })).status, 400, '빈 글자');
  assert.equal((await ctx.staffA.client.req('POST', `/api/attachments/${pid}/pdf`, { items: [{ ...T, x: 0.8 }] })).status, 400, '쪽 밖');
  assert.equal((await ctx.staffA.client.req('POST', `/api/attachments/${pid}/pdf`, { items: [{ type: 'sign', page: 1, x: 0.6, y: 0.8, w: 0.25, h: 0.07 }] })).status, 400, '서명 그림 없음');
  assert.ok([403, 404].includes((await ctx.staffB.client.req('POST', `/api/attachments/${pid}/pdf`, { items: [T] })).status), '참여자 아니면 못 고침');
  const items = [{ type: 'cover', page: 1, x: 0.1, y: 0.2, w: 0.4, h: 0.04 }, T, { type: 'check', page: 1, x: 0.6, y: 0.2, w: 0.03, h: 0.02 }, { type: 'sign', page: 1, x: 0.6, y: 0.8, w: 0.25, h: 0.07, image: PNG }];
  assert.equal((await ctx.staffA.client.ok('POST', `/api/attachments/${pid}/pdf`, { items })).version, 2);
  const out = await fetchBytes(ctx.staffA.client, `/api/attachments/${pid}/raw`);
  assert.equal(out.subarray(0, 5).toString(), '%PDF-'); assert.notEqual(out.length, pdf.length);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(out), useSystemFonts: false, isEvalSupported: false }).promise;
  assert.equal(doc.numPages, 1, '쪽 수 그대로');
  const page = await doc.getPage(1), { width: W, height: H } = page.getViewport({ scale: 1 });
  const hit = (await page.getTextContent()).items.find((i) => i.str.includes('1,200,000'));
  assert.equal(hit?.str, '합계 1,200,000원', '넣은 글자 그대로(다시 읽기)');
  await assertPdfGlyphs(assert, out, '업무 첨부 PDF 써넣기'); // 147차: 한글이 실제로 그려지는지(크롬에서 안 보이던 글꼴 깨짐)
  assert.ok(Math.abs(hit.transform[4] - (T.x * W + 1)) < 2, `x ${hit.transform[4]}`); // 같은 자리: 칸 왼쪽 + 1pt
  const by = H - T.y * H - T.h * H; assert.ok(hit.transform[5] > by && hit.transform[5] < by + T.h * H, `y ${hit.transform[5]}`);
  const v = (await ctx.staffA.client.ok('GET', `/api/attachments/${pid}/versions`)).versions;
  assert.deepEqual(v.map((x) => [x.version, x.kind]), [[2, 'pdf'], [1, 'original']]);
  assert.equal(v[0].note, 'PDF 에 써넣음(글자 1·체크 1·서명 1·가리기 1)');
  assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'file_edited' and changes->>'kind' = 'pdf'`).length, '업무 타임라인');
});

test('#258 PDF 글자 칸보다 긴 글: 칸 폭에서 줄을 바꾸고 글자를 줄여 칸 안에 다 찍음(잘리지 않음) · 가장 작은 글자로도 넘치면 400(버전 그대로)', async () => {
  const { PDFDocument } = await import('pdf-lib');
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); const pdf = Buffer.from(await d.save());
  const pid = await upload(ctx.owner, '긴 글 견적서.pdf', 'application/pdf', pdf);
  const long = '이 견적서는 3층 회의실 프로젝터 교체 공사를 기준으로 작성했으며 설치비와 운반비를 모두 포함한 금액입니다';
  const T = { type: 'text', page: 1, x: 0.1, y: 0.3, w: 0.3, h: 0.06, value: long };
  assert.equal((await ctx.staffA.client.ok('POST', `/api/attachments/${pid}/pdf`, { items: [T] })).version, 2);
  const out = await fetchBytes(ctx.staffA.client, `/api/attachments/${pid}/raw`);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(out), useSystemFonts: false, isEvalSupported: false }).promise;
  const page = await doc.getPage(1), { width: W, height: H } = page.getViewport({ scale: 1 });
  const items = (await page.getTextContent()).items.filter((i) => i.str.trim());
  assert.equal(items.map((i) => i.str).join('').replace(/\s/g, ''), long.replace(/\s/g, ''), '글 전부(뒤를 자르지 않음)');
  await assertPdfGlyphs(assert, out, '업무 첨부 PDF 긴 글'); // 147차: 줄마다 한글이 실제로 그려지는지
  const ys = [...new Set(items.map((i) => Math.round(i.transform[5])))];
  assert.ok(ys.length >= 2, `여러 줄로 바꿈 ${ys}`);
  const bx = T.x * W, bw = T.w * W, bh = T.h * H, by = H - T.y * H - bh;
  for (const i of items) {
    const size = Math.hypot(i.transform[0], i.transform[1]);
    assert.ok(size >= 5, `글자 크기 ${size}`);
    assert.ok(i.transform[4] >= bx && i.transform[4] + i.width <= bx + bw + 0.5, `칸 폭 안 x ${i.transform[4]} w ${i.width}`);
    assert.ok(i.transform[5] >= by && i.transform[5] + size * 0.8 <= by + bh + 0.5, `칸 높이 안 y ${i.transform[5]}`);
  }
  // 작은 칸에 아주 긴 글 → 칸을 키우라는 400, 새 버전 안 생김
  const r = await ctx.staffA.client.req('POST', `/api/attachments/${pid}/pdf`, { items: [{ ...T, w: 0.1, h: 0.012, value: long.repeat(3) }] });
  assert.equal(r.status, 400); assert.match(r.body?.error?.message ?? '', /칸에 다 들어가지 않습니다/);
  assert.equal((await ctx.staffA.client.ok('GET', `/api/attachments/${pid}/versions`)).versions[0].version, 2);
});
