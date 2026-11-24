// #1163(대표 11/24 D-20 고객사 관리 고도화) 화면 · #1164 영업 업무 '일정 없음' 띠·배지·거르기 · #1165 업무 주소 = 목록 + 오른쪽 패널
import assert from 'node:assert/strict';

export async function ops1163({ owner, ctx, sql, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1440, height: 900 });
  // ── 고객사 하나(시험 아님) + 이번 달 결제 1건 + 해지 예약 + 연락 기록
  const T = 't_e2e1163';
  await sql`insert into tenants (id, name) values (${T}, 'E2E 고도화상사') on conflict (id) do nothing`;
  await sql`insert into tenant_subscriptions (tenant, plan_code, status, billing_cycle, next_billing_on, billing_amount, cancel_at_period_end)
    values (${T}, 'w_work', 'active', 'monthly', current_date + 9, 22000, true) on conflict (tenant) do update set billing_cycle = 'monthly', next_billing_on = current_date + 9, billing_amount = 22000, cancel_at_period_end = true`;
  const [pay] = await sql`insert into payments (tenant, kind, plan_code, moid, amount, status, paid_at, tid, meta)
    values (${T}, 'subscription', 'w_work', ${`E2E1163-${Date.now()}`}, 22000, 'paid', now(), 'T-e2e', ${sql.json({ billing: true, first: true })}) returning id`;
  await sql`insert into tenant_contact_logs (tenant, kind, summary) values (${T}, 'call', 'E2E 해지 이유 통화')`;
  await sql`insert into audit_logs (actor_id, action, target_type, target_id, detail) values (${ctx.ownerId}, 'billing.refund', 'payment', ${pay.id}, ${sql.json({ tenant: T, amount: 1000, reason: '중복 결제', reasonCode: 'duplicate' })})`;

  await owner.goto(`${BASE}/platform`);
  const list = owner.getByTestId('platform-company-list');
  await list.waitFor();
  // ① 이번 달 결제·다음 결제·미납 칸 + 정렬 · ② 해지 위험 배지
  await list.getByTestId(`company-month-paid-${T}`).getByText('22,000원').first().waitFor();
  assert.match(await list.getByTestId(`company-next-bill-${T}`).innerText(), /\d{4}-\d{2}-\d{2}[\s\S]*해지 예약/);
  await list.getByTestId(`company-risk-${T}`).waitFor();
  await list.getByTestId('platform-sort-paid').click();
  assert.equal(await list.locator('tbody tr').first().getAttribute('data-tenant'), T, '이번 달 결제 많은 순');
  await owner.screenshot({ path: `${SHOTS}/1163-company-list.png` });
  // ④ 체크 → 메일·공지 → 미리 보기(대표·관리자 없음이면 0명) · 공지 금액 금지
  await list.getByTestId(`platform-pick-${T}`).check();
  await owner.getByTestId('platform-broadcast').click();
  const bm = owner.getByTestId('broadcast-modal');
  await bm.getByTestId('broadcast-notice').check();
  await bm.getByTestId('broadcast-title').fill('점검 안내');
  await bm.getByTestId('broadcast-body').fill('이번 달 22,000원 결제 안내');
  await bm.getByTestId('broadcast-preview-btn').click();
  await owner.getByText(/금액·결제·요금 이야기를 넣지 않습니다/).first().waitFor();
  await bm.getByTestId('broadcast-body').fill('12월 1일 새벽 점검합니다');
  await bm.getByTestId('broadcast-preview-btn').click();
  await bm.getByTestId('broadcast-preview').getByText(/1곳/).waitFor();
  await owner.keyboard.press('Escape');
  // ② 상세 사유 · ③ 회사 타임라인(종류 거르기)
  await list.getByTestId(`company-open-${T}`).click();
  const d = owner.getByTestId('company-detail');
  await d.getByTestId('company-risks').getByText(/해지 예약/).waitFor();
  await d.getByTestId('company-timeline-toggle').click();
  const tl = d.getByTestId('company-timeline-list');
  await tl.getByText(/22,000원/).first().waitFor();
  await tl.getByText(/환불 1,000원 · 사유 중복 결제/).waitFor();
  await d.getByTestId('timeline-kind-contact').click();
  await tl.getByText(/22,000원/).first().waitFor({ state: 'detached' }); // 연락만 거름(다시 불러온 뒤)
  await tl.getByText(/E2E 해지 이유 통화/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/1163-company-timeline.png` });
  await owner.keyboard.press('Escape');
  // ⑥ 환불 사유 통계 · 환불 창 사유 고르기
  await owner.goto(`${BASE}/platform?tab=billing`);
  const pp = owner.getByTestId('platform-payments');
  await pp.getByTestId('refund-stats-toggle').click();
  await pp.getByTestId('refund-stats-table').getByText('중복 결제').waitFor();
  await pp.getByTestId('payments-q').fill(T);
  await pp.getByTestId(`payment-row-${pay.id}`).click();
  const pd = owner.getByTestId('payment-detail');
  await pd.getByTestId('payment-tax').getByText(/요청 없음/).waitFor();
  await pd.getByTestId('refund-partial').click();
  await pd.getByTestId('refund-reason-code').selectOption('other');
  await pd.getByTestId('refund-amount').fill('1000');
  assert.equal(await pd.getByTestId('refund-next').isDisabled(), true, '기타는 사유를 적어야 다음');
  await pd.getByTestId('refund-reason').fill('E2E 직접 사유');
  assert.equal(await pd.getByTestId('refund-next').isDisabled(), false);
  await owner.keyboard.press('Escape');

  // ── #1164 영업 출처 업무 '일정 없음' 띠 → [일정 잡기] → 미팅 → 사라짐 · 목록 배지·거르기 / #1165 주소로 들어와도 목록 + 오른쪽 패널
  // '일정 없음'은 영업 공간을 쓰는 사람에게만 — 이 단계 동안만 우리 회사 영업 공간을 켬(끝나면 원래대로)
  const [{ spaces: sp0 }] = await sql`select spaces from tenants where id = 'default'`;
  if (!(sp0 ?? []).includes('sales')) await sql`update tenants set spaces = ${[...(sp0 ?? []), 'sales']} where id = 'default'`;
  try {
  const tk = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 일정 없는 입찰', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'E2E-1164', name: 'E2E 아파트 헬스장' })} where id = ${tk.id}`;
  await owner.goto(`${BASE}/tasks/${tk.id}`);
  const panel = owner.getByTestId('task-panel');
  const band = panel.getByTestId('task-needs-schedule');
  await band.getByText('아직 잡힌 일정이 없습니다 — 현장설명회·미팅 일정을 잡아 주세요').waitFor();
  assert.equal(await owner.getByTestId('task-page').count(), 0, '#1165 가운데 전체 카드 없음');
  const pb = await panel.boundingBox(); assert.ok(pb && pb.x > 600, `오른쪽 패널 ${JSON.stringify(pb)}`);
  await owner.screenshot({ path: `${SHOTS}/1164-no-schedule-band.png` });
  await owner.goto(`${BASE}/tasks?view=all&noSchedule=1`);
  await owner.locator(`[data-task-id="${tk.id}"]`).getByTestId('no-schedule-chip').first().waitFor();
  await owner.goto(`${BASE}/tasks/${tk.id}`);
  await band.getByTestId('task-needs-schedule-go').click();
  const dlg = owner.getByRole('dialog', { name: '미팅 일정 만들기' });
  await dlg.getByLabel('장소').fill('E2E 아파트 관리사무소');
  await dlg.getByTestId('meeting-save').click();
  await band.waitFor({ state: 'detached' });
  await ctx.owner.ok('DELETE', `/api/tasks/${tk.id}`);
  } finally { await sql`update tenants set spaces = ${sp0} where id = 'default'`; }
}
