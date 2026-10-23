// S1-4(로컬 10/20): 공고 첨부 중계 /api/bids/file?u=&n= · /api/bids/kapt-file — 로그인·영업 공간 필요 · 허용 사이트만(403) · https 만 · 리다이렉트 안 따라감(502) · 30MB 상한(413) · octet-stream 강제 내려받기(이름 유지) · 저장 안 함
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer } from '../helpers.mjs';
import { HWP5, fakeKapt } from '../fakeKapt.mjs';

let srv, ctx, fake, fakeBase;
const EUCKR_GONGGO = Buffer.from([0xb0, 0xf8, 0xb0, 0xed, 0xb9, 0xae]).toString('latin1'); // '공고문' EUC-KR 날 바이트(머리는 latin1 로 실림)
const PDF = Buffer.from('%PDF-1.4\n%fake\n'); const HWPX = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(26), Buffer.from('mimetypeapplication/hwp+zip')]); const ZIP = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(26), Buffer.from('data.bin')]);
const kapt = fakeKapt({ files: { '20261021092205298': [{ seq: 4329886, fileName: '커뮤니티 시설 위탁 운영업체 선정 입찰 공고.hwp' }, { seq: 4329887, fileName: '과업지시서', body: PDF }] } });
before(async () => {
  // #507 후속: 가짜 K-apt 를 먼저 띄우고 그 주소를 SALES_COLLECT_TEST_BASE 로(서버의 K-apt 바탕 = <fake>/kapt)
  fake = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    if (kapt.handle(req, res, body)) return;
    if (req.url.startsWith('/ok.hwp')) { res.writeHead(200, { 'content-type': 'application/x-hwp', 'content-length': '11' }); res.end('HWP-CONTENT'); return; }
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: '/ok.hwp' }); res.end(); return; }
    if (req.url.startsWith('/big')) { res.writeHead(200, { 'content-length': String(31 * 1024 * 1024) }); res.end(); return; }
    if (req.url.startsWith('/nolen')) { res.writeHead(200); for (let i = 0; i < 3; i++) res.write('x'.repeat(1024)); res.end(); return; }
    // 파일 대신 웹페이지(로그인·오류 화면) · 이름 머리 여러 모양 · 이름 없는 downloadFile.do(첫 바이트로 확장자)
    if (req.url.startsWith('/page.hwp')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!DOCTYPE html><html><body>로그인이 필요합니다</body></html>'); return; }
    if (req.url.startsWith('/euckr.do')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${EUCKR_GONGGO}.hwp"` }); res.end(HWP5); return; }
    if (req.url.startsWith('/pct-euckr.do')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=%B0%F8%B0%ED%B9%AE+%281%29.hwp;' }); res.end(HWP5); return; }
    if (req.url.startsWith('/star.do')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': "attachment; filename=\"x.pdf\"; filename*=UTF-8''%EC%9E%85%EC%B0%B0%20%EA%B3%B5%EA%B3%A0.pdf" }); res.end(PDF); return; }
    if (req.url.startsWith('/double.do')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename=${encodeURIComponent(encodeURIComponent('커뮤니티 시설 공고.hwp').replace(/%20/g, '+'))};` }); res.end(HWP5); return; } // 두 번 인코딩한 이름
    if (req.url.startsWith('/downloadFile.do')) { const q = new URL(req.url, 'http://x').searchParams.get('t'); res.writeHead(200, { 'content-type': 'application/octet-stream' }); res.end(q === 'hwpx' ? HWPX : q === 'zip' ? ZIP : PDF); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: fakeBase }); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.close(); });

const get = (path, cookie) => fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {} });
describe('S1-4 공고 첨부 중계', () => {
  test('로그인 없이는 401, 허용 밖 사이트 403, http 가 아닌 잘못된 주소 400', async () => {
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/ok.hwp')}`)).status, 401);
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent('https://evil.example.com/x.hwp')}`, ctx.owner.cookie)).status, 403);
    assert.equal((await get('/api/bids/file?u=notaurl', ctx.owner.cookie)).status, 400);
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent('http://www.g2b.go.kr/x.hwp')}`, ctx.owner.cookie)).status, 400, '공공 사이트도 https 만');
  });
  test('허용 사이트 첨부는 octet-stream 으로 그대로, 이름(n) 유지·한글 이름 인코딩', async () => {
    const r = await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/ok.hwp')}&n=${encodeURIComponent('공고문 (최종).hwp')}`, ctx.owner.cookie);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'application/octet-stream');
    assert.match(r.headers.get('content-disposition'), /attachment;.*filename\*=UTF-8''%EA%B3%B5%EA%B3%A0%EB%AC%B8/);
    assert.equal(r.headers.get('cache-control'), 'private, no-store');
    assert.equal(await r.text(), 'HWP-CONTENT');
    const r2 = await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/ok.hwp')}`, ctx.owner.cookie);
    assert.match(r2.headers.get('content-disposition'), /ok\.hwp/, '이름 없으면 주소의 파일 이름');
  });
  test('리다이렉트는 따라가지 않음(502), 30MB 넘으면 413, 길이 없는 응답도 그대로', async () => {
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/redirect')}`, ctx.owner.cookie)).status, 502);
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/big')}`, ctx.owner.cookie)).status, 413);
    const r = await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/nolen')}`, ctx.owner.cookie);
    assert.equal(r.status, 200); assert.equal((await r.text()).length, 3072);
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/missing')}`, ctx.owner.cookie)).status, 502);
  });
  test('K-apt 중계: k-apt.go.kr 만(다른 곳 400), bid·seq 로 주소를 만들고 u 도 받음 — 영업 공간 없는 직원은 404', async () => {
    assert.equal((await get(`/api/bids/kapt-file?u=${encodeURIComponent(fakeBase + '/ok.hwp')}`, ctx.owner.cookie)).status, 400);
    assert.equal((await get('/api/bids/kapt-file', ctx.owner.cookie)).status, 400);
    assert.equal((await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/ok.hwp')}`, ctx.staffA.client.cookie)).status, 404, '영업 공간 미배정 직원');
  });

  test('#507 후속: 파일 대신 웹페이지가 오면 가짜 파일 대신 안내 화면(원문 열기) · 이름은 응답 머리(EUC-KR·URL 인코딩·filename*) → 없으면 넘긴 이름 + 첫 바이트 확장자', async () => {
    const pg = await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + '/page.hwp')}&n=${encodeURIComponent('공고문.hwp')}&o=${encodeURIComponent(fakeBase + '/notice/1')}`, ctx.owner.cookie);
    assert.equal(pg.status, 502); assert.match(pg.headers.get('content-type'), /text\/html/); assert.equal(pg.headers.get('content-disposition'), null, '파일로 내려받게 하지 않음');
    const html = await pg.text(); assert.match(html, /원문에서 받아 주세요/); assert.ok(html.includes(`href="${fakeBase}/notice/1"`), '원문 열기 = 화면이 넘긴 원문 주소'); assert.match(html, />원문 열기</);
    const name = async (path, extra = '') => { const r = await get(`/api/bids/file?u=${encodeURIComponent(fakeBase + path)}${extra}`, ctx.owner.cookie); assert.equal(r.status, 200, path); await r.arrayBuffer(); return decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition'))[1]); };
    assert.equal(await name('/euckr.do'), '공고문.hwp', 'EUC-KR 날 바이트');
    assert.equal(await name('/pct-euckr.do'), '공고문 (1).hwp', 'EUC-KR URL 인코딩·빈칸 +');
    assert.equal(await name('/star.do'), '입찰 공고.pdf', 'filename*=UTF-8 우선');
    assert.equal(await name('/downloadFile.do', `&f=${encodeURIComponent('광교 센트럴 커뮤니티 첨부 1')}`), '광교 센트럴 커뮤니티 첨부 1.pdf', '나라장터 downloadFile.do → 넘긴 이름 + %PDF');
    assert.equal(await name('/downloadFile.do?t=hwpx'), '첨부.hwpx', 'PK + hwp+zip → hwpx');
    assert.equal(await name('/downloadFile.do?t=zip'), '첨부.zip', '그 밖 PK → zip');
    // 로컬 10/23: 이름이 URL 인코딩된 채로 오면(두 번 인코딩·옛 저장 칸의 n) 풀어서 — '%EC%BB…+…' 로 내려가지 않게
    assert.equal(await name('/double.do'), '커뮤니티 시설 공고.hwp', '두 번 인코딩한 머리');
    assert.equal(await name('/euckr.do', `&n=${encodeURIComponent(encodeURIComponent('공고문 원본.hwp').replace(/%20/g, '+'))}`), '공고문 원본.hwp', '인코딩된 채로 넘어온 n');
  });
  test('#507 후속 K-apt(로컬 10/23 실측 순서): 상세(쿠키·_csrf) → 첨부 목록 POST(JSON·X-CSRF-TOKEN·같은 쿠키) → fileDownload.do(같은 쿠키·Referer) — 옛 주소(bidFileDown.do)도 같은 순서로 · 목록에 없는 파일은 안내', async () => {
    const r = await get('/api/bids/kapt-file?bid=20261021092205298&seq=4329886', ctx.owner.cookie);
    assert.equal(r.status, 200); const buf = Buffer.from(await r.arrayBuffer());
    assert.equal(buf.subarray(0, 4).toString('hex'), 'd0cf11e0', 'HWP5 그대로');
    assert.equal(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(r.headers.get('content-disposition'))[1]), '커뮤니티 시설 위탁 운영업체 선정 입찰 공고.hwp', '응답 머리의 UTF-8 URL 인코딩 이름(빈칸 +)');
    const [d, l, f] = kapt.calls.slice(-3);
    assert.deepEqual([d.path, l.path, f.path], ['/kapt/bid/bidDetail.do', '/kapt/bid/bidFileListData.do', '/kapt/cmm/file/BID/fileDownload.do']);
    assert.equal(l.method, 'POST'); assert.equal(l.q.seq, 'BID_FILE'); assert.deepEqual(JSON.parse(l.body), { bidNum: '20261021092205298' }); assert.match(l.type, /application\/json/); assert.match(l.accept, /json/);
    assert.match(l.csrf, /^csrf-\d+$/); assert.match(l.cookie, /JSESSIONID=S\d+/); assert.match(l.cookie, /KHANUSER=/); assert.ok(l.referer.endsWith('/kapt/bid/bidDetail.do?bidNum=20261021092205298'));
    assert.equal(f.cookie, l.cookie, '받기도 같은 쿠키'); assert.equal(f.referer, l.referer); assert.equal(f.q.key, '4329886'); assert.equal(f.q.fileName, '커뮤니티 시설 위탁 운영업체 선정 입찰 공고.hwp'); assert.ok(f.q._cb);
    // 원본 영업관리·지금 화면이 저장한 옛 주소도 같은 순서로(바로 부르면 K-apt 는 오류 화면 HTML)
    const old = await get(`/api/bids/kapt-file?u=${encodeURIComponent(`${fakeBase}/kapt/bid/bidFileDown.do?bidNum=20261021092205298&fileSeq=4329887`)}`, ctx.owner.cookie);
    assert.equal(old.status, 200); assert.equal(decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(old.headers.get('content-disposition'))[1]), '과업지시서.pdf', '목록 이름 + 첫 바이트(%PDF) 확장자'); await old.arrayBuffer();
    assert.ok(!kapt.calls.some((c) => c.path === '/kapt/bid/bidFileDown.do'), '옛 주소는 K-apt 에 직접 부르지 않음');
    const gone = await get('/api/bids/kapt-file?bid=20261021092205298&seq=999', ctx.owner.cookie);
    assert.equal(gone.status, 502); const gh = await gone.text(); assert.match(gh, /첨부 목록에 없는 파일/); assert.match(gh, /K-apt 원문 열기/); assert.ok(gh.includes('/kapt/bid/bidDetail.do?bidNum=20261021092205298'));
  });
});
