// 192차(대표 10/27 "결제 시험회사 숨겨도 됩니다. 결제 모듈 상태가 정상인지만 표기하는 걸 냅두고 그 밑에 테스트만 냅둡니다. 굳이 테스트 결제 회사를 추가해야 할 이유를 모르겠네요."):
// 플랫폼 운영 › 요금·결제 › 결제 모듈 · 시험 = 결제 모듈 상태(설정 필요·정상·확인 필요 + 운영 결제 방식·최근 7일·마지막 시험) + [시험 결제]만
// · 시험 회사 만들기·목록·지우기 없음 · [시험 결제창 열기]는 숨은 시험 계정 하나를 다시 씀(두 번 눌러도 회사 안 늘어남) · 그 계정은 고객사 목록에 없음 · 휴대폰 폭
// (결제창은 가짜 스크립트로 열린 값만 확인 — 실제 나이스페이 아님. 상태 계산 세부는 API 시험 billing.test.mjs '192차')
import assert from 'node:assert/strict';

const FAKE_NP = `window.goPay = function(f){ window.__np = Object.fromEntries(Array.from(f.elements).map(function(i){ return [i.name, i.value]; })); return false; };`;

export async function payTest192({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.route('https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_NP }));
  try {
    await owner.goto(`${BASE}/platform?tab=paytest`);
    const box = owner.getByTestId('pay-status'); await box.waitFor();
    const state = await box.getAttribute('data-state');
    assert.ok(['ok', 'warn', 'setup'].includes(state), `상태 ${state}`);
    assert.match(await box.innerText(), /결제 모듈 (정상|확인 필요|설정 필요)/);
    assert.match(await owner.getByTestId('pay-status-mode').innerText(), /^운영 결제: (실 상점|시험 상점|꺼짐)/);
    assert.match(await owner.getByTestId('pay-status-week').innerText(), /승인 \d+건 · 실패 \d+건/);
    for (const id of ['pay-test-create', 'pay-test-tenant', 'pay-test-remove']) assert.equal(await owner.getByTestId(id).count(), 0, `${id} 없음(시험 회사 화면 없앰)`);
    // [시험 결제창 열기] 두 번 → 숨은 시험 계정 하나 · 결제창 값은 시험 상점
    const tests0 = (await sql`select count(*)::int n from tenants where is_test and deleted_at is null`)[0].n;
    for (let k = 0; k < 2; k++) {
      await owner.evaluate(() => { delete window.__np; });
      await owner.getByTestId('pay-test-open').click();
      await owner.waitForFunction(() => !!window.__np);
    }
    const np = await owner.evaluate(() => window.__np);
    assert.equal(np.MID, 'nictest00m', '늘 시험 상점');
    const [cfg] = await sql`select value from app_settings where key = 'pay_tester'`;
    assert.ok(cfg?.value?.tenant, '숨은 시험 계정 기록');
    const tests1 = (await sql`select count(*)::int n from tenants where is_test and deleted_at is null`)[0].n;
    assert.ok(tests1 - tests0 <= 1 && tests1 >= 1, `시험 회사가 늘지 않음(${tests0} → ${tests1})`);
    assert.equal((await sql`select count(*)::int n from payments where tenant = ${cfg.value.tenant} and created_at > now() - interval '5 minutes' and status = 'pending'`)[0].n >= 2, true, '열 때마다 대기 결제 기록');
    const all = await ctx.owner.ok('GET', '/api/platform/tenants');
    assert.ok((all.tenants ?? all.rows ?? []).every((x) => x.id !== cfg.value.tenant), '숨은 시험 계정은 고객사 목록에 없음');
    await owner.goto(`${BASE}/platform?tab=paytest`);
    await owner.getByTestId('pay-test-row').filter({ hasText: '대기' }).first().waitFor();
    await owner.getByTestId('pay-test').screenshot({ path: `${SHOTS}/274-pay-module.png` });
    // 휴대폰 폭: 넘침 없음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/platform?tab=paytest`);
    await owner.getByTestId('pay-status').waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 가로 넘침 없음');
  } finally {
    await owner.unroute('https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js');
    await owner.evaluate(() => { delete window.goPay; }).catch(() => {});
    await owner.setViewportSize({ width: 1366, height: 900 });
  }
}
