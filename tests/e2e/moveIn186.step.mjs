// 186차(로컬 10/26 19:20 B1·B2): 영업기회 '입주 시기(6개월 전~12개월 뒤)' 칩 — 청약홈 입주 예정월로 골라 늦은 것부터·남은 달 표시
// + 수집기 칸 '신규 공동주택 단지(K-apt 단지 목록)' 카드·키 안내 — 구조 시험(영업기회 줄을 직접 심음). 실제 청약홈·K-apt 응답은 운영 [처음 채우기 4년]·[지금 수집]으로 확인
import assert from 'node:assert/strict';

const ym = (add) => { const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number); return new Date(Date.UTC(y, m - 1 + add, 1)).toISOString().slice(0, 10); };

export async function moveIn186({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const rows = [['창밖 13개월 전', -13], ['3개월 전 입주', -3], ['이번 달 입주', 0], ['6개월 뒤 입주', 6], ['창밖 7개월 뒤', 7]];
  for (const [k, add] of rows) {
    await sql`insert into prospects (source_code, ext_id, name, address, sido, status, opened_on, category, detail, raw, base_date)
      values ('15098547', ${'e2e186:' + k}, ${'입주E2E ' + k}, '서울특별시 강남구 개포로 1', '서울', '모집공고', current_date, '민영 · 300세대', ${sql.json({ moveIn: ym(add), households: 300 })}, ${sql.json({})}, current_date)
      on conflict (source_code, ext_id) do nothing`;
  }
  await ctx.owner.ok('PUT', '/api/sales/sources/15098547', { enabled: true });

  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/sales/prospects`);
  const box = owner.getByTestId('prospects');
  await box.waitFor();
  await box.getByLabel('영업기회 검색').fill('입주E2E');
  await box.getByLabel('영업기회 검색').press('Enter');
  const cards = box.getByTestId('prospect-card');
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="prospect-card"]').length === 5);
  const chip = box.getByTestId('prospects-movein');
  assert.equal(await chip.getAttribute('aria-pressed'), 'false');
  await chip.click();
  await box.getByTestId('prospects-movein-count').waitFor();
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="prospect-card"]').length === 3);
  assert.equal(await box.getByTestId('prospects-movein-count').innerText(), '입주 시기에 맞는 단지 3곳 · 입주가 가까운 순 · 아파트만');
  const names = await cards.evaluateAll((els) => els.map((e) => (e.textContent ?? '').match(/입주E2E [^·\n]*?입주/)?.[0] ?? ''));
  assert.deepEqual(names, ['입주E2E 이번 달 입주', '입주E2E 3개월 전 입주', '입주E2E 6개월 뒤 입주'], '창 밖(13개월 전·7개월 뒤)은 빠지고 입주가 가까운 순(242차)');
  assert.deepEqual(await box.getByTestId('prospect-movein-label').allInnerTexts(), ['· 이번 달 입주', '· 입주 3개월 지남', '· 입주까지 6개월']);
  await box.screenshot({ path: `${SHOTS}/186-prospects-movein.png` });

  // 휴대폰 폭: 칩이 줄바꿈되고 좌우로 밀리지 않음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.waitForTimeout(200);
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, `휴대폰 폭 좌우 넘침 ${over}px`);
  await owner.screenshot({ path: `${SHOTS}/186-prospects-movein-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await chip.click();
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="prospect-card"]').length === 5);
  assert.equal(await box.getByTestId('prospects-movein-count').count(), 0, '칩을 끄면 전체로');

  // B1: 수집기 칸 새 카드(영업 DB · 매일 09·11·13·15시 · 키 안내)
  await owner.goto(`${BASE}/s/sales/sources#collectors`);
  const card = owner.locator('[data-testid="sales-collector"][data-slug="kapt_new_complexes"]');
  await card.waitFor();
  const text = await card.innerText();
  assert.match(text, /신규 공동주택 단지\(K-apt 단지 목록\)/);
  assert.match(text, /09:00·11:00·13:00·15:00/);
  assert.match(text, /15057332/, '플랫폼 운영 보기: 원천 설명에 서비스 번호');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${SHOTS}/186-collector-kapt-new.png` });
}
