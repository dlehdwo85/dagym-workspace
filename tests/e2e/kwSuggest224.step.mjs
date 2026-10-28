// 224차 #457 관심 검색어 추천: 데이터 설정 맞춤 상자 안 [추천 받기](가짜 AI) → 넣을·뺄 낱말 + 근거 숫자(서버가 셈) · 진행한 공고도 가리는 제외어는 위험 표시(미리 안 고름)
// → [고른 것 반영] → 관심 검색어·제외 검색어 칸에 들어감 · 반영한 낱말은 추천에서 빠짐 · 휴대폰 폭 넘침 없음. 끝나면 맞춤 설정·넣은 공고를 되돌림
import assert from 'node:assert/strict';

export async function kwSuggest224({ owner, ctx, sql, BASE, SHOTS, FAKE }) {
  const ID = (n) => `00000000-0000-4000-8000-000000224${String(n).padStart(3, '0')}`; const ids = [1, 2, 3, 4, 5, 6].map(ID);
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const orig = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs;
  const clean = async () => { await sql`delete from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = any(${ids})`; await sql`delete from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = any(${ids})`; };
  await clean();
  const ins = (n, title) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), source_type: 'kapt_bid', title, notice_kind: 'new', current_status: '진행중' })}, 'workin')`;
  const work = (n, status, reason) => sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data) values ('default', 'opportunity_work', ${`w:bid:${ID(n)}`}, ${ID(n)}, ${status}, ${sql.json(reason ? { skip_reason: reason } : {})})`;
  // 다른 단계 자료와 겹치지 않게 지어낸 낱말: 진행 3(수조세척) · 대상 아님 2(벽면칠) · 지난 30일 다른 공고 1
  for (const [n, t] of [[1, '[서울] 모의단지 수조세척 용역'], [2, '[경기] 모의단지 수조세척 업체 선정'], [3, '[인천] 모의단지 수조세척 및 점검']]) { await ins(n, t); await work(n, '검토중'); }
  for (const [n, t] of [[4, '[서울] 모의단지 벽면칠 공사'], [5, '[경기] 모의단지 벽면칠 보수']]) { await ins(n, t); await work(n, '대상아님', '칠 공사는 안 함'); }
  await ins(6, '[광주] 모의단지 수조세척 용역');
  try {
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({
      add: [{ word: '수조세척', why: '진행한 수조세척 공고 3건' }], exclude: [{ word: '벽면칠', why: '칠 공사는 모두 대상 아님' }, { word: '모의단지', why: '시험용 잘못된 추천' }], remove: [] }) }], stop_reason: 'end_turn' }] }) });
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/sources`);
    const box = owner.getByTestId('kw-suggest'); await box.waitFor();
    await box.getByTestId('kw-run').click();
    await owner.getByTestId('toast').filter({ hasText: 'AI 추천을 만들었습니다' }).first().waitFor();
    const add = box.locator('[data-testid="kw-item"][data-kind="add"][data-word="수조세척"]'), ex = box.locator('[data-testid="kw-item"][data-kind="exclude"][data-word="벽면칠"]');
    const risky = box.locator('[data-testid="kw-item"][data-kind="exclude"][data-word="모의단지"]');
    await add.waitFor();
    assert.match(await add.innerText(), /진행한 수조세척 공고 3건[\s\S]*진행 3 · 대상 아님 0 · 지난 30일 더 보일 공고 \d+/);
    assert.match(await ex.innerText(), /진행 0 · 대상 아님 2 · 지난 30일 가려질 공고 \d+/);
    assert.match(await risky.innerText(), /진행한 공고 3건도 가려집니다 — 확인 뒤 고르세요/);
    assert.deepEqual([await add.getByTestId('kw-check').isChecked(), await ex.getByTestId('kw-check').isChecked(), await risky.getByTestId('kw-check').isChecked()], [true, true, false], '위험 표시는 미리 안 고름');
    assert.match(await box.getByTestId('kw-base').innerText(), /AI 추천 · 근거: 진행한 공고 \d+건 · 대상 아님 \d+건/);
    await box.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/577-kw-suggest.png`, clip: await box.boundingBox() });
    // 내 낱말 두 개만 반영(다른 단계 자료에서 나온 추천은 빼고)
    for (const it of await box.getByTestId('kw-item').all()) { const w = await it.getAttribute('data-word'); const c = it.getByTestId('kw-check'); if ((w === '수조세척' || w === '벽면칠') !== (await c.isChecked())) await c.click(); }
    await box.getByTestId('kw-apply').click();
    await owner.getByTestId('toast').filter({ hasText: '고른 추천을 맞춤 설정에 반영했습니다' }).first().waitFor();
    await owner.waitForFunction(() => (document.querySelector('[data-testid="prefs-keywords"]')?.value ?? '').includes('수조세척'));
    assert.ok((await owner.getByTestId('prefs-excludes').inputValue()).includes('벽면칠'), '제외 검색어 칸에 들어감');
    await add.waitFor({ state: 'detached' }); await ex.waitFor({ state: 'detached' });
    assert.ok(await risky.isVisible(), '고르지 않은 추천은 남음');
    const p = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs;
    assert.ok(p.keywords.includes('수조세척') && p.excludes.includes('벽면칠') && !p.excludes.includes('모의단지'));
    // 휴대폰 폭: 상자가 화면 밖으로 넘치지 않음
    await owner.setViewportSize({ width: 390, height: 844 });
    await box.scrollIntoViewIfNeeded();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
    const bb = await box.boundingBox(); assert.ok(bb && bb.x >= 0 && bb.x + bb.width <= 391, JSON.stringify(bb));
    await owner.screenshot({ path: `${SHOTS}/578-kw-suggest-mobile.png`, clip: bb });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: orig.keywords, excludes: orig.excludes });
    await clean();
  }
}
