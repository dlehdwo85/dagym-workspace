// S1-4(로컬 10/20): 공고 첨부 중계 /api/bids/file?u=&n= · /api/bids/kapt-file — 로그인·영업 공간 필요 · 허용 사이트만(403) · https 만 · 리다이렉트 안 따라감(502) · 30MB 상한(413) · octet-stream 강제 내려받기(이름 유지) · 저장 안 함
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer } from '../helpers.mjs';

let srv, ctx, fake, fakeBase;
before(async () => {
  await resetDb(); srv = await startServer(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  fake = http.createServer((req, res) => {
    if (req.url.startsWith('/ok.hwp')) { res.writeHead(200, { 'content-type': 'application/x-hwp', 'content-length': '11' }); res.end('HWP-CONTENT'); return; }
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: '/ok.hwp' }); res.end(); return; }
    if (req.url.startsWith('/big')) { res.writeHead(200, { 'content-length': String(31 * 1024 * 1024) }); res.end(); return; }
    if (req.url.startsWith('/nolen')) { res.writeHead(200); for (let i = 0; i < 3; i++) res.write('x'.repeat(1024)); res.end(); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  fakeBase = `http://127.0.0.1:${fake.address().port}`;
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
});
