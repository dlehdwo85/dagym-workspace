// 전자계약 2차(대표 10/23 "글로싸인 레퍼런스", docs/handoff/ECONTRACT_GLOSIGN_REFERENCE_2026-10-23.md §7 시험 기준):
// 2쪽 PDF 올리기(사진은 PDF 로) → 서명자 2명(순서 1·2)에게 서명·날짜·텍스트 칸 → 서명자마다 서명 칸 없으면 막힘 → 1번이 서명해야 2번 차례 →
// 완료본 같은 좌표에 텍스트·날짜가 찍히고 감사 추적 쪽에 원본 해시 → 상태 바구니(내 서명 필요·상대 서명 필요) → 다른 회사 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';
import { assertPdfGlyphs } from '../pdfCheck.mjs';

let srv, ctx, sql;
const P = {};
before(async () => { await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const pub = async (method, path, body, ua = 'E2E-Phone/1.0') => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', origin: BASE, 'user-agent': ua, 'x-forwarded-for': '203.0.113.9' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: r.headers.get('content-type')?.includes('json') ? await r.json() : null, buf: r.headers.get('content-type')?.includes('pdf') ? Buffer.from(await r.arrayBuffer()) : null };
};
const tokenOf = (link) => link.split('/sign/')[1];
const sha = (b) => createHash('sha256').update(b).digest('hex');
async function upload(c, name, mime, data) {
  const t = await c.ok('POST', '/api/contracts/upload', { fileName: name, mime, size: data.length });
  await fetch(BASE + t.upload.url, { method: 'PUT', headers: t.upload.headers, body: data });
  return c.ok('POST', '/api/contracts/source', { key: t.key });
}
const textAt = async (pdf, pageNo) => { // pdf.js 로 그 쪽 글자와 위치
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, isEvalSupported: false }).promise;
  const page = await doc.getPage(pageNo); const vp = page.getViewport({ scale: 1 });
  return { W: vp.width, H: vp.height, items: (await page.getTextContent()).items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] })) };
};

test('올리기: 2쪽 PDF 그대로(쪽 수·해시) · 사진은 A4 PDF 로 · 다른 형식·다른 회사 키는 막힘', async () => {
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); d.addPage([595.28, 841.89]);
  // 로컬 10/25 17:05 ①: 원본 쪽에 글자 레이어를 두어, 완료본에서도 그 글자가 추출되는지(평면화가 아닌지) 본다
  d.getPages()[0].drawText('ORIGINAL TEXT LAYER', { x: 50, y: 700, size: 12, font: await d.embedFont(StandardFonts.Helvetica) });
  P.pdf = Buffer.from(await d.save());
  const s = await upload(ctx.owner, '용역 계약서.pdf', 'application/pdf', P.pdf);
  assert.deepEqual([s.pages, s.sha256], [2, sha(P.pdf)]);
  P.key = s.key;
  const img = await upload(ctx.owner, '사진 계약서.png', 'image/png', Buffer.from(PNG.split(',')[1], 'base64'));
  assert.equal(img.pages, 1); assert.match(img.key, /\.png\.pdf$/, '사진 → PDF');
  assert.equal((await ctx.owner.req('POST', '/api/contracts/upload', { fileName: '계약서.hwp', mime: 'application/x-hwp', size: 10 })).status, 400, '한글은 PDF 로 저장해 올리라고 안내');
  assert.equal((await ctx.owner.req('POST', '/api/contracts/source', { key: s.key.replace('contract/default/', 'contract/other-co/') })).status, 400, '다른 회사 키');
  assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/contracts/upload', { fileName: 'a.pdf', mime: 'application/pdf', size: 10 })).status), '사용자 관리 권한 없음');
});

test('만들기: 서명자마다 서명·도장 칸이 없으면 막힘 · 보내면 1번 서명자에게만(링크·코드)', async () => {
  const signers = [{ name: '거래처 김담당', email: 'partner@example.test', role: 'party' }, { name: '김대표', email: 'ceo@dagym.test', role: 'company', userId: ctx.ownerId }];
  const base = { title: '시설 운영 용역 계약서', sourceKey: P.key, sourceName: '용역 계약서.pdf', signers, message: '확인 후 서명 부탁드립니다' };
  P.fields = [
    { signer: 0, type: 'sign', page: 1, x: 0.6, y: 0.8, w: 0.2, h: 0.06 },
    { signer: 0, type: 'date', page: 1, x: 0.1, y: 0.82, w: 0.25, h: 0.03 },
    { signer: 0, type: 'text', page: 2, x: 0.1, y: 0.3, w: 0.5, h: 0.03, label: '주소', required: true },
    { signer: 1, type: 'stamp', page: 2, x: 0.7, y: 0.8, w: 0.1, h: 0.07 },
  ];
  const r0 = await ctx.owner.req('POST', '/api/contracts/pdf', { ...base, fields: P.fields.slice(0, 3) });
  assert.equal(r0.status, 400); assert.match(JSON.stringify(r0.body), /김대표/);
  assert.equal((await ctx.owner.req('POST', '/api/contracts/pdf', { ...base, fields: [{ ...P.fields[0], page: 3 }, P.fields[3]] })).status, 400, '없는 쪽');
  const r = await ctx.owner.ok('POST', '/api/contracts/pdf', { ...base, fields: P.fields });
  assert.match(r.docNo, /^계약-\d{4}-\d{4}$/); P.id = r.id;
  assert.deepEqual(r.delivery.map((d) => d.name), ['거래처 김담당'], '1번 순서만');
  P.s1 = { token: tokenOf(r.delivery[0].link), code: r.delivery[0].code };
  const l = await ctx.owner.ok('GET', '/api/contracts');
  assert.equal(l.contracts.find((c) => c.id === P.id).bucket, 'others', '상대 서명 필요');
  assert.equal(l.counts.mine, 0);
});

test('서명: 내 칸·원본 PDF · 필수 텍스트·서명 없으면 막힘 · 1번 서명 뒤 2번 차례(내 서명 필요) · 완료본 같은 좌표·감사 추적 원본 해시', async () => {
  const v = (await pub('POST', `/api/sign/${P.s1.token}/view`, { code: P.s1.code })).json;
  assert.equal(v.doc.pages, 2);
  assert.deepEqual(v.doc.fields.filter((f) => f.mine).map((f) => f.type).sort(), ['date', 'sign', 'text']);
  assert.deepEqual(v.doc.fields.filter((f) => !f.mine).map((f) => [f.type, f.signer]), [['stamp', 1]]);
  const src = await pub('GET', `/api/sign/${P.s1.token}/source?code=${P.s1.code}`);
  assert.equal(sha(src.buf), sha(P.pdf), '서명 화면이 그리는 원본 = 올린 파일');
  assert.equal((await pub('GET', `/api/sign/${P.s1.token}/source?code=000000`)).status, 403);
  const text = v.doc.fields.find((f) => f.mine && f.type === 'text');
  assert.equal((await pub('POST', `/api/sign/${P.s1.token}/sign`, { code: P.s1.code, image: PNG, agree: true, fields: [] })).status, 400, '필수 텍스트');
  assert.equal((await pub('POST', `/api/sign/${P.s1.token}/sign`, { code: P.s1.code, agree: true, fields: [{ id: text.id, value: '서울시 강남구 테헤란로 1' }] })).status, 400, '서명 없음');
  const ok = (await pub('POST', `/api/sign/${P.s1.token}/sign`, { code: P.s1.code, image: PNG, agree: true, fields: [{ id: text.id, value: '서울시 강남구 테헤란로 1' }] })).json;
  assert.equal(ok.status, 'partially_signed');
  const l = await ctx.owner.ok('GET', '/api/contracts?bucket=mine');
  assert.deepEqual([l.contracts.map((c) => c.id), l.counts.mine], [[P.id], 1], '이제 대표(2번) 차례 = 내 서명 필요');
  const d2 = (await ctx.owner.ok('POST', `/api/contracts/${P.id}/resend`, {})).delivery[0];
  const s2 = { token: tokenOf(d2.link), code: d2.code };
  const v2 = (await pub('POST', `/api/sign/${s2.token}/view`, { code: s2.code })).json;
  assert.equal(v2.doc.fields.find((f) => f.type === 'text').value, '서울시 강남구 테헤란로 1', '앞 서명자가 채운 값이 보임');
  const done = (await pub('POST', `/api/sign/${s2.token}/sign`, { code: s2.code, image: PNG, method: 'stamp', agree: true }, CHROME_UA)).json; // 2번 서명은 윈도우 크롬 UA 로(기기 이름 확인용)
  assert.deepEqual([done.status, done.completed], ['completed', true]);
  const pdf = (await pub('GET', `/api/sign/${s2.token}/pdf?code=${s2.code}`)).buf;
  const [c] = await sql`select final_sha256, original_sha256, file_id from contracts where id = ${P.id}`;
  assert.deepEqual([c.final_sha256, c.original_sha256], [sha(pdf), sha(P.pdf)]);
  const out = await PDFDocument.load(pdf);
  assert.ok(out.getPageCount() >= 3, '원본 2쪽 + 감사 추적');
  const p2 = await textAt(pdf, 2);
  const addr = p2.items.find((i) => i.str.includes('서울시 강남구'));
  assert.ok(addr, JSON.stringify(p2.items.slice(0, 5)));
  const f = P.fields[2]; // 같은 좌표: 칸 안(왼쪽 x·위아래 y 범위)
  assert.ok(Math.abs(addr.x - (f.x * p2.W + 1)) < 2, `x ${addr.x}`);
  assert.ok(addr.y > p2.H * (1 - f.y - f.h) - 1 && addr.y < p2.H * (1 - f.y), `y ${addr.y}`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  assert.ok((await textAt(pdf, 1)).items.some((i) => i.str.includes(today)), '날짜 칸 = 서명일');
  const audit = (await textAt(pdf, 3)).items.map((i) => i.str).join(' ');
  assert.match(audit, new RegExp(sha(P.pdf).slice(0, 16)), '감사 추적 쪽에 원본 해시');
  // 로컬 10/25 17:05 ①: 원본 쪽은 평면화(그림) 없이 그대로 — 원본에 있던 글자가 완료본 1쪽에서도 추출됨 · 기기 칸은 UA 원문 자르기 대신 '크롬 141 · 윈도우'
  assert.ok((await textAt(pdf, 1)).items.some((i) => i.str.includes('ORIGINAL TEXT LAYER')), '원본 쪽 글자 레이어 그대로(평면화 아님)');
  assert.ok(audit.includes('크롬 141 · 윈도우') && !audit.includes('KHTML'), `기기 이름 ${audit.slice(-200)}`);
  assert.ok(audit.includes('E2E-Phone/1.0'), '모르는 UA 는 앞 40자 그대로');
  const ev = await ctx.owner.ok('GET', `/api/contracts/${P.id}`);
  assert.ok(ev.events.some((e) => e.type === 'signed' && e.user_agent === CHROME_UA), '화면 표에 쓰는 원문(user_agent)은 DB 에 그대로');
  // 147차: 완료본을 다시 읽어 — 서명자가 채운 글·날짜·감사 추적(참여자 이름·행위) 글이 원문 그대로이고, 한글이 실제로 그려지는지(글꼴 깨짐이면 실패)
  const pages = await assertPdfGlyphs(assert, pdf, '전자계약 2차 완료본');
  assert.ok(pages[1].text.includes('서울시 강남구 테헤란로 1'), `텍스트 칸 값 그대로 ${JSON.stringify(pages[1].text)}`);
  assert.ok(pages[0].text.includes(today), '날짜 칸 값 그대로');
  const auditLines = pages.at(-1).text;
  for (const s of ['서명 감사 추적', '서명자', '행위 기록']) assert.ok(auditLines.includes(s), `감사 추적 '${s}'`);
  assert.ok(auditLines.some((l) => l.includes('거래처 김담당')) && auditLines.some((l) => l.includes('김대표')) && auditLines.some((l) => l.includes('시설 운영 용역 계약서')), '감사 추적 참여자 이름·제목');
  assert.equal((await ctx.owner.ok('GET', '/api/contracts?bucket=done')).contracts[0].id, P.id);
  await sql`update contracts set tenant = 'other-co' where id = ${P.id}`;
  assert.equal((await ctx.owner.req('GET', `/api/contracts/${P.id}`)).status, 404, '다른 회사 계약 404');
  await sql`update contracts set tenant = 'default' where id = ${P.id}`;
});

test('삭제(로컬 10/25 17:05 ①, 대표 "시험 흔적 지우세요"): 끝난 계약은 취소(DELETE) 409 → ?purge=1 로 통째로 지움(대표·관리자) → 404·목록·서명자·완료본 PDF 함께 · 직원은 못 지움 · 감사 기록', async () => {
  assert.equal((await ctx.owner.req('DELETE', `/api/contracts/${P.id}`)).status, 409, '완료된 계약은 취소가 아니라');
  assert.ok([403, 404].includes((await ctx.staffA.client.req('DELETE', `/api/contracts/${P.id}?purge=1`)).status), '직원은 못 지움');
  const [c] = await sql`select file_id, doc_no from contracts where id = ${P.id}`;
  assert.ok(c.file_id, '완료본 PDF 파일');
  await ctx.owner.ok('DELETE', `/api/contracts/${P.id}?purge=1`);
  assert.equal((await ctx.owner.req('GET', `/api/contracts/${P.id}`)).status, 404, '지운 뒤 상세 404');
  assert.ok(!(await ctx.owner.ok('GET', '/api/contracts')).contracts.some((x) => x.id === P.id), '목록에서 사라짐');
  assert.equal((await sql`select count(*)::int n from contract_signers where contract_id = ${P.id}`)[0].n, 0, '서명자·기록 함께');
  assert.equal((await sql`select count(*)::int n from contract_events where contract_id = ${P.id}`)[0].n, 0);
  assert.ok((await sql`select deleted_at from library_files where id = ${c.file_id}`)[0]?.deleted_at, '완료본 PDF 는 자료실에서 지운 파일로');
  const [a] = await sql`select detail from audit_logs where action = 'contract.delete' and target_id = ${P.id}`;
  assert.deepEqual([a?.detail?.docNo, a?.detail?.status], [c.doc_no, 'completed'], '감사 기록에 문서번호·상태');
});
