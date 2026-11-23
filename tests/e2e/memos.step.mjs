// #1135(대표 11/23 · docs/research/SECURE_MEMO_DESIGN_2026-11-23.md) 메모 화면:
// 사이드바 [메모] → 빈 화면 → 주요 메모 만들기(사이트·아이디·비밀번호, 직원 A 에게 보기 공유) → 상세는 ●●●● →
// [보기] 누르면 본인 확인 창(틀린 비밀번호 안내) → 맞으면 그 칸만 보임 + '본인 확인됨 남은 시간' → [가리기] → 기록에 '비밀번호 보기' →
// 직원 A(휴대폰)는 목록에서 '보기만'으로 보이고 고치기 단추 없음 · 대표의 일반 메모는 직원에게 안 보임 · 390 가로 넘침 없음
import assert from 'node:assert/strict';

export async function memos({ owner, staff, ctx, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/');
  await owner.locator('aside a[href="/memos"]').click();
  await owner.getByTestId('memos-page').waitFor();
  await owner.getByText('아직 메모가 없습니다').waitFor();

  // 일반 메모(나만)
  await owner.getByTestId('memo-new-note').click();
  let f = owner.getByTestId('memo-create'); await f.waitFor();
  await f.getByTestId('memo-in-title').fill('대표 개인 메모');
  await f.getByTestId('memo-in-body').fill('직원에게 보이면 안 되는 메모');
  await f.getByTestId('memo-create-go').click();
  await owner.getByTestId('memo-detail').waitFor();
  await owner.keyboard.press('Escape');

  // 주요 메모 + 직원 A 보기 공유
  await owner.getByTestId('memo-new-secret').click();
  f = owner.getByTestId('memo-create'); await f.waitFor();
  await f.getByTestId('memo-in-title').fill('세금계산서 발행 사이트');
  await f.getByTestId('memo-in-url').fill('tax.example.com');
  await f.getByTestId('memo-in-username').fill('dagym-tax');
  await f.getByTestId('memo-in-password').fill('E2E-pass-1135!');
  await f.getByTestId('memo-share-add-user').selectOption(ctx.staffA.id); // 같은 회사 사람 목록(이름 + 이메일)에서 직원 A
  assert.equal(await f.getByTestId('memo-share-row').count(), 1);
  await owner.screenshot({ path: `${SHOTS}/1135-memo-create.png` });
  await f.getByTestId('memo-create-go').click();

  const d = owner.getByTestId('memo-detail'); await d.waitFor();
  assert.equal(await d.getAttribute('data-kind'), 'secret');
  assert.equal(await d.getByTestId('memo-secret-password-value').innerText(), '●●●●●●', '처음엔 가림');
  assert.ok(!(await d.innerText()).includes('E2E-pass-1135!'), '상세 화면 어디에도 비밀번호 없음');
  assert.equal(await d.getByTestId('memo-site-open').getAttribute('href'), 'https://tax.example.com');
  assert.match(await d.getByTestId('memo-access').innerText(), /이직원[\s\S]*보기/);

  // [보기] → 본인 확인 창 → 틀린 비밀번호 → 맞는 비밀번호 → 그 칸만 보임
  await d.getByTestId('memo-view-password').click();
  const un = owner.getByTestId('memo-unlock'); await un.waitFor();
  await un.getByTestId('memo-unlock-input').fill('wrong-password');
  await un.getByTestId('memo-unlock-go').click();
  await un.getByTestId('memo-unlock-error').waitFor();
  await un.getByTestId('memo-unlock-input').fill('owner-pass-1234');
  await un.getByTestId('memo-unlock-go').click();
  await owner.waitForFunction(() => document.querySelector('[data-testid="memo-secret-password-value"]')?.textContent === 'E2E-pass-1135!');
  assert.equal(await d.getByTestId('memo-secret-username-value').innerText(), '●●●●●●', '고른 칸만');
  await owner.getByTestId('memo-unlocked').waitFor(); // 본인 확인됨 · 남은 시간
  await owner.screenshot({ path: `${SHOTS}/1135-memo-reveal.png` });
  await d.getByTestId('memo-view-password').click(); // 가리기
  assert.equal(await d.getByTestId('memo-secret-password-value').innerText(), '●●●●●●');
  // 두 번째 [보기]는 10분 안이라 다시 묻지 않음
  await d.getByTestId('memo-view-username').click();
  await owner.waitForFunction(() => document.querySelector('[data-testid="memo-secret-username-value"]')?.textContent === 'dagym-tax');
  assert.equal(await owner.getByTestId('memo-unlock').count(), 0);
  // 기록
  await d.getByTestId('memo-log-toggle').click();
  await d.getByTestId('memo-log-row').first().waitFor();
  const log = await d.getByTestId('memo-log').innerText();
  assert.match(log, /비밀번호 보기/); assert.match(log, /아이디 보기/); assert.match(log, /만듦/);
  assert.ok(!log.includes('E2E-pass-1135!'));
  await owner.keyboard.press('Escape');

  // 직원 A(휴대폰 390): 공유받은 주요 메모만 '보기만'으로, 대표 개인 메모는 없음, 고치기 단추 없음
  await staff.goto(BASE + '/memos');
  await staff.getByTestId('memos-page').waitFor();
  await staff.getByTestId('memo-row').first().waitFor();
  const titles = await staff.getByTestId('memo-row-title').allInnerTexts();
  assert.deepEqual(titles, ['세금계산서 발행 사이트']);
  assert.match(await staff.getByTestId('memo-row').first().innerText(), /보기만/);
  assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390 가로 넘침 없음');
  await staff.getByTestId('memo-row').first().click();
  const sd = staff.getByTestId('memo-detail'); await sd.waitFor();
  assert.equal(await sd.getByTestId('memo-edit-open').count(), 0, '보기만 받은 사람은 고치기 없음');
  assert.equal(await sd.getByTestId('memo-delete').count(), 0);
  assert.equal(await sd.getByTestId('memo-secret-password-value').innerText(), '●●●●●●');
  await staff.screenshot({ path: `${SHOTS}/1135-memo-staff-390.png` });
  await staff.keyboard.press('Escape');
}
