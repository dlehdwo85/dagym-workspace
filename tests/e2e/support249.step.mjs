// 249차 #781·#782·#784(대표 10/28 22:45 "디데이 순서·필터 · AI 확인 중이 왜?"): 지원사업 정렬·마감·종류 칩(사람별 기억 — 다시 열어도 그대로)
// · 자동 판단 꺼짐이면 '규칙상 맞음 · AI 판단 전'(안내 줄·[AI 판단 · 약 n원]) · 관리자 [여러 건 AI 판단] 창(건수 × 예상 비용) · 프로필 빈칸 안내 · 휴대폰 폭
// · 250차 #785 자동 판단 켬 → 판단 차례인 공고만 'AI 확인 중' → 정기 실행 뒤 AI 판단 · 프로필 기준 칸을 바꾸면 '예전 프로필 기준 · 다시 판단 차례'
import assert from 'node:assert/strict';

export async function support249({ owner, ctx, sql, BASE, FAKE, SHOTS, tick }) {
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const prof = { regionSido: '경기', regionSigungu: '용인시', founded: day(-1735), size: null, employees: null, industries: ['소프트웨어'], keywords: [], certs: [], brands: ['워크인'], interests: ['마케팅'], excludes: [], memo: null };
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...prof, autoAi: false }); // 앞부분은 자동 판단 꺼짐, 뒤에서 켬(#785)
  await ctx.owner.ok('PUT', '/api/sales/support/view', { sort: null, dd: 'all', kind: 'all' });
  const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), target: '중소기업', apply_end: day(20), ...o })} returning id`.then((r) => r[0].id);
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    const a = await ins({ source_id: 'E2E249-A', title: '[경기] E2E249 용인시 마케팅 지원', regions: ['경기'], nationwide: false, agency: '경기도', apply_end: day(2), amount: '최대 300만원' });
    const b = await ins({ source_id: 'E2E249-B', title: '[경기] E2E249 용인시 마케팅 기술개발 자금', regions: ['경기'], nationwide: false, agency: '경기도', apply_end: day(12), amount: '최대 1억원' });
    await ins({ source_id: 'E2E249-C', title: 'E2E249 무료 마케팅 컨설팅', apply_end: null, apply_text: '예산 소진 시까지' });
    await ins({ source_id: 'E2E249-D', title: 'E2E249 1인 창조기업 마케팅 지원센터 입주기업 모집', target: '1인 창조기업' });
    await owner.goto(`${BASE}/s/sales/support`);
    const list = owner.getByTestId('support-list');
    await owner.getByTestId('support-search').fill('E2E249');
    const ia = list.getByTestId('support-item').filter({ hasText: 'E2E249 용인시 마케팅 지원' }); await ia.waitFor();
    // #782 표시 — 돌고 있는 것처럼 보이던 'AI 확인 중' 대신
    const v = ia.getByTestId('support-verdict');
    assert.equal(await v.innerText(), '규칙상 맞음 · AI 판단 전'); assert.equal(await v.getAttribute('data-pending'), '1');
    assert.match(await owner.getByTestId('support-auto-note').innerText(), /규칙상 맞음 · AI 판단 전 \d+건[\s\S]*\[AI 판단\]을 눌러야[\s\S]*건당 약 [\d,]+원[\s\S]*새 공고 자동 판단이 꺼져 있습니다/);
    assert.match(await ia.getByTestId('support-analyze').innerText(), /^AI 판단 · 약 [\d,]+원$/);
    assert.equal(await owner.getByText('AI 확인 중', { exact: true }).count(), 0);
    // #784 빈칸 안내 — 1인 창조기업 공고가 상시근로자 수 빈칸 때문에 '확인 필요'
    assert.match(await owner.getByTestId('support-profile-blanks').innerText(), /^빈칸 \d+개\([^)]*상시근로자 수[^)]*\)를 채우면 \d+건 더 판단합니다/);
    // #781 정렬·마감·종류 칩
    const first = async () => (await list.getByTestId('support-item').first().getAttribute('data-id'));
    await owner.getByTestId('support-sort-amount').click();
    await owner.waitForFunction((id) => document.querySelector('[data-testid="support-list"] [data-testid="support-item"]')?.getAttribute('data-id') === id, b);
    assert.equal(await owner.getByTestId('support-sort-amount').getAttribute('aria-pressed'), 'true');
    await owner.getByTestId('support-dd-d7').click();
    await owner.waitForFunction(() => document.querySelectorAll('[data-testid="support-list"] [data-testid="support-item"]').length === 1);
    assert.equal(await first(), a); assert.match(await owner.getByTestId('support-dd-d7').innerText(), /^D-7\s*1$/);
    assert.match(await owner.getByTestId('support-dd-open').innerText(), /^상시·예산 소진\s*\d+$/);
    assert.match(await owner.getByTestId('support-kind-money').innerText(), /^돈\s*1$/);
    await owner.screenshot({ path: `${SHOTS}/595-support-viewbar.png` });
    // 사람별 기억 — 다시 열어도 그대로(찾기 글자는 안 남음)
    await owner.goto(`${BASE}/s/sales/support`);
    await owner.getByTestId('support-viewbar').waitFor();
    assert.deepEqual([await owner.getByTestId('support-sort-amount').getAttribute('aria-pressed'), await owner.getByTestId('support-dd-d7').getAttribute('aria-pressed')], ['true', 'true']);
    assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/support')).view, { sort: 'amount', dd: 'd7', kind: 'all', aud: 'all' }); // 254차 대상 칩(aud)
    await owner.getByTestId('support-dd-all').click(); await owner.getByTestId('support-sort-fit').click();
    await owner.waitForFunction(() => document.querySelector('[data-testid="support-sort-fit"]')?.getAttribute('aria-pressed') === 'true');
    // 관리자 [여러 건 AI 판단] — 건수 × 예상 비용을 보고 누를 때만
    const lv = await ctx.owner.ok('GET', '/api/sales/support?tab=fit&limit=200&sort=fit&dd=all&kind=all');
    const n = Math.min(5, lv.pendingCount); assert.ok(n >= 2, `판단 전 ${lv.pendingCount}건`);
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: Array.from({ length: n }, (_, i) => ({ content: [{ type: 'text', text: JSON.stringify({ verdict: 'fit',
      reasons: ['용인시 소재 중소기업 대상 — 본점 용인시라 해당'], brands: ['워크인'], docs: ['신청서'], summary: `E2E249 요약 ${i}`, amount: null, use: ['온라인 광고비로'], schedule: null,
      effect: { receive: '온라인 마케팅 비용 지원', amount: '최대 300만 원', selfPay: '10%', prepHours: 4, perBusiness: [{ brand: '워크인', line: '검색 광고비' }], confirm: ['상시근로자 수'] } }) }], stop_reason: 'end_turn' })) }) });
    await owner.getByTestId('support-analyze-top').click();
    const bk = owner.getByTestId('support-bulk'); await bk.waitFor();
    assert.match(await bk.innerText(), new RegExp(`판단 전’ ${lv.pendingCount}건`));
    assert.match(await bk.getByTestId(`support-bulk-${n}`).innerText(), new RegExp(`^${n}건 판단 · 약 [\\d,]+원$`));
    await owner.screenshot({ path: `${SHOTS}/596-support-bulk.png` });
    await bk.getByTestId(`support-bulk-${n}`).click();
    await owner.getByText(new RegExp(`위에서 ${n}건을 AI 세일즈가 판단했습니다`)).waitFor();
    const top = lv.items.filter((x) => x.pending).slice(0, n).map((x) => x.id);
    assert.equal((await sql`select count(*)::int c from support_matches where ai_verdict is not null and program_id = any(${top}::uuid[])`)[0].c, n, '맞춤 순 위에서부터 고른 건수만');
    // #785 자동 판단 켬 → AI 판단 없는 공고(C·D)만 'AI 확인 중'(판단 차례) → 정기 실행 → AI 판단
    await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...prof, autoAi: true });
    await owner.goto(`${BASE}/s/sales/support`); await owner.getByTestId('support-search').fill('E2E249');
    const ic = list.getByTestId('support-item').filter({ hasText: 'E2E249 무료 마케팅 컨설팅' }); await ic.waitFor();
    assert.deepEqual([await ic.getByTestId('support-verdict').innerText(), await ic.getByTestId('support-verdict').getAttribute('data-queued')], ['⏳ AI 확인 중', '1']);
    assert.equal(await ia.getByTestId('support-verdict').getAttribute('data-by'), 'ai', '이미 판단한 공고는 차례 아님');
    assert.match(await owner.getByTestId('support-auto-note').innerText(), /AI 세일즈가 새 공고를 자동으로 판단합니다[\s\S]*지금 판단 차례 2건/);
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [0, 1].map((i) => ({ content: [{ type: 'text', text: JSON.stringify({ verdict: 'maybe',
      reasons: ['상시근로자 조건 확인 필요'], brands: [], docs: [], summary: `E2E249 자동 ${i}`, amount: null, use: [], schedule: null,
      effect: { receive: '무료 컨설팅', amount: null, selfPay: '없음', prepHours: 2, perBusiness: [], confirm: [] } }) }], stop_reason: 'end_turn' })) }) });
    const tk = await tick();
    assert.deepEqual(tk.detail?.supportAuto?.out?.default, { done: 2, failed: 0, left: 0, stopped: null }, JSON.stringify(tk.detail?.supportAuto));
    await owner.reload(); await owner.getByTestId('support-search').fill('E2E249'); await ic.waitFor();
    await owner.waitForFunction(() => [...document.querySelectorAll('[data-testid="support-verdict"]')].every((v) => v.getAttribute('data-queued') !== '1'));
    assert.equal(await ic.getByTestId('support-verdict').getAttribute('data-by'), 'ai');
    // 판단 기준 칸(상시근로자)을 바꾸면 그 전 판단은 '예전 프로필 기준 · 다시 판단 차례'
    await ctx.owner.ok('PUT', '/api/sales/support/profile', { ...prof, employees: 12, autoAi: true });
    await owner.reload(); await owner.getByTestId('support-search').fill('E2E249'); await ia.waitFor();
    assert.equal(await ia.getByTestId('support-ai-stale').innerText(), '예전 프로필 기준 · 다시 판단 차례');
    await owner.getByTestId('support-profile-line').getByText(/새 공고 AI 자동 판단/).waitFor();
    await owner.screenshot({ path: `${SHOTS}/598-support-auto.png` });
    // 251차 #783·#784: 카드 '받는 것' 줄 → [목록에 담기] → 신청 목록 탭 표(받는 것·예상 금액·자부담·준비 시간) → 담당 골라 [업무로] → 신청 준비 · [엑셀로]
    assert.match(await ia.getByTestId('support-effect-line').innerText(), /받는 것 온라인 마케팅 비용 지원 · 최대 300만 원 · 준비 약 4시간/);
    await ia.getByTestId('support-list-toggle').click(); await owner.getByText('이번 주 신청 목록에 담았습니다').waitFor();
    await ia.locator('[data-testid="support-list-toggle"][data-on="1"]').waitFor(); // 알림이 먼저 뜨고 목록을 다시 읽은 뒤 바뀜(253차: 바로 읽으면 가끔 '0')
    await owner.getByTestId('support-tab-list').click(); await owner.waitForURL(/tab=list/);
    const row = owner.getByTestId('support-apply-row').filter({ hasText: 'E2E249 용인시 마케팅 지원' }); await row.waitFor();
    assert.match(await row.getByTestId('support-apply-receive').innerText(), /온라인 마케팅 비용 지원[\s\S]*워크인 검색 광고비/);
    assert.match(await row.innerText(), /최대 300만 원[\s\S]*10%[\s\S]*약 4시간/);
    assert.equal(await owner.getByTestId('support-list-export').getAttribute('href'), '/api/sales/support/export');
    const pick = row.getByTestId('support-apply-owner-pick'); const opt = pick.locator('option').nth(1);
    const [who, whoName] = [await opt.getAttribute('value'), (await opt.innerText()).trim()];
    await pick.selectOption(who);
    await row.getByTestId('support-apply-task').click();
    await owner.getByText(/담당에게 신청 준비 업무를 넘겼습니다/).waitFor();
    await row.getByTestId('support-apply-owner').getByText(`신청 준비 · ${whoName}`).waitFor();
    assert.equal((await sql`select t.assignee_id from support_work w join tasks t on t.id = w.task_id where w.program_id = ${a}`)[0].assignee_id, who, '고른 담당에게 업무');
    await owner.screenshot({ path: `${SHOTS}/599-support-apply-list.png` });
    const csv = await ctx.owner.req('GET', '/api/sales/support/export');
    assert.match(String(csv.body), /E2E249 용인시 마케팅 지원,경기도,[\d-]+,D-2,해당\(AI\),온라인 마케팅 비용 지원,최대 300만 원,10%,4,워크인: 검색 광고비,상시근로자 수,/);
    await owner.goto(`${BASE}/s/sales/support`);
    // 휴대폰 폭: 칩 줄이 감겨 가로 넘침 없음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/support`);
    await owner.getByTestId('support-viewbar').waitFor();
    const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
    await owner.screenshot({ path: `${SHOTS}/597-support-mobile.png` });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('PUT', '/api/sales/support/view', { sort: null, dd: 'all', kind: 'all' }).catch(() => {});
    await sql`update tasks set deleted_at = now() where sales_ref->>'kind' = 'support' and sales_ref->>'id' in (select id::text from support_programs where source_id like 'E2E249-%')`;
    await sql`delete from support_matches where program_id in (select id from support_programs where source_id like 'E2E249-%')`;
    await sql`delete from support_programs where source_id like 'E2E249-%'`;
    await sql`delete from support_profiles where tenant = 'default'`;
  }
}
