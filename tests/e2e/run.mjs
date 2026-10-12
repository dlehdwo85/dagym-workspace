// 실제 브라우저(Chromium) 사용자 시나리오 검증. 화면 증거를 docs/screens/ 에 저장한다.
// 실행: node tests/e2e/run.mjs   (사전: npm run build, PostgreSQL 실행)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { bootstrap, resetDb, startServer, BASE, Client, addDays, seoulToday, ensureTls, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const SHOTS = 'docs/screens';
mkdirSync(SHOTS, { recursive: true });
mkdirSync('test-results', { recursive: true });
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('✔', name); }
  catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log('✖', name, '\n   ', e.message.split('\n').slice(0, 14).join('\n    '));
    // 실패 순간 화면을 남긴다 (원인 분석용, 저장소에는 올리지 않음)
    for (const [k, pg] of Object.entries(globalThis.__pages ?? {})) await pg.screenshot({ path: `test-results/fail-${results.length}-${k}.png`, fullPage: true }).catch(() => {});
  }
}

await resetDb();
await ensureTls();
const fake = await startFakeGoogle();
let srv = await startServer();
const sql = testDb();
const ctx = await bootstrap();
const today = seoulToday();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());

async function login(context, email, password) {
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('회사 이메일').fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(BASE + '/');
  return page;
}

const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const owner = await login(desk, 'ceo@dagym.test', 'owner-pass-1234');
globalThis.__pages = { owner };
let taskId;

await step('외부 계정 없이 동작: Google 동기화 기능 꺼짐 상태에서 메뉴 숨김·API 404', async () => {
  const h = await (await fetch(BASE + '/api/health')).json();
  assert.equal(h.config.googleCalendar, false);
  const r = await ctx.owner.get('/api/google/connect?mode=both');
  assert.equal(r.status, 404);
  await owner.goto(BASE + '/settings');
  await owner.getByText('알림 종류별 수신').waitFor();
  assert.equal(await owner.getByText('Google Calendar 연동').count(), 0);
});

await step('① 대표 로그인 → 대시보드 표시', async () => {
  await owner.goto(BASE + '/');
  await owner.getByRole('heading', { name: '전체 현황' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/01-dashboard-owner.png`, fullPage: true });
});

let inviteLink;
await step('① 대표가 화면에서 직원 초대 → 초대 링크 발급', async () => {
  await owner.goto(BASE + '/admin/users');
  await owner.getByRole('button', { name: '+ 직원 초대' }).click();
  const dlg = owner.getByRole('dialog', { name: '직원 초대' });
  await dlg.getByLabel('이름').fill('정신입');
  await dlg.getByLabel('회사 이메일').fill('newbie@dagym.test');
  await dlg.getByRole('checkbox', { name: '다짐 강남점', exact: true }).check();
  await dlg.getByRole('button', { name: '초대 링크 만들기' }).click();
  inviteLink = await owner.getByTestId('invite-link').inputValue();
  assert.ok(inviteLink.includes('/invite/'));
  await owner.screenshot({ path: `${SHOTS}/02-admin-invite.png` });
  await owner.keyboard.press('Escape');
});

await step('① 직원이 초대 링크로 가입·로그인 → 허용된 현장만 보임', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await c.newPage();
  await p.goto(inviteLink);
  await p.getByText('초대했습니다').waitFor();
  await p.getByLabel('비밀번호 (8자 이상)').fill('newbie-pass-1');
  await p.getByLabel('비밀번호 확인').fill('newbie-pass-1');
  await p.getByRole('button', { name: '가입하고 시작하기' }).click();
  await p.waitForURL(BASE + '/');
  await p.goto(BASE + '/tasks');
  await p.getByTestId('filter-toggle').click();
  const options = await p.locator('select').filter({ hasText: '모든 현장·부서' }).locator('option').allTextContents();
  assert.deepEqual(options.map((o) => o.trim()), ['모든 현장·부서', '다짐 강남점 (지점)']);
  await p.screenshot({ path: `${SHOTS}/03-staff-tasks-scope.png` });
  await c.close();
});

await step('② 대표가 + 버튼으로 업무 등록·담당자 배정', async () => {
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('create-menu').click(); // 상단 바 "+ 만들기" → 업무
  await owner.getByRole('menuitem', { name: /^업무/ }).click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  await dlg.getByLabel('제목').fill('강남점 소방 점검 대응');
  await dlg.getByLabel('담당자').selectOption({ label: '이직원' });
  await dlg.getByLabel('마감일').fill(addDays(today, 3));
  await dlg.getByLabel('소속 (현장·부서)').selectOption({ label: '　다짐 강남점 (지점)' });
  await dlg.getByRole('button', { name: '등록' }).click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  taskId = owner.url().split('/').pop();
  await owner.getByTestId('task-title').waitFor();
  await owner.screenshot({ path: `${SHOTS}/04-task-detail-owner.png`, fullPage: true });
});

const mob = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const staff = await login(mob, ctx.staffA.email, ctx.staffA.password);
globalThis.__pages.staff = staff;

await step('② 직원(모바일) 알림 수신 → 알림 눌러 업무로 이동', async () => {
  await staff.goto(BASE + '/notifications');
  const item = staff.getByTestId('notifications').getByText('새 업무 배정: 강남점 소방 점검 대응');
  await item.waitFor();
  await staff.screenshot({ path: `${SHOTS}/05-mobile-notifications.png` });
  await item.click();
  await staff.waitForURL(`${BASE}/tasks/${taskId}`);
});

await step('② 직원(모바일) 댓글·멘션·사진 첨부·문서 링크 → 검토 요청', async () => {
  await staff.getByTestId('comment-input').fill('점검 완료 사진 올립니다');
  await staff.getByLabel('멘션할 사람').selectOption({ label: '최매니저' });
  const typed = await staff.getByTestId('comment-input').inputValue();
  assert.ok(typed.endsWith('@최매니저 ') && !typed.includes(']('), `입력창에는 이름만 보여야 함: ${typed}`);
  const opts = await staff.getByLabel('멘션할 사람').locator('option').allTextContents();
  assert.ok(!opts.some((o) => o.includes('박직원')), '다른 현장 직원은 멘션 목록에 없음');
  await staff.getByRole('button', { name: '등록', exact: true }).click();
  await staff.getByTestId('comments').getByText('@최매니저').waitFor();
  await staff.getByTestId('file-input').setInputFiles({ name: '소화기.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]) });
  await staff.getByTestId('attachments').getByText('소화기.jpg').waitFor();
  await staff.getByRole('button', { name: '문서 링크 연결' }).click();
  const dlg = staff.getByRole('dialog', { name: '문서 링크 연결' });
  await dlg.getByLabel('링크 (https://)').fill('https://chatgpt.com/share/example-report');
  await dlg.getByLabel('문서명').fill('소방 점검 체크 결과(ChatGPT)');
  await dlg.getByLabel('버전').fill('v1');
  await dlg.getByRole('button', { name: '연결' }).click();
  await staff.getByTestId('attachments').getByText('ChatGPT 결과물').waitFor();
  await staff.getByRole('button', { name: '완료 → 검토 요청' }).click();
  await staff.getByText('검토 요청 중').waitFor();
  await staff.screenshot({ path: `${SHOTS}/06-mobile-task-review.png`, fullPage: true });
  const n = await ctx.managerA.client.ok('GET', '/api/notifications');
  assert.ok(n.items.some((x) => x.type === 'mention'));
  assert.ok(n.items.some((x) => x.type === 'review_requested'));
});

await step('② 현장 관리자가 대시보드에서 최종 완료 확인', async () => {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const m = await login(c, ctx.managerA.email, ctx.managerA.password);
  const row = m.locator('li', { hasText: '강남점 소방 점검 대응' }).first();
  await row.getByRole('button', { name: '완료 확인' }).click();
  await m.getByText('최종 완료 처리했습니다').waitFor();
  const d = await ctx.staffA.client.ok('GET', `/api/tasks/${taskId}`);
  assert.equal(d.task.status, 'done');
  assert.equal(d.task.approved_by, ctx.managerA.id);
  await c.close();
});

// ③ 보기 전환 / 마감일 변경 일치
let t3;
await step('③ 목록에서 마감일 변경 → 보드·캘린더·타임라인 동일 반영', async () => {
  t3 = (await ctx.owner.ok('POST', '/api/tasks', { title: '보기 전환 시험 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 2) })).id;
  const nd = addDays(today, 4);
  await owner.goto(BASE + '/tasks?mode=list');
  const row = owner.locator(`[data-task-id="${t3}"]`);
  await row.getByTestId('due-input').fill(nd);
  await owner.waitForTimeout(800);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t3}`)).task.due_date, nd);
  await owner.getByRole('tab', { name: '보드' }).click();
  await owner.getByTestId('board').locator(`[data-task-id="${t3}"]`).getByText(new RegExp(`${Number(nd.slice(5, 7))}\\. ${Number(nd.slice(8))}\\.`)).waitFor();
  await owner.screenshot({ path: `${SHOTS}/07-board.png` });
  await owner.getByRole('tab', { name: '캘린더' }).click();
  const cell = owner.locator(`td[data-date="${nd}"]`);
  await cell.getByText('보기 전환 시험 업무').waitFor();
  await owner.screenshot({ path: `${SHOTS}/08-task-calendar.png` });
  await owner.getByRole('tab', { name: '타임라인' }).click();
  await owner.getByTestId('timeline').locator(`[data-task-id="${t3}"] [title="${nd} ~ ${nd}"]`).waitFor();
  await owner.screenshot({ path: `${SHOTS}/09-timeline.png` });
});

await step('③ 보드에서 끌어서 상태 변경 → 원본 반영', async () => {
  await owner.getByRole('tab', { name: '보드' }).click();
  const card = owner.getByTestId('board').locator(`[data-task-id="${t3}"]`);
  const target = owner.locator('[data-column="in_progress"]');
  const a = await card.boundingBox(); const b = await target.boundingBox();
  await owner.mouse.move(a.x + 20, a.y + 10);
  await owner.mouse.down();
  await owner.mouse.move(a.x + 40, a.y + 30, { steps: 5 });
  await owner.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 15 });
  await owner.mouse.up();
  await owner.waitForTimeout(800);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t3}`)).task.status, 'in_progress');
});

await step('③ 업무 캘린더에서 끌어서 마감일 이동 → 원본 반영', async () => {
  await owner.getByRole('tab', { name: '캘린더' }).click();
  const nd = addDays(today, 4);
  const ev = owner.locator(`td[data-date="${nd}"]`).getByText('보기 전환 시험 업무');
  const target = addDays(today, 6);
  const tcell = owner.locator(`td[data-date="${target}"]`);
  if (!(await tcell.count())) return; // 월 경계면 건너뜀
  const a = await ev.boundingBox(); const b = await tcell.boundingBox();
  await owner.mouse.move(a.x + 10, a.y + 5); await owner.mouse.down();
  await owner.mouse.move(b.x + 20, b.y + 40, { steps: 15 }); await owner.mouse.up();
  await owner.waitForTimeout(1000);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t3}`)).task.due_date, target);
});

// Asana 이상 P0
await step('B-1 목록에서 업무를 오른쪽 패널로 열기 → URL /tasks/:id → 수정 → Esc 로 닫으면 목록·필터 유지', async () => {
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.getByRole('button', { name: '이번 주' }).click().catch(() => {});
  await owner.getByRole('button', { name: '전체', exact: true }).click();
  await owner.getByLabel('업무 검색').fill('보기 전환');
  const link = owner.locator(`[data-task-id="${t3}"] a[data-open-task]`).first();
  await link.waitFor();
  await link.click();
  await owner.getByTestId('task-panel').waitFor();
  assert.ok(owner.url().endsWith(`/tasks/${t3}`), 'URL 이 업무 주소로 바뀜: ' + owner.url());
  await owner.getByTestId('task-panel').getByLabel('우선순위').selectOption('high');
  await owner.waitForTimeout(600);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t3}`)).task.priority, 'high');
  await owner.screenshot({ path: `${SHOTS}/30-task-panel.png` });
  await owner.keyboard.press('Escape');
  await owner.getByTestId('task-panel').waitFor({ state: 'detached' });
  assert.ok(owner.url().includes('/tasks?'), '목록 주소로 돌아옴: ' + owner.url());
  assert.equal(await owner.getByLabel('업무 검색').inputValue(), '보기 전환', '검색 필터 유지');
  // 새로고침해도 같은 업무가 열림 (공유 가능)
  await owner.goto(`${BASE}/tasks/${t3}`);
  await owner.getByTestId('task-page').waitFor();
});

await step('B-3 프로젝트 섹션: 추가 → 업무를 끌어 다른 섹션으로 → 보드 열=섹션', async () => {
  const pid = (await ctx.owner.ok('POST', '/api/projects', { name: 'GX 리뉴얼', orgUnitId: ctx.siteA })).id;
  const tk = (await ctx.owner.ok('POST', '/api/tasks', { title: '강사 섭외', projectId: pid })).id;
  await owner.goto(`${BASE}/projects/${pid}?mode=list`);
  for (const n of ['준비', '진행']) {
    await owner.getByLabel('새 섹션 이름').fill(n);
    await owner.getByRole('button', { name: '+ 섹션 추가' }).click();
    await owner.locator('[data-testid="sectioned-list"] h2', { hasText: n }).waitFor();
  }
  const handle = owner.getByLabel('강사 섭외 끌어서 이동');
  const target = owner.locator('section[data-section]', { hasText: '진행' }).first();
  const a = await handle.boundingBox(); const b = await target.boundingBox();
  await owner.mouse.move(a.x + 4, a.y + 4); await owner.mouse.down();
  await owner.mouse.move(a.x + 20, a.y + 20, { steps: 5 });
  await owner.mouse.move(b.x + 60, b.y + 30, { steps: 15 }); await owner.mouse.up();
  await owner.waitForTimeout(800);
  const secs = (await ctx.owner.ok('GET', `/api/projects/${pid}/sections`)).sections;
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${tk}`)).task.section_id, secs.find((x) => x.name === '진행').id, '끌어 옮긴 섹션 저장');
  await owner.screenshot({ path: `${SHOTS}/31-project-sections.png`, fullPage: true });
  await owner.getByRole('tab', { name: '보드' }).click();
  await owner.getByLabel('보드 열 기준').selectOption('section');
  await owner.getByTestId('section-board').locator(`[data-column="section:${secs.find((x) => x.name === '진행').id}"]`).getByText('강사 섭외').waitFor();
  await owner.screenshot({ path: `${SHOTS}/32-section-board.png` });
});

await step('B-4 Ctrl+K 검색 → Enter 로 업무 열기, 권한 밖 결과 없음', async () => {
  await owner.goto(BASE + '/');
  await owner.getByRole('heading', { name: '전체 현황' }).waitFor(); // 화면 준비 후 단축키
  await owner.keyboard.press('Control+K');
  await owner.getByTestId('palette-input').fill('소방 점검');
  await owner.getByTestId('palette-results').getByText('강남점 소방 점검 대응').waitFor();
  await owner.screenshot({ path: `${SHOTS}/33-command-palette.png` });
  await owner.keyboard.press('Enter');
  await owner.waitForURL(`${BASE}/tasks/${taskId}`);
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const p = await login(c, ctx.staffB.email, ctx.staffB.password);
  await p.getByText('님의 업무 현황').waitFor();
  await p.keyboard.press('Control+K');
  await p.getByTestId('palette-input').fill('소방 점검');
  await p.getByText('검색 결과가 없습니다').waitFor();
  await c.close();
});

// ④ 캘린더 반복 일정 (화면)
await step('④ 캘린더 화면에서 매주 반복 일정 등록 → 주 보기에서 끌어 이동 → "이번 일정만"', async () => {
  await owner.goto(BASE + '/calendar');
  await owner.getByRole('button', { name: '일정 등록' }).click();
  const dlg = owner.getByRole('dialog', { name: '일정 등록' });
  await dlg.getByLabel('제목').fill('주간 운영 회의');
  await dlg.getByLabel('캘린더').selectOption({ label: '회사 일정' });
  const d = addDays(today, 1);
  await dlg.getByLabel('시작일').fill(d);
  await dlg.getByLabel('종료일').fill(d);
  await dlg.getByLabel('시작 시각').fill('10:00');
  await dlg.getByLabel('종료 시각').fill('11:00');
  const dow = '일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()];
  await dlg.getByLabel('반복 규칙').selectOption({ label: `매주 ${dow}요일` });
  await dlg.getByLabel('반복 종료').selectOption('count');
  await dlg.getByLabel('반복 횟수').fill('6');
  await dlg.getByText('각자 기본 알림 설정 따르기').click();
  await dlg.getByLabel('알림 추가').selectOption({ label: '1일 전' });
  await dlg.getByRole('button', { name: '저장' }).click();
  await owner.getByText('저장했습니다').waitFor();
  await owner.getByRole('button', { name: '주', exact: true }).click();
  if (new Date(d + 'T00:00:00+09:00').getDay() === 1) await owner.getByRole('button', { name: 'Next week' }).click().catch(() => {});
  const ev = owner.locator('.fc-timegrid-event', { hasText: '주간 운영 회의' }).first();
  await ev.waitFor();
  await owner.screenshot({ path: `${SHOTS}/10-calendar-week.png` });
  const box = await ev.boundingBox();
  await owner.mouse.move(box.x + box.width / 2, box.y + 8); await owner.mouse.down();
  await owner.mouse.move(box.x + box.width / 2, box.y + 60, { steps: 10 });
  await owner.mouse.move(box.x + box.width / 2, box.y + 100, { steps: 10 }); await owner.mouse.up();
  const sd = owner.getByRole('dialog', { name: '반복 일정 적용 범위' });
  await sd.waitFor();
  await owner.screenshot({ path: `${SHOTS}/11-recurring-scope.png` });
  await sd.getByLabel('이번 일정만').check();
  await sd.getByRole('button', { name: '확인' }).click();
  await owner.getByText('일정을 이동했습니다').waitFor();
  const [mst] = await sql`select rrule, reminder_minutes from events where title = '주간 운영 회의' and recurring_event_id is null`;
  assert.ok(/COUNT=6/.test(mst.rrule), `반복 6회 저장: ${mst.rrule}`);
  assert.deepEqual(mst.reminder_minutes, [30, 1440], '일정별 알림 30분 전(기본 추가분)+하루 전 저장');
  const ex = await sql`select count(*)::int c from events e join events m on m.id = e.recurring_event_id where m.title = '주간 운영 회의' and e.deleted_at is null`;
  assert.equal(ex[0].c, 1, '예외 회차 1건 생성');
});

await step('④ 월·일·일정목록 보기 렌더링', async () => {
  for (const [b, f] of [['월', '12-calendar-month'], ['일', '13-calendar-day'], ['일정목록', '14-calendar-list']]) {
    await owner.getByRole('button', { name: b, exact: true }).click();
    await owner.waitForTimeout(300);
    await owner.screenshot({ path: `${SHOTS}/${f}.png` });
  }
});

// 네트워크 끊김
await step('⑨ 오프라인에서 댓글 작성 → 재연결 시 자동 전송(중복 없음)', async () => {
  await staff.goto(`${BASE}/tasks/${t3}`);
  await staff.getByTestId('comment-input').waitFor();
  await mob.setOffline(true);
  await staff.getByTestId('comment-input').fill('지하 주차장이라 오프라인에서 작성');
  await staff.getByRole('button', { name: '등록', exact: true }).click();
  await staff.getByText('오프라인 상태입니다').first().waitFor();
  await staff.screenshot({ path: `${SHOTS}/15-mobile-offline.png` });
  await mob.setOffline(false);
  await staff.evaluate(() => window.dispatchEvent(new Event('online')));
  await staff.getByText('전송했습니다').waitFor({ timeout: 10000 });
  const d = await ctx.staffA.client.ok('GET', `/api/tasks/${t3}`);
  assert.equal(d.comments.filter((c) => c.body === '지하 주차장이라 오프라인에서 작성').length, 1);
});

await step('⑥ 다른 현장 직원은 화면에서도 접근 불가 안내', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const p = await login(c, ctx.staffB.email, ctx.staffB.password);
  await p.goto(`${BASE}/tasks/${taskId}`);
  await p.getByText('찾을 수 없거나 접근 권한이 없습니다').waitFor();
  await p.screenshot({ path: `${SHOTS}/16-forbidden-task.png` });
  await p.goto(`${BASE}/admin/users`);
  await p.getByText('접근 권한이 없습니다').waitFor();
  await c.close();
});

await step('⑦ PC·모바일 데이터 일치 (모바일 수정 → PC 즉시 조회)', async () => {
  await staff.goto(`${BASE}/tasks/${t3}`);
  const nd = addDays(today, 8);
  await staff.getByTestId('detail-due').fill(nd);
  await staff.waitForTimeout(800);
  await owner.goto(`${BASE}/tasks/${t3}`);
  assert.equal(await owner.getByTestId('detail-due').inputValue(), nd);
});

await step('B-2 내 업무 자동 묶음 (새로 배정됨→확인·기한 지남·오늘·이번 주·나중)', async () => {
  await ctx.owner.ok('POST', '/api/tasks', { title: '방금 배정된 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 20) });
  await ctx.staffA.client.ok('POST', '/api/tasks', { title: '내가 만든 지난 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, -2) });
  await staff.goto(BASE + '/tasks?view=my&mode=list');
  const groups = staff.getByTestId('my-groups');
  await groups.locator('[data-group="new"]').getByText('방금 배정된 업무').waitFor();
  await groups.locator('[data-group="over"]').getByText('내가 만든 지난 업무').waitFor();
  await groups.locator('[data-group="new"]').getByRole('button', { name: '방금 배정된 업무 확인' }).click();
  await staff.waitForTimeout(800);
  assert.equal(await groups.locator('[data-group="new"]').getByText('방금 배정된 업무').count(), 0, '확인하면 새로 배정됨에서 빠짐');
  await staff.screenshot({ path: `${SHOTS}/29-mobile-my-groups.png`, fullPage: true });
});

await step('모바일 대시보드·캘린더·하단 메뉴 화면', async () => {
  await staff.goto(BASE + '/');
  await staff.getByText('님의 업무 현황').waitFor();
  await staff.screenshot({ path: `${SHOTS}/17-mobile-home.png` });
  await staff.goto(BASE + '/calendar');
  await staff.getByTestId('calendar').waitFor();
  await staff.waitForTimeout(500);
  await staff.screenshot({ path: `${SHOTS}/18-mobile-calendar.png` });
  await staff.getByRole('button', { name: '업무 등록' }).click();
  await staff.getByRole('dialog', { name: '업무 등록' }).waitFor();
  await staff.screenshot({ path: `${SHOTS}/19-mobile-quick-add.png` });
});

// UI/UX 개선 (UIUX_REVIEW) + Asana 이상 P1 화면
await step('U-0a 알 수 없는 주소 값(/tasks?view=board·?view=xyz)에도 화면 정상 + 보드로 해석', async () => {
  await owner.goto(BASE + '/tasks?view=board');
  await owner.getByTestId('board').waitFor();
  assert.equal(await owner.getByText('불러오지 못했습니다').count(), 0);
  await owner.goto(BASE + '/tasks?view=xyz&from=not-a-date');
  await owner.getByTestId('task-list').waitFor();
  assert.equal(await owner.getByText('불러오지 못했습니다').count(), 0);
});
await step('U-0b·U-0c 검증 오류는 항목 이름과 한국어로, 연결 실패는 한국어 안내', async () => {
  const r = await ctx.owner.post('/api/tasks', { title: '', orgUnitId: ctx.siteA });
  assert.equal(r.status, 400);
  assert.match(r.body.error.message, /제목: 제목을 입력하세요/);
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const p = await c.newPage();
  await p.goto(BASE + '/login');
  await p.route('**/api/auth/login', (route) => route.abort('connectionrefused'));
  await p.getByLabel('회사 이메일').fill('ceo@dagym.test');
  await p.getByLabel('비밀번호').fill('x');
  await p.getByRole('button', { name: '로그인' }).click();
  await p.getByText('서버에 연결할 수 없습니다').waitFor({ timeout: 15000 });
  assert.equal(await p.getByText('Failed to fetch').count(), 0);
  await p.getByRole('button', { name: '다시 시도' }).waitFor();
  await p.screenshot({ path: `${SHOTS}/34-login-network-error.png` });
  // 글꼴: Pretendard 가 실제로 내려받아져 적용됨
  const fam = await p.evaluate(async () => { await document.fonts.ready; return [getComputedStyle(document.body).fontFamily, document.fonts.check('16px "Pretendard Variable"', '업무')]; });
  assert.match(fam[0], /Pretendard Variable/); assert.equal(fam[1], true, 'Pretendard 글꼴 로드');
  await c.close();
});
await step('목록: 원형 체크로 완료 → 되돌리기, 필터 칩 표시·해제, 상단 검색(Ctrl K 버튼)', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '원형 체크 시험', orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.getByLabel('업무 검색').fill('원형 체크');
  const row = owner.locator(`[data-task-id="${id}"]`);
  await row.getByTestId('check-circle').click();
  await owner.getByText('완료했습니다').waitFor();
  await owner.waitForTimeout(500);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'done');
  await owner.getByRole('button', { name: '되돌리기' }).click();
  await owner.waitForTimeout(800);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'todo');
  await owner.getByTestId('filter-toggle').click();
  await owner.getByTestId('filter-panel').getByLabel('상태').selectOption('todo');
  await owner.getByTestId('filter-chip').filter({ hasText: '상태: 예정' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/35-task-list-filters.png` });
  await owner.getByRole('button', { name: '상태: 예정 필터 해제' }).click();
  assert.equal(await owner.getByTestId('filter-chip').count(), 0);
  await owner.getByTestId('open-palette').click();
  await owner.getByTestId('palette-input').waitFor();
  await owner.keyboard.press('Escape');
});
await step('B-8 현장 QR: 관리자가 양식 만들고 QR 표시 → 비로그인 휴대폰으로 신고 → 현장 업무 생성', async () => {
  await owner.goto(BASE + '/forms');
  await owner.getByRole('button', { name: '양식 만들기' }).first().click();
  const dlg = owner.getByRole('dialog', { name: '신고 양식 만들기' });
  await dlg.locator('select').first().selectOption({ label: '　다짐 강남점 (지점)' });
  await dlg.getByRole('button', { name: '만들기' }).click();
  await owner.getByTestId('forms').getByText('다짐 강남점 · 시설 고장').waitFor();
  await owner.getByRole('button', { name: 'QR 보기·인쇄' }).first().click();
  await owner.getByTestId('qr-sheet').locator('img').waitFor();
  await owner.screenshot({ path: `${SHOTS}/36-site-qr.png` });
  const url = await owner.getByTestId('qr-sheet').locator('p.break-all').textContent();
  await owner.keyboard.press('Escape');
  const pc = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR' });
  const p = await pc.newPage();
  await p.goto(url.trim());
  await p.getByText('다짐 강남점 시설 고장 신고').waitFor();
  await p.getByLabel('고장 내용').fill('2층 런닝머신 3번 벨트가 미끄러집니다');
  await p.getByLabel('위치 (선택)').fill('2층 유산소존');
  await p.getByRole('button', { name: '신고 보내기' }).click();
  await p.getByTestId('report-done').waitFor();
  await p.screenshot({ path: `${SHOTS}/37-public-report-done.png` });
  await pc.close();
  const [t] = await sql`select id, assignee_id from tasks where title like '[시설 고장] 2층 런닝머신%'`;
  assert.equal(t.assignee_id, ctx.managerA.id);
});
await step('B-9 결재선 화면에서 2단계 결재선 만들기 → 업무에 지정 → 현장 관리자·대표 순서로 화면에서 승인', async () => {
  await owner.goto(BASE + '/admin/approvals');
  await owner.getByRole('button', { name: '결재선 만들기' }).first().click();
  const dlg = owner.getByRole('dialog', { name: '결재선 만들기' });
  await dlg.getByLabel('이름', { exact: true }).fill('계약 결재');
  await dlg.getByRole('button', { name: '저장' }).click();
  await owner.getByTestId('approval-lines').getByText('계약 결재').waitFor();
  const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: 'PT 강사 계약서 검토', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, taskType: 'approval' })).id;
  await owner.goto(`${BASE}/tasks/${id}`);
  await owner.getByLabel('결재선').selectOption({ label: '계약 결재 (2단계)' });
  await owner.waitForTimeout(600);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const m = await login(c, ctx.managerA.email, ctx.managerA.password);
  await m.goto(`${BASE}/tasks/${id}`);
  await m.getByTestId('approval-steps').getByRole('button', { name: '승인' }).click();
  await m.getByText('승인했습니다').waitFor();
  await c.close();
  await owner.goto(`${BASE}/tasks/${id}`);
  await owner.getByTestId('approval-steps').getByText('승인 · 최매니저').waitFor();
  await owner.screenshot({ path: `${SHOTS}/38-approval-steps.png` });
  await owner.getByTestId('approval-steps').getByRole('button', { name: '승인' }).click();
  await owner.getByText('최종 승인으로 완료되었습니다').waitFor();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'done');
});
await step('B-11 프로젝트 필드: 퍼센트 필드 추가 → 업무 상세에서 값 입력 → 평균 집계', async () => {
  const pid = (await ctx.owner.ok('POST', '/api/projects', { name: '필드 화면 시험', orgUnitId: ctx.siteA })).id;
  for (const [title, v] of [['필드 A', 80], ['필드 B', 90]]) await ctx.owner.ok('POST', '/api/tasks', { title, projectId: pid });
  await owner.goto(`${BASE}/projects/${pid}`);
  await owner.getByRole('tab', { name: '사용자 지정 필드' }).click();
  await owner.getByRole('button', { name: '필드 추가' }).click();
  const dlg = owner.getByRole('dialog', { name: '필드 추가' });
  await dlg.getByLabel('이름').fill('달성률');
  await dlg.getByLabel('형식').selectOption('percent');
  await dlg.getByRole('button', { name: '추가' }).click();
  await owner.getByTestId('fields-manager').getByText('달성률').first().waitFor();
  const tasks = (await ctx.owner.ok('GET', `/api/tasks?projectId=${pid}`)).tasks;
  for (const [i, v] of [[0, '80'], [1, '90']]) {
    await owner.goto(`${BASE}/tasks/${tasks[i].id}`);
    const input = owner.getByLabel('달성률');
    await input.fill(v); await input.blur();
    await owner.waitForTimeout(500);
  }
  await owner.goto(`${BASE}/projects/${pid}`);
  await owner.getByRole('tab', { name: '사용자 지정 필드' }).click();
  await owner.getByTestId('field-summary').getByText('85%').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/39-project-fields.png` });
});
await step('화면 캡처: 대시보드·목록·보드·업무 상세(1440px)', async () => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await login(c, 'ceo@dagym.test', 'owner-pass-1234');
  await p.getByRole('heading', { name: '전체 현황' }).waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/40-dashboard-1440.png`, fullPage: true });
  await p.goto(BASE + '/tasks?mode=list');
  await p.getByTestId('task-list').waitFor();
  await p.screenshot({ path: `${SHOTS}/41-task-list-1440.png` });
  await p.goto(BASE + '/tasks?mode=board');
  await p.getByTestId('board').waitFor();
  await p.screenshot({ path: `${SHOTS}/42-board-1440.png` });
  await p.goto(`${BASE}/tasks/${taskId}`);
  await p.getByTestId('task-title').waitFor();
  await p.screenshot({ path: `${SHOTS}/43-task-detail-1440.png`, fullPage: true });
  await p.goto(BASE + '/login');
  await c.close();
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR' });
  const p2 = await c2.newPage();
  await p2.goto(BASE + '/login');
  await p2.getByLabel('회사 이메일').waitFor();
  await p2.screenshot({ path: `${SHOTS}/44-login-1440.png` });
  await c2.close();
});

await step('⑨ 서버 재시작 중 오류 안내 → 재시작 후 데이터 유지·정상 동작', async () => {
  srv.proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  const r = await owner.goto(`${BASE}/tasks`).catch((e) => e);
  assert.ok(r instanceof Error || r.status() >= 500, '서버 중단 확인');
  srv = await startServer();
  await owner.goto(`${BASE}/tasks/${t3}`);
  await owner.getByTestId('task-title').waitFor();
  const h = await (await fetch(BASE + '/api/health')).json();
  assert.equal(h.db, 'ok');
});

await step('설정·Google 연동·관리자 화면', async () => {
  for (const [path, f, text] of [['/settings', '20-settings', '알림 종류별 수신'], ['/admin/org', '22-admin-org', '조직 구성'], ['/admin/ops', '23-admin-ops', '운영 상태'], ['/admin/audit', '24-admin-audit', '감사 기록'], ['/templates', '25-templates', '업무 템플릿']]) {
    await owner.goto(BASE + path);
    await owner.getByText(text).first().waitFor();
    await owner.waitForTimeout(300);
    await owner.screenshot({ path: `${SHOTS}/${f}.png`, fullPage: true });
  }
});

await browser.close();
srv.proc.kill();
fake.server.close();
await sql.end();
const failed = results.filter((r) => !r.ok);
console.log(`\nE2E ${results.length - failed.length}/${results.length} 통과`);
const { writeFileSync } = await import('node:fs');
writeFileSync('test-results-e2e.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
