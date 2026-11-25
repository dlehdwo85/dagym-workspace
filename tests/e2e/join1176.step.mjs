// #1176(대표 11/26): 회사 초대 링크 — 관리자 [링크 만들기] → 링크 복사 → (로그인 안 한 사람) 링크로 합류 신청 → 메일 확인 → 관리자 승인(역할·팀, 요금 구간 안내) → 그 비밀번호로 로그인
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export async function join1176({ browser, owner, sql, BASE, SHOTS }) {
  await sql`update join_links set disabled_at = now() where tenant = 'default' and disabled_at is null`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  const p = owner.getByTestId('join-panel');
  await p.waitFor();
  await p.getByTestId('join-days').selectOption('7');
  await p.getByTestId('join-link-make').click();
  const urlBox = p.getByTestId('join-link-url');
  await owner.waitForFunction(() => /\/join\//.test(document.querySelector('[data-testid="join-link-url"]')?.value ?? ''));
  const url = await urlBox.inputValue();
  assert.match(await p.getByTestId('join-link-meta').innerText(), /사용 중 · 만료 .+ · 신청 0건/);
  const link = new URL(url); // 링크 주소는 APP_URL 기준 — 시험 서버 주소로 바꿔 엶
  const c = await browser.newContext({ viewport: { width: 420, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const g = await c.newPage();
    await g.goto(`${BASE}${link.pathname}`);
    const form = g.getByTestId('join-form'); await form.waitFor();
    await g.getByTestId('join-name').fill('링크직원');
    await g.getByTestId('join-email').fill('linkstaff@join-e2e.test');
    await g.locator('input[type="password"]').first().fill('link-pass-1234');
    for (const k of ['terms', 'privacy', 'age14', 'ai']) await g.getByTestId(`join-agree-${k}`).check();
    await g.screenshot({ path: `${SHOTS}/1176-join-form.png` });
    await g.getByTestId('join-submit').click();
    await g.getByTestId('join-done').waitFor();
    // 확인 메일 대신: 이 서버는 메일 설정이 없어 메일이 안 감 — 같은 확인 주소를 알려진 값으로 바꿔 엶(메일 확인 흐름은 API 시험 join-links-1176)
    const t = 'e2e1176verifytoken';
    await sql`update join_requests set verify_hash = ${createHash('sha256').update(t).digest('hex')} where email = 'linkstaff@join-e2e.test' and status = 'pending'`;
    await g.goto(`${BASE}/api/join/verify?t=${t}`);
    await g.getByTestId('join-sent').getByText(/관리자에게 합류 신청이 갔습니다/).waitFor();
  } finally { await c.close(); }
  await owner.reload();
  const row = p.getByTestId('join-req-linkstaff@join-e2e.test'); await row.waitFor();
  await owner.screenshot({ path: `${SHOTS}/1176-join-panel.png` });
  await row.getByTestId('join-req-open').click();
  const m = owner.getByTestId('join-approve'); await m.waitFor();
  await m.getByTestId('join-band').waitFor();
  await m.getByTestId('join-role').selectOption('staff');
  await m.getByTestId('join-approve-go').click();
  await m.waitFor({ state: 'detached' });
  await row.waitFor({ state: 'detached' });
  const [u] = await sql`select status, role from users where email = 'linkstaff@join-e2e.test'`;
  assert.deepEqual([u.status, u.role], ['active', 'staff']);
  await sql`update join_links set disabled_at = now() where tenant = 'default' and disabled_at is null`;
}
