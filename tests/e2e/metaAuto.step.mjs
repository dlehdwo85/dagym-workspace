// #494 메타 광고 자동 세팅(화면): 광고 운영 › 메타 광고 자동 세팅 칸(초안 대기 줄 → 승인함 링크) → [새 메타 광고] 창(리드 양식 직접 입력·개인정보 확인·자료실 소재·지역 반경·기간·예산·자동 일시정지) 저장 →
// 승인함 '광고 초안' 탭(건수 배지·요약·피드 모양 미리보기·확인 문구) → [반려](사유) → 빈 탭 · 휴대폰 폭. 시험 서버에는 가짜 Meta 가 없다 → Meta 로 가는 [초안 만들기]·[승인하고 집행]은 tests/api/meta-auto.test.mjs
import assert from 'node:assert/strict';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a40000000049454e44ae426082', 'hex');
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));

export async function metaAuto({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'meta', '998877', 'E2E 다짐 메타 광고', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label, status = 'active' returning id`;
  const [page] = await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, scopes, status, created_by, info) values ('default', 'meta_fb', '777000111', 'E2E 다짐 본점', ${['pages_show_list']}, 'active', ${ctx.ownerId}, ${sql.json({ warnings: [] })})
    on conflict (tenant, provider, external_id) do update set label = excluded.label, status = 'active' returning id`;
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: 'E2E 가을 PT 메타 소재.png', mimeType: 'image/png', size: PNG.length, folder: '마케팅', space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: PNG });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  const plan = { objective: 'leads', pageAccountId: page.id, leadFormId: '880000222', privacyConfirmed: false,
    creative: { fileId: lf.id, primary: '집 앞 헬스장에서 첫 PT 상담을 받아 보세요. 상담만 받아도 운동 계획표를 드립니다.', headline: '가을 PT 첫 상담', description: '광교 다짐', cta: 'SIGN_UP' },
    location: { address: '경기 수원시 영통구 광교중앙로 140', radiusKm: 3 }, ageMin: 25, ageMax: 55, startDate: day(1), endDate: day(20), dailyBudget: 10000, totalCap: 150000, guard: { maxCpl: 20000, minSpend: 30000 } };
  // Meta 에 꺼진 채로 만들어진 초안(승인 대기) — 실제 생성은 API 시험에서
  const [draft] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, status, external, created_by)
    values ('default', ${acc.id}, 'meta', 'meta_auto', 'E2E 가을 PT 리드', ${sql.json(plan)}, 'created',
      ${sql.json({ campaignId: '120210000000000101', adsetId: '120210000000000102', creativeId: '120210000000000103', adId: '120210000000000104', formName: '가을 PT 상담', privacyUrl: 'https://example.com/privacy', formChecked: true,
        imageText: { checked: true, ratio: 8, note: '이미지 속 글자 약 8%' },
        checks: { at: new Date().toISOString(), warnings: ['하루 예산 × 20일 = 200,000원 — 총 상한 150,000원에 닿으면 그 뒤로는 멈춥니다'] } })}, ${ctx.ownerId}) returning id`;
  // 리드 양식 목록은 페이지 토큰이 필요(시험 연결엔 없음) → 화면은 번호 직접 입력으로 바뀌어야
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  const box = owner.getByTestId('meta-auto');
  await box.waitFor();
  const row = box.getByTestId('meta-plan').filter({ hasText: 'E2E 가을 PT 리드' });
  assert.equal(await row.getByTestId('meta-plan-status').innerText(), '광고 초안 · 승인 대기');
  assert.match(await row.getByTestId('meta-plan-summary').innerText(), /리드\(광고 안 양식\) · 하루 10,000원 · 총 상한 150,000원 · .*\(20일\) · 경기 수원시 영통구 광교중앙로 140 반경 3km · 25~55세 · 리드당 20,000원 넘으면 자동 일시정지/);
  assert.equal(await row.getByTestId('meta-plan-to-inbox').getAttribute('href'), '/s/marketing/approvals?tab=ads');
  assert.equal(await row.getByTestId('meta-plan-checked').innerText(), '검사 결과: 리드 양식: 가을 PT 상담 · 개인정보처리방침 링크 있음 · 이미지 속 글자 약 8%', '4cde86d b: 초안 때 검사 결과');
  assert.equal(await box.getByTestId('meta-manage-connect').getAttribute('href'), '/api/marketing/ads/connect/meta?manage=1');

  // [새 메타 광고] 창
  await box.getByTestId('meta-plan-new').click();
  const dlg = owner.getByRole('dialog', { name: '새 메타 광고(꺼진 초안으로 만듦)' });
  await dlg.getByTestId('meta-name').fill('E2E 겨울 PT 리드');
  const formIn = dlg.getByTestId('meta-form');
  await owner.waitForFunction(() => /직접 입력/.test(document.querySelector('[data-testid="meta-form"]')?.getAttribute('placeholder') ?? ''));
  await formIn.fill('880000333');
  await dlg.getByTestId('meta-privacy').check();
  await dlg.getByRole('button', { name: '소재 고르기' }).click();
  await dlg.getByRole('button', { name: /E2E 가을 PT 메타 소재/ }).first().click();
  await dlg.getByTestId('meta-primary').fill('겨울에도 가까운 헬스장에서 첫 PT 상담. 상담만 받아도 운동 계획표를 드려요.');
  await dlg.getByTestId('meta-headline').fill('겨울 PT 첫 상담');
  await dlg.getByTestId('meta-address').fill('경기 수원시 영통구 광교중앙로 140');
  await dlg.getByTestId('meta-radius').fill('5');
  await dlg.getByText('자동 일시정지 기준(권장)').click();
  await dlg.getByTestId('meta-max-cpl').fill('25000');
  assert.deepEqual(await dlg.getByTestId('meta-cta').locator('option').allInnerTexts(), ['가입하기', '신청하기', '더 알아보기', '견적 받기', '구독하기', '다운로드'], '리드 광고 버튼 6가지');
  await owner.screenshot({ path: `${SHOTS}/215-meta-auto-form.png`, clip: await dlg.boundingBox() });
  await dlg.getByTestId('meta-save').click();
  await owner.getByText(/세팅안을 저장했습니다/).first().waitFor();
  const made = box.getByTestId('meta-plan').filter({ hasText: 'E2E 겨울 PT 리드' });
  await made.waitFor();
  assert.equal(await made.getByTestId('meta-plan-status').innerText(), '세팅안');
  const [saved] = await sql`select plan from mkt_ad_plans where name = 'E2E 겨울 PT 리드'`;
  assert.deepEqual([saved.plan.leadFormId, saved.plan.privacyConfirmed, saved.plan.creative.fileId, saved.plan.location.radiusKm, saved.plan.guard.maxCpl], ['880000333', true, lf.id, 5, 25000]);
  assert.equal(await made.getByTestId('meta-plan-draft').isEnabled(), true, '검사 통과·상한 있음 → [Meta에 초안 만들기] 누를 수 있음');
  assert.equal(await made.getByTestId('meta-plan-later').innerText(), '초안 만들 때 검사: 광고 계정 권한·원화·활성 상태 · 리드 양식 상태·개인정보처리방침 링크 · 이미지 속 글자 비율', '4cde86d b: 세팅안 카드에 미리 표시');

  // 승인함 '광고 초안' 탭
  await owner.goto(`${BASE}/s/marketing/approvals?tab=ads`);
  const card = owner.getByTestId('meta-draft').filter({ hasText: 'E2E 가을 PT 리드' });
  await card.waitFor(); // 건수는 목록을 읽은 뒤에 채워짐(처음 그릴 때는 0)
  assert.equal(await owner.getByTestId('mkt-inbox-tab-ads').getAttribute('data-count'), '1');
  assert.match(await card.innerText(), /리드 양식: 가을 PT 상담 · 개인정보처리방침 링크 있음/);
  assert.match(await card.getByTestId('meta-draft-warnings').innerText(), /총 상한 150,000원에 닿으면/);
  assert.equal(await card.getByTestId('meta-draft-image-text').innerText(), '이미지 속 글자 약 8%');
  assert.match(await card.getByTestId('meta-preview').innerText(), /E2E 다짐 본점[\s\S]*가을 PT 첫 상담[\s\S]*가입하기/);
  await owner.waitForFunction(() => { const i = document.querySelector('[data-testid="meta-draft"] [data-testid="meta-preview"] img'); return !!i && i.complete && i.naturalWidth > 0; });
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await owner.screenshot({ path: `${SHOTS}/216-meta-draft-card.png`, clip: await card.boundingBox() });
  // 휴대폰 폭: 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await card.waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 반려(사유) → 보관, 빈 탭
  await card.getByTestId('meta-draft-reject').click();
  await card.getByTestId('meta-draft-reason').fill('예산을 줄여 다시');
  await card.getByTestId('meta-draft-reject-send').click();
  await owner.getByText(/반려했습니다 — Meta 에는 꺼진 채로 남습니다/).first().waitFor();
  await owner.getByTestId('mkt-inbox-empty').waitFor();
  const [rj] = await sql`select status, error from mkt_ad_plans where id = ${draft.id}`;
  assert.deepEqual([rj.status, rj.error], ['archived', '반려: 예산을 줄여 다시']);
}
