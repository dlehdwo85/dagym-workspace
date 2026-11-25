// #1181 상업화 마감 4번: 설정 › 쓰는 기능 — 점검 끄면 사이드바 '점검'·/check 화면이 사라지고, 켜면 돌아옴 · 운영자 회사 상세 '기능' 칸
import assert from 'node:assert/strict';

export async function features1181({ owner, ctx, sql, BASE, SHOTS }) {
  const [{ platform_admin: wasAdmin }] = await sql`select platform_admin from users where id = ${ctx.ownerId}`;
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; // 운영자 회사 상세 '기능' 칸을 보려고(끝나면 되돌림)
  try {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/settings`);
  const box = owner.getByTestId('company-features'); await box.waitFor();
  const sw = box.getByTestId('company-feature-check').getByTestId('company-feature-switch');
  assert.equal(await sw.isChecked(), true, '기본 = 사용');
  await box.scrollIntoViewIfNeeded(); await box.screenshot({ path: `${SHOTS}/1181-features-settings.png` });
  await sw.click(); // 저장 뒤에 칸이 바뀜(서버 값 기준) — 아래에서 저장을 기다림
  for (let i = 0; i < 40; i++) { const [r] = await sql`select enabled from tenant_features where tenant = 'default' and key = 'check'`; if (r && r.enabled === false) break; await owner.waitForTimeout(150); }
  await owner.goto(`${BASE}/`); await owner.waitForLoadState('networkidle').catch(() => {});
  assert.equal(await owner.locator('nav a[href="/check"]').count(), 0, '점검 메뉴 사라짐');
  await owner.goto(`${BASE}/check`); await owner.getByTestId('not-found').waitFor({ timeout: 15000 }); // 점검 화면 없음(앱 틀 안에서는 상태 코드 200 + '찾을 수 없음' 화면)
  assert.equal(await owner.getByTestId('check-home').count(), 0);
  // 운영자 회사 상세 '기능' 칸에 '끔 · 바꿈'
  await owner.goto(`${BASE}/platform?tenant=default`);
  const pf = owner.getByTestId('company-features'); await pf.waitFor({ timeout: 15000 });
  assert.match(await pf.getByTestId('company-feature-check').innerText(), /끔[\s\S]*켜기/);
  await pf.scrollIntoViewIfNeeded(); await pf.screenshot({ path: `${SHOTS}/1181-features-platform.png` });
  await pf.getByTestId('company-feature-check').getByTestId('company-feature-reset').click();
  for (let i = 0; i < 40; i++) { const r = await sql`select 1 from tenant_features where tenant = 'default' and key = 'check'`; if (!r.length) break; await owner.waitForTimeout(150); }
  await owner.goto(`${BASE}/`); await owner.waitForLoadState('networkidle').catch(() => {});
  assert.ok(await owner.locator('nav a[href="/check"]').count() > 0, '기본값으로 → 점검 메뉴 돌아옴');
  } finally { await sql`update users set platform_admin = ${!!wasAdmin} where id = ${ctx.ownerId}`; await sql`delete from tenant_features where tenant = 'default'`; }
}
