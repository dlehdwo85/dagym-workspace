// #1117(대표 11/22 '민감한 내용은 경고 혹은 승인 후에 최종 파일'): 지점 주간보고 초안 — 민감 내용 검사 패널(걸린 곳·이유·노란 표시) →
// [개인정보 모두 가리기] → 남은 사고 표현 '그대로 두기(이유)' → 제출 = 승인 대기(고객사 제출 금지) → [승인] = 고객사 제출용
import assert from 'node:assert/strict';

export async function review1117({ owner, ctx, sql, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  const name = 'E2E 검사점';
  let [site] = await sql`select id from branch_sites where tenant = 'default' and name = ${name}`;
  if (!site) [site] = await sql`insert into branch_sites (tenant, name, sort, writer_user_id) values ('default', ${name}, 99, ${ctx.ownerId}) returning id`;
  const { friday } = await ctx.owner.ok('GET', `/api/branch-reports?site=${site.id}`);
  await sql`delete from branch_reports where site_id = ${site.id} and report_day = ${friday}`;
  const body = { usage: [{ item: '헬스', count: '410' }], lockers: [], facilities: [], notes: '', sources: { w: [] },
    issues: [{ title: '샤워실 온수 민원', details: ['305동 1201호 입주민 문의 — 연락처 010-5555-6666', '바닥 미끄러워 부상, 보험 접수 예정'], state: '진행 중', evidence: [] }] };
  await sql`insert into branch_reports (tenant, site_id, kind, period_start, period_end, report_day, status, body, created_by)
    values ('default', ${site.id}, 'weekly', ${friday}::date - 7, ${friday}::date - 1, ${friday}, 'draft', ${sql.json(body)}, ${ctx.ownerId})`;
  await owner.goto(`${BASE}/branch-reports?site=${site.id}`);
  const panel = owner.getByTestId('branch-review'); await panel.waitFor();
  assert.equal(await panel.getAttribute('data-state'), 'draft');
  assert.equal(await panel.getByTestId('branch-review-flag').count(), 4, '민원인 특정·전화·부상·보험');
  assert.ok(await panel.locator('mark').first().isVisible(), '걸린 말 노란 표시');
  await owner.screenshot({ path: `${SHOTS}/1117-review-flags.png`, fullPage: true });
  await panel.getByTestId('branch-review-mask-all').click();
  await owner.getByText('개인정보를 가렸습니다').waitFor();
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="branch-review-flag"]').length === 2);
  for (let k = 0; k < 2; k++) {
    const f = owner.getByTestId('branch-review').getByTestId('branch-review-flag').filter({ hasNot: owner.getByTestId('branch-review-kept') }).first();
    await f.getByLabel('그대로 두는 이유').fill('관리사무소와 공유된 사고 — 고객사 보고 필요');
    await f.getByTestId('branch-review-keep').click();
    await owner.getByTestId('branch-review').getByTestId('branch-review-kept').nth(k).waitFor();
  }
  await owner.getByTestId('branch-submit').click();
  await owner.getByTestId('confirm-ok').click();
  await owner.locator('[data-testid="branch-review"][data-state="pending"]').waitFor();
  assert.match(await owner.getByTestId('branch-client-mark').innerText(), /승인 대기 — 고객사 제출 금지/);
  await owner.getByTestId('branch-review-approve').click();
  await owner.locator('[data-testid="branch-review"][data-state="approved"]').waitFor();
  assert.match(await owner.getByTestId('branch-client-mark').innerText(), /^고객사 제출용$/);
  await owner.screenshot({ path: `${SHOTS}/1117-review-approved.png`, fullPage: true });
  const [r] = await sql`select body from branch_reports where site_id = ${site.id} and report_day = ${friday}`;
  assert.equal(r.body.issues[0].details[0], '입주민 문의 — 연락처 010-****-6666', '가린 글이 저장됨');
}
