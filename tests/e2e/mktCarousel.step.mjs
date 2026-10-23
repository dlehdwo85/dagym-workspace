// #499-5 카드뉴스 장별 생성기: 자동 제작 › 카드뉴스 탭 → 제품·대상·비교·키워드 → [주제 후보 받기](4유형·훅 점수) → 후보 고르기 → [장별 문구 만들기](보내는 값)
// → 편집(장 7개·채울 곳 경고·[이미지로…] 잠김) → 4장 채우기·순서 바꾸기·틀 '흰 바탕' → [저장](미리보기 1080 새로 그림) → [이미지로 만들어 승인 요청] → 승인 요청함·승인함 링크 · 휴대폰 폭
// 가짜 AI 응답(구조 시험) — 실제 문구 품질·인스타 실제 게시는 확인 못함. 검증 규칙·다시 그리기·AI 로 고치기는 tests/api/mkt-carousel.test.mjs
import assert from 'node:assert/strict';
import { FAKE } from '../helpers.mjs';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const TOPIC = '위탁 운영 vs 직영, 우리 단지엔?';
const TOPICS = [{ pattern: 'vs', topic: TOPIC, why: '둘 중 고르는 비교는 저장이 잘 됨', a: '위탁 운영', b: '직영' }, { pattern: 'howto', topic: '운영사, 실패 없이 고르는 법 3가지', why: '방법 N가지', a: '', b: '' },
  { pattern: 'types', topic: '우리 단지에 맞는 운영 방식은?', why: '내 경우 찾기', a: '', b: '' }, { pattern: 'checklist', topic: '입주 전 커뮤니티 점검 5가지', why: '저장해 두고 봄', a: '', b: '' }];
const SLIDES = [
  { kind: 'cover', title: '위탁 운영 vs 직영,\n우리 단지엔?', body: '입주 3개월 전 가장 많이 받는 질문', rows: [], imagePlan: '단지 커뮤니티 실내 사진' },
  { kind: 'body', title: '같은 커뮤니티인데 왜 다를까', body: '시설은 같아도 운영 방식에 따라\n민원·비용이 달라져요.', rows: [], imagePlan: '운영 데스크 사진' },
  { kind: 'body', title: '직영의 특징', body: '관리사무소가 직접 인력을 뽑아요.\n결정은 빠르지만 부담이 커요.', rows: [], imagePlan: '관리사무소 사진' },
  { kind: 'body', title: '위탁 운영의 특징', body: '운영사가 인력·프로그램을 맡아요.\n운영 경험 {{운영 단지 수}}곳', rows: [], imagePlan: '프로그램 진행 사진' },
  { kind: 'table', title: '유형별 추천', body: '', rows: [['단지 유형', '추천'], ['500세대 미만', '직영'], ['500세대 이상', '위탁 운영']], imagePlan: '' },
  { kind: 'body', title: '결정 전 한 가지', body: '운영비 구조를 같은 기준으로\n비교해 보세요.', rows: [], imagePlan: '' },
  { kind: 'cta', title: "댓글에 '비교표' 남기면\n보내 드려요", body: '도움이 됐다면 저장·팔로우', rows: [], imagePlan: '' }];
const CAPTION = "위탁 운영 vs 직영, 우리 단지엔?\n\n세 가지만 비교해 보세요.\n\n댓글에 '비교표' 남기면 보내 드려요.\n#커뮤니티운영 #아파트";
const loaded = (img) => img.evaluate((el) => el.complete && el.naturalWidth);

export async function mktCarousel({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 카드뉴스 브랜드' })).id;
  await sql`update mkt_brands set color = '#0F766E' where id = ${brand}`;
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [say({ topics: TOPICS }), say({ slides: SLIDES, caption: CAPTION, keyword: '비교표' })] }) });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/automation?tab=cards`);
  const box = owner.getByTestId('carousels'); await box.waitFor();
  assert.equal(await owner.getByTestId('auto-tab-cards').getAttribute('aria-selected'), 'true');
  const form = owner.getByTestId('carousel-form');
  await form.getByTestId('carousel-brand').selectOption(brand);
  await form.getByTestId('carousel-product').fill('커뮤니티 위탁 운영');
  await form.getByTestId('carousel-audience').fill('입주 앞둔 단지');
  await form.getByTestId('carousel-keyword').fill('비교표');
  await form.getByTestId('carousel-topics-btn').click();
  await form.getByTestId('carousel-topic').nth(3).waitFor();
  assert.deepEqual(await form.getByTestId('carousel-topic').evaluateAll((els) => els.map((e) => e.getAttribute('data-pattern'))), ['vs', 'howto', 'types', 'checklist']);
  assert.match(await form.getByTestId('carousel-topic-score').first().innerText(), /^훅 \d+점$/);
  await form.locator('[data-testid=carousel-topic][data-pattern=checklist]').click();
  assert.equal(await form.getByTestId('carousel-pattern').inputValue(), 'checklist');
  await form.locator('[data-testid=carousel-topic][data-pattern=vs]').click();
  assert.deepEqual([await form.getByTestId('carousel-topic-input').inputValue(), await form.getByTestId('carousel-pattern').inputValue(), await form.getByTestId('carousel-a').inputValue()], [TOPIC, 'vs', '위탁 운영']);
  await owner.screenshot({ path: `${SHOTS}/228-carousel-form.png` });
  const created = owner.waitForResponse((r) => r.url().endsWith('/api/marketing/carousels') && r.request().method() === 'POST');
  await form.getByTestId('carousel-create').click();
  const body = (await created).request().postDataJSON();
  assert.deepEqual({ topic: body.topic, pattern: body.pattern, keyword: body.keyword, template: body.template, brand: body.brandId, a: body.a, b: body.b }, { topic: TOPIC, pattern: 'vs', keyword: '비교표', template: 'box', brand, a: '위탁 운영', b: '직영' });
  await owner.getByText('AI 마케터가 7장 문구를 썼습니다 — 고친 뒤 [이미지로 만들어 승인 요청]').waitFor();
  const ed = owner.getByTestId('carousel-editor'); await ed.waitFor();
  assert.equal(await ed.getByTestId('carousel-slide').count(), 7);
  assert.match(await ed.getByTestId('carousel-placeholders').innerText(), /4장/);
  assert.equal(await ed.getByTestId('carousel-render').isDisabled(), true, '채울 곳이 있으면 잠김');
  for (let i = 0; i < 50 && (await loaded(ed.getByTestId('carousel-preview'))) !== 1080; i++) await owner.waitForTimeout(200);
  assert.equal(await loaded(ed.getByTestId('carousel-preview')), 1080, '서버가 그린 1080×1350 미리보기');
  assert.equal(await ed.getByTestId('carousel-thumb').count(), 7);
  // 4장 채우기 · 2장을 아래로(→ 3장) 갔다가 되돌리기 · 틀 '흰 바탕'
  await ed.getByTestId('carousel-slide').nth(3).getByTestId('carousel-slide-body').fill('운영사가 인력·프로그램을 맡아요.\n민원 창구도 하나로 모여요.');
  await ed.getByTestId('carousel-dirty').waitFor();
  assert.equal(await ed.getByTestId('carousel-placeholders').count(), 0);
  await ed.getByTestId('carousel-slide').nth(1).getByTestId('carousel-slide-down').click();
  assert.equal(await ed.getByTestId('carousel-slide').nth(2).getByTestId('carousel-slide-title').inputValue(), '같은 커뮤니티인데 왜 다를까');
  await ed.getByTestId('carousel-slide').nth(2).getByTestId('carousel-slide-up').click();
  await ed.getByTestId('carousel-template').getByLabel('흰 바탕').check();
  const v0 = await ed.getByTestId('carousel-preview').getAttribute('src');
  await ed.getByTestId('carousel-save').click();
  await owner.getByText('저장했습니다 — 미리보기를 새로 그렸습니다').waitFor();
  await ed.getByTestId('carousel-dirty').waitFor({ state: 'detached' });
  assert.notEqual(await ed.getByTestId('carousel-preview').getAttribute('src'), v0, '저장하면 미리보기 주소가 바뀜');
  for (let i = 0; i < 50 && (await loaded(ed.getByTestId('carousel-preview'))) !== 1080; i++) await owner.waitForTimeout(200);
  const [row] = await sql`select id, template, slides from mkt_carousels where brand_id = ${brand}`;
  assert.deepEqual({ tpl: row.template, s4: row.slides[3].body, s2: row.slides[1].title }, { tpl: 'clean', s4: '운영사가 인력·프로그램을 맡아요.\n민원 창구도 하나로 모여요.', s2: '같은 커뮤니티인데 왜 다를까' });
  await ed.screenshot({ path: `${SHOTS}/229-carousel-editor.png` });
  // 그리기 → 자료실 + 승인 요청
  await ed.getByTestId('carousel-render').click();
  await owner.getByText('7장을 그려 자료실(마케팅/카드뉴스)에 넣고 승인 요청을 올렸습니다').waitFor({ timeout: 60000 });
  await owner.locator('[data-testid=carousel-item][data-status=sent]').first().waitFor();
  const href = await ed.getByTestId('carousel-content-link').getAttribute('href');
  const [c] = await sql`select c.id, c.kind, c.channel, c.status, v.media_ids from mkt_carousels k join mkt_contents c on c.id = k.content_id join mkt_versions v on v.content_id = c.id and v.version = c.current_version where k.id = ${row.id}`;
  assert.equal(href, `/s/marketing/approvals?c=${c.id}`);
  assert.deepEqual({ kind: c.kind, channel: c.channel, status: c.status, n: c.media_ids.length }, { kind: 'feed', channel: 'instagram', status: 'pending', n: 7 });
  // 휴대폰 폭: 편집 화면이 상자 안에서만(미리보기 줄은 가로로 넘김)
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/automation?tab=cards`);
  await owner.getByTestId('carousel-item').first().getByTestId('carousel-open').click();
  await owner.getByTestId('carousel-editor').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.screenshot({ path: `${SHOTS}/230-carousel-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리(뒤 단계의 승인함 건수에 섞이지 않게)
  await sql`delete from mkt_contents where id = ${c.id}`;
  await sql`delete from mkt_carousels where brand_id = ${brand}`;
}
