// 대표 10/20 11:40 ① 플랫폼 운영 [고객사 추가] → 회사·대표 초대 링크 → 회사 관리에 초대 대기·공간·메모·감사 기록
import assert from 'node:assert/strict';

export async function platformAdd({ owner, BASE, SHOTS, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/platform');
  await owner.getByTestId('platform-add-company').click();
  const f = owner.getByTestId('new-company');
  await f.getByTestId('new-company-name').fill('E2E 고객사');
  const chips = f.getByTestId('new-company-industries').getByRole('button');
  await chips.nth(0).click(); await chips.nth(1).click();
  await f.getByTestId('new-company-size').selectOption('11-30');
  await f.getByTestId('new-company-trial-days').fill('30');
  await f.getByTestId('new-company-space-marketing').check();
  await f.getByTestId('new-company-owner').fill('이고객');
  await f.getByTestId('new-company-email').fill('e2e-cust@dagym.test');
  await f.getByTestId('new-company-memo').fill('E2E 메모');
  // #656 담당자·구분·소개 경로
  await f.getByTestId('new-company-segment').selectOption('partner');
  await f.getByTestId('new-company-source').fill('하이링크 고객');
  await f.getByTestId('new-company-contact-name').fill('김담당');
  await f.getByTestId('new-company-contact-phone').fill('010-1234-5678');
  await owner.screenshot({ path: `${SHOTS}/152-platform-add-company.png` });
  await f.getByTestId('new-company-go').click();
  const done = owner.getByTestId('new-company-done'); await done.waitFor();
  const link = await done.getByTestId('new-company-link').getAttribute('href'); // 시험 서버는 메일 미설정 → 링크 표시
  assert.match(link ?? '', /^\/invite\//);
  await done.getByTestId('new-company-open').click();
  const d = owner.getByTestId('company-detail'); await d.waitFor();
  await d.getByTestId('company-invite-pending').waitFor();
  assert.equal(await d.getByTestId('company-space-marketing').isChecked(), true);
  assert.equal(await d.getByTestId('company-space-sales').isChecked(), false);
  assert.equal(await d.getByTestId('company-memo').inputValue(), 'E2E 메모');
  await d.getByTestId('company-audit-toggle').click();
  await d.getByTestId('company-audit').getByText('platform.tenant_create').waitFor();
  await owner.screenshot({ path: `${SHOTS}/153-platform-company-ops.png` });
  // #656 고객사 관리: 담당자·구분·단계(자동 → 직접)·연락 기록
  const crm = d.getByTestId('company-crm'); await crm.waitFor();
  assert.equal(await crm.getByTestId('company-contact-phone').inputValue(), '010-1234-5678');
  assert.match(await crm.getByTestId('company-stage-badge').innerText(), /체험 · 자동/);
  await crm.getByTestId('company-log-summary').fill('대표와 통화 — 데모 약속');
  await crm.getByTestId('company-log-next').fill('2026-11-03');
  await crm.getByTestId('company-log-add').click();
  await d.getByTestId('company-logs').getByText('대표와 통화 — 데모 약속').waitFor();
  await d.getByTestId('company-stage').selectOption('hold');
  await d.getByTestId('company-stage-note').fill('11월 결제 협의 중');
  await d.getByTestId('company-stage-save').click();
  await d.getByTestId('company-stage-badge').getByText(/보류/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/301-platform-company-crm.png` });
  const [t] = await sql`select id, industries, spaces, platform_memo, contact_phone, segment, lifecycle from tenants where name = 'E2E 고객사'`;
  assert.equal(t.industries.length, 2); assert.deepEqual(t.spaces, ['work', 'marketing']); assert.equal(t.platform_memo, 'E2E 메모');
  assert.deepEqual([t.contact_phone, t.segment, t.lifecycle], ['010-1234-5678', 'partner', 'hold']);
  await owner.keyboard.press('Escape');
  await owner.getByTestId(`company-partner-${t.id}`).waitFor(); // 목록에 파트너 배지
  await owner.getByTestId(`company-stage-${t.id}`).filter({ hasText: '보류' }).waitFor(); // 닫으면 목록을 다시 불러온다
  await owner.getByTestId(`company-contact-${t.id}`).filter({ hasText: '다음 2026-11-03' }).waitFor();
}
