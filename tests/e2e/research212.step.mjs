// 212차 #612(대표 결정 10/25 "매주 진행"): 영업 '준공·입주 시설' 후속조사 — 머리 줄 [이번 주 묶음 지금 만들기] → 업무 하나 · 카드 '미확인 · 조사 예정 날짜(담당)'(휴대폰 폭에도)
// → 업무 [완료] 때 곳마다 값을 적는 창(비우면 확인 못함) → 카드에 현 위탁사·계약만료 · 업무 목록 칩 '후속조사'
import assert from 'node:assert/strict';

export async function research212({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'operating_facility_prospects', ${row.id}, ${sql.json({ facility_type: '아파트', region: '경기', ...row })})
    on conflict (scope, tbl, src_id) do nothing`;
  await put({ id: 'E2E212-A', name: 'E2E212 광교 단지', household_count: 99001 }); // 큰 단지부터 묶으니 맨 앞
  await put({ id: 'E2E212-B', name: 'E2E212 동탄 단지', household_count: 99000, office_phone: '031-212-0000' });
  await sql`delete from sales_research_weekly where tenant = 'default'`; // 앞 단계가 만든 이번 주 묶음이 있으면 지움(정기 실행은 시험 서버에서 꺼짐)
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/sales/hub?tab=facilities`);
  const bar = owner.getByTestId('hub-research'); await bar.waitFor();
  await bar.getByTestId('hub-research-run').click();
  await owner.getByText(/이번 주 후속조사 \d+곳을 업무로 묶었습니다/).first().waitFor();
  await bar.getByTestId('hub-research-task').waitFor();
  assert.match(await bar.getByTestId('hub-research-week').innerText(), /^이번 주 \d+곳 · 담당 .+ · \d+\/\d+까지$/);
  assert.equal(await bar.getByTestId('hub-research-run').count(), 0, '이번 주 묶음이 있으면 [지금 만들기] 없음');
  // 업무 화면(영업): 묶음 업무 한 줄 + 원천 칩 '후속조사'
  await owner.goto(`${BASE}/tasks?space=sales`);
  const trow = owner.getByTestId('row-title').filter({ hasText: '[후속조사]' }).first(); await trow.waitFor();
  assert.equal(await trow.getByTestId('row-sales-ref').innerText(), '후속조사');
  await owner.goto(`${BASE}/s/sales/hub?tab=facilities`); await bar.waitFor();
  const card = owner.getByTestId('sales-hub-item').filter({ hasText: 'E2E212 광교 단지' });
  const chip = card.getByTestId('hub-research-chip'); await chip.waitFor();
  assert.match(await chip.innerText(), /^미확인 · 조사 예정 \d+\/\d+\(담당 .+\)$/);
  await card.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/560-hub-research.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  await chip.waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, '휴대폰 폭 넘침 없음');
  // 카드 칩 → 업무 → [완료] = 곳마다 값을 적는 창
  await owner.setViewportSize({ width: 1366, height: 900 });
  await chip.click(); await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}/);
  const taskId = owner.url().match(/\/tasks\/([0-9a-f-]{36})/)[1];
  await owner.getByTestId('next-action').click();
  const dlg = owner.getByTestId('research-ask'); await dlg.waitFor();
  const rowA = dlg.getByTestId('research-ask-row').filter({ hasText: 'E2E212 광교 단지' });
  // #758(대표 10/28): 먼저 운영 방식 — 위탁이면 현 위탁사·계약 만료일, 미개관이면 첫 운영사 선정 예정 시기(현 위탁사 칸 대신)
  const rowB = dlg.getByTestId('research-ask-row').filter({ hasText: 'E2E212 동탄 단지' });
  await rowB.getByTestId('research-ask-mode-미개관').click();
  await rowB.getByTestId('research-ask-first').waitFor();
  assert.equal(await rowB.getByTestId('research-ask-operator').count(), 0, '미개관이면 현 위탁사 칸 없음');
  await rowB.getByTestId('research-ask-mode-미개관').click(); // 다시 누르면 고르기 취소(이 곳은 확인 못함으로 남김)
  await rowB.getByTestId('research-ask-operator').waitFor();
  await rowA.getByTestId('research-ask-mode-위탁').click();
  assert.equal(await rowA.getByTestId('research-ask-mode-위탁').getAttribute('aria-checked'), 'true');
  await rowA.getByTestId('research-ask-operator').fill('E2E바른운영');
  await rowA.getByTestId('research-ask-end').fill('2027-06-30');
  await rowA.getByTestId('research-ask-phone').fill('031-212-9999');
  await rowA.getByTestId('research-ask-note').fill('직영 아님 — 내년 상반기 입찰');
  assert.match(await dlg.getByTestId('research-ask-count').innerText(), /^확인 1곳 · 확인 못함 \d+곳$/);
  await owner.screenshot({ path: `${SHOTS}/561-research-complete.png` });
  await dlg.getByTestId('research-ask-save').click();
  await owner.getByText(/후속조사 \d+곳을 적었습니다 — 확인 1곳/).first().waitFor();
  await owner.waitForFunction(async (id) => (await (await fetch(`/api/tasks/${id}`)).json()).task?.status === 'done', taskId, { timeout: 15_000 });
  const [ra] = await sql`select status, result from sales_research where src_id = 'E2E212-A' order by id desc limit 1`;
  assert.deepEqual([ra.status, ra.result.mode, ra.result.operator, ra.result.contractEnd, ra.result.phone], ['done', '위탁', 'E2E바른운영', '2027-06-30', '031-212-9999']);
  const [rb] = await sql`select status from sales_research where src_id = 'E2E212-B' order by id desc limit 1`;
  assert.equal(rb.status, 'none', '비운 곳은 확인 못함');
  // 카드: 현 위탁사·계약만료 · 칩 없음(다 채움) / 비운 곳은 '조사함(확인 못함)'
  await owner.goto(`${BASE}/s/sales/hub?tab=facilities`);
  await card.waitFor();
  assert.match(await card.innerText(), /현 위탁사 E2E바른운영 · 계약만료 2027\. 6\. 30\./);
  assert.equal(await card.getByTestId('hub-research-chip').count(), 0);
  assert.equal(await card.getByTestId('hub-research-mode').innerText(), '위탁', '#758 운영 방식 표시');
  const cardB = owner.getByTestId('sales-hub-item').filter({ hasText: 'E2E212 동탄 단지' });
  assert.match(await cardB.getByTestId('hub-research-chip').innerText(), /^미확인 · \d+\/\d+ 조사함\(확인 못함\)$/);
}
