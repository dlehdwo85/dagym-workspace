// #499-3 리드 단계 → 메타 전환 API: 광고 운영 '리드 광고' 상자 안 '리드 단계 → 메타에 알리기' — 기본 꺼짐 · 보내는 것 안내(이름·전화·이메일 안 보냄)
// · 설정(데이터 세트 숫자만·토큰 저장 뒤 '저장됨'·단계 이름표) → 저장(보내는 값) → [시험 보내기] → 켜기 → [지금 보내기] → 최근 기록 · 휴대폰 폭
// 시험 서버에는 가짜 메타가 없다 → [시험 보내기]는 가로채 내용만 확인(실제 경로는 tests/api/meta-capi.test.mjs).
// [지금 보내기]는 실제 경로 — 리드 ID 가 메타 형식(15~17자리 숫자)이 아니면 메타를 부르지 않고 '건너뜀'으로 남는 것까지.
import assert from 'node:assert/strict';

export async function metaCapi({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`update mkt_settings set capi = '{}'::jsonb, capi_token_enc = null where tenant = 'default'`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 리드 광고로 들어온 신청 1건 → 영업 리드가 미팅예정까지 감(1차 연락은 건너뜀)
  const [l] = await sql`insert into sales_leads (tenant, name, status, owner_id) values ('default', 'E2E 전환 API 리드', '미팅예정', ${ctx.ownerId}) returning id`;
  const [m] = await sql`insert into mkt_meta_leads (tenant, page_id, leadgen_id, via, status, lead_id, received_at, created_time)
    values ('default', '880001', 'e2e-capi-1', 'webhook', 'created', ${l.id}, now() - interval '30 minutes', now() - interval '31 minutes') returning id`;
  await sql`insert into sales_status_log (tenant, lead_id, from_status, to_status, changed_by) values ('default', ${l.id}, '신규리드', '미팅예정', ${ctx.ownerId})`;

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  const box = owner.getByTestId('capi'); await box.waitFor();
  assert.equal(await box.getAttribute('data-on'), '0'); assert.equal(await box.getByTestId('capi-state').innerText(), '꺼짐', '기본 꺼짐');
  assert.match(await box.innerText(), /메타 리드 번호·단계 이름·바뀐 시각[\s\S]*이름·전화·이메일은 보내지 않습니다/);
  const setup = box.getByTestId('capi-setup');
  assert.equal(await setup.evaluate((d) => d.open), true, '꺼져 있으면 설정이 펼쳐져 있음');
  assert.match(await setup.getByTestId('capi-guide').innerText(), /CRM[\s\S]*액세스 토큰 생성[\s\S]*개인정보 처리방침/);
  // 단계 이름표: 기본값(보류·되돌림은 비어 있음 = 안 보냄)
  assert.equal(await setup.getByTestId('capi-map-input').count(), 12);
  assert.deepEqual(await Promise.all(['신규리드', '1차연락완료', '미팅예정', '계약완료', '실패', '보류'].map((s) => setup.getByLabel(`${s} 이벤트 이름`).inputValue())),
    ['Lead', 'Contacted', 'QualifiedLead', 'ConvertedLead', 'DisqualifiedLead', '']);
  // 데이터 세트·토큰 저장 전에는 [시험 보내기]를 못 누름
  await setup.getByTestId('capi-test-code').fill('TEST4821');
  assert.equal(await setup.getByTestId('capi-test').isDisabled(), true);
  // 데이터 세트 ID 는 숫자만 남김 · 토큰 · CRM 이름 · 보류 이름표 → 저장(아직 꺼 둠)
  await setup.getByTestId('capi-dataset').fill('1234-5678 9012 3456');
  assert.equal(await setup.getByTestId('capi-dataset').inputValue(), '1234567890123456');
  const TOKEN = 'EAAGe2ecapi' + 'z'.repeat(30);
  await setup.getByTestId('capi-token').fill(TOKEN);
  await setup.getByTestId('capi-source').fill('워크인 CRM');
  await setup.getByLabel('보류 이벤트 이름').fill('OnHold');
  const put = owner.waitForRequest((r) => r.url().endsWith('/api/marketing/lead-ads/capi') && r.method() === 'PUT');
  await setup.getByTestId('capi-save').click();
  const body = (await put).postDataJSON();
  assert.deepEqual({ on: body.on, datasetId: body.datasetId, token: body.token, source: body.source, hold: body.map['보류'], lead: body.map['신규리드'] },
    { on: false, datasetId: '1234567890123456', token: TOKEN, source: '워크인 CRM', hold: 'OnHold', lead: 'Lead' });
  await owner.getByText('전환 API 설정을 저장했습니다').waitFor();
  await setup.locator('[data-testid=capi-token][placeholder="저장됨 — 바꿀 때만 넣기"]').waitFor();
  assert.equal(await setup.getByTestId('capi-token').inputValue(), '', '저장한 토큰은 다시 보여 주지 않음');
  assert.ok(!(await owner.content()).includes(TOKEN));
  // [시험 보내기]: 가짜 메타가 없어 가로채 내용만
  let testBody = null;
  await owner.route('**/api/marketing/lead-ads/capi/test', async (r) => { testBody = r.request().postDataJSON(); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, received: 1, fbtrace: 'e2e-trace', eventName: 'Lead', leadTail: '4321' }) }); });
  await setup.getByTestId('capi-test').click();
  await owner.getByText("시험 이벤트를 보냈습니다 — 메타가 받음 1건('Lead', 리드 …4321). 이벤트 테스트 탭에서 확인하세요").waitFor();
  assert.deepEqual(testBody, { testEventCode: 'TEST4821' });
  await owner.unroute('**/api/marketing/lead-ads/capi/test');
  // 켜기 → 보내는 중 · [지금 보내기](실제): Lead·Contacted(건너뛴 단계)·QualifiedLead 3건 → 리드 ID 형식이 아니라 메타를 부르지 않고 건너뜀
  await setup.getByTestId('capi-on').check();
  await setup.getByTestId('capi-save').click();
  await owner.getByText('전환 API 를 켰습니다 — 리드 단계가 바뀌면 메타로 보냅니다').waitFor();
  await owner.locator('[data-testid=capi][data-on="1"]').waitFor();
  assert.equal(await box.getByTestId('capi-state').innerText(), '보내는 중');
  await box.getByTestId('capi-send').click();
  await owner.getByText('새 이벤트 3건 · 보냄 0건').waitFor();
  const rows = box.getByTestId('capi-row');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 3);
  assert.equal(await box.locator('[data-testid=capi-row][data-status=skipped]').count(), 3);
  assert.deepEqual((await rows.allInnerTexts()).map((t) => t.match(/(Lead|Contacted|QualifiedLead) \(/)?.[1]).sort(), ['Contacted', 'Lead', 'QualifiedLead']);
  assert.match(await rows.first().innerText(), /…pi-1[\s\S]*건너뜀[\s\S]*메타 리드 ID 형식이 아님/);
  assert.match(await box.getByTestId('capi-stats').innerText(), /^지난 7일 보냄 0건 · 대기 0 · 실패 0 · 건너뜀 3/);
  await box.screenshot({ path: `${SHOTS}/223-capi.png` });
  // 휴대폰 폭: 표는 상자 안에서만 옆으로
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('capi-row').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.getByTestId('capi').screenshot({ path: `${SHOTS}/224-capi-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리(뒤 단계의 점검이 보내지 않게 끔)
  await sql`delete from mkt_meta_leads where id = ${m.id}`;
  await sql`delete from sales_leads where id = ${l.id}`;
  await sql`update mkt_settings set capi = '{}'::jsonb, capi_token_enc = null where tenant = 'default'`;
}
