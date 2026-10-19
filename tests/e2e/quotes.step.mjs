// V19: AI 비서 문자 시안 카드(번호·본문 고치기 → PC 는 QR → "보내셨나요?" [보냈어요] → 기록) · 견적서 시안 카드(표·합계 → [견적서 만들기] → 견적서 화면 PDF·문자 시안 → 보냄 표시)
import assert from 'node:assert/strict';

export async function quotesFlow({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  const q = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '주식회사 다짐', ceo: '김대표', bizNo: '123-45-67890', address: '서울 강남구 테헤란로 1', phone: '02-000-0000', isDefault: true });
  const taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 견적 업무', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await owner.goto(BASE + '/assistant');
  await owner.getByText('이렇게 말해 보세요').waitFor();
  // 문자 시안
  await q([{ content: [{ type: 'tool_use', id: 'e1', name: 'propose_draft_sms', input: { body: '안녕하세요, 주식회사 다짐입니다. 내일 10시에 방문하겠습니다.', to: ['010-1234-5678'], taskId } }], stop_reason: 'tool_use' }, { content: [{ type: 'text', text: '문자 시안입니다.' }], stop_reason: 'end_turn' }]);
  await owner.getByLabel('AI 에게 요청').fill('010-1234-5678 로 내일 방문 문자 보내줘');
  await owner.getByRole('button', { name: '보내기' }).click();
  const card = owner.getByTestId('ai-sms-draft');
  await card.waitFor();
  assert.equal(await card.getByTestId('ai-sms-to').inputValue(), '010-1234-5678');
  await card.getByTestId('ai-sms-body').fill('내일 10시 방문합니다 — 다짐 김대표');
  await owner.screenshot({ path: `${SHOTS}/123-ai-sms-draft.png` });
  await card.getByTestId('ai-sms-open').click();
  await card.getByTestId('ai-sms-confirm').waitFor();
  assert.ok(await card.getByAltText('문자 QR').isVisible(), 'PC 는 QR');
  assert.equal((await sql`select count(*)::int n from outbox where channel = 'sms:handoff'`)[0].n, 0, '아직 기록 없음');
  await card.getByTestId('ai-sms-sent').click();
  await card.getByText('✓ 보낸 기록 남김').waitFor();
  const [ob] = await sql`select body_text, to_addrs, task_id from outbox where channel = 'sms:handoff' order by sent_at desc limit 1`;
  assert.deepEqual([ob.body_text, ob.to_addrs, ob.task_id], ['내일 10시 방문합니다 — 다짐 김대표', ['010-1234-5678'], taskId]);
  // 견적서 시안 → 만들기 → 견적서 화면
  await q([{ content: [{ type: 'tool_use', id: 'e2', name: 'propose_draft_quote', input: { company: 'dagym', to: { name: '강남 피트니스', phone: '010-1234-5678' }, items: [{ name: '러닝머신 A형', spec: '3.0HP', qty: 2, unitPrice: 100000 }, { name: '설치비', qty: 1, unitPrice: 55000 }], taskId } }], stop_reason: 'tool_use' }, { content: [{ type: 'text', text: '견적서 시안입니다.' }], stop_reason: 'end_turn' }]);
  await owner.getByLabel('AI 에게 요청').fill('강남 피트니스에 러닝머신 2대 견적서');
  await owner.getByRole('button', { name: '보내기' }).click();
  const qc = owner.getByTestId('ai-quote-draft');
  await qc.waitFor();
  await qc.getByText('합계 280,500원').waitFor();
  assert.equal(await qc.getByTestId('ai-quote-items').locator('tbody tr').count(), 2);
  await owner.screenshot({ path: `${SHOTS}/124-ai-quote-draft.png` });
  await qc.getByTestId('ai-quote-create').click();
  await qc.getByTestId('ai-quote-open').waitFor();
  const [qr] = await sql`select id, quote_no, total from quotes order by created_at desc limit 1`;
  assert.equal(Number(qr.total), 280500);
  await qc.getByTestId('ai-quote-open').click();
  await owner.waitForURL(/\/quotes\//);
  await owner.getByTestId('quote-title').filter({ hasText: qr.quote_no }).waitFor();
  await owner.getByTestId('quote-pdf').waitFor();
  assert.match(await owner.getByTestId('quote-status').innerText(), /초안/);
  await owner.screenshot({ path: `${SHOTS}/125-quote-page.png` });
  // 문자 시안 → 보냈어요 → 보냄 표시
  await owner.getByTestId('quote-sms').click();
  const m = owner.getByTestId('quote-sms-modal');
  await m.waitFor();
  assert.match(await m.getByTestId('quote-sms-body').inputValue(), /견적서 보기\(14일\)/);
  await m.getByTestId('quote-sms-open').click();
  await m.getByTestId('quote-sms-sent').click();
  await owner.getByTestId('quote-status').filter({ hasText: '보냄 · 문자' }).waitFor();
  const [row] = await sql`select status, sent_via from quotes where id = ${qr.id}`;
  assert.deepEqual([row.status, row.sent_via], ['sent', 'sms']);
  // 목록
  await owner.goto(BASE + '/quotes');
  await owner.getByTestId('quote-row').filter({ hasText: qr.quote_no }).waitFor();
}
