// 소개 사이트(대표 10/20 16:45): 로그인 전 / = 랜딩(H1·무료로 시작·앱 다운로드·세 공간·AI·3단계·요금 14일 무료 체험(#466)·문의·푸터 계정 삭제·JSON-LD·OG) + 클릭 이벤트 + 390px, 로그인하면 홈
import assert from 'node:assert/strict';

export async function landing({ browser, owner, BASE, SHOTS }) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  const views = []; p.on('request', (r) => { if (r.url().includes('/api/public/landing-view')) views.push(r.postDataJSON()?.page); }); // 311차 #867 페이지별 방문
  await p.goto(`${BASE}/?utm_source=naver&utm_medium=cpc&utm_campaign=launch`);
  assert.equal(new URL(p.url()).pathname, '/', '주소는 / 그대로(rewrite)');
  assert.equal(await p.getByTestId('landing-title').innerText(), '업무도, 영업도, 마케팅도 한 화면에서');
  assert.equal(await p.getByTestId('landing-space-work').count() + await p.getByTestId('landing-space-sales').count() + await p.getByTestId('landing-space-marketing').count(), 3);
  await p.getByTestId('landing-ai').waitFor(); await p.getByTestId('landing-steps').waitFor();
  // 대표 11/19 '주요 기능을 홍보 사이트와 네비게이션에 추가': 자주 쓰는 기능 구역(자료실·결재·메시지·점검 = 실제 화면 그림 · AI 비서·영업·마케팅 공간 = 아래 구역으로) · 머리줄 [기능] = 이 구역
  const feats = p.getByTestId('landing-features'); await feats.waitFor();
  assert.deepEqual(await feats.locator('article').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('landing-feature-', ''))), ['library', 'approvals', 'messages', 'check', 'ai', 'spaces']);
  assert.equal(await feats.locator('article img').count(), 4, '그림 4장(자료실·결재·메시지·점검)');
  for (const src of await feats.locator('article img').evaluateAll((els) => els.map((e) => e.getAttribute('src')))) assert.equal((await p.request.get(BASE + src)).status(), 200, `${src} 그림이 있음`);
  assert.ok(!/화상회의/.test(await feats.innerText()), '화상회의는 넣지 않음(지금은 우리 회사만 — 대표 결정 뒤)');
  assert.match(await feats.innerText(), /14일 무료 체험/);
  assert.equal(await p.locator('header nav a', { hasText: '기능' }).getAttribute('href'), '#features');
  assert.equal(await feats.getByTestId('landing-feature-ai').locator('a').getAttribute('href'), '#ai'); assert.equal(await p.locator('#ai').count(), 1);
  assert.match(await p.getByTestId('pricing').innerText(), /14일 무료 체험[\s\S]*0원/); assert.equal(await p.getByTestId('pricing').getByText(/베이직|스탠다드|프로/).count(), 0, '요금은 14일 체험만');
  // 상용화 B3: 체험 뒤 업무 요금표만 공개(고객 결제 화면과 같은 구간 데이터) · 영업·마케팅 금액은 없음(상담 후 견적)
  const wp = p.getByTestId('landing-work-price'); await wp.waitFor();
  assert.match(await wp.innerText(), /1~5인[\s\S]*19,900원/); assert.match(await wp.innerText(), /51인~[\s\S]*1인 3,900원/);
  assert.doesNotMatch(await wp.innerText(), /34,900|베이직|스탠다드|프로/, '영업·마케팅 금액은 공개하지 않음');
  assert.doesNotMatch(await p.locator('body').innerText(), /5명까지|카드 등록 없음|6명 이상/, '#466 5명 무료 폐지 · 카드 등록 문구는 대표 결정 전'); // 대표 10/23
  assert.match(await p.getByTestId('landing-contact').innerText(), /dagym-in@naver\.com/);
  await p.getByTestId('biz-footer').getByRole('link', { name: '계정 삭제' }).waitFor();
  const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().innerHTML());
  assert.ok(ld['@graph'].some((x) => x['@type'] === 'SoftwareApplication' && x.offers.price === '0'), 'JSON-LD');
  assert.equal(await p.locator('meta[property="og:image"]').getAttribute('content'), 'https://www.work-in.dev/landing/og.png'); // #627 기본 주소 www
  assert.equal(await p.locator('link[rel="canonical"]').getAttribute('href'), 'https://www.work-in.dev'); // Next 는 루트 canonical 의 끝 / 를 뗀다
  assert.equal(await p.getByTestId('landing-feature-links').getByRole('link').count(), 5, '기능별 소개 링크 5개(#867 마케팅 자동화·입찰 정보 자동 수집)');
  assert.equal(await p.locator('meta[name="robots"]').getAttribute('content'), 'index, follow');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('wos_utm') ?? '{}').source), 'naver', 'UTM 기억');
  // 311차 #867: 처음 들어온 소개 페이지(home)도 기억 · 방문 1번 보냄 · 같은 날 다시 와도 또 안 보냄
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('wos_utm') ?? '{}').page === 'home');
  assert.deepEqual(views, ['home'], '홈 방문 1번');
  await p.reload(); await p.getByTestId('landing-title').waitFor(); await p.waitForTimeout(500);
  assert.deepEqual(views, ['home'], '같은 날 다시 와도 1번');
  // 대표 11/20: [앱 다운로드] = 앱 받기 화면(/app)으로 — 이벤트만 볼 때는 화면이 넘어가지 않게 잡아 둔다
  const fired = await p.evaluate(() => new Promise((r) => { const a = document.querySelector('[data-testid="landing-app"]'); a.addEventListener('click', (e) => e.preventDefault(), { once: true });
    document.addEventListener('wos:landing', (e) => r(e.detail.kind), { once: true }); a.click(); }));
  assert.equal(fired, 'app', '앱 다운로드 클릭 이벤트');
  assert.equal(await p.getByTestId('landing-app').getAttribute('href'), '/app');
  assert.equal(await p.getByTestId('landing-app-page').innerText(), 'www.work-in.dev/app', '앱 구역에 직원에게 알려 줄 주소');
  await p.getByTestId('landing-stores').getByText(/Google Play/).waitFor();
  // 대표 11/19: Google Play 는 공개 주소로 바로(‘심사 중’ 글자 없음) · App Store 는 ‘준비 중’
  assert.equal(await p.getByTestId('landing-stores').locator('a[data-track="play"]').getAttribute('href'), 'https://play.google.com/store/apps/details?id=kr.co.dagym.workos');
  await p.getByTestId('appstore-soon').getByText('App Store 준비 중').waitFor();
  assert.equal(await p.getByTestId('landing-stores').getByText(/심사 중/).count(), 0, '‘심사 중’ 글자 없음');
  await p.screenshot({ path: `${SHOTS}/163-landing.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/`);
  await p.getByTestId('landing-title').waitFor();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), '390 가로 넘침 없음');
  // #627 검색어별 소개 페이지: 휴대폰 폭·PC 캡처·홈으로 돌아오기
  await p.goto(`${BASE}/landing/task-management`); await p.getByTestId('landing-h1').waitFor();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), '소개 페이지 390 가로 넘침 없음');
  assert.equal(await p.getByTestId('landing-sections').locator('article').count(), 3);
  await p.setViewportSize({ width: 1366, height: 900 }); await p.goto(`${BASE}/landing/e-approval`); await p.getByTestId('landing-h1').waitFor();
  await p.screenshot({ path: `${SHOTS}/299-landing-e-approval.png`, fullPage: true });
  await p.getByTestId('landing-others').getByRole('link', { name: /협업툴/ }).click(); await p.waitForURL(/\/landing\/collaboration/); await p.getByTestId('landing-h1').waitFor();
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/`); await p.getByTestId('landing-title').waitFor();
  await p.screenshot({ path: `${SHOTS}/163-landing-390.png`, fullPage: true });
  await p.getByTestId('landing-start').click(); await p.waitForURL(/\/signup/);
  await ctx.close();
  await owner.goto(`${BASE}/`); await owner.waitForURL(`${BASE}/`);
  assert.equal(await owner.getByTestId('landing-title').count(), 0, '로그인 상태는 홈');
}
