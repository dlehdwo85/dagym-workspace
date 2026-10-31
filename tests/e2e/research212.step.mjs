// 212차 #612 → 247차 #777·#778(대표 10/28 21:35 '단지 정보를 확인 후 업무로 넘기는건 사람이 합니다 · 컨택해서 미팅 유도'): 영업 '준공·입주 시설' 후속조사 —
// 자동 묶음 꺼짐 · 두 곳 체크 → 아래 줄 [후속조사 넘기기 2곳] → 담당(기본 = 담당자 지정 규칙) → 업무 하나 · 카드 '후속조사 중 · 담당'(휴대폰 폭에도)
// → 업무 [완료] 때 곳마다 연락 결과(통화·직함·반응·미팅 약속 → 일정·다음 연락일 → 업무)와 운영 방식(비우면 확인 못함) → 카드에 현 위탁사·계약만료·반응·미팅 · 업무 목록 칩 '후속조사'
import assert from 'node:assert/strict';

export async function research212({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'operating_facility_prospects', ${row.id}, ${sql.json({ facility_type: '아파트', region: '경기', ...row })})
    on conflict (scope, tbl, src_id) do nothing`;
  await put({ id: 'E2E212-A', name: 'E2E212 광교 단지', household_count: 99001 }); // 큰 단지부터 묶으니 맨 앞
  await put({ id: 'E2E212-B', name: 'E2E212 동탄 단지', household_count: 99000, office_phone: '031-212-0000' });
  await sql`delete from sales_research where tenant = 'default' and src_id like 'E2E212-%'`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`; // 체크 칸(일괄)은 쓰기 열림일 때
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/sales/hub?tab=facilities&q=E2E212`);
  const bar = owner.getByTestId('hub-research'); await bar.waitFor();
  assert.match(await bar.getByTestId('hub-research-week').innerText(), /사람이 넘깁니다 — 자동 묶음 꺼짐/);
  assert.equal(await bar.getByTestId('hub-research-run').count(), 0, '247차 #777 자동 묶음 꺼짐 — [지금 만들기] 없음');
  for (const nm of ['E2E212 광교 단지', 'E2E212 동탄 단지']) await owner.getByLabel(`${nm} 선택`).check();
  await owner.getByTestId('sales-bulk').getByTestId('research-handoff').click();
  const hd = owner.getByTestId('research-handoff-dialog'); await hd.waitFor();
  await hd.locator('[data-testid="research-handoff-person"][aria-checked="true"]').waitFor();
  await hd.getByTestId('research-handoff-go').click();
  await owner.getByText(/후속조사 2곳을 넘겼습니다 — 담당 .+/).first().waitFor();
  // 업무 화면(영업): 묶음 업무 한 줄 + 원천 칩 '후속조사'
  await owner.goto(`${BASE}/tasks?space=sales`);
  const trow = owner.getByTestId('row-title').filter({ hasText: '[후속조사] 시설 2곳 — 연락(전화)' }).first(); await trow.waitFor();
  assert.equal(await trow.getByTestId('row-sales-ref').innerText(), '후속조사');
  await owner.goto(`${BASE}/s/sales/hub?tab=facilities&q=E2E212`); await bar.waitFor();
  const card = owner.getByTestId('sales-hub-item').filter({ hasText: 'E2E212 광교 단지' });
  const chip = card.getByTestId('hub-research-chip'); await chip.waitFor();
  assert.match(await chip.innerText(), /^후속조사 중 · 담당 .+ · \d+\/\d+까지$/);
  assert.equal(await card.getByTestId('research-handoff').count(), 0, '후속조사 중이면 [후속조사 넘기기] 없음');
  await card.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/560-hub-research.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  await chip.waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, '휴대폰 폭 넘침 없음');
  // 카드 칩 → 업무 → [완료] = 곳마다 값을 적는 창
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 300차 #850: 업무 링크는 지금 화면 위 오른쪽 패널(?task=id)로 열림(예전 주소 /tasks/:id 도 받음)
  await chip.click(); await owner.waitForURL((u) => /^\/tasks\/[0-9a-f-]{36}/.test(u.pathname) || /^[0-9a-f-]{36}$/.test(u.searchParams.get('task') ?? ''));
  const u0 = new URL(owner.url()); const taskId = u0.searchParams.get('task') ?? u0.pathname.match(/\/tasks\/([0-9a-f-]{36})/)[1];
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
  // 247차 #778: 연락 결과 — 통화함 → 반응·직함·미팅 약속(일정)·다음 연락일(업무)
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await rowA.getByTestId('research-ask-call-통화함').click();
  await rowA.getByTestId('research-ask-reaction-관심 있음').click();
  await rowA.getByTestId('research-ask-title').fill('관리소장');
  await rowA.getByTestId('research-ask-meeting').fill(`${ymd(5)}T14:00`);
  await rowA.getByTestId('research-ask-next').fill(ymd(10));
  // 246차 #775: 적은 답 한 줄 정리 · 통화 도움(공개 자료로 아는 것 · 물어볼 말 3줄, AI 호출 없음)
  assert.match(await rowA.getByTestId('research-ask-summary').innerText(), /^정리: 통화함 · 관리소장 · 반응 관심 있음 · 미팅 \d+\/\d+ 14:00\(일정 만듦\) · 다음 연락 \d+\/\d+\(업무 만듦\) \/ 위탁 · E2E바른운영 · 2027-06-30 만료\(약 \d+개월 뒤\) — 저장하면 시설 카드/);
  assert.match(await rowB.getByTestId('research-ask-summary').innerText(), /^정리: 확인 못함/);
  await rowA.getByTestId('research-ask-help').locator('summary').click();
  assert.equal(await rowA.getByTestId('research-ask-questions').locator('li').count(), 3);
  assert.match(await dlg.getByTestId('research-ask-count').innerText(), /^확인 1곳 · 확인 못함 \d+곳$/);
  await owner.screenshot({ path: `${SHOTS}/561-research-complete.png` });
  await dlg.getByTestId('research-ask-save').click();
  await owner.getByText(/후속조사 \d+곳을 적었습니다 — 확인 1곳/).first().waitFor();
  await owner.waitForFunction(async (id) => (await (await fetch(`/api/tasks/${id}`)).json()).task?.status === 'done', taskId, { timeout: 15_000 });
  const [ra] = await sql`select status, result from sales_research where src_id = 'E2E212-A' order by id desc limit 1`;
  assert.deepEqual([ra.status, ra.result.mode, ra.result.operator, ra.result.contractEnd, ra.result.phone], ['done', '위탁', 'E2E바른운영', '2027-06-30', '031-212-9999']);
  assert.deepEqual([ra.result.call, ra.result.contactTitle, ra.result.reaction, ra.result.meetingAt, ra.result.nextDate], ['통화함', '관리소장', '관심 있음', `${ymd(5)}T14:00`, ymd(10)]);
  assert.match((await sql`select title from events where id = ${ra.result.meetingEventId}`)[0].title, /^\[영업\] 미팅 · E2E212 광교 단지$/, '미팅 약속 → 일정');
  assert.deepEqual(Object.values((await sql`select title, due_date::text d from tasks where id = ${ra.result.nextTaskId}`)[0]), ['[영업] E2E212 광교 단지 — 다음 연락', ymd(10)], '다음 연락일 → 업무');
  const [rb] = await sql`select status from sales_research where src_id = 'E2E212-B' order by id desc limit 1`;
  assert.equal(rb.status, 'none', '비운 곳은 확인 못함');
  // 카드: 현 위탁사·계약만료 · 칩 없음(다 채움) / 비운 곳은 '조사함(확인 못함)'
  await owner.goto(`${BASE}/s/sales/hub?tab=facilities&q=E2E212`);
  await card.waitFor();
  assert.match(await card.getByTestId('hub-research-contact').innerText(), /^관리소장 · 반응 관심 있음 · 미팅 \d+\/\d+ 14:00$/, '247차 카드에 연락 결과');
  assert.match(await card.innerText(), /현 위탁사 E2E바른운영 · 계약만료 2027\. 6\. 30\./);
  assert.equal(await card.getByTestId('hub-research-chip').count(), 0);
  assert.equal(await card.getByTestId('hub-research-mode').innerText(), '위탁', '#758 운영 방식 표시');
  const cardB = owner.getByTestId('sales-hub-item').filter({ hasText: 'E2E212 동탄 단지' });
  assert.match(await cardB.getByTestId('hub-research-chip').innerText(), /^미확인 · \d+\/\d+ 조사함\(확인 못함\)$/);
}
