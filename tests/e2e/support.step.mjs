// #450 영업실 '지원사업': 사이드바 메뉴 → 맞춤 목록(1차 판단 배지·조건 칩·D-day·자격 안 맞는 공고 빼기) → [AI 판단](가짜 AI) → [신청 준비](담당 업무)
// → 영업 홈 '마감 임박 지원사업' 카드 → 상세(AI 판단·준비 서류·진행 단계) → [신청 완료] → [직접 추가](지난 신청 이력) → 신청·결과 탭 → 휴대폰 폭
// 시험 서버에는 가짜 원천이 없다 → 공고는 DB 에 만들고, 수집(기업마당·K-Startup·게시판)은 tests/api/support.test.mjs 에서
import assert from 'node:assert/strict';

export async function supportPrograms({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: day(-2200), size: '소기업', employees: 12, industries: ['소프트웨어'], keywords: ['출입'], certs: ['벤처기업'],
    brands: ['다짐', '하이링크', '워크인'], interests: ['IP', '마케팅'], excludes: [], memo: 'E2E 회사 소개' });
  const ins = (o) => sql`insert into support_programs ${sql({ regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), ...o })} returning id`.then((r) => r[0].id);
  const p1 = await ins({ source: 'bizinfo', source_id: 'E2E-1', title: '[경기] E2E 용인 IP 전략수립 지원사업', agency: '경기도', executor: '경기테크노파크', target: '중소기업', regions: ['경기'], nationwide: false, hashtags: ['경기', '용인', '지식재산'],
    apply_start: day(0), apply_end: day(5), apply_text: `${day(0)} ~ ${day(5)}`, amount: '최대 1,000만원', url: 'https://www.bizinfo.go.kr/sii/siia/selectSIIA200Detail.do?pblancId=E2E-1',
    summary: '용인시 소재 중소기업 IP 전략수립 컨설팅(기업당 최대 1,000만원)\n※ 기출원 건은 지원 불가' });
  await ins({ source: 'bizinfo', source_id: 'E2E-2', title: 'E2E 소상공인 온라인 판로 지원', agency: '중소벤처기업부', target: '소상공인', apply_end: day(20), summary: '소상공인 온라인 마케팅·판로 지원' });
  await ins({ source: 'bizinfo', source_id: 'E2E-3', title: '[부산] E2E 부산 수출 마케팅 지원', agency: '부산광역시', regions: ['부산'], nationwide: false, apply_end: day(15) });
  await ins({ source: 'kstartup', source_id: 'E2E-4', title: 'E2E 초기창업패키지 창업기업 모집', agency: '중소벤처기업부', executor: '창업진흥원', biz_years: '예비창업자,1년미만,3년미만,5년미만,7년미만', apply_end: day(12) });

  // 사이드바 '지원사업' → 맞춤 목록
  await owner.goto(`${BASE}/s/sales`);
  await owner.getByRole('link', { name: '지원사업', exact: true }).first().click();
  await owner.waitForURL(/\/s\/sales\/support/);
  const list = owner.getByTestId('support-list');
  const i1 = list.getByTestId('support-item').filter({ hasText: 'E2E 용인 IP 전략수립' }); await i1.waitFor();
  assert.equal(await i1.getByTestId('support-verdict').getAttribute('data-verdict'), 'fit');
  assert.match(await i1.getByTestId('support-flags').innerText(), /경기 지역 공고[\s\S]*용인시 공고/);
  assert.equal(await i1.getByTestId('support-dday').innerText(), 'D-5');
  assert.equal(await list.getByTestId('support-item').filter({ hasText: 'E2E 부산 수출' }).count(), 0, '자격이 안 맞는 공고는 빼고');
  await owner.getByText(/자격이 안 맞는 공고 1건은 빼고/).waitFor();
  assert.equal(await list.getByTestId('support-item').first().getAttribute('data-id'), p1, '맞는 순 맨 위');
  await owner.getByTestId('support-profile-line').getByText(/경기 용인시 · 소기업/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/207-support.png`, fullPage: false });
  // [AI 판단] — 가짜 AI 응답
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ verdict: 'fit',
    reasons: ['용인시 소재 중소기업 대상 — 본점 용인시라 해당', '기출원 건 지원 불가 — 상표·디자인은 선정 뒤 출원'], brands: ['하이링크', '워크인'], docs: ['사업자등록증', '중소기업 확인서', '출원 예정 목록'], summary: 'IP 전략 수립 컨설팅을 기업당 최대 1,000만원까지 지원', amount: '최대 1,000만원' }) }], stop_reason: 'end_turn' }] }) });
  await i1.getByTestId('support-analyze').click();
  await owner.getByText(/AI 세일즈가 판단했습니다/).waitFor();
  await i1.getByTestId('support-ai-line').getByText(/용인시 소재 중소기업 대상/).waitFor();
  assert.equal(await i1.getByTestId('support-verdict').getAttribute('data-by'), 'ai');
  // [신청 준비] → 담당 업무
  await i1.getByTestId('support-prepare').click();
  await owner.getByText(/신청 준비 업무\(체크리스트\)를 만들었습니다/).waitFor();
  await i1.getByTestId('support-status').getByText('신청 준비').waitFor();
  const [t] = await sql`select title, due_date::text due from tasks where sales_ref->>'id' = ${p1} and deleted_at is null`;
  assert.equal(t.title, '[지원사업] [경기] E2E 용인 IP 전략수립 지원사업 — 신청 준비'); assert.equal(t.due, day(5));
  // 영업 홈 카드 '마감 임박 지원사업'
  await owner.goto(`${BASE}/s/sales`);
  const card = owner.getByTestId('sales-kpi-support'); await card.waitFor();
  assert.match(await card.innerText(), /마감 임박 지원사업\s+1\s+관심·준비 1 · 맞춤 0/);
  // #647(대표 10/25 22:20): 홈 맨 위 고정 카드 '이번 주 맞는 지원사업 n건'(7일 안 마감 맞춤 — 관심·준비로 넘어간 건은 따로) + 허브 '지원사업' 탭은 지원사업 화면으로
  const pin = owner.getByTestId('sales-support-pin'); await pin.waitFor();
  assert.match(await pin.innerText(), /이번 주 맞는 지원사업\s*0\s*건[\s\S]*관심·준비 중 1건/);
  await owner.goto(`${BASE}/s/sales/hub`);
  await owner.getByTestId('sales-hub-support').click(); await owner.waitForURL(/\/s\/sales\/support/);
  await owner.getByTestId('support-list').waitFor();
  await owner.goto(`${BASE}/s/sales`); await card.waitFor();
  await card.click(); await owner.waitForURL(/\/s\/sales\/support\?tab=closing/);
  // 상세: AI 판단·준비 서류·진행 단계 → [신청 완료]
  await owner.getByTestId('support-list').getByTestId('support-open').filter({ hasText: 'E2E 용인 IP 전략수립' }).click();
  const dt = owner.getByTestId('support-detail'); await dt.waitFor();
  assert.match(await dt.getByTestId('support-ai-docs').innerText(), /사업자등록증[\s\S]*중소기업 확인서[\s\S]*출원 예정 목록/);
  await dt.getByTestId('support-task-link').getByText(/체크 0\/6/).waitFor(); // 바로 신청 준비: AI 가 읽은 서류 3 + 준비 단계 3
  await owner.screenshot({ path: `${SHOTS}/208-support-detail.png` });
  await dt.getByTestId('support-step-applied').click();
  await owner.getByText(/'신청 완료'\(으\)로 바꿨습니다/).waitFor();
  assert.equal((await sql`select status from tasks where sales_ref->>'id' = ${p1}`)[0].status, 'done', '신청하면 업무 완료');
  await owner.keyboard.press('Escape');
  // [직접 추가] 지난 신청 이력
  await owner.goto(`${BASE}/s/sales/support?tab=results`);
  await owner.getByTestId('support-add').click();
  const m = owner.getByTestId('support-manual'); await m.waitFor();
  await m.getByTestId('manual-title').fill('E2E 시 지식재산 긴급지원 사업(3차)');
  await m.getByTestId('manual-agency').fill('경기지식재산센터');
  await m.getByTestId('manual-start').fill('2026-09-08'); await m.getByTestId('manual-end').fill('2026-09-15');
  await m.getByTestId('manual-status').selectOption('applied');
  await m.getByTestId('manual-applied-at').fill('2026-09-12');
  await m.getByTestId('manual-memo').fill('결과 대기 — 개별 통보');
  await m.getByTestId('manual-save').click();
  await owner.getByText(/넣고 '신청 완료'\(으\)로 기록했습니다/).waitFor();
  await owner.getByTestId('support-detail-title').getByText('E2E 시 지식재산 긴급지원 사업(3차)').waitFor();
  assert.equal(await owner.getByTestId('support-applied-at').inputValue(), '2026-09-12');
  await owner.keyboard.press('Escape');
  const res = owner.getByTestId('support-list').getByTestId('support-item');
  await res.filter({ hasText: 'E2E 시 지식재산 긴급지원' }).getByTestId('support-status').getByText('신청 완료').waitFor();
  await res.filter({ hasText: 'E2E 용인 IP 전략수립' }).getByTestId('support-status').getByText('신청 완료').waitFor();
  // 277차 #815: [관심] 직후 토스트 [되돌리기] = 회수(업무 휴지통·진행 처음 상태) · 상세 [업무 회수]
  await owner.goto(`${BASE}/s/sales/support?tab=all`);
  const i2 = owner.getByTestId('support-list').getByTestId('support-item').filter({ hasText: 'E2E 소상공인 온라인 판로' }); await i2.waitFor();
  await i2.getByTestId('support-interest').click();
  const tst = owner.getByTestId('toast').filter({ hasText: '관심으로 두고 담당 업무를 만들었습니다' }); await tst.waitFor();
  await i2.getByTestId('support-status').waitFor();
  await tst.getByRole('button', { name: '되돌리기' }).click();
  await owner.getByText(/되돌렸습니다 — 만든 업무는 휴지통으로 옮겼습니다/).waitFor();
  await i2.getByTestId('support-interest').waitFor(); // 처음 상태: [관심]·[신청 준비] 단추가 다시
  const made = await sql`select deleted_at from tasks where sales_ref->>'name' like 'E2E 소상공인%'`;
  assert.ok(made.length === 1 && made[0].deleted_at, '만든 업무는 휴지통');
  await i2.getByTestId('support-interest').click(); await i2.getByTestId('support-status').waitFor();
  await i2.getByRole('button', { name: '진행 기록' }).click();
  const dt2 = owner.getByTestId('support-detail'); await dt2.waitFor();
  owner.once('dialog', (d) => d.accept());
  await dt2.getByTestId('support-withdraw').click();
  await owner.getByText(/업무를 회수했습니다 — 업무는 휴지통에서 30일/).waitFor();
  await dt2.getByText(/\[관심\]·\[신청 준비\]를 누르면/).waitFor();
  assert.equal((await sql`select count(*)::int n from tasks where sales_ref->>'name' like 'E2E 소상공인%' and deleted_at is null`)[0].n, 0);
  await owner.keyboard.press('Escape');
  // 휴대폰 폭: 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/sales/support`);
  await owner.getByTestId('support-item').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.screenshot({ path: `${SHOTS}/209-support-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리
  await sql`update tasks set deleted_at = now() where sales_ref->>'kind' = 'support'`;
  await sql`delete from support_programs where source_id like 'E2E-%' or title like 'E2E %'`;
  await sql`delete from support_profiles where tenant = 'default'`;
}
