// #499-6 경쟁 광고 보관함: 운영실 상자 [광고 넣기](업체·링크·형식·게재 시작·비슷한 소재 수·대본) → 첫 문장 질문형 → 훅 유형 칩 거르기 → ★
// → 자세히(대본) → [AI 분석](뼈대) → 3개 골라 [공통 구조 분석](우리 브랜드·제품) → 대본 3안·제작의뢰실 링크 → [주간 분석 지금] · 휴대폰 폭
// 가짜 AI 응답(구조 시험) — 영상 받아쓰기·실제 분석 품질은 tests/api/mkt-adrefs.test.mjs·로컬 확인
import assert from 'node:assert/strict';
import { FAKE } from '../helpers.mjs';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - n * 864e5));
const TRANSCRIPT = '입주 앞둔 단지, 커뮤니티 운영사 아직 못 정하셨나요? 무료 운영 진단 받아 보세요. 양식에 단지명만 남기세요.';
const script = (n) => ({ title: `${n}안`, hook: '입주 앞둔 단지 관리소장님, 커뮤니티 운영 무료 진단 받아 보세요', lines: ['운영사가 정해지지 않으면 오픈이 늦어집니다.', '인력과 프로그램을 한 번에 맡깁니다.'], cta: '양식에 단지명만 남기세요' });

export async function mktAdRefs({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 보관함 브랜드' })).id;
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [
    say({ hook: '', hookType: 'question', beats: [{ part: '훅', text: '입주 앞둔 단지 지목' }, { part: '제안', text: '무료 운영 진단' }, { part: '행동', text: '양식에 단지명' }], offer: '무료 운영 진단', cta: '양식에 단지명', angle: '입주 앞둔 단지 관리소장', why: '추정: 40일째 — 반응이 있었을 가능성' }),
    say({ common: ['첫 문장에서 대상을 부름', '무료 제안', '15초 안팎'], structure: ['대상 지목', '문제', '제안', '행동'], scripts: [script(1), script(2), script(3)] }),
    say({ common: ['질문형이 많음'], structure: ['지목', '제안', '행동'], scripts: [script(1)] })] }) });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/ops`);
  const box = owner.getByTestId('adrefs'); await box.waitFor();
  await box.getByTestId('adref-new').click();
  const form = owner.getByTestId('adref-form'); await form.waitFor();
  await form.getByTestId('adref-advertiser').fill('E2E 경쟁사A');
  await form.getByTestId('adref-url-input').fill('https://www.facebook.com/ads/library/?id=999');
  await form.getByTestId('adref-started').fill(daysAgo(40));
  await form.getByTestId('adref-variants').fill('5');
  await form.getByTestId('adref-brand').selectOption(brand);
  await form.getByTestId('adref-transcript-input').fill(TRANSCRIPT);
  await owner.screenshot({ path: `${SHOTS}/231-adrefs-form.png` });
  const posted = owner.waitForResponse((r) => r.url().endsWith('/api/marketing/adrefs') && r.request().method() === 'POST');
  await form.getByTestId('adref-save').click();
  const body = (await posted).request().postDataJSON();
  assert.deepEqual({ adv: body.advertiser, url: body.url, fmt: body.format, started: body.startedOn, variants: body.variants, brand: body.brandId, hasTranscript: body.transcript === TRANSCRIPT },
    { adv: 'E2E 경쟁사A', url: 'https://www.facebook.com/ads/library/?id=999', fmt: 'video', started: daysAgo(40), variants: 5, brand, hasTranscript: true });
  await owner.getByText('넣었습니다 — 첫 문장: 질문형').waitFor();
  // 두 개 더(첫 문장만) → 훅 유형 칩으로 거르기
  for (const hook of ['월 9,900원으로 커뮤니티 운영 끝', '직영 vs 위탁, 비용 차이 정리']) await ctx.owner.ok('POST', '/api/marketing/adrefs', { advertiser: 'E2E 경쟁사B', hook, format: 'image', startedOn: daysAgo(2) });
  await owner.reload(); await box.getByTestId('adref-item').nth(2).waitFor();
  await box.locator('[data-testid=adref-filter][data-type=question]').click();
  assert.deepEqual(await box.getByTestId('adref-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-hook-type'))), ['question']);
  const it = box.getByTestId('adref-item').first();
  assert.match(await it.getByTestId('adref-days').innerText(), /^40일째 · 오래 돌림$/);
  await it.getByTestId('adref-star').click();
  await box.locator('[data-testid=adref-item] [data-testid=adref-star][aria-pressed=true]').waitFor();
  await it.getByTestId('adref-open').click();
  assert.equal(await it.getByTestId('adref-transcript').innerText(), TRANSCRIPT);
  await it.getByTestId('adref-analyze').click();
  await owner.getByText('AI 가 뼈대를 뽑았습니다').waitFor();
  assert.equal(await box.getByTestId('adref-beats').first().innerText(), '훅 입주 앞둔 단지 지목 → 제안 무료 운영 진단 → 행동 양식에 단지명');
  // 3개 골라 공통 구조 분석
  await box.locator('[data-testid=adref-filter][data-type=all]').click();
  for (let k = 0; k < 3; k++) await box.getByTestId('adref-item').nth(k).getByTestId('adref-pick').check();
  const bar = box.getByTestId('adref-selected'); await bar.waitFor();
  await bar.getByTestId('adref-report-brand').selectOption(brand);
  await bar.getByTestId('adref-report-product').fill('커뮤니티 위탁 운영');
  await bar.getByTestId('adref-report-go').click();
  await owner.getByText('공통 구조와 우리 대본 3안을 만들었습니다').waitFor();
  const rep = box.getByTestId('adref-report').first(); await rep.waitFor();
  assert.equal(await rep.getAttribute('data-source'), 'ai');
  assert.equal(await rep.getByTestId('adref-script').count(), 3);
  assert.deepEqual(await rep.getByTestId('adref-report-structure').locator('li').allInnerTexts(), ['대상 지목', '문제', '제안', '행동']);
  const href = await rep.getByTestId('adref-script-studio').first().getAttribute('href');
  assert.match(href, /^\/s\/marketing\/automation\?tab=studio&kind=reels&mode=ad&purpose=inquiry&brand=[0-9a-f-]{36}&message=/);
  await box.screenshot({ path: `${SHOTS}/232-adrefs-report.png` });
  // 주간 분석 지금(관리자)
  await box.getByTestId('adref-weekly').click();
  await owner.getByText(/주간 분석\(\d{4}-W\d{2}\)을 만들었습니다 — 광고 3개/).waitFor();
  await box.locator('[data-testid=adref-report][data-kind=weekly]').waitFor();
  // 휴대폰 폭
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ops#adrefs`);
  await owner.getByTestId('adrefs').getByTestId('adref-item').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.getByTestId('adrefs').screenshot({ path: `${SHOTS}/233-adrefs-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await sql`delete from mkt_ad_ref_reports where tenant = (select tenant from mkt_brands where id = ${brand})`;
  await sql`delete from mkt_ad_refs where advertiser like 'E2E %'`;
}
