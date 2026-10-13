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

/** 업무 상세의 "필드 더보기" 펼치기 (이미 펼쳐져 있으면 그대로) */
async function openMoreFields(scope) {
  const btn = scope.getByTestId('more-fields').first();
  await btn.waitFor();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
}

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
  assert.equal(await dlg.getByLabel('소속 (현장·부서)').count(), 0, '등록 창은 제목·담당자·마감일·프로젝트 4칸');
  await dlg.getByRole('button', { name: '등록' }).click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  taskId = owner.url().split('/').pop();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${taskId}`)).task.approval_required, false, '관리자 최종 확인 기본 꺼짐');
  // 이 시나리오(현장 관리자 최종 확인)는 확인 필요·현장 소속으로 바꿔 진행
  await ctx.owner.ok('PATCH', `/api/tasks/${taskId}`, { approvalRequired: true, orgUnitId: ctx.siteA });
  await owner.reload();
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
  await row.getByTestId('due-picker').click();
  await owner.getByLabel('보기 전환 시험 업무 마감일 날짜 선택').fill(nd);
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
  await openMoreFields(owner.getByTestId('task-panel'));
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
  await owner.getByTestId('task-list').first().waitFor();
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
  await openMoreFields(owner);
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
  // 빈 화면 안내 문구에도 '달성률' 이 들어 있으므로 표의 칸을 정확히 기다린다 (생성 요청이 끝나기 전에 이동하지 않도록)
  await owner.getByTestId('fields-manager').getByRole('cell', { name: '달성률', exact: true }).waitFor();
  const tasks = (await ctx.owner.ok('GET', `/api/tasks?projectId=${pid}`)).tasks;
  for (const [i, v] of [[0, '80'], [1, '90']]) {
    await owner.goto(`${BASE}/tasks/${tasks[i].id}`);
    await owner.getByTestId('task-title').waitFor();
    await owner.getByTestId('task-title').waitFor();
    await openMoreFields(owner);
    const input = owner.locator('section[aria-label="추가 필드"]').getByLabel('달성률');
    await input.fill(v); await input.blur();
    await owner.waitForTimeout(500);
  }
  await owner.goto(`${BASE}/projects/${pid}`);
  await owner.getByRole('tab', { name: '사용자 지정 필드' }).click();
  await owner.getByTestId('field-summary').getByText('85%').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/39-project-fields.png` });
});
await step('B-14·B-15·B-16·B-17 현장 비교·주간 보고·업무량·공휴일 화면', async () => {
  await owner.goto(BASE + '/insights');
  await owner.getByTestId('site-compare').getByText('다짐 강남점').waitFor();
  await owner.screenshot({ path: `${SHOTS}/45-site-compare.png` });
  await owner.goto(BASE + '/workload');
  await owner.getByTestId('workload').locator('[data-person="이직원"]').waitFor();
  await owner.screenshot({ path: `${SHOTS}/46-workload.png` });
  await owner.goto(BASE + '/reports');
  await owner.getByRole('button', { name: '지난주 보고 지금 만들기' }).click();
  await owner.getByTestId('weekly-report').getByText('주간 보고 ·').waitFor();
  await owner.screenshot({ path: `${SHOTS}/47-weekly-report.png`, fullPage: true });
  await owner.goto(BASE + '/calendar?date=2026-10-01');
  // 달력이 그려진 뒤(단축키 처리기도 붙은 뒤) 조작 — 그리기 전에 키를 누르면 무시되어 시험이 흔들렸음
  await owner.locator('.fc-toolbar-title').waitFor();
  await owner.getByRole('button', { name: '월', exact: true }).click();
  await owner.locator('.fc-event.holiday', { hasText: '한글날' }).first().waitFor();
  await owner.keyboard.press('w');
  await owner.locator('.fc-timeGridWeek-view').waitFor();
  await owner.keyboard.press('m');
  await owner.locator('.fc-dayGridMonth-view').waitFor();
  await owner.screenshot({ path: `${SHOTS}/48-calendar-holidays.png` });
});
await step('모바일 목록 행을 오른쪽으로 밀어 완료 → 되돌리기', async () => {
  const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '밀어서 완료 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  await staff.goto(BASE + '/tasks?mode=list');
  await staff.getByLabel('업무 검색').fill('밀어서');
  const row = staff.locator(`[data-row="${id}"]`);
  await row.waitFor();
  const b = await row.boundingBox();
  const y = b.y + b.height / 2;
  await row.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: b.x + 20, clientY: y }] });
  for (const x of [40, 80, 120, 150]) await row.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: b.x + 20 + x, clientY: y }] });
  await row.dispatchEvent('touchend', { touches: [] });
  await staff.getByText('완료했습니다').waitFor();
  await staff.waitForTimeout(500);
  assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task.status, 'done');
});

// 일정 × 업무 통합 (TASK_SCHEDULE_INTEGRATION)
await step('DB 미설정이면 로그인 화면에 원인 안내', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR' });
  const p = await c.newPage();
  await p.route('**/api/health', (r) => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, db: 'error', error: 'DATABASE_URL 이 설정되지 않았습니다' }) }));
  await p.goto(BASE + '/login');
  await p.getByTestId('server-not-ready').getByText('운영 설정이 아직 끝나지 않았습니다').waitFor();
  await p.screenshot({ path: `${SHOTS}/49-login-not-configured.png` });
  await c.close();
});
await step('S-2 회의 메모 2줄 → 후속 업무 2건(담당=참석자) 자동 연결 + 미리보기 시간 표기·참석자·연결 업무', async () => {
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.org_unit_id === ctx.siteA).id;
  const d = addDays(today, 1);
  const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '강남점 운영 회의', start: `${d}T14:00:00+09:00`, end: `${d}T15:00:00+09:00`, attendeeIds: [ctx.staffA.id, ctx.managerA.id], location: '2층 회의실' })).id;
  await owner.goto(`${BASE}/calendar?event=${ev}`);
  const dlg = owner.getByRole('dialog', { name: '일정 수정' });
  await dlg.getByTestId('meeting-notes').fill('- 런닝머신 벨트 교체 업체 섭외 (이직원)\n- 다음 달 GX 시간표 초안 (최매니저)');
  for (const line of ['런닝머신 벨트 교체 업체 섭외 (이직원)', '다음 달 GX 시간표 초안 (최매니저)']) {
    await dlg.getByRole('button', { name: `${line} 업무로 만들기` }).click();
    const m = owner.getByRole('dialog', { name: '회의 후속 업무' });
    await m.getByRole('button', { name: '만들기' }).click();
    await owner.getByText('후속 업무를 만들고 연결했습니다').first().waitFor();
    await m.waitFor({ state: 'detached' });
  }
  await dlg.getByTestId('note-lines').getByText('업무로 만듦').nth(1).waitFor();
  await owner.screenshot({ path: `${SHOTS}/50-meeting-notes-followups.png`, fullPage: true });
  const linked = (await ctx.owner.ok('GET', `/api/events/${ev}/tasks`)).tasks;
  assert.equal(linked.filter((t) => t.link_role === 'followup').length, 2);
  assert.equal(linked.find((t) => t.title.startsWith('런닝머신')).assignee_id, ctx.staffA.id, '메모의 이름으로 담당자 자동 선택');
  assert.equal(linked.find((t) => t.title.startsWith('다음 달 GX')).assignee_id, ctx.managerA.id);
  await owner.keyboard.press('Escape');
  // 미리보기: 시간 표기 통일, 참석자, 연결 업무
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await owner.getByTestId('calendar').waitFor();
  await owner.locator('.fc-timegrid-event', { hasText: '강남점 운영 회의' }).first().click();
  const pv = owner.getByTestId('event-preview');
  await pv.getByTestId('preview-time').getByText(/오후 2:00~3:00/).waitFor();
  await pv.getByText('이직원, 최매니저').waitFor();
  await pv.getByText('연결 업무 2건').waitFor();
  await owner.screenshot({ path: `${SHOTS}/51-meeting-preview.png` });
});
await step('S-3 업무 시간 배정: 담당자 조직 캘린더 + 담당자 참석, 블록 미리보기에서 업무 완료', async () => {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '소화기 위치 표지 교체', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 2), approvalRequired: false, estimateMinutes: 120 })).id;
  await owner.goto(`${BASE}/tasks/${t}`);
  await owner.getByTestId('linked-events').getByRole('button', { name: '실행 시간 배정' }).click();
  const dlg = owner.getByRole('dialog', { name: '업무 실행 시간 배정' });
  await dlg.getByText('이직원님을 참석자로 넣어').waitFor();
  assert.equal(await dlg.getByLabel('캘린더').locator('option:checked').textContent(), '다짐 강남점 일정');
  await dlg.getByTestId('block-availability').waitFor();
  await dlg.getByRole('button', { name: '배정' }).click();
  await owner.getByText('이직원님의 실행 시간을 배정했습니다').waitFor();
  await owner.getByTestId('linked-events').getByText('소화기 위치 표지 교체').waitFor();
  await owner.getByTestId('estimate-progress').getByText('2시간 배정').waitFor();
  const blk = (await ctx.staffA.client.ok('GET', `/api/tasks/${t}/events`)).events[0];
  assert.equal(blk.role, 'block');
  // 직원 캘린더에서 블록 미리보기 → 완료
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await login(c, ctx.staffA.email, ctx.staffA.password);
  await p.goto(`${BASE}/calendar?date=${addDays(today, 2)}`);
  await p.getByTestId('calendar').waitFor();
  await p.locator('.fc-timegrid-event.task-block', { hasText: '소화기 위치 표지 교체' }).first().click();
  const pv = p.getByTestId('event-preview');
  await pv.getByTestId('block-task').getByText('소화기 위치 표지 교체').waitFor();
  assert.equal(await pv.getByText('[업무]').count(), 0, '제목 접두어 중복 없음');
  await p.screenshot({ path: `${SHOTS}/52-block-preview.png` });
  await pv.getByRole('button', { name: '완료' }).click();
  await p.getByText('업무를 완료했습니다').waitFor();
  assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.status, 'done');
  await c.close();
});
await step('S-5 오늘·이번 주: 업무를 시간표로 끌어 놓아 실행 시간 배정 · S-7 업무량 히트맵', async () => {
  const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '회원 상담 기록 정리', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 5), estimateMinutes: 90 })).id;
  await staff.setViewportSize({ width: 1366, height: 900 });
  await staff.goto(`${BASE}/calendar`);
  if (!(await staff.getByTestId('unscheduled').count())) await staff.getByRole('button', { name: '미배정 업무' }).click();
  const card = staff.locator(`[data-plan-task="${t}"]`);
  await card.waitFor();
  await staff.locator('.fc-timegrid-slot').first().waitFor();
  const slot = staff.locator('td.fc-timegrid-slot-lane[data-time="15:00:00"]').first();
  const b = await card.boundingBox(); const sb = await slot.boundingBox();
  const col = await staff.locator('.fc-timegrid-col.fc-day-today').boundingBox().catch(() => null) ?? await staff.locator('.fc-timegrid-col').nth(2).boundingBox();
  await staff.mouse.move(b.x + 30, b.y + 15); await staff.mouse.down();
  await staff.mouse.move(b.x + 60, b.y + 30, { steps: 5 });
  await staff.mouse.move(col.x + col.width / 2, sb.y + 5, { steps: 20 });
  await staff.mouse.up();
  await staff.getByText('업무 시간을 잡았습니다').waitFor();
  const evs = (await ctx.staffA.client.ok('GET', `/api/tasks/${t}/events`)).events;
  assert.equal(evs.length, 1); assert.equal(evs[0].kind, 'task_block');
  assert.equal(Math.round((new Date(evs[0].end_at) - new Date(evs[0].start_at)) / 60000), 90, '남은 예상 시간만큼');
  await staff.screenshot({ path: `${SHOTS}/53-plan-week.png` });
  await staff.setViewportSize(devices['iPhone 13'].viewport);
  await owner.goto(BASE + '/workload');
  await owner.getByTestId('workload-heatmap').waitFor();
  await owner.screenshot({ path: `${SHOTS}/54-workload-heatmap.png`, fullPage: true });
});

// 본사 운영 도구 단순화 (HQ_SIMPLIFY)
await step('W-1 이름 워크인·부제 다짐 · 하이링크, 사이드바(홈·업무·프로젝트·캘린더·알림 + 관리), 계정 메뉴는 설정·단축키·로그아웃', async () => {
  await owner.goto(BASE + '/');
  assert.match(await owner.title(), /^워크인/);
  const side = owner.getByRole('complementary', { name: '사이드바' });
  await side.getByText('워크인', { exact: true }).waitFor();
  await side.getByText('다짐 · 하이링크', { exact: true }).waitFor();
  assert.equal(await owner.getByText('BODY LAB').count(), 0, 'BODY LAB 문구 없음');
  const nav = owner.getByRole('navigation', { name: '주 메뉴' });
  const labels = (await nav.getByRole('link').allTextContents()).map((x) => x.replace(/\d+$/, '').trim()).filter(Boolean);
  for (const l of ['홈', '업무', '프로젝트', '캘린더', '알림', '주간 보고', '매출', '사용자 관리', '운영 상태']) assert.ok(labels.includes(l), `${l} 있음 (${labels})`);
  for (const l of ['내 업무', '현장 신고 QR', '자동화', '현장 비교', '업무량', '결재선', '전체 업무', '오늘·이번 주', '템플릿']) assert.ok(!labels.includes(l), `${l} 숨김`);
  await owner.getByRole('button', { name: '내 계정 메뉴' }).click();
  const items = (await owner.getByRole('menuitem').allTextContents()).map((x) => x.replace(/\?$/, '').trim());
  assert.deepEqual(items, ['설정·알림', '단축키', '로그아웃']);
  await owner.keyboard.press('Escape');
  await owner.screenshot({ path: `${SHOTS}/55-hq-sidebar.png` });
});
await step('W-2 업무 화면: 기본 전체·담당자별 묶음, "+ 업무 추가" → 제목 Enter 연속 추가·Esc 종료, 묶음 끝 줄은 그 담당자로, 줄에서 마감·담당 칩', async () => {
  await owner.goto(BASE + '/tasks');
  const groups = owner.getByTestId('task-groups');
  await groups.waitFor();
  assert.equal(await groups.getAttribute('data-group-by'), 'assignee');
  await groups.locator(`[data-group="${ctx.staffA.id}"]`).waitFor(); // 다른 사람 업무도 기본으로 보임
  assert.equal(await groups.locator('section').first().getAttribute('data-group'), ctx.ownerId, '내 묶음이 맨 위');
  await owner.getByTestId('add-task-top').click();
  const top = owner.getByLabel('업무 추가 제목').first();
  await top.waitFor();
  assert.ok(await top.evaluate((el) => el === document.activeElement), '빈 줄에 커서');
  await owner.keyboard.type('주간 매출 보고 정리');
  const t0 = Date.now();
  await owner.keyboard.press('Enter');
  await groups.locator(`[data-group="${ctx.ownerId}"]`).getByText('주간 매출 보고 정리').waitFor();
  assert.ok(Date.now() - t0 < 5000, '빠르게 생성');
  assert.ok(await top.evaluate((el) => el === document.activeElement && !el.value), '저장 후 다음 빈 줄');
  await owner.keyboard.type('본부장 회의 자료');
  await owner.keyboard.press('Enter');
  await groups.getByText('본부장 회의 자료').waitFor();
  await owner.keyboard.press('Escape');
  await owner.waitForTimeout(200);
  assert.equal(await groups.locator('[data-group]').first().getByPlaceholder(/Esc 로 끝내기/).count(), 0, 'Esc 로 맨 위 줄 닫힘');
  const [t] = await sql`select id, assignee_id, approval_required from tasks where title = '주간 매출 보고 정리'`;
  assert.equal(t.assignee_id, ctx.ownerId); assert.equal(t.approval_required, false);
  // 묶음 끝 "업무 추가" 줄 → 그 묶음의 담당자
  const endRow = groups.locator(`[data-group="${ctx.staffA.id}"]`).getByLabel('업무 추가 제목');
  await endRow.fill('강남점 전단 배포');
  await endRow.press('Enter');
  await groups.locator(`[data-group="${ctx.staffA.id}"]`).getByText('강남점 전단 배포').waitFor();
  const [t2] = await sql`select assignee_id from tasks where title = '강남점 전단 배포'`;
  assert.equal(t2.assignee_id, ctx.staffA.id);
  // 줄에서 마감·담당 칩
  const row = owner.locator(`[data-row="${t.id}"]`);
  await row.getByTestId('due-picker').click();
  await owner.getByRole('button', { name: /^내일/ }).click();
  await row.getByTestId('assignee-picker').click();
  await owner.getByRole('dialog').getByRole('button', { name: /^최매니저/ }).click();
  await owner.waitForTimeout(800);
  const [u] = await sql`select assignee_id, to_char(due_date, 'YYYY-MM-DD') as due from tasks where id = ${t.id}`;
  assert.equal(u.assignee_id, ctx.managerA.id); assert.equal(u.due, addDays(today, 1));
  // 사람 칩·묶기 전환
  await owner.getByTestId('group-by').selectOption('due');
  await owner.locator('[data-group-by="due"]').waitFor();
  await owner.getByTestId('group-by').selectOption('assignee');
  await owner.screenshot({ path: `${SHOTS}/56-inline-add.png` });
});
await step('W-3 홈: 오늘 할 일(내 것/전체) · 이번 주 일정 · 이달의 일정(미니 달력) · 담당자별 현황 · 기한 지남/검토 대기 · 최근 활동', async () => {
  await owner.goto(BASE + '/');
  for (const id of ['home-today', 'home-week', 'home-month-card', 'home-people', 'home-alerts', 'home-activity']) await owner.getByTestId(id).waitFor();
  await owner.getByTestId('home-today').getByRole('button', { name: '전체' }).click();
  await owner.getByTestId('home-activity').getByText('강남점 전단 배포').waitFor();
  const d = addDays(today, 1);
  if (d.slice(0, 7) === today.slice(0, 7)) {
    await owner.getByTestId('home-month').locator('button[aria-pressed]', { hasText: new RegExp(`^${Number(d.slice(8))}$`) }).click();
    await owner.waitForTimeout(200);
    assert.equal(await owner.getByText('다가오는 일정').count(), 0, '날짜를 누르면 그날 목록');
  }
  await owner.screenshot({ path: `${SHOTS}/59-home-dashboard.png`, fullPage: true });
});
await step('W-4 매출: 본사가 월 실적 입력·CSV 가져오기(오류 줄 안내) → 차트·표, 직원은 404', async () => {
  await owner.goto(BASE + '/revenue');
  const month = today.slice(0, 7);
  const box = owner.getByTestId('revenue-input');
  await box.getByLabel('입력할 월').fill(month);
  await box.getByLabel('다짐 강남점 매출(원)').fill('48000000');
  await box.getByLabel('다짐 강남점 지출(원)').fill('30000000');
  await box.getByLabel('다짐 강남점 목표(원)').fill('50000000');
  await box.getByRole('button', { name: '다짐 강남점 저장' }).click();
  await owner.getByText('저장했습니다').waitFor();
  await box.locator('[data-unit="다짐 강남점"]').getByText(/근거: 직접 입력/).waitFor();
  const bad = '현장,월,매출\n없는 현장,' + month + ',100\n';
  await box.getByLabel('CSV 파일 선택').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from(bad) });
  await owner.getByTestId('csv-preview').getByText('2번째 줄').waitFor();
  await owner.getByTestId('csv-preview').getByRole('button', { name: '취소' }).click();
  const good = '현장,월,매출,지출\n하이링크 판교 위탁현장,' + month + ',12000000,9000000\n';
  await box.getByLabel('CSV 파일 선택').setInputFiles({ name: '실적.csv', mimeType: 'text/csv', buffer: Buffer.from(good) });
  await owner.getByTestId('csv-preview').getByRole('button', { name: '가져오기' }).click();
  await owner.getByText('1건을 가져왔습니다').waitFor();
  await owner.getByText('표로 보기').click();
  await owner.getByTestId('revenue-table').getByText('60,000,000원').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/58-revenue.png`, fullPage: true });
  assert.equal((await ctx.staffA.client.get('/api/revenue')).status, 404);
});
await step('W-5 매출 AI 분석(AI 제안 표시·근거 숫자로 이동) · GPT 연동 토큰 한 번만 표시', async () => {
  await owner.goto(BASE + '/revenue');
  const ai = owner.getByTestId('revenue-ai');
  await ai.getByRole('button', { name: 'AI 분석' }).click();
  await ai.getByText('AI 제안', { exact: true }).waitFor();
  // 첫 이상치(근거 숫자) 버튼 → 그 현장이 선택됨 (어느 현장이 먼저 오는지는 DB 정렬에 따라 다를 수 있음)
  const first = ai.getByRole('button', { name: /· \d+월 (매출|지출|회원 수)/ }).first();
  const site = (await first.textContent()).split(' · ')[0];
  await first.click();
  const want = site === '다짐 강남점' ? ctx.siteA : ctx.siteB;
  await owner.getByLabel('현장').evaluate((el) => el.value).then((v) => assert.equal(v, want, `근거 현장(${site})으로 이동`));
  const tk = owner.getByTestId('revenue-tokens');
  await tk.getByRole('button', { name: '토큰 만들기' }).click();
  await owner.getByTestId('fresh-token').getByText(/^wk_/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/60-revenue-ai.png`, fullPage: true });
  await owner.reload();
  await owner.getByTestId('revenue-tokens').getByText('GPT 자료 운영체계').waitFor();
  assert.equal(await owner.getByTestId('fresh-token').count(), 0, '새로 고침하면 원문 다시 안 보임');
});
await step('W-0 휴대폰 360·375·390·430px 모든 주요 화면 좌우 넘침 없음 (안전장치 끄고 측정)', async () => {
  const { checkWidths } = await import('./widths.mjs');
  const bad = await checkWidths(browser, await desk.storageState());
  assert.deepEqual(bad, []);
});
await step('HQ-3 캘린더: 빈 칸 클릭 → 빠른 입력(업무 탭) 저장 → 업무가 체크로 표시 → 체크로 완료, 미니 달력·업무 캘린더', async () => {
  const d = addDays(today, 2);
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await owner.locator('.fc-toolbar-title').waitFor();
  await owner.getByTestId('mini-month').waitFor();
  await owner.getByTestId('calendar-list').getByLabel('업무 캘린더 표시').waitFor();
  const col = await owner.locator(`.fc-timegrid-col[data-date="${d}"]`).boundingBox();
  const slot = await owner.locator('td.fc-timegrid-slot-lane[data-time="11:00:00"]').first().boundingBox();
  await owner.mouse.click(col.x + col.width / 2, slot.y + 4);
  const q = owner.getByTestId('quick-create');
  await q.getByRole('tab', { name: '업무' }).click();
  await q.getByLabel('빠른 입력 제목').fill('계약서 최종본 확인');
  await q.getByRole('button', { name: '저장' }).click();
  await owner.getByText('업무를 만들었습니다').waitFor();
  const item = owner.locator('.fc-event.task-item', { hasText: '계약서 최종본 확인' }).first();
  await item.waitFor();
  const [t] = await sql`select id, to_char(due_date, 'YYYY-MM-DD') as due, to_char(due_time, 'HH24:MI') as tm from tasks where title = '계약서 최종본 확인'`;
  assert.equal(t.due, d); assert.equal(t.tm, '11:00');
  await owner.screenshot({ path: `${SHOTS}/57-calendar-google.png` });
  await item.getByRole('button', { name: '계약서 최종본 확인 완료' }).click();
  await owner.getByText('완료했습니다').waitFor();
  await owner.waitForTimeout(500);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t.id}`)).task.status, 'done');
  // 일정 탭 빠른 입력
  const slot2 = await owner.locator('td.fc-timegrid-slot-lane[data-time="15:00:00"]').first().boundingBox();
  await owner.mouse.click(col.x + col.width / 2, slot2.y + 4);
  await owner.getByTestId('quick-create').getByLabel('빠른 입력 제목').fill('투자사 미팅');
  await owner.getByTestId('quick-create').getByRole('button', { name: '저장' }).click();
  await owner.getByText('일정을 저장했습니다').waitFor();
  await owner.locator('.fc-timegrid-event', { hasText: '투자사 미팅' }).first().click();
  const pv = owner.getByTestId('event-preview');
  await pv.getByRole('button', { name: '일정 삭제' }).waitFor();
  await pv.getByRole('button', { name: '미리보기 닫기' }).click();
  // "캘린더에 표시" 끄면 사라짐
  const id2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '캘린더 숨김 시험', dueDate: d, approvalRequired: false })).id;
  await ctx.owner.ok('PATCH', `/api/tasks/${id2}`, { showOnCalendar: false });
  await owner.reload();
  await owner.locator('.fc-toolbar-title').waitFor();
  await owner.waitForTimeout(800);
  assert.equal(await owner.locator('.fc-event.task-item', { hasText: '캘린더 숨김 시험' }).count(), 0);
});

await step('화면 캡처: 대시보드·목록·보드·업무 상세(1440px)', async () => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await login(c, 'ceo@dagym.test', 'owner-pass-1234');
  await p.getByRole('heading', { name: '전체 현황' }).waitFor();
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SHOTS}/40-dashboard-1440.png`, fullPage: true });
  await p.goto(BASE + '/tasks?mode=list');
  await p.getByTestId('task-list').first().waitFor();
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
