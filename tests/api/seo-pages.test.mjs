// #627(대표 10/25 20:05 ①, docs/handoff/SEO_AUDIT_2026-10-25 2-1 워크인 코드 묶음): robots(공개 화면 열고 앱 화면만 막음·$ 없음·주소 www) · 사이트맵(색인 화면만·lastmod·www)
// · 검색어별 소개 페이지 3개(제목 검색어·canonical·OG·FAQ 구조화 데이터·서로 링크) · 홈 제목·설명 검색어 + 기능별 링크 · 가입 OG(색인은 안 함). 시험 서버는 NEXT_PUBLIC_SITE_URL 없음 = 기본 www
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, resetDb, startServer } from '../helpers.mjs';

let srv;
before(async () => { await resetDb(); srv = await startServer(); });
after(() => srv?.proc.kill());
const get = async (p) => { const r = await fetch(BASE + p, { redirect: 'manual' }); return { status: r.status, text: await r.text() }; };
const SITE = 'https://www.work-in.dev';
const SLUGS = ['task-management', 'e-approval', 'collaboration'];

test('robots.txt: 공개 화면 전부 열고 앱 화면만 막음 · $ 패턴 없음 · 사이트맵·호스트 www', async () => {
  const r = await get('/robots.txt');
  assert.equal(r.status, 200);
  for (const w of ['User-Agent: *', 'Allow: /', 'Disallow: /api/', 'Disallow: /s/', 'Disallow: /tasks', 'Disallow: /platform', `Sitemap: ${SITE}/sitemap.xml`]) assert.ok(r.text.includes(w), w);
  assert.ok(!r.text.includes('$'), '$ 패턴 없음(네이버 등 일부 검색엔진이 못 읽음)');
  assert.ok(!/Disallow: \/\s*$/m.test(r.text), 'Disallow: / 없음');
  assert.ok(!r.text.includes('Disallow: /_next'), '_next(CSS·JS) 막지 않음');
});

test('sitemap.xml: 홈 + 소개 페이지 3개(lastmod·www), noindex 화면(가입·약관·개인정보·계정 삭제)은 없음', async () => {
  const r = await get('/sitemap.xml');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes(`<loc>${SITE}/</loc>`), '홈');
  for (const s of SLUGS) assert.ok(r.text.includes(`<loc>${SITE}/landing/${s}</loc>`), s);
  assert.ok(r.text.includes('<lastmod>2026-'), 'lastmod');
  for (const no of ['/signup</loc>', '/privacy</loc>', '/terms</loc>', '/account-deletion</loc>', 'https://work-in.dev/']) assert.ok(!r.text.includes(no), `없어야 함: ${no}`);
});

test('검색어별 소개 페이지 3개: 제목에 검색어 · canonical·og:url www · index,follow · FAQ·빵부스러기 구조화 데이터 · 가입 버튼 · 서로 링크 · 하단 사업자 정보 · 모르는 주소 404', async () => {
  const keywords = { 'task-management': '중소기업 업무관리 프로그램', 'e-approval': '전자결재 프로그램', collaboration: '중소기업 협업툴' };
  for (const s of SLUGS) {
    const r = await get(`/landing/${s}`);
    assert.equal(r.status, 200, s);
    const title = r.text.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
    assert.ok(title.includes(keywords[s]) && title.includes('워크인'), `${s} 제목: ${title}`);
    for (const w of [`rel="canonical" href="${SITE}/landing/${s}"`, `property="og:url" content="${SITE}/landing/${s}"`, 'name="robots" content="index, follow"', 'property="og:image"', '"@type":"FAQPage"', '"@type":"BreadcrumbList"', 'data-testid="landing-h1"', 'href="/signup"', 'data-testid="biz-footer"', 'data-testid="landing-faq"'])
      assert.ok(r.text.includes(w), `${s}: ${w}`);
    for (const o of SLUGS.filter((x) => x !== s)) assert.ok(r.text.includes(`href="/landing/${o}"`), `${s} → ${o} 링크`);
    const desc = r.text.match(/name="description" content="([^"]+)"/)?.[1] ?? '';
    assert.ok(desc.length > 40 && desc.length <= 95 && desc.includes('14일 무료 체험'), `${s} 설명 길이·체험 문구: ${desc.length}`);
    assert.ok(!/5명까지|베이직|스탠다드|프로 요금|2,200|4,500|8,500/.test(r.text), `${s}: 요금 숫자·옛 문구 없음(대표 승인 전)`);
  }
  assert.equal((await get('/landing/no-such-page')).status, 404);
});

test('홈(/·/welcome): 제목·설명에 검색어 · "Android·iOS" 문구 없음 · canonical www · 기능별 소개 링크 3개 · 측정 ID 없으면 태그 없음', async () => {
  for (const path of ['/', '/welcome']) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    const title = r.text.match(/<title>([^<]+)<\/title>/)?.[1] ?? '';
    assert.ok(/업무관리/.test(title) && /전자결재/.test(title) && /협업툴/.test(title), `${path} 제목: ${title}`);
    const desc = r.text.match(/name="description" content="([^"]+)"/)?.[1] ?? '';
    assert.ok(desc.includes('중소기업 업무관리') && desc.includes('14일 무료 체험') && !desc.includes('Android·iOS') && desc.length <= 80, `${path} 설명: ${desc}`);
    assert.ok(r.text.includes(`rel="canonical" href="${SITE}"`) || r.text.includes(`rel="canonical" href="${SITE}/"`), `${path} canonical`); // Next 는 루트 canonical 의 끝 / 를 뗀다(같은 주소)
    assert.ok(r.text.includes(`property="og:url" content="${SITE}"`) || r.text.includes(`property="og:url" content="${SITE}/"`), `${path} og:url`);
    for (const s of SLUGS) assert.ok(r.text.includes(`href="/landing/${s}"`), `${path} → ${s}`);
    assert.ok(!r.text.includes('googletagmanager.com') && !r.text.includes('wcs.naver.net'), '측정 ID 없으면 태그 없음');
    assert.ok(r.text.includes('"@type":"WebSite"') && r.text.includes('"contactPoint"'), 'JSON-LD WebSite·연락처');
  }
});

test('가입·로그인: 고유 제목 · 가입은 OG 미리보기 · 둘 다 색인 안 함(noindex)', async () => {
  const su = await get('/signup');
  assert.ok(su.text.includes('<title>워크인 가입') && su.text.includes('property="og:title"') && su.text.includes(`property="og:url" content="${SITE}/signup"`), '가입 제목·OG');
  assert.ok(/name="robots" content="noindex/.test(su.text), '가입은 noindex');
  const lo = await get('/login');
  assert.ok(lo.text.includes('<title>워크인 로그인') && /name="robots" content="noindex/.test(lo.text), '로그인 제목·noindex');
});
