// 점검 2단계 — 점검하기 · 보완 흐름(휴대폰 폭 375): 점검하기 탭 → 곳·코스 고르고 [점검 시작] → 항목마다 양호/보완 필요 + 메모 + 사진(펼치면 확인 방법·놓치기 쉬운 곳)
// → [점검 끝내기]에서 담당자 지정 → 보완 요청 업무 → (담당자가 사진 올리고 완료) → 확인 대기 → [다시 보완](새 업무·2차) → 다시 완료 → [양호 확인]
// → 수시 점검(항목 찾아 적기) → 분야·공간 탭에서 코스 만들기. 직원 쪽 업무 완료는 API 로(업무 화면은 다른 단계가 봄). 업무의 검토 기능은 쓰지 않음(대표 11/18)
import assert from 'node:assert/strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR42mNk+M+AFzAxDCgY4dIATT0CDxO0HKMAAAAASUVORK5CYII=', 'base64');

export async function checkRun({ owner, ctx, BASE, SHOTS }) {
  const finishTask = async (taskId) => {
    const c = ctx.staffA.client;
    const init = await c.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: 'done.jpg', mimeType: 'image/jpeg', size: 4, capturedAt: new Date().toISOString() });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
    await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
    await c.ok('PATCH', `/api/tasks/${taskId}`, { status: 'done' }); // 검토 요청 없이 바로 완료
  };
  const fit = async (what) => assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 375), `${what}: 375 가로 넘침 없음`);
  await owner.setViewportSize({ width: 375, height: 812 });
  await owner.goto(BASE + '/check');
  await owner.getByTestId('check-run').waitFor({ timeout: 20000 }); // 점검하기 권한이 있으면 이 탭이 먼저
  await owner.getByTestId('check-start-unit').selectOption({ label: '다짐 강남점' });
  await owner.getByTestId('check-start-course').selectOption({ label: '기본 매장 점검' });
  await fit('점검 홈');
  await owner.getByTestId('check-start-go').click();
  await owner.waitForURL(/\/check\/round\//);
  const round = owner.getByTestId('check-round');
  await round.waitFor();
  assert.ok(await owner.getByTestId('check-step').count() >= 5, '코스의 공간 유형마다 한 묶음');
  // 출입구 바닥: 펼쳐서 확인 방법·놓치기 쉬운 곳 → 양호
  const door = owner.getByTestId('check-round-item').filter({ hasText: '출입구 바닥' }).first();
  await door.getByText('먼지·물기·이물 없음').click();
  await door.getByTestId('check-round-guide').getByText('매트 아래 · 모서리').waitFor();
  await door.getByTestId('check-verdict-ok').click();
  await owner.waitForFunction(() => /양호 1/.test(document.querySelector('[data-testid=check-round-count]')?.textContent ?? ''));
  // 화장실: 보완 필요 + 메모 + 사진
  const toilet = owner.getByTestId('check-step').filter({ hasText: '화장실' }).getByTestId('check-round-item').filter({ hasText: '바닥 물기·냄새 없음' }).first();
  await toilet.getByTestId('check-verdict-fix').click();
  const memo = toilet.getByTestId('check-round-memo');
  await memo.waitFor(); await memo.fill('세면대 아래 물기'); await memo.blur();
  await toilet.getByTestId('check-round-photo-input').setInputFiles({ name: 'sink.png', mimeType: 'image/png', buffer: PNG });
  await toilet.getByTestId('check-round-photo').first().waitFor({ timeout: 15000 });
  await owner.waitForFunction(() => /보완 필요 1/.test(document.querySelector('[data-testid=check-round-count]')?.textContent ?? ''));
  await fit('점검 화면');
  await owner.screenshot({ path: `${SHOTS}/check-round-mobile.png` });
  // 끝내기: 담당자 지정 → 보완 요청 업무
  await owner.getByTestId('check-finish-open').click();
  const fin = owner.getByTestId('check-finish');
  await fin.getByText('세면대 아래 물기').waitFor();
  await owner.getByTestId('check-finish-assignee').selectOption({ label: '이직원' });
  await fit('끝내기 창');
  await owner.screenshot({ path: `${SHOTS}/check-finish-mobile.png` });
  await owner.getByTestId('check-finish-go').click();
  await owner.getByText('점검을 끝냈습니다 — 보완 요청 1건을 보냈습니다').first().waitFor();
  await owner.waitForURL((u) => u.pathname === '/check');
  const row = owner.getByTestId('check-followup-row').filter({ hasText: '화장실' });
  await row.getByText('조치 중').waitFor();
  await row.getByText(/다짐 강남점 · 화장실 · 이직원/).waitFor();
  // 점검 2단계 남은 것(11/20): 홈 '점검' 카드(조치 중 1 · 마지막 점검) → 점검 화면 [업무 목록에서 보기] = 업무 목록 '점검 보완만'
  await owner.goto(BASE + '/');
  const hc = owner.getByTestId('home-check'); await hc.waitFor({ timeout: 15000 });
  await hc.getByTestId('home-check-requested').getByText('조치 중 1').waitFor();
  await hc.getByTestId('home-check-last').getByText(/마지막 점검 .*다짐 강남점 · 기본 매장 점검/).waitFor();
  await fit('홈 점검 카드');
  await hc.scrollIntoViewIfNeeded(); await owner.screenshot({ path: `${SHOTS}/check-home-card-mobile.png` });
  await hc.getByTestId('home-check-go').click();
  await owner.waitForURL((u) => u.pathname === '/check');
  await owner.getByTestId('check-tasks-link').click();
  await owner.waitForURL(/\/tasks\?.*tag=/);
  await owner.getByTestId('filter-chip').filter({ hasText: '점검 보완만' }).waitFor({ timeout: 15000 });
  await owner.getByTestId('task-list').getByText('화장실 보완 요청').first().waitFor({ timeout: 15000 });
  assert.equal(await owner.getByTestId('task-list').getByTestId('row-title').count(), 1, '점검 보완 업무만 보임');
  await fit('업무 목록 점검 보완만');
  await owner.goto(BASE + '/check');
  await owner.getByTestId('check-followup-row').filter({ hasText: '화장실' }).waitFor({ timeout: 15000 });
  // 담당자가 사진을 올리고 완료 → 확인 대기 → 다시 보완(새 업무 · 2차)
  const fu = async () => (await ctx.owner.ok('GET', '/api/check/followups?state=open')).followups.find((f) => f.itemTitle === '화장실');
  const first = await fu();
  const t1 = (await ctx.staffA.client.ok('GET', `/api/tasks/${first.taskId}`)).task;
  assert.deepEqual([t1.title, t1.photo_required, t1.status], ['화장실 보완 요청', 1, 'todo']);
  await finishTask(first.taskId);
  await owner.reload();
  await owner.getByTestId('check-count-waiting').getByText('확인 대기 1').waitFor();
  await owner.getByTestId('check-followup-row').filter({ hasText: '화장실' }).click();
  const sheet = owner.getByTestId('check-followup');
  await sheet.getByText('점검 때 본 것:').waitFor();
  await sheet.getByTestId('check-fix-photo').first().waitFor();
  await fit('보완 확인 창');
  await owner.waitForTimeout(400); // 창이 올라오는 움직임이 끝난 뒤에 찍음
  await owner.screenshot({ path: `${SHOTS}/check-followup-mobile.png` });
  await owner.getByTestId('check-confirm-again').click();
  await owner.getByText('무엇을 더 살펴보면 좋을지 한 줄 적어 주세요').first().waitFor(); // 까닭 없이 다시 보완은 안 됨
  await owner.getByTestId('check-confirm-note').fill('칸막이 아래쪽도 한 번 더 부탁드려요');
  await owner.getByTestId('check-confirm-again').click();
  await owner.getByText(/다시 살펴봐 달라고 요청했습니다/).first().waitFor();
  await owner.getByTestId('check-followup-row').filter({ hasText: '화장실' }).getByText('2차').waitFor();
  const second = await fu();
  assert.notEqual(second.taskId, first.taskId, '같은 담당자에게 새 업무');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${second.taskId}`)).task.title, '화장실 보완 요청(2차)');
  await finishTask(second.taskId);
  await owner.reload();
  await owner.getByTestId('check-followup-row').filter({ hasText: '화장실' }).click();
  await owner.getByTestId('check-confirm-ok').click();
  await owner.getByText('양호로 확인했습니다').first().waitFor();
  await owner.getByTestId('check-followups').getByText('열린 보완 요청이 없습니다.').waitFor();
  await owner.getByTestId('check-recent').getByText(/양호 1 · 보완 1/).first().waitFor();
  // 수시 점검: 항목을 찾아 적고 끝내기
  await owner.getByTestId('check-start-unit').selectOption({ label: '다짐 강남점' });
  await owner.getByTestId('check-start-adhoc').click();
  await owner.waitForURL(/\/check\/round\//);
  await owner.getByTestId('check-adhoc-search').fill('소화기');
  await owner.getByTestId('check-adhoc-item').filter({ hasText: '소화기·비상구' }).click();
  await owner.getByTestId('check-round-item').filter({ hasText: '소화기·비상구' }).getByTestId('check-verdict-ok').waitFor();
  await owner.getByTestId('check-finish-open').click();
  await owner.getByTestId('check-finish').getByText('보완이 필요한 곳이 없습니다.').waitFor();
  await owner.getByTestId('check-finish-go').click();
  await owner.getByText('점검을 끝냈습니다').first().waitFor();
  await owner.waitForURL((u) => u.pathname === '/check');
  // 분야·공간 탭: 점검 코스 만들기(돌 순서대로 공간 유형 누르기)
  await owner.getByTestId('check-tab-setup').click();
  const cs = owner.getByTestId('check-setup-courses');
  await cs.getByText('기본 매장 점검').waitFor();
  await owner.getByTestId('check-course-name').fill('E2E 화장실 먼저');
  await cs.getByTestId('check-course-place').filter({ hasText: '화장실' }).click();
  await cs.getByTestId('check-course-place').filter({ hasText: '출입구·로비' }).click();
  await owner.getByTestId('check-course-add').click();
  await cs.getByText('화장실 → 출입구·로비 → 공간 없이 보는 항목').waitFor();
  await fit('분야·공간 탭');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
