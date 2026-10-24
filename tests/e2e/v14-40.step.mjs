// V14 40번: 휴대폰 업무 목록 — 꾹 눌러 선택 → 완료 → 다시 선택 → 삭제 뒤에도 다음 터치가 먹혀야 한다 (run.mjs 와 단독 실행 둘 다)
import assert from 'node:assert/strict';
export async function v1440({ browser, desk, ctx, sql, BASE, SHOTS }) {
  const ids = [];
  for (let i = 1; i <= 5; i++) ids.push((await ctx.owner.ok('POST', '/api/tasks', { title: `터치 시험 ${i}`, assigneeId: ctx.ownerId, approvalRequired: false })).id);
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  // 기본 화면(담당자별·마감순) — 앞 단계가 남긴 '직접 순서'(꾹 누르면 끌기)는 쓰지 않는다
  await mc.addInitScript(() => { try { localStorage.setItem('wos_task_group', 'assignee'); localStorage.setItem('wos_task_sort2', 'due'); } catch {} });
  const m = await mc.newPage();
  let dialogs = 0;
  m.on('dialog', (d) => { dialogs++; d.accept(); }); // "휴지통으로 옮길까요?"
  await m.goto(BASE + '/tasks');
  const cdp = await mc.newCDPSession(m);
  const pt = (x, y) => ({ touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const row = (id) => m.locator(`[data-row="${id}"]`);
  /** 실제 손가락처럼: 꾹 누르고(끌기 시작 0.4초·선택 0.55초를 모두 넘김) 그대로 뗀다 */
  const center = async (loc) => { await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' })); await m.waitForTimeout(150); }; // 아래 탭바·막대에 가리지 않게 가운데로
  async function longPress(id) {
    await center(row(id));
    const b = await row(id).boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...pt(b.x + b.width * 0.6, b.y + b.height / 2) });
    await m.waitForTimeout(800);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await m.waitForTimeout(300);
  }
  async function tap(loc) { if (!(await loc.evaluate((el) => !!el.closest('[data-testid=bulk-bar]')))) await center(loc); const b = await loc.boundingBox(); await m.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); }
  await row(ids[0]).waitFor();
  // 1) 꾹 → 선택 → 하나 더 → 완료
  await longPress(ids[0]);
  await m.getByTestId('bulk-bar').waitFor();
  await tap(row(ids[1]));
  assert.equal(await m.getByTestId('bulk-count').textContent(), '2건 선택');
  await tap(m.getByTestId('bulk-done'));
  await m.getByText(/2건 완료/).waitFor();
  await m.getByTestId('bulk-bar').waitFor({ state: 'detached' }); // 완료 뒤 선택 모드 끝
  // 2) 다시 꾹 → 선택 → 삭제
  await longPress(ids[2]);
  await m.getByTestId('bulk-bar').waitFor();
  await tap(row(ids[3]));
  assert.equal(await m.getByTestId('bulk-count').textContent(), '2건 선택', '두 번째 꾹 누르기·탭이 먹힘');
  await tap(m.getByTestId('bulk-delete'));
  await m.getByText(/2건 휴지통으로/).waitFor(); // 완료 안내(되돌리기)가 막대를 덮지 않아 삭제 버튼이 눌림
  assert.equal(dialogs, 1, '삭제 확인 창');
  await m.getByTestId('bulk-bar').waitFor({ state: 'detached' }); // 삭제 뒤 선택 모드 끝
  await row(ids[2]).waitFor({ state: 'detached' });
  // 3) 다음 터치: 남은 업무를 누르면 상세가 열린다 (선택·끌기 상태가 남아 터치를 먹지 않음)
  await tap(row(ids[4]).getByText('터치 시험 5'));
  await m.getByTestId('task-panel').waitFor({ timeout: 5000 });
  await m.screenshot({ path: `${SHOTS}/v14-40-touch-after-delete.png` });
  // 상세에서 그 업무를 지우면 패널이 닫히고 목록 터치가 그대로 된다
  await m.getByTestId('task-panel').getByRole('button', { name: '패널 닫기' }).click();
  await m.getByTestId('task-panel').waitFor({ state: 'detached' });
  await m.waitForTimeout(800); // #535 닫은 뒤 0.7초 동안 목록을 연 자리로 맞춤(사람 손이 닿으면 멈춤) — 시험의 scrollIntoView 는 사람 입력이 아니어서 끝날 때까지 기다림(전체 실행에서 '선택'이 아닌 곳을 누르던 원인)
  await tap(m.getByTestId('select-mode'));
  await m.getByTestId('bulk-bar').waitFor();
  await tap(m.getByTestId('select-mode')); // 선택 끝내기
  await m.getByTestId('bulk-bar').waitFor({ state: 'detached' });
  await tap(row(ids[4]).getByText('터치 시험 5'));
  await m.getByTestId('task-panel').waitFor({ timeout: 5000 });
  assert.equal((await sql`select count(*)::int n from tasks where id = any(${[ids[2], ids[3]]}::uuid[]) and deleted_at is not null`)[0].n, 2);
  await mc.close();
}
