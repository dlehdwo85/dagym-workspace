// 실제 브라우저(Chromium) 사용자 시나리오 검증. 화면 증거를 docs/screens/ 에 저장한다.
// 실행: node tests/e2e/run.mjs   (사전: npm run build, PostgreSQL 실행)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { bootstrap, resetDb, startServer, BASE, FAKE, Client, addDays, seoulToday, ensureTls, testDb } from '../helpers.mjs';
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

/** 일정 등록 창의 날짜 버튼 → 작은 달력에서 날짜 고르기 (달 이동 포함) */
async function pickDate(page, scope, label, d) {
  await scope.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  const cal = page.getByRole('dialog', { name: `${label} 달력` });
  const t = new Date(d + 'T00:00:00Z');
  const name = `${t.getUTCMonth() + 1}월 ${t.getUTCDate()}일 (${'일월화수목금토'[t.getUTCDay()]})`;
  for (let i = 0; i < 24 && !(await cal.getByRole('button', { name, exact: true }).count()); i++) {
    const head = await cal.locator('span.font-semibold').first().textContent();
    const [y, m] = head.match(/\d+/g).map(Number);
    await cal.getByRole('button', { name: y * 12 + m < t.getUTCFullYear() * 12 + t.getUTCMonth() + 1 ? '다음 달' : '이전 달' }).click();
  }
  await cal.getByRole('button', { name, exact: true }).click();
}

/** 업무 상세의 "필드 더보기" 펼치기 (이미 펼쳐져 있으면 그대로) */
async function openMoreFields(scope) {
  if (!(await scope.getByTestId('more-fields').count())) return; // R-15 4번: "필드 더보기"를 없애 모든 항목이 기본으로 보임
  const btn = scope.getByTestId('more-fields').first();
  await btn.waitFor();
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
}

async function login(context, email, password) {
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
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
  await dlg.getByLabel('담당자', { exact: true }).selectOption({ label: '이직원' });
  await dlg.getByLabel('마감일').fill(addDays(today, 3));
  assert.equal(await dlg.getByLabel('소속 (현장·부서)').count(), 0, '등록 창은 제목·담당자·마감일·프로젝트 4칸');
  await dlg.getByRole('button', { name: '저장' }).click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  taskId = owner.url().split('/').pop();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${taskId}`)).task.approval_required, false, '관리자 최종 확인 기본 꺼짐');
  // 이 시나리오(현장 관리자 최종 확인)는 확인 필요·현장 소속으로 바꿔 진행
  await ctx.owner.ok('PATCH', `/api/tasks/${taskId}`, { approvalRequired: true, orgUnitId: ctx.siteA, requestedById: ctx.managerA.id }); // V12-11: 검토 승인 = 지시자
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
  // V14 23번: 휴대폰은 @ 드롭다운 없이 입력 중 @ 자동완성으로만
  await staff.getByTestId('comment-input').fill('점검 완료 사진 올립니다 @');
  assert.equal(await staff.getByLabel('멘션할 사람').count(), 0, '휴대폰 댓글줄에 @ 드롭다운 없음');
  const opts = await staff.getByTestId('mention-suggest').locator('button').allTextContents();
  assert.ok(!opts.some((o) => o.includes('박직원')), '다른 현장 직원은 멘션 목록에 없음');
  await staff.getByTestId('comment-input').fill('점검 완료 사진 올립니다 @최');
  await staff.getByTestId('mention-suggest').getByRole('option', { name: /최매니저/ }).click();
  const typed = await staff.getByTestId('comment-input').inputValue();
  assert.ok(typed.endsWith('@최매니저 ') && !typed.includes(']('), `입력창에는 이름만 보여야 함: ${typed}`);
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
  // V14 28번: 같은 이름의 "[검토] …" 업무도 생기므로 완료 확인 버튼이 있는 줄을 고른다
  const row = m.locator('li', { hasText: '강남점 소방 점검 대응' }).filter({ has: m.getByRole('button', { name: '완료 확인' }) }).first();
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
  t3 = (await ctx.owner.ok('POST', '/api/tasks', { title: '보기 전환 시험 업무', orgUnitId: ctx.siteA, assigneeId: ctx.ownerId, dueDate: addDays(today, 2) })).id; // V12: 보드로 상태를 바꾸는 사람 = 담당자
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
  await owner.getByTestId('timeline').locator(`[data-task-id="${t3}"] [data-range="${nd} ~ ${nd}"]`).waitFor();
  // V12 12번: 마감만 있는 업무는 배정일부터 옅은 기간 + 좁은 막대는 제목을 바깥에 전체로, 오늘 세로선·범례
  const tlRow = owner.getByTestId('timeline').locator(`div[data-task-id="${t3}"]`);
  await tlRow.locator('[data-outside-title]').getByText('보기 전환 시험 업무').waitFor();
  assert.ok(await tlRow.locator('[data-implied]').count() >= 1, '배정→마감 옅은 기간');
  assert.ok(await owner.getByTestId('timeline').locator('[data-today-line]').count() > 0, '오늘 세로선');
  await owner.getByTestId('timeline-legend').getByText('검토 요청').waitFor();
  await owner.getByRole('tab', { name: '6주' }).click();
  await owner.getByRole('tab', { name: '2주' }).click();
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
  await owner.getByTestId('palette-results').getByText('강남점 소방 점검 대응', { exact: true }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/33-command-palette.png` });
  // V14 28번: "[검토] 강남점 소방 점검 대응"도 나오므로 원 업무까지 ↓ 로 옮긴 뒤 Enter
  const names = await owner.getByTestId('palette-results').locator('button').allTextContents();
  const idx = names.findIndex((x) => x.startsWith('강남점 소방 점검 대응'));
  for (let k = 0; k < idx; k++) await owner.keyboard.press('ArrowDown');
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
  await pickDate(owner, dlg, '시작일', d); // Google 형 날짜 달력 팝업
  await dlg.getByLabel('시작 시각').selectOption('10:00'); // 15분 목록
  assert.match(await dlg.getByLabel('종료 시각').locator('option:checked').textContent(), /오전 11:00 \(1시간\)/, '시작을 바꾸면 길이(1시간) 유지');
  await dlg.getByLabel('종료 시각').selectOption('11:00');
  const dow = '일월화수목금토'[new Date(d + 'T00:00:00Z').getUTCDay()];
  await dlg.getByLabel('반복 규칙').selectOption({ label: `매주 ${dow}요일` });
  await dlg.getByLabel('반복 종료').selectOption('count');
  await dlg.getByLabel('반복 횟수').fill('6');
  await dlg.getByText('각자 기본 알림 설정 따르기').click();
  await dlg.getByLabel('알림 추가').selectOption({ label: '1일 전' });
  await dlg.getByTestId('editor-close').click();
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
  // V13 11번: 휴대폰은 "세부 정보" 요약 한 줄 → 눌러서 펼침
  await staff.getByTestId('details-toggle').getByText(/👤/).waitFor();
  await staff.getByTestId('details-toggle').click();
  await staff.getByTestId('detail-due').getByTestId('due-picker').click(); // 마감일 칩 → 빠른 선택·달력
  await staff.getByLabel('마감일 날짜 선택').fill(nd);
  await staff.locator(`[data-testid="detail-due"][data-value="${nd}"]`).waitFor();
  await owner.goto(`${BASE}/tasks/${t3}`);
  assert.equal(await owner.getByTestId('detail-due').getAttribute('data-value'), nd);
  assert.equal(await owner.getByTestId('status-chip').count(), 1, '상태 표시는 칩 하나');
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
  await staff.getByTestId('fab').click(); // + → 업무 · 일정 메뉴
  await staff.getByRole('menuitem', { name: '업무 등록' }).click();
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
  await p.getByLabel('이메일', { exact: true }).fill('ceo@dagym.test');
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
  await owner.getByRole('button', { name: '되돌리기', exact: true }).click();
  await owner.waitForTimeout(800);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'todo');
  await owner.getByTestId('filter-toggle').click();
  await owner.getByTestId('filter-panel').getByLabel('상태').selectOption('todo');
  await owner.getByTestId('filter-chip').filter({ hasText: '상태: 진행 전' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/35-task-list-filters.png` });
  await owner.getByRole('button', { name: '상태: 진행 전 필터 해제' }).click();
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
  // V14 27번: 상세 화면에서 결재선 칸은 뺌(데이터는 유지) — 결재선 지정은 API/업무 생성 때
  const line = (await ctx.owner.ok('GET', '/api/approval-lines')).lines.find((l) => l.name === '계약 결재');
  await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { approvalLineId: line.id });
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
await step('모바일 밀기: 기본 꺼짐·짧은/세로 밀기 무시, 켜면 45% 이상 밀어 완료 → "방금 완료한 업무"에서 되돌리기', async () => {
  const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '밀어서 완료 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  await staff.evaluate(() => localStorage.setItem('wos_task_group', 'assignee')); // V14 34번: 휴대폰 기본 마감별 — 뜬 뒤 묶기가 바뀌지 않게 고정
  await staff.goto(BASE + '/tasks?mode=list');
  await staff.getByLabel('업무 검색').fill('밀어서');
  const row = staff.locator(`[data-row="${id}"]`);
  await row.waitFor();
  const drag = async (steps, dy = 0) => {
    const b = await row.boundingBox(); const y = b.y + b.height / 2;
    await row.dispatchEvent('touchstart', { touches: [{ identifier: 1, clientX: b.x + 10, clientY: y }] });
    for (const x of steps) await row.dispatchEvent('touchmove', { touches: [{ identifier: 1, clientX: b.x + 10 + x, clientY: y + dy }] });
    await row.dispatchEvent('touchend', { touches: [] });
    await staff.waitForTimeout(400);
  };
  const status = async () => (await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task.status;
  await drag([60, 120, 200, 260]);
  assert.notEqual(await status(), 'done', '기본 꺼짐: 길게 밀어도 그대로');
  await staff.evaluate(() => localStorage.setItem('wos_swipe_done', '1'));
  await staff.reload(); await staff.getByLabel('업무 검색').fill('밀어서'); await row.waitFor();
  await drag([15, 30]);
  assert.notEqual(await status(), 'done', '가로 30px 는 무시');
  await drag([20, 40, 60], 150);
  assert.notEqual(await status(), 'done', '세로 스크롤 중엔 무시');
  const w = (await row.boundingBox()).width;
  await drag([w * 0.2, w * 0.4, w * 0.5]);
  await staff.getByText('완료했습니다').waitFor();
  assert.equal(await status(), 'done');
  const bar = staff.getByTestId('just-done');
  await bar.getByText('방금 완료한 업무 1건').waitFor();
  await bar.getByRole('button', { name: /방금 완료한 업무/ }).click();
  await bar.getByRole('button', { name: '되돌리기', exact: true }).click();
  await staff.waitForTimeout(600);
  assert.notEqual(await status(), 'done', '되돌리기');
  await staff.evaluate(() => localStorage.removeItem('wos_swipe_done'));
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
  assert.equal(await owner.getByTestId('linked-events').count(), 0, 'V14 27번: 연결 일정이 없으면 줄 없음');
  await owner.getByRole('button', { name: '더보기' }).click();
  await owner.getByRole('menuitem', { name: '실행 시간 배정' }).click();
  const dlg = owner.getByRole('dialog', { name: '업무 실행 시간 배정' });
  await dlg.getByText('이직원님을 참석자로 넣어').waitFor();
  assert.equal(await dlg.getByLabel('캘린더').locator('option:checked').textContent(), '다짐 강남점 일정');
  await dlg.getByTestId('block-availability').waitFor();
  await dlg.getByRole('button', { name: '배정' }).click();
  await owner.getByText('이직원님의 실행 시간을 배정했습니다').waitFor();
  await owner.getByTestId('linked-events').getByText('소화기 위치 표지 교체').waitFor();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t}`)).task.scheduled_minutes, 120, '2시간 배정');
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
  assert.deepEqual(items, ['설정·알림', '도움말·문의', '단축키', '로그아웃']);
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
await step('W-5 매출 AI 분석(내장 AI, AI 제안 표시·근거 숫자로 이동) · V13 GPT 카드 없음 · 자료로 입력(AI)', async () => {
  await owner.goto(BASE + '/revenue');
  const ai = owner.getByTestId('revenue-ai');
  await ai.getByRole('button', { name: 'AI 분석' }).click();
  await ai.getByText('AI 제안', { exact: true }).waitFor();
  // 첫 이상치(근거 숫자) 버튼 → 그 현장이 선택됨 (어느 현장이 먼저 오는지는 DB 정렬에 따라 다를 수 있음)
  const first = ai.getByRole('button', { name: /· \d+월 (매출|지출|회원 수)/ }).first();
  const site = (await first.textContent()).split(' · ')[0];
  await first.click();
  const want = site === '다짐 강남점' ? ctx.siteA : ctx.siteB;
  await owner.getByLabel('현장', { exact: true }).evaluate((el) => el.value).then((v) => assert.equal(v, want, `근거 현장(${site})으로 이동`));
  // V13: GPT 토큰 카드 없음 → 자료로 입력(AI): 정산서 올리기 → 미리보기 표 → 고쳐서 반영
  assert.equal(await owner.getByTestId('revenue-tokens').count(), 0, 'GPT 연동 카드 제거');
  assert.equal(await owner.getByText('GPT 연동').count(), 0);
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [
    { content: [{ type: 'text', text: JSON.stringify({ rows: [{ site: '하이링크 판교 위탁현장', month, item: '매출', amount: 12300000 }], notes: '사진이 흐려 지출은 못 읽었습니다' }) }], stop_reason: 'end_turn' }] }) });
  const box = owner.getByTestId('revenue-ai-input');
  await box.getByTestId('revenue-ai-file').setInputFiles([{ name: '판교 정산.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }]);
  const pv = owner.getByTestId('revenue-ai-preview');
  await pv.getByText('AI 메모: 사진이 흐려').waitFor();
  await pv.getByLabel('1번째 금액').fill('12400000');
  await owner.screenshot({ path: `${SHOTS}/60-revenue-ai.png`, fullPage: true });
  await pv.getByTestId('revenue-ai-apply').click();
  await owner.getByText('1건을 반영했습니다').waitFor();
  const [row] = await sql`select revenue::float8 as revenue, source, source_file_ids from revenue_entries where org_unit_id = ${ctx.siteB} and month = ${month + '-01'}`;
  assert.equal(row.revenue, 12400000, '사람이 고친 값으로 반영'); assert.equal(row.source, 'ai'); assert.equal(row.source_file_ids.length, 1);
});
await step('V13 메뉴 권한: 대표만 "메뉴 권한" 탭 → 현장 관리자에게 매출 보기 켜기 → 그 사람 메뉴에 매출(입력 칸 없음) → 끄면 사라짐', async () => {
  await owner.goto(BASE + '/admin/users');
  await owner.getByTestId('tab-menus').click();
  const mp = owner.getByTestId('menu-perms');
  // V14 17번: 단계마다 독립 스위치
  await mp.getByRole('switch', { name: '매출 현장 관리자 조회' }).click();
  await owner.getByText('바꿨습니다').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/62-menu-perms.png`, fullPage: true });
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const m = await login(c, ctx.managerA.email, ctx.managerA.password);
  await m.goto(BASE + '/revenue');
  await m.getByTestId('revenue-view-only').waitFor();
  assert.equal(await m.getByTestId('revenue-input').count(), 0, '보기 권한은 입력 칸 없음');
  await m.goto(BASE + '/admin/users');
  assert.equal(await m.getByTestId('tab-menus').count(), 0, '대표 외에는 권한 탭 없음');
  await mp.getByRole('switch', { name: '매출 현장 관리자 조회' }).click();
  await owner.getByText('바꿨습니다').first().waitFor();
  // 자료실 행 펼침 → 내부·기밀 열람 행 + 폴더별 권한·등급
  await mp.getByTestId('perm-library-toggle').click();
  await mp.locator('[data-menu="confidential"]').waitFor();
  assert.equal(await mp.getByRole('switch', { name: '기밀 자료 열람 현장 관리자 조회' }).getAttribute('aria-checked'), 'false', '기밀 기본은 대표만');
  await owner.waitForTimeout(500);
  assert.equal((await ctx.managerA.client.get('/api/revenue')).status, 404);
  await c.close();
});
await step('V3 업무 0건인 본사 사람도 묶음·그 사람에게 추가, 행에서 지시자·우선순위 변경, 손잡이로 끌어 순서 → 새로고침해도 유지, 정렬·내가 지시한 업무', async () => {
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'minsu@dagym.test', name: '김민수', role: 'staff', orgUnitIds: [ctx.hq] });
  const c = new Client('minsu');
  await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'minsu-pass-1234' });
  const minsu = (await c.ok('GET', '/api/auth/me')).user.id;
  for (const n of ['순서 시험 1', '순서 시험 2']) await ctx.owner.ok('POST', '/api/tasks', { title: n, orgUnitId: ctx.hq, assigneeId: ctx.ownerId });
  await owner.evaluate(() => { localStorage.setItem('wos_task_sort2', 'manual'); localStorage.removeItem('wos_task_group'); }); // 기본은 마감순 — 끌어 놓기 시험은 직접 순서로
  await owner.goto(BASE + '/tasks');
  const groups = owner.getByTestId('task-groups');
  const g = groups.locator(`[data-group="${minsu}"]`);
  await g.getByText('업무 없음').waitFor();
  const add = g.getByPlaceholder('김민수님에게 업무 추가');
  await add.fill('신규 회원 이벤트 기획');
  await add.press('Enter');
  await g.getByText('신규 회원 이벤트 기획').waitFor();
  const [t] = await sql`select id, assignee_id, requested_by from tasks where title = '신규 회원 이벤트 기획'`;
  assert.equal(t.assignee_id, minsu); assert.equal(t.requested_by, ctx.ownerId, '지시자 = 나(만든 사람)');
  // 행에서 지시자·우선순위
  const row = owner.locator(`[data-row="${t.id}"]`);
  await row.getByTestId('requester-picker').click();
  await owner.getByRole('dialog').getByRole('button', { name: /^최매니저/ }).click();
  await row.getByTestId('priority-picker').click();
  await owner.getByRole('dialog').getByRole('button', { name: /긴급/ }).click();
  await owner.waitForTimeout(800);
  const [u] = await sql`select requested_by, priority from tasks where id = ${t.id}`;
  assert.equal(u.requested_by, ctx.managerA.id); assert.equal(u.priority, 'urgent');
  // 손잡이로 끌어 순서 (내 묶음 안: 마지막 행을 맨 위로)
  const mine = groups.locator(`[data-group="${ctx.ownerId}"]`);
  const handles = mine.getByTestId('drag-handle');
  const n = await handles.count();
  assert.ok(n >= 2, '내 묶음에 업무 2건 이상');
  const lastTitle = (await mine.locator('[data-row] a[data-open-task]').nth(n - 1).textContent()).trim();
  const from = await handles.nth(n - 1).boundingBox(), to = await handles.nth(0).boundingBox();
  await owner.mouse.move(from.x + 8, from.y + 8); await owner.mouse.down();
  for (let i = 1; i <= 12; i++) await owner.mouse.move(from.x + 8, from.y + 8 + ((to.y - from.y - 6) * i) / 12);
  await owner.mouse.up();
  await owner.waitForTimeout(1000);
  await owner.reload();
  await mine.locator('[data-row] a[data-open-task]').first().waitFor();
  assert.equal((await mine.locator('[data-row] a[data-open-task]').first().textContent()).trim(), lastTitle, '새로고침 후에도 끌어 놓은 순서');
  await owner.screenshot({ path: `${SHOTS}/61-tasks-v3.png` });
  // 정렬·열 머리·내가 지시한 업무
  await owner.getByTestId('sort-by').selectOption('due');
  assert.equal(await mine.getByTestId('drag-handle').count(), 0, '직접 순서가 아니면 손잡이 없음');
  await owner.getByTestId('list-header').getByRole('button', { name: /우선순위/ }).click();
  assert.equal(await owner.getByTestId('sort-by').inputValue(), 'priority');
  await owner.getByTestId('sort-by').selectOption('manual');
  await owner.getByRole('button', { name: '내가 지시한 업무' }).click();
  await owner.waitForTimeout(600);
  assert.equal(await groups.getByText('신규 회원 이벤트 기획').count(), 0, '지시자를 최매니저로 바꿨으니 빠짐');
});
await step('V3-6 휴대폰: 다른 사람 묶음에서 입력 후 바깥 누르면 자동 추가 → 안내·강조·그 묶음에 표시, 순서 메뉴로 위로, 홈 기한 지남 경고 띠', async () => {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_task_group', 'assignee'); } catch {} }); // V14 34번: 휴대폰 기본은 마감별 — 이 시험은 담당자별 묶음
  const m = await mc.newPage();
  await m.goto(BASE + '/tasks');
  const [minsu] = await sql`select id from users where email = 'minsu@dagym.test'`;
  const g = m.getByTestId('task-groups').locator(`[data-group="${minsu.id}"]`);
  const add = g.getByPlaceholder('김민수님에게 업무 추가');
  await add.fill('두정점 원판 수량 파악');
  await g.getByTestId('inline-save').click(); // 업무 생성은 저장 버튼 (WORKIN_SAVE_AND_SPEED)
  await m.getByText('김민수님에게 추가됨: 두정점 원판 수량 파악').waitFor();
  await g.getByText('두정점 원판 수량 파악').waitFor();
  await g.locator('[data-fresh="1"]').first().waitFor();
  assert.equal(await add.inputValue(), '', '저장 후 입력 비움');
  const [t] = await sql`select assignee_id from tasks where title = '두정점 원판 수량 파악'`;
  assert.equal(t.assignee_id, minsu.id);
  // 순서 메뉴: 김민수 묶음 마지막 업무를 맨 위로
  const titles = async () => (await g.locator('[data-row] a[data-open-task]').allTextContents()).map((x) => x.trim());
  const before = await titles();
  assert.ok(before.length >= 2);
  const last = before.at(-1);
  await g.getByRole('button', { name: `${last} 순서 바꾸기` }).click();
  await m.getByRole('dialog').getByRole('button', { name: '맨 위로' }).click();
  await m.waitForTimeout(800);
  await m.reload();
  await g.locator('[data-row]').first().waitFor();
  assert.equal((await titles())[0], last, '새로고침 후에도 맨 위');
  await m.screenshot({ path: `${SHOTS}/62-mobile-add-other.png` });
  // 홈: 기한 지난 업무 경고 띠
  await m.goto(BASE + '/');
  await m.getByTestId('overdue-banner').getByText(/기한 지난 업무 \d+건/).waitFor();
  await mc.close();
});
await step('심사용 체험 계정: 대표가 사용자 관리에서 버튼 → 초대 링크·안내, 목록에 "심사용" 표시', async () => {
  await owner.goto(BASE + '/admin/users');
  await owner.getByTestId('review-account').click();
  const dlg = owner.getByRole('dialog', { name: '심사용 체험 계정' });
  await dlg.getByLabel(/심사용 이메일/).fill('applereview@workin.test');
  await dlg.getByRole('button', { name: '만들기' }).click();
  await owner.getByTestId('review-msg').getByText(/비밀번호를 직접 정하세요/).waitFor();
  assert.match(await owner.getByTestId('invite-link').inputValue(), /\/invite\//);
  await owner.screenshot({ path: `${SHOTS}/63-review-account.png` });
  await owner.keyboard.press('Escape');
  await owner.getByTestId('users').getByText('심사용').first().waitFor();
});
await step('V4 캘린더: 휴대폰 빈 칸 한 번 탭 → 빠른 등록 시트 저장, 본사 동료 화면에 보임, 비공개는 "바쁨", 내 일정·사람 필터 기억', async () => {
  const d = addDays(today, 3);
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(`${BASE}/calendar?date=${d}`);
  const lane = m.locator('.fc-timegrid-slot-lane[data-time="14:00:00"]').first();
  await lane.waitFor();
  await lane.evaluate((el) => el.scrollIntoView({ block: 'center' })); // 고정 머리줄에 가리지 않게 가운데로
  // 휴대폰 기본 = 주 보기(V5): 그 날짜 열의 14시 칸을 탭
  const colBox = await m.locator(`td.fc-timegrid-col[data-date="${d}"]`).boundingBox();
  const laneBox = await lane.boundingBox();
  await m.touchscreen.tap(colBox.x + colBox.width / 2, laneBox.y + laneBox.height / 2);
  const sheet = m.getByTestId('quick-create');
  await sheet.waitFor();
  await sheet.getByLabel('빠른 입력 제목').fill('V4 탭 등록');
  assert.equal(await sheet.getByLabel('종료 시각').inputValue(), '15:00', '탭 = 1시간 블록');
  await sheet.getByLabel('빠른 입력 제목').press('Enter');
  await m.getByText('일정을 저장했습니다').waitFor();
  await m.screenshot({ path: `${SHOTS}/64-mobile-tap-create.png` });
  await mc.close();
  const [ev] = await sql`select to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s from events where title = 'V4 탭 등록'`;
  assert.equal(ev.s, `${d} 14:00`);
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'V4 비밀 일정', start: `${d}T16:00:00+09:00`, end: `${d}T17:00:00+09:00`, isPrivate: true });
  // 본사 동료(김민수) 화면
  const mctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const mp = await login(mctx, 'minsu@dagym.test', 'minsu-pass-1234');
  await mp.goto(`${BASE}/calendar?date=${d}`);
  await mp.getByTestId('calendar').getByText('V4 탭 등록').first().waitFor();
  await mp.getByTestId('calendar').getByText('바쁨').first().waitFor();
  assert.equal(await mp.getByText('V4 비밀 일정').count(), 0, '비공개 제목 안 보임');
  const filter = mp.getByTestId('people-filter');
  await filter.getByRole('button', { name: '내 일정' }).click();
  await mp.waitForTimeout(300);
  assert.equal(await mp.getByTestId('calendar').getByText('V4 탭 등록').count(), 0, '내 일정만');
  await mp.reload();
  await mp.getByTestId('calendar').waitFor();
  await mp.getByTestId('people-filter').locator('button[aria-pressed="true"]', { hasText: '내 일정' }).waitFor({ timeout: 5000 }); // 필터 기억(화면이 뜬 뒤 복원)
  await mp.getByTestId('people-filter').getByRole('button', { name: '김대표 일정' }).click();
  await mp.getByTestId('calendar').getByText('V4 탭 등록').first().waitFor();
  await mp.screenshot({ path: `${SHOTS}/65-calendar-people.png` });
  await mctx.close();
});
await step('W-0 휴대폰 360·375·390·430px 모든 주요 화면 좌우 넘침 없음 (안전장치 끄고 측정)', async () => {
  const { checkWidths } = await import('./widths.mjs');
  const bad = await checkWidths(browser, await desk.storageState());
  assert.deepEqual(bad, []);
  // 앱(Android edge-to-edge): SystemBars 가 넣는 --safe-area-inset-top 만큼 머리줄 내용이 내려가 상태바와 겹치지 않음
  const mc = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true, storageState: await desk.storageState() });
  const mp = await mc.newPage();
  await mp.goto(BASE + '/');
  await mp.evaluate(() => document.documentElement.style.setProperty('--safe-area-inset-top', '32px'));
  const top = await mp.getByTestId('mobile-header').locator('> div').evaluate((el) => el.getBoundingClientRect().top);
  assert.equal(Math.round(top), 32, '상태바 높이만큼 내려감');
  await mc.close();
});
await step('HQ-3 캘린더: 빈 칸 클릭 → 빠른 입력(업무 탭) 저장 → 업무가 체크로 표시 → 체크로 완료, 미니 달력·업무 캘린더', async () => {
  const d = addDays(today, 2);
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await owner.locator('.fc-toolbar-title').waitFor();
  await owner.getByTestId('mini-month').waitFor();
  await owner.getByTestId('calendar-list').getByLabel('업무 캘린더 표시').waitFor();
  await owner.waitForLoadState('networkidle'); // 일정을 불러온 뒤(이른 시각 일정이 있으면 시간 칸이 늘어남) 위치 측정
  const col = await owner.locator(`.fc-timegrid-col[data-date="${d}"]`).boundingBox();
  const slot = await owner.locator('td.fc-timegrid-slot-lane[data-time="11:00:00"]').first().boundingBox();
  await owner.mouse.click(col.x + col.width / 2, slot.y + 4);
  const q = owner.getByTestId('quick-create');
  assert.equal(await q.getByRole('tab').count(), 0, '탭 없이 일정 양식 하나(V6)');
  await q.getByLabel('빠른 입력 제목').fill('계약서 최종본 확인');
  await q.getByTestId('quick-also-task').check({ force: true }); // 업무에도 추가 스위치 → 담당·지시·우선 칸
  await q.getByTestId('quick-task-fields').getByLabel('업무 우선순위').selectOption('high');
  await q.getByLabel('빠른 입력 제목').press('Enter');
  await owner.getByText(/업무에도 추가했습니다/).first().waitFor();
  const [t] = await sql`select id, priority, to_char(due_date, 'YYYY-MM-DD') as due, to_char(due_time, 'HH24:MI') as tm from tasks where title = '계약서 최종본 확인' and deleted_at is null`;
  assert.equal(t.due, d); assert.equal(t.tm, '11:00'); assert.equal(t.priority, 'high');
  await owner.locator('[data-ev-block]', { hasText: '계약서 최종본 확인' }).first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/57-calendar-google.png` });
  // 업무 마감 칩 체크로 완료 (연결 안 된 업무)
  const lone = (await ctx.owner.ok('POST', '/api/tasks', { title: '체크 완료 시험', assigneeId: ctx.ownerId, dueDate: d, dueTime: '07:00', approvalRequired: false })).id;
  await owner.reload();
  const item = owner.locator('.fc-event.task-item', { hasText: '체크 완료 시험' }).first();
  await item.waitFor();
  // V14 33번: 캘린더의 동그라미는 누를 수 없음 — 눌러도 완료되지 않고 상세만 열린다
  assert.equal(await item.getByRole('button', { name: '체크 완료 시험 완료' }).count(), 0, '캘린더에 완료 버튼 없음');
  await item.click();
  await owner.getByTestId('task-panel').waitFor();
  assert.notEqual((await ctx.owner.ok('GET', `/api/tasks/${lone}`)).task.status, 'done', '누르기만으로 완료되지 않음');
  await owner.getByTestId('task-panel').getByRole('button', { name: '패널 닫기' }).click();
  await owner.getByTestId('task-panel').waitFor({ state: 'detached' });
  // 일정 탭 빠른 입력
  const lane15 = owner.locator('td.fc-timegrid-slot-lane[data-time="15:00:00"]').first();
  await lane15.evaluate((el) => el.scrollIntoView({ block: 'center' })); // 화면 아래 안내(토스트)에 가리지 않게
  const slot2 = await lane15.boundingBox();
  const col2 = await owner.locator(`.fc-timegrid-col[data-date="${d}"]`).boundingBox();
  await owner.mouse.click(col2.x + col2.width / 2, slot2.y + 4);
  await owner.getByTestId('quick-create').getByLabel('빠른 입력 제목').fill('투자사 미팅');
  await owner.getByTestId('quick-create').getByLabel('빠른 입력 제목').press('Enter');
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

await step('저장 버튼: 한 줄 추가는 저장 버튼·Enter 로만 생성(바깥 클릭은 초안 유지), 상세 설명은 입력 후 이동해도 자동 저장', async () => {
  await owner.goto(BASE + '/tasks');
  const row = owner.getByTestId('inline-add').first();
  const inp = row.getByLabel('업무 추가 제목');
  await inp.fill('자동 저장 시험 업무');
  await row.getByTestId('inline-save').waitFor(); // 제목을 쓰면 저장 버튼
  await row.getByTestId('due-picker').click(); // 칩을 누르는 동안은 저장하지 않음
  await owner.waitForTimeout(600);
  assert.equal((await sql`select count(*)::int n from tasks where title = '자동 저장 시험 업무'`)[0].n, 0, '칩 선택 중 저장 안 됨');
  const d = addDays(today, 3);
  await owner.getByLabel('새 업무 마감일 날짜 선택').fill(d);
  await owner.getByLabel('새 업무 마감일 시각').selectOption('15:00'); // V6 10번: 날짜 다음 시각
  await owner.locator('div.fixed.inset-0.z-\\[70\\]').click(); // 선택 창 닫기
  await owner.waitForTimeout(300);
  assert.equal((await sql`select count(*)::int n from tasks where title = '자동 저장 시험 업무'`)[0].n, 0, '날짜 고른 뒤에도 입력칸으로 돌아올 뿐 저장 안 됨');
  await owner.getByRole('heading', { level: 1 }).first().click(); // 바깥 클릭 → 저장하지 않고 초안 유지
  await owner.waitForTimeout(500);
  assert.equal((await sql`select count(*)::int n from tasks where title = '자동 저장 시험 업무'`)[0].n, 0, '바깥 클릭으로는 생성 안 됨');
  assert.equal(await inp.inputValue(), '자동 저장 시험 업무', '초안 유지');
  const t0 = Date.now();
  await row.getByTestId('inline-save').click();
  assert.equal(await inp.inputValue(), '', '누르는 즉시 입력칸 비움');
  await owner.getByText('나에게 추가됨: 자동 저장 시험 업무').waitFor();
  console.log(`    업무 저장 → 추가됨 안내까지 ${Date.now() - t0}ms (로컬)`);
  const [t] = await sql`select id, to_char(due_date, 'YYYY-MM-DD') due, to_char(due_time, 'HH24:MI') tm from tasks where title = '자동 저장 시험 업무'`;
  assert.equal(t.due, d, '고른 마감일이 함께 저장'); assert.equal(t.tm, '15:00', '마감 시각도 저장');
  // 상세 설명: 입력 후 바로 다른 화면으로 이동해도 저장
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('desc-view').click();
  await owner.getByLabel('설명', { exact: true }).fill('이동해도 남아야 하는 설명');
  await owner.goto(BASE + '/tasks');
  let saved = '';
  for (let i = 0; i < 20 && saved !== '이동해도 남아야 하는 설명'; i++) { await owner.waitForTimeout(250); saved = (await ctx.owner.ok('GET', `/api/tasks/${t.id}`)).task.description; }
  assert.equal(saved, '이동해도 남아야 하는 설명', '설명 자동 저장');
});

await step('V3-7 휴대폰: 업무 행 빈 곳 탭 → 상세 열림, 칩 탭 → 상세 안 열리고 선택 창, 홈 줄 탭 → 상세', async () => {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_task_group', 'assignee'); } catch {} }); // V14 34번: 뜬 뒤 묶기가 바뀌지 않게
  const m = await mc.newPage();
  await m.goto(BASE + '/tasks');
  const row = m.locator('[data-row]').first();
  await row.waitFor();
  const id = await row.getAttribute('data-row');
  const box = await row.boundingBox();
  await m.touchscreen.tap(box.x + box.width / 2, box.y + box.height - 4); // 제목·상태 칩이 아닌 행 아래쪽 가운데 여백
  await m.getByTestId('task-panel').waitFor();
  assert.ok(m.url().endsWith(`/tasks/${id}`), '행 빈 곳 탭 → 그 업무 상세');
  await m.getByTestId('status-chip').waitFor();
  await m.screenshot({ path: `${SHOTS}/65-mobile-task-detail-390.png` });
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '상세 가로 넘침 없음(390)');
  await m.setViewportSize({ width: 360, height: 780 });
  await m.screenshot({ path: `${SHOTS}/66-mobile-task-detail-360.png` });
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '상세 가로 넘침 없음(360)');
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goBack();
  await m.getByTestId('task-panel').waitFor({ state: 'detached' });
  const chip = row.locator('[aria-haspopup][aria-label^="담당자"]').first(); // 담당자 칩
  await chip.tap();
  await m.waitForTimeout(400);
  assert.equal(await m.getByTestId('task-panel').count(), 0, '칩 탭은 상세를 열지 않음');
  assert.equal(await chip.getAttribute('aria-expanded'), 'true', '칩 선택 창 열림');
  await m.keyboard.press('Escape');
  // 홈 목록
  await m.goto(BASE + '/');
  const hrow = m.locator('[data-home-task]').first();
  await hrow.waitFor();
  const hid = await hrow.getAttribute('data-home-task');
  await hrow.evaluate((el) => el.scrollIntoView({ block: 'center' })); // 달성률 카드 아래로 밀려 하단 탭에 가리지 않게
  const hb = await hrow.boundingBox();
  await m.touchscreen.tap(hb.x + hb.width * 0.5, hb.y + hb.height - 3);
  await m.waitForURL(`**/tasks/${hid}`);
  await mc.close();
});

await step('V6-2 휴대폰(Android Chrome 터치): 행을 0.5초 꾹 눌러 위로 끌면 순서 저장, 길게 누르기 메뉴·상세 열림 없음', async () => {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_task_group', 'assignee'); } catch {} }); // V14 34번: 휴대폰 기본은 마감별 — 이 시험은 담당자별 묶음
  const m = await mc.newPage();
  await m.goto(BASE + '/tasks');
  const g = m.getByTestId('task-groups').locator(`[data-group="${ctx.ownerId}"]`);
  await g.locator('[data-sortable-row]').nth(1).waitFor();
  const ids = await g.locator('[data-sortable-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-sortable-row')));
  const a = await g.locator('[data-sortable-row]').nth(0).boundingBox();
  const b = await g.locator('[data-sortable-row]').nth(1).boundingBox();
  let menus = 0;
  await m.exposeFunction('wosCtx', () => { menus++; });
  await m.evaluate(() => document.addEventListener('contextmenu', (e) => { if (!e.defaultPrevented) window.wosCtx?.(); }));
  const cdp = await mc.newCDPSession(m);
  // V6 12번: 휴대폰 "+ 업무 추가" 버튼 → 업무 등록 시트가 열리고 제목 칸에 바로 초점(키보드)
  await m.getByTestId('add-task-top').tap();
  const sheetDlg = m.getByRole('dialog', { name: '업무 등록' });
  await sheetDlg.waitFor();
  await m.waitForFunction(() => document.activeElement?.getAttribute('placeholder') === '무엇을 해야 하나요?');
  await m.keyboard.press('Escape');
  await sheetDlg.waitFor({ state: 'detached' });
  const pt = (x, y) => ({ touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  const x = b.x + b.width * 0.5, y0 = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...pt(x, y0) });
  await m.waitForTimeout(600); // 꾹 누르기
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...pt(x, y0 - ((y0 - (a.y + 4)) * i) / 8) }); await m.waitForTimeout(40); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await m.waitForTimeout(800);
  assert.equal(await m.getByTestId('task-panel').count(), 0, '꾹 눌러 끈 뒤 상세가 열리지 않음');
  assert.equal(menus, 0, '길게 누르기 메뉴 없음');
  const after = await sql`select id from tasks where id = any(${ids.slice(0, 2)}::uuid[]) order by sort_order`;
  assert.deepEqual(after.map((r) => r.id), [ids[1], ids[0]], '두 번째 업무가 맨 위로');
  await mc.close();
});

await step('V5 휴대폰: 홈 이번 주 날짜 줄 → 빠른 등록·업무에도 추가 → 주 보기 블록 제목·업무 연동 → 삭제 시 연결 업무도', async () => {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(BASE + '/');
  assert.equal(await m.getByTestId('home-create').count(), 0, '홈에 따로 만들기 버튼 없음(V6)');
  await m.locator(`[data-day="${today}"]`).first().click({ position: { x: 20, y: 30 } }); // 이번 주의 오늘 줄 → 빠른 등록
  const sheet = m.getByTestId('quick-create');
  await sheet.waitFor();
  await sheet.getByLabel('빠른 입력 제목').fill('V5 홈에서 만든 거래처 미팅 준비');
  await sheet.getByTestId('quick-also-task').check({ force: true });
  await sheet.getByLabel('빠른 입력 제목').press('Enter');
  await m.getByText('일정을 저장하고 업무에도 추가했습니다').waitFor();
  const [t] = await sql`select id, to_char(due_date,'YYYY-MM-DD') d, to_char(due_time,'HH24:MI') tm from tasks where title = 'V5 홈에서 만든 거래처 미팅 준비' and deleted_at is null`;
  const [e] = await sql`select id, to_char(start_at at time zone 'Asia/Seoul','YYYY-MM-DD HH24:MI') s from events where title = 'V5 홈에서 만든 거래처 미팅 준비' and deleted_at is null`;
  assert.ok(t && e, '일정과 업무 둘 다 생김');
  assert.equal(`${t.d} ${t.tm}`, e.s, '업무 마감 = 일정 시작');
  // 긴 제목의 종일 마감 업무도 제목이 보임(줄바꿈)
  await ctx.owner.ok('POST', '/api/tasks', { title: 'V5 마감 제목이 길어도 두 줄로 보여야 함', assigneeId: ctx.ownerId, dueDate: t.d, approvalRequired: false });
  await m.goto(`${BASE}/calendar?date=${t.d}`);
  await m.getByTestId('cal-mobile-head').waitFor();
  assert.equal(await m.locator('[data-day-head]').count(), 7, '휴대폰 기본 = 주 보기, 요일+날짜 머리');
  const dh = m.locator(`[data-day-head="${t.d}"]`);
  assert.equal((await dh.innerText()).replace(/\s+/g, ''), `${'일월화수목금토'[new Date(t.d + 'T00:00:00Z').getUTCDay()]}${Number(t.d.slice(8))}`, '날짜 머리 = 그 칸의 요일·날짜(하루 밀림 없음)');
  const block = m.locator('[data-ev-block]', { hasText: 'V5 홈에서 만든' }).first();
  await block.waitFor();
  assert.ok(await block.getByLabel('업무와 연결').count(), '연결 표시 ✓');
  const chip = m.locator(`[data-task-item][title="V5 마감 제목이 길어도 두 줄로 보여야 함"]`).first();
  assert.ok((await chip.innerText()).startsWith('V5 마감'), '마감 업무 제목이 보임(주 보기는 앞 6자)');
  const cb = await chip.boundingBox();
  assert.ok(cb.width > 20 && cb.height >= 10, `마감 칩에 글자 칸이 있음 ${cb.width}x${cb.height}`);
  await chip.scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${SHOTS}/69-mobile-week-due-chips-390.png` });
  assert.equal(await m.locator('[data-task-item][title^="V5 홈에서 만든"]').count(), 0, '연결 업무는 블록으로만(중복 표시 없음)');
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '주 보기 가로 넘침 없음(390)');
  await block.scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${SHOTS}/67-mobile-week-v5-390.png` });
  await m.setViewportSize({ width: 360, height: 780 });
  await m.waitForTimeout(300);
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '주 보기 가로 넘침 없음(360)');
  await m.screenshot({ path: `${SHOTS}/68-mobile-week-v5-360.png` });
  await m.setViewportSize({ width: 390, height: 844 });
  // 업무 마감 변경 → 일정 이동
  const nd = addDays(t.d, 1);
  await ctx.owner.ok('PATCH', `/api/tasks/${t.id}`, { dueDate: nd });
  const [e2] = await sql`select to_char(start_at at time zone 'Asia/Seoul','YYYY-MM-DD') d from events where id = ${e.id}`;
  assert.equal(e2.d, nd, '업무 날짜를 바꾸면 일정도 이동');
  // 일정 삭제 → "연결된 업무도 삭제할까요?" 확인 → 둘 다 삭제
  await m.goto(`${BASE}/calendar?date=${nd}`);
  await m.locator('[data-ev-block]', { hasText: 'V5 홈에서 만든' }).first().click();
  const msgs = [];
  m.on('dialog', (dg) => { msgs.push(dg.message()); dg.accept(); });
  await m.getByTestId('event-preview').getByRole('button', { name: '일정 삭제' }).click();
  await m.getByText('삭제했습니다').waitFor();
  assert.ok(msgs.some((x) => x.includes('연결된 업무')), '연결 업무 삭제 확인을 물음');
  assert.equal((await sql`select deleted_at is not null as del from tasks where id = ${t.id}`)[0].del, true, '연결 업무도 삭제');
  // + 버튼 메뉴에 업무·일정 둘 다
  await m.getByTestId('fab').click();
  await m.getByRole('menuitem', { name: '일정 등록' }).waitFor();
  await m.getByRole('menuitem', { name: '업무 등록' }).waitFor();
  await mc.close();
});

await step('V6 화면: 여러 명 일괄 생성·완료 제자리·완료 월별·삭제→되돌리기·휴지통·엑셀·사용자 지정 반복·알림 발송 기록', async () => {
  // 담당자 여러 명 → 각자 1건씩
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('create-menu').click();
  await owner.getByRole('menuitem', { name: /업무/ }).first().click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  await dlg.getByLabel('제목').fill('V6 다같이 점검');
  await dlg.getByLabel('담당자', { exact: true }).selectOption({ label: '김대표' }); // 마지막 설정 기억(V8) 대신 명시
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: /여러 명에게/ }).click();
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: '이직원' }).click();
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: '최매니저' }).click();
  await dlg.getByRole('button', { name: '3명에게 각각 만들기' }).click();
  await owner.getByText('3명에게 각각 만들었습니다').waitFor();
  const batch = await sql`select id, batch_id from tasks where title = 'V6 다같이 점검' and deleted_at is null`;
  assert.equal(batch.length, 3); assert.equal(new Set(batch.map((b) => b.batch_id)).size, 1);
  await owner.goto(BASE + '/tasks');
  await owner.locator('[data-batch]').first().waitFor();
  // 완료해도 제자리(취소선)
  const row = owner.locator('[data-row]', { hasText: 'V6 다같이 점검' }).first();
  const rid = await row.getAttribute('data-row');
  await row.getByRole('button', { name: /V6 다같이 점검 (완료|검토 요청)/ }).first().click();
  await owner.waitForTimeout(800);
  await owner.locator(`[data-row="${rid}"]`).waitFor();
  assert.ok((await owner.locator(`[data-row="${rid}"] a[data-open-task]`).getAttribute('class')).includes('line-through'), '완료해도 제자리 취소선');
  // 완료 보기(월별)
  await owner.getByRole('button', { name: '완료', exact: true }).click();
  await owner.getByTestId('task-groups').getByText(/\d{4}년 \d+월/).first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/70-done-archive.png` });
  // 삭제 → 되돌리기 → 다시 삭제 → 휴지통에서 되살리기
  const del = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V6 지웠다 살릴 업무', orgUnitId: ctx.hq, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${del}`);
  owner.once('dialog', (dg) => dg.accept());
  await owner.getByRole('button', { name: '더보기', exact: true }).click();
  await owner.getByRole('menuitem', { name: '삭제' }).click();
  await owner.getByRole('button', { name: '되돌리기' }).click();
  await owner.getByText('되살렸습니다').waitFor();
  assert.equal((await sql`select deleted_at from tasks where id = ${del}`)[0].deleted_at, null);
  await ctx.owner.ok('DELETE', `/api/tasks/${del}`);
  await owner.goto(BASE + '/tasks/trash');
  await owner.getByTestId('trash-list').getByRole('button', { name: 'V6 지웠다 살릴 업무 되살리기' }).click();
  await owner.getByText('되살렸습니다').waitFor();
  // 엑셀 내려받기
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('tasks-more').click();
  await owner.getByRole('menuitem', { name: '엑셀로 내려받기' }).click();
  const [download] = await Promise.all([owner.waitForEvent('download'), owner.getByTestId('export-download').click()]);
  // 헤드리스 크로미움은 파일 이름을 'download' 로만 알려 줘서, 받은 파일 내용(xlsx = zip)과 서버의 파일 이름 헤더를 따로 확인
  const fbuf = await (await import('node:fs/promises')).readFile(await download.path());
  assert.equal(fbuf.subarray(0, 2).toString(), 'PK', 'xlsx(zip) 파일');
  const head = await owner.request.get(download.url());
  assert.match(head.headers()['content-disposition'], /filename\*=UTF-8''%EC%9B%8C%ED%81%AC%EC%9D%B8_%EC%97%85%EB%AC%B4_\d{4}-\d{2}\.xlsx/, '워크인_업무_YYYY-MM.xlsx');
  // 사용자 지정 반복 (Google 형)
  const rt = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V6 반복 지정', orgUnitId: ctx.hq, dueDate: today, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${rt}`);
  await owner.getByTestId('detail-repeat').getByLabel('반복 규칙').selectOption('__custom');
  const cr = owner.getByTestId('custom-recur');
  await cr.getByLabel('반복 단위').selectOption('WEEKLY');
  await cr.getByRole('group', { name: '반복 요일' }).getByRole('button', { name: '월' }).click();
  await cr.getByRole('group', { name: '반복 요일' }).getByRole('button', { name: '금' }).click();
  await cr.getByLabel('종료 횟수').fill('8');
  await cr.getByRole('button', { name: '완료' }).click();
  await owner.waitForTimeout(800);
  const rr = (await sql`select recurrence_rule from tasks where id = ${rt}`)[0].recurrence_rule;
  assert.match(rr, /FREQ=WEEKLY/); assert.match(rr, /COUNT=8/); assert.match(rr, /MO/); assert.match(rr, /FR/);
  // 운영 상태 알림 기록 (달성률 카드는 V7 에서 제거)
  await owner.goto(BASE + '/admin/ops');
  await owner.getByTestId('recent-notifications').getByText('V6 다같이 점검').first().waitFor();
});

await step('V7: 홈 첫 화면에 오늘 할 일·이번 주(업무·일정 같은 한 줄), 달성률 없음, 업무 ⋯ 메뉴 시트, 캘린더 개인/회사 색', async () => {
  for (const [w, h] of [[390, 844], [360, 780]]) {
    const mc = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
    const m = await mc.newPage();
    await m.goto(BASE + '/');
    await m.getByTestId('home-week').waitFor();
    assert.equal(await m.getByTestId('achievement').count(), 0, '달성률 카드 없음');
    const tb = await m.getByTestId('home-today').boundingBox();
    const wb = await m.getByTestId('home-week').boundingBox();
    assert.ok(tb.y < h && wb.y < h, `첫 화면에 두 카드 시작이 보임 (오늘 ${Math.round(tb.y)}, 이번 주 ${Math.round(wb.y)}, 화면 ${h})`);
    assert.ok(tb.y < wb.y, '오늘 할 일이 먼저');
    assert.ok(!(await m.getByTestId('home-week').innerText()).includes('마감:'), '"마감:" 접두어 없음 — 업무·일정 같은 한 줄');
    await m.screenshot({ path: `${SHOTS}/72-home-first-screen-${w}.png` });
    await m.goto(BASE + '/tasks');
    await m.getByTestId('tasks-more').click();
    const menu = m.getByRole('menu', { name: '업무 더보기' });
    for (const name of ['엑셀로 내려받기', '휴지통 (30일 복원)']) {
      const b = await menu.getByRole('menuitem', { name }).boundingBox();
      assert.ok(b.x >= 0 && b.x + b.width <= w && b.y + b.height <= h && b.height >= 44, `${name} 잘림 없음·44px (${JSON.stringify(b)})`);
    }
    await m.screenshot({ path: `${SHOTS}/73-tasks-more-sheet-${w}.png` });
    await mc.close();
  }
  // V7 4번 캘린더 색: 개인/회사 두 가지, 사용자별 저장
  await owner.goto(BASE + '/calendar');
  await owner.getByTestId('cal-colors-open').click();
  const cd = owner.getByTestId('cal-colors');
  await cd.getByRole('radio', { name: '개인 일정 색 블루베리' }).click();
  await cd.getByRole('button', { name: '저장' }).click();
  await owner.getByText('캘린더 색을 바꿨습니다').waitFor();
  const [cs] = await sql`select cal_colors from user_settings where user_id = ${ctx.ownerId}`;
  assert.equal(cs.cal_colors.personal, '#3f51b5');
  await owner.screenshot({ path: `${SHOTS}/74-calendar-two-colors.png` });
});

await step('V8: 등록 창 한 번에(자동 인식·템플릿·우선순위·반복·알림), 🔔 미리 알림, 사진 여러 장·크게 보기, 내 주간 보고, 브리핑 설정', async () => {
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('create-menu').click();
  await owner.getByRole('menuitem', { name: /업무/ }).first().click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  await dlg.getByTestId('tpl-chips').getByRole('button', { name: '견적서 발송' }).waitFor(); // 시작 템플릿
  await dlg.getByLabel('제목').fill('내일 3시 @최매니저 !높음 매주 장비 견적 비교');
  // 검수 20: 적용 버튼 없이 바로 칩에 반영(담당·우선순위), 저장할 때 제목에서 인식한 말을 뺀다
  await dlg.getByTestId('quick-nl-apply').getByText(/장비 견적 비교/).waitFor();
  await owner.waitForFunction(() => (document.querySelector('[role=dialog] select[aria-label="담당자"]'))?.selectedOptions[0]?.textContent?.includes('최매니저'));
  await dlg.getByRole('button', { name: '저장' }).click();
  await owner.getByText(/업무를 등록했습니다/).first().waitFor();
  const [t] = await sql`select id, assignee_id, priority, recurrence_rule, to_char(due_date,'YYYY-MM-DD') d, to_char(due_time,'HH24:MI') tm from tasks where title = '장비 견적 비교'`;
  assert.equal(t.d, addDays(today, 1)); assert.equal(t.tm, '15:00'); assert.equal(t.assignee_id, ctx.managerA.id); assert.equal(t.priority, 'high'); assert.match(t.recurrence_rule, /FREQ=WEEKLY/);
  // 🔔 미리 알림
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('detail-remind').getByTestId('bell-chip').click();
  await owner.getByRole('button', { name: '30분 전' }).click();
  await owner.waitForTimeout(600);
  assert.deepEqual((await sql`select reminder_minutes from tasks where id = ${t.id}`)[0].reminder_minutes, [30]);
  await owner.keyboard.press('Escape');
  // 사진 여러 장 → 격자 → 크게 보기·넘기기
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await owner.getByTestId('album-input').setInputFiles([{ name: '현장1.png', mimeType: 'image/png', buffer: png }, { name: '현장2.png', mimeType: 'image/png', buffer: png }]);
  await owner.getByTestId('photo-grid').locator('[data-photo]').nth(1).waitFor();
  await owner.getByTestId('photo-grid').locator('[data-photo]').first().click();
  const viewer = owner.getByTestId('photo-viewer');
  await viewer.getByRole('button', { name: '다음 사진' }).click();
  await viewer.getByText(/현장2\.png|현장1\.png/).waitFor();
  await viewer.getByRole('button', { name: '사진 닫기' }).click();
  // 내 주간 보고: 초안 → 제출
  await owner.goto(BASE + '/reports/mine');
  await owner.getByTestId('report-draft').click();
  await owner.getByLabel('주간 보고 내용').waitFor();
  assert.match(await owner.getByLabel('주간 보고 내용').inputValue(), /■ 이번 주 완료/);
  await owner.getByTestId('report-submit').click();
  await owner.getByText('제출했습니다').waitFor();
  await owner.getByTestId('team-reports').getByText('김대표').waitFor();
  // 브리핑 설정
  await owner.goto(BASE + '/settings');
  await owner.getByTestId('briefing-settings').getByLabel('브리핑 시각').waitFor();
  // 휴대폰 360: 등록 창 칩 줄 넘침 없음
  const mc = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(BASE + '/tasks');
  await m.getByTestId('add-task-top').tap();
  const sd = m.getByRole('dialog', { name: '업무 등록' });
  await sd.getByTestId('quick-chips').waitFor();
  await sd.getByLabel('제목').fill('모레 오전 10시 현장 점검표 제출');
  await sd.getByTestId('quick-nl-apply').waitFor();
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '360 넘침 없음');
  await m.screenshot({ path: `${SHOTS}/75-quick-add-v8-360.png` });
  await mc.close();
});

await step('V9: 자료실 올리기·검색 → 홈 "AI에게 요청" → 비서가 찾은 로고 첨부 제안 → [확인] → 업무에 첨부, 360 넘침 없음', async () => {
  const task = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V9 전단지 제작', orgUnitId: ctx.hq, approvalRequired: false })).id;
  await owner.goto(BASE + '/library');
  // V14 18번 폴더 탐색기: 새 폴더 → 그 폴더에 올리기
  await owner.getByTestId('folder-new').click();
  await owner.getByLabel('폴더 이름').fill('브랜드');
  await owner.getByTestId('folder-save').click();
  await owner.getByTestId('library-path').getByText('브랜드').waitFor();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await owner.getByTestId('library-file').setInputFiles([{ name: '다짐 로고 E2E.png', mimeType: 'image/png', buffer: png }]);
  await owner.getByTestId('library-list').getByText('다짐 로고 E2E').waitFor();
  await owner.getByLabel('자료 검색').fill('로고 E2E');
  await owner.getByRole('treeitem', { name: /브랜드/ }).waitFor();
  assert.equal((await sql`select folder from library_files where title = '다짐 로고 E2E'`)[0].folder, '브랜드', '보고 있던 폴더에 올라감');
  const [f] = await sql`select id from library_files where title = '다짐 로고 E2E'`;
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [
    { content: [{ type: 'tool_use', id: 'e1', name: 'search_library', input: { query: '다짐 로고' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'tool_use', id: 'e2', name: 'propose_attach_file', input: { taskId: task, fileId: f.id } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '로고를 찾았습니다. 확인을 누르면 첨부됩니다.' }], stop_reason: 'end_turn' }] }) });
  await owner.goto(BASE + '/');
  await owner.getByTestId('home-ai').getByLabel('AI에게 요청').fill('다짐 로고 찾아서 전단지 업무에 붙여줘');
  await owner.getByTestId('home-ai').getByRole('button', { name: '요청' }).click();
  await owner.waitForURL(/\/assistant/);
  const card = owner.getByTestId('ai-proposal');
  await card.getByText(/다짐 로고 E2E → V9 전단지 제작/).waitFor();
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${task}`)[0].n, 0, '확인 전 첨부 없음');
  await card.getByRole('button', { name: '확인' }).click();
  await card.getByText('✓ 반영됨').waitFor();
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${task} and deleted_at is null`)[0].n, 1);
  await owner.screenshot({ path: `${SHOTS}/76-ai-assistant.png` });
  const mc = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  for (const path of ['/library', '/assistant']) {
    await m.goto(BASE + path);
    await m.getByRole('heading', { name: path === '/library' ? '자료실' : 'AI 비서' }).waitFor();
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} 360 넘침 없음`);
  }
  await m.screenshot({ path: `${SHOTS}/77-library-360.png` });
  await mc.close();
});

await step('V10: 관리 → 사용량·요금제(내부 무제한·막대·큰 파일·요금제 표·변경 요청) → /platform 요청 반영·요금제 숫자 변경, 직원은 /platform 없음', async () => {
  await owner.goto(BASE + '/admin/usage');
  await owner.getByTestId('current-plan').getByText('내부(무제한)').waitFor();
  await owner.getByTestId('meter-storage').getByText('무제한').first().waitFor();
  await owner.getByTestId('top-files').locator('li').first().waitFor();
  await owner.getByTestId('plan-request').click();
  await owner.getByLabel('요청할 요금제').selectOption('team');
  await owner.getByRole('button', { name: '요청 보내기' }).click();
  await owner.getByText(/요청을 보냈습니다/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/78-usage-plan.png`, fullPage: true });
  await owner.goto(BASE + '/platform');
  await owner.getByTestId('platform-requests').getByRole('button', { name: '반려' }).first().click();
  await owner.getByText('반려했습니다').waitFor();
  await owner.getByLabel('business 월 요금').fill('80000');
  await owner.getByTestId('platform-plans').locator('tr', { hasText: 'business' }).getByRole('button', { name: '저장' }).click();
  await owner.getByText('저장했습니다').first().waitFor();
  assert.equal((await sql`select monthly_krw from plans where code = 'business'`)[0].monthly_krw, 80000);
  await sql`update plans set monthly_krw = 79000 where code = 'business'`;
  assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = 'default'`)[0].plan_code, 'internal', '반려하면 그대로');
  await owner.screenshot({ path: `${SHOTS}/79-platform.png`, fullPage: true });
  const r = await ctx.staffA.client.req('GET', '/api/platform');
  assert.equal(r.status, 404);
});

await step('V11 휴대폰: 행 상태 칩 → 시트에서 진행 중, 묶기 상태별, 완료 칩 보임·월별 요약, 마감 선택 = 아래 시트(화면 안)·시각 버튼, 글자 칩, 🎤 말로 등록 → 인식 카드(빠진 마감 빨간 표시)', async () => {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V11 상태 칩 업무', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: addDays(today, 1), approvalRequired: false })).id;
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_task_group', 'assignee'); } catch {} }); // V14 34번: 휴대폰 기본은 마감별 — 이 시험은 담당자별 묶음
  const m = await mc.newPage();
  await m.goto(BASE + '/tasks');
  const row = m.locator(`[data-row="${t}"]`);
  await row.getByTestId('row-status-chip').getByText('확인 완료').waitFor();
  await row.getByTestId('row-status-chip').tap();
  const sheet = m.locator('[data-sheet]');
  await sheet.getByRole('button', { name: '진행 중' }).tap();
  await row.getByTestId('row-status-chip').getByText('진행 중').waitFor();
  assert.equal((await sql`select status from tasks where id = ${t}`)[0].status, 'in_progress');
  // 완료 칩은 줄 끝에 고정되어 화면 안에 보임
  const box = await m.getByTestId('done-chip').boundingBox();
  assert.ok(box && box.x + box.width <= 390, '완료 칩 화면 안');
  assert.equal(await m.getByText('완료된 업무도 보기').count(), 0, '체크박스 없음');
  await m.getByTestId('group-by').selectOption('status');
  await m.locator('[data-group="in_progress"]').getByText('V11 상태 칩 업무').waitFor();
  await m.getByTestId('group-by').selectOption('assignee');
  // 한 줄 추가: 글자 칩 + 마감 시트
  const add = m.getByTestId('inline-add').first();
  await add.getByLabel('업무 추가 제목').fill('V11 시트 마감 업무');
  await add.getByTestId('repeat-chip').getByText('반복 안 함').waitFor();
  await add.getByTestId('bell-chip').getByText('알림 기본').waitFor();
  await add.getByTestId('due-picker').tap();
  await sheet.waitFor();
  await m.waitForTimeout(400); // 올라오는 동작 끝난 뒤
  const sb = await sheet.boundingBox();
  assert.ok(sb.y >= 0 && sb.y + sb.height <= 844 + 1, `시트가 화면 안(상태바·아래 가림 없음): ${JSON.stringify(sb)}`);
  await sheet.getByRole('button', { name: /^내일/ }).tap();
  await sheet.getByRole('button', { name: '15:00' }).tap();
  await m.screenshot({ path: `${SHOTS}/80-v11-due-sheet-390.png` });
  await sheet.getByTestId('sheet-done').tap();
  await add.getByTestId('inline-save').tap();
  await m.getByText(/추가됨: V11 시트 마감 업무/).first().waitFor();
  const [nt] = await sql`select to_char(due_date,'YYYY-MM-DD') d, to_char(due_time,'HH24:MI') tm from tasks where title = 'V11 시트 마감 업무'`;
  assert.equal(nt.d, addDays(today, 1)); assert.equal(nt.tm, '15:00');
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '390 넘침 없음');
  await m.screenshot({ path: `${SHOTS}/81-v11-tasks-390.png` });
  // 🎤 말로 등록 (텍스트로 대체 시험)
  await m.getByTestId('fab').tap();
  await m.getByTestId('fab-voice').tap();
  const dlg = m.getByRole('dialog', { name: '🎤 말로 업무 등록' });
  await dlg.getByTestId('voice-guide').getByText('마감(언제까지)').waitFor();
  await dlg.getByTestId('voice-text').fill('견적서 보내기');
  await dlg.getByTestId('voice-recognize').tap();
  await dlg.getByTestId('voice-card').getByText('말씀하지 않으셨어요 — 눌러서 선택').waitFor();
  assert.equal(await dlg.getByTestId('voice-save').isDisabled(), true, '마감 없으면 저장 불가');
  await dlg.getByRole('button', { name: '다시 말하기' }).tap();
  await dlg.getByTestId('voice-text').fill('금요일까지 최매니저 쌍용점 덤벨 수량 파악 !높음');
  await dlg.getByTestId('voice-recognize').tap();
  assert.equal(await dlg.getByLabel('인식한 업무명').inputValue(), '쌍용점 덤벨 수량 파악');
  await m.screenshot({ path: `${SHOTS}/82-v11-voice-card-390.png` });
  await dlg.getByTestId('voice-save').tap();
  await m.getByText(/업무를 등록했습니다: 쌍용점 덤벨 수량 파악/).first().waitFor();
  const [vt] = await sql`select assignee_id, priority, due_date from tasks where title = '쌍용점 덤벨 수량 파악'`;
  assert.equal(vt.assignee_id, ctx.managerA.id); assert.equal(vt.priority, 'high'); assert.ok(vt.due_date);
  await mc.close();
});

await step('V12: PC 상세 패널 — 다른 업무 클릭 시 교체·바깥/Esc 닫힘, 한 줄 추가 여러 담당 "n명에게 각각 만들기", 남의 업무 상태 칩 비활성·검토 알림에서 승인', async () => {
  const a = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12 패널 A', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  const b = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12 패널 B', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await owner.setViewportSize({ width: 1440, height: 900 });
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.locator(`[data-row="${a}"]`).getByText('V12 패널 A').click();
  const panel = owner.getByTestId('task-panel');
  await panel.getByText('V12 패널 A').first().waitFor();
  await owner.locator(`[data-row="${b}"]`).getByText('V12 패널 B').click();
  await panel.getByText('V12 패널 B').first().waitFor();
  assert.ok(owner.url().endsWith(`/tasks/${b}`), '패널 교체');
  await owner.getByRole('heading', { level: 1, name: '업무' }).click(); // 목록 빈 곳
  await panel.waitFor({ state: 'detached' });
  assert.ok(!/\/tasks\/[0-9a-f-]{36}$/.test(owner.url()), '닫히면 목록 주소');
  await owner.locator(`[data-row="${a}"]`).getByText('V12 패널 A').click();
  await panel.waitFor();
  await owner.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  // 한 줄 추가 여러 담당
  await owner.getByTestId('add-task-top').click();
  const add = owner.getByTestId('task-groups').getByTestId('inline-add').first();
  await add.getByLabel('업무 추가 제목').fill('V12 각자 제출');
  await add.getByTestId('assignee-picker').click();
  const dlg = owner.getByRole('dialog', { name: '담당자 선택 (여러 명 가능)' });
  await dlg.getByRole('menuitemcheckbox', { name: /최매니저/ }).click();
  await dlg.getByRole('menuitemcheckbox', { name: /이직원/ }).click();
  await owner.locator('div.fixed.inset-0.z-\\[70\\]').click();
  await add.getByRole('button', { name: '3명에게 각각 만들기' }).click();
  await owner.getByText(/3명 각각에게 추가됨: V12 각자 제출/).first().waitFor();
  assert.equal((await sql`select count(distinct batch_id)::int b, count(*)::int n from tasks where title = 'V12 각자 제출'`)[0].n, 3);
  await owner.keyboard.press('Escape');
  // 남의 업무: 원형 체크 비활성, 검토 요청 알림에서 승인
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12 검토 승인 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  await owner.goto(BASE + '/tasks?mode=list');
  assert.equal(await owner.locator(`[data-row="${t}"]`).getByTestId('check-circle').isDisabled(), true, '담당자만 완료');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
  await owner.goto(BASE + '/notifications');
  const li = owner.getByTestId('notifications').locator('li', { hasText: '검토 요청: V12 검토 승인 업무' });
  await li.getByTestId('review-actions').getByRole('button', { name: '승인' }).click();
  await owner.getByText('승인했습니다 (완료)').waitFor();
  assert.equal((await sql`select status from tasks where id = ${t}`)[0].status, 'done');
  await owner.setViewportSize({ width: 1366, height: 900 });
});

await step('V12-8: 업무 등록 "📎 자료로 채우기" → 제목·설명·체크리스트 채움 → 저장하면 자료 첨부, AI 비서에 사진 첨부 → 담당자별 일괄 제안 미리보기', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const q = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) }); // 앞 단계에서 남은 가짜 AI 응답을 비우고 넣는다
  await q([{ content: [{ type: 'text', text: JSON.stringify({ title: 'E2E 촬영 자료 수집', description: '요청서 표 기준', checklist: ['외관', '내부', '기구'], dueDate: addDays(today, 4), dueTime: '14:00' }) }], stop_reason: 'end_turn' }]);
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('create-menu').click();
  await owner.getByRole('menuitem', { name: /업무/ }).first().click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  await dlg.getByTestId('quick-fill-input').setInputFiles([{ name: 'E2E 요청서.png', mimeType: 'image/png', buffer: png }]);
  await dlg.getByTestId('quick-filled').getByText('체크리스트 3개').waitFor();
  assert.equal(await dlg.getByLabel('제목').inputValue(), 'E2E 촬영 자료 수집');
  await dlg.getByRole('button', { name: '저장' }).click();
  await owner.getByText(/업무를 등록했습니다/).first().waitFor();
  await owner.waitForTimeout(800);
  const [t] = await sql`select id, to_char(due_time,'HH24:MI') tm from tasks where title = 'E2E 촬영 자료 수집'`;
  assert.equal(t.tm, '14:00');
  assert.equal((await sql`select count(*)::int n from task_checklist_items where task_id = ${t.id}`)[0].n, 3);
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null`)[0].n, 1, '자료 첨부');
  // AI 비서에 사진 첨부 → 일괄 제안 미리보기
  await owner.goto(BASE + '/assistant');
  await owner.getByText('이렇게 말해 보세요').waitFor(); // 화면 준비(상태 불러옴) 뒤에 파일 선택
  await owner.waitForLoadState('networkidle');
  await owner.getByTestId('ai-file-input').setInputFiles([{ name: 'E2E 표.png', mimeType: 'image/png', buffer: png }]);
  await owner.getByTestId('ai-files').getByText('E2E 표.png').waitFor();
  await q([{ content: [{ type: 'tool_use', id: 'e8', name: 'propose_create_tasks', input: { title: 'E2E 지점 자료', assigneeIds: [ctx.staffA.id, ctx.managerA.id], dueDate: addDays(today, 5), checklist: ['가', '나'] } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '확인을 누르면 만들어집니다.' }], stop_reason: 'end_turn' }]);
  await owner.getByLabel('AI 에게 요청').fill('각 지점 자료 받아오라고 배정해줘');
  await owner.getByRole('button', { name: '보내기' }).click();
  const pv = owner.getByTestId('ai-proposal-preview');
  await pv.getByText(/담당: .*\(각자 1건\)/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/83-ai-attach-proposal.png` });
  await owner.getByTestId('ai-proposal').getByRole('button', { name: '확인' }).click();
  await owner.getByTestId('ai-proposal').getByText('✓ 반영됨').waitFor();
  assert.equal((await sql`select count(*)::int n from tasks where title = 'E2E 지점 자료'`)[0].n, 2);
});

await step('V12-9: 첨부 칸·자료실에 파일 끌어 놓기(여러 개·진행률), 저장소 연결 실패 시 알기 쉬운 원인 표시', async () => {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12 끌어 놓기 업무', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${t}`);
  const drop = async (testid, files) => owner.getByTestId(testid).first().evaluate((el, fs) => {
    const dt = new DataTransfer();
    for (const f of fs) dt.items.add(new File([f.body], f.name, { type: f.type }));
    for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, files);
  await drop('attach-drop', [{ name: '끌기1.txt', type: 'text/plain', body: 'a' }, { name: '끌기2.txt', type: 'text/plain', body: 'b' }]);
  await owner.getByText('2개 첨부 완료').waitFor();
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t} and deleted_at is null`)[0].n, 2);
  // 저장소 연결 실패(CORS·네트워크) → 원인 안내
  await owner.route('**/api/files/local**', (r) => (r.request().method() === 'PUT' ? r.abort('failed') : r.continue()));
  await drop('comment-drop', [{ name: '실패.txt', type: 'text/plain', body: 'x' }]);
  await owner.getByTestId('upload-progress').getByText(/파일 저장소에 연결하지 못했습니다/).first().waitFor();
  await owner.unroute('**/api/files/local**');
  await owner.goto(BASE + '/library');
  await drop('library-drop', [{ name: '끌기 자료.txt', type: 'text/plain', body: '끌어 놓은 자료' }]);
  await owner.getByTestId('library-list').getByText('끌기 자료').waitFor();
});

await step('V13 11·12·8번: 업무 상세 — 설명 위·오른쪽 속성 열(PC), 빈 체크리스트·하위 업무 한 줄, (?) 안내, 하위 업무 추가·n/m, 답글·반응', async () => {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13 상세 배치', orgUnitId: ctx.siteA, assigneeId: ctx.ownerId, description: '**중요** 기준 문서 https://example.com/guide 참고', approvalRequired: false })).id;
  await ctx.staffA.client.ok('POST', `/api/tasks/${t}/comments`, { body: '자료 확인했습니다' });
  await owner.setViewportSize({ width: 1440, height: 900 });
  await owner.goto(`${BASE}/tasks/${t}`);
  await owner.getByTestId('desc-rich').getByText('중요').waitFor();
  assert.equal(await owner.getByTestId('desc-rich').locator('a[href="https://example.com/guide"]').count(), 1, '링크');
  const desc = await owner.getByTestId('desc-section').boundingBox(), aside = await owner.getByTestId('detail-aside').boundingBox();
  assert.ok(aside.x > desc.x + desc.width - 5, 'PC: 속성은 오른쪽 열');
  assert.ok(desc.y < (await owner.getByTestId('detail-requester').boundingBox()).y + 200, '설명이 위쪽');
  await owner.evaluate(() => localStorage.setItem('wos_task_more', '0')); await owner.reload(); // 필드 더보기 접힘 = 빈 상태 한 줄
  await owner.getByTestId('plan-empty').getByText('＋ 하위 업무 나눠 맡기기').click();
  await owner.getByTestId('help-subtasks').click();
  await owner.getByRole('note').getByText(/나눠 맡기거나 마감이 따로/).waitFor();
  await owner.getByLabel('하위 업무 제목').fill('사진 촬영');
  await owner.getByTestId('subtask-add').getByRole('button', { name: '추가' }).click();
  await owner.getByTestId('subtask-progress').getByText('0/1 완료').waitFor();
  await owner.screenshot({ path: `${SHOTS}/63-task-detail-2col.png`, fullPage: true });
  // 답글·반응
  const th = owner.getByTestId('comment-thread').first();
  await th.getByTestId('reply-open').first().click();
  await th.getByLabel('답글').fill('감사합니다');
  await th.getByTestId('reply-form').getByRole('button', { name: '등록' }).click();
  await th.getByText('감사합니다').waitFor();
  await th.getByTestId('react-open').first().click();
  await owner.getByRole('button', { name: '확인했습니다' }).click();
  await th.getByTestId('reaction').first().getByText('1').waitFor();
  const n = await sql`select title from notifications where user_id = ${ctx.staffA.id} and title = ${'답글: V13 상세 배치'}`;
  assert.equal(n.length, 1, '원 댓글 작성자에게 답글 알림');
  await owner.setViewportSize({ width: 1280, height: 860 });
});
await step('V13 10번 메신저: 1:1 대화 → 상대 화면에 실시간 도착·배지 → 답장 → 읽음, 파일 보내기, 업무로 만들기', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const a = await login(c, ctx.staffA.email, ctx.staffA.password);
  await a.goto(BASE + '/messages');
  await a.getByTestId('chat-rooms').waitFor();
  await owner.goto(BASE + '/messages');
  await owner.getByTestId('chat-new').click();
  await owner.getByTestId('chat-new-modal').getByRole('button', { name: '이직원와 대화' }).click();
  await owner.getByTestId('chat-room-name').getByText('이직원').waitFor();
  await owner.getByTestId('chat-input').fill('내일 오전에 현장 사진 부탁해요');
  await owner.getByTestId('chat-input').press('Enter');
  // 상대: 목록에 안 읽은 수 → 열면 메시지
  await a.getByTestId('room-unread').first().waitFor({ timeout: 15000 });
  await a.getByTestId('chat-rooms').getByText('김대표').click();
  await a.getByTestId('chat-messages').getByText('내일 오전에 현장 사진 부탁해요').waitFor();
  await a.getByTestId('chat-input').fill('네 알겠습니다');
  await a.getByTestId('chat-send').click();
  await owner.getByTestId('chat-messages').getByText('네 알겠습니다').waitFor({ timeout: 15000 });
  await owner.getByTestId('chat-messages').getByText('읽음').first().waitFor({ timeout: 15000 });
  await owner.getByTestId('chat-file').setInputFiles([{ name: '현장 안내.txt', mimeType: 'text/plain', buffer: Buffer.from('안내문') }]);
  await a.getByTestId('chat-messages').getByText('현장 안내.txt').waitFor({ timeout: 15000 });
  await owner.screenshot({ path: `${SHOTS}/64-messenger.png`, fullPage: true });
  // 업무로 만들기
  await owner.getByTestId('chat-message').filter({ hasText: '내일 오전에 현장 사진' }).hover();
  await owner.getByTestId('chat-message').filter({ hasText: '내일 오전에 현장 사진' }).getByTestId('msg-more').click();
  await owner.getByTestId('chat-message').filter({ hasText: '내일 오전에 현장 사진' }).getByTestId('msg-to-task').click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  await dlg.waitFor();
  assert.equal(await dlg.getByPlaceholder('무엇을 해야 하나요?').inputValue(), '내일 오전에 현장 사진 부탁해요', 'AI 꺼짐·실패 시 첫 줄이 제목');
  await c.close();
});
await step('V14 2·6번: AI 비서 대화가 남아 다시 열면 이어짐, 직원 고지 상시 / 3번 자료실 정리 상태 표시·다시 정리', async () => {
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: '이번 주 마감은 2건입니다.' }], stop_reason: 'end_turn' }] }) });
  await owner.goto(BASE + '/assistant');
  await owner.getByTestId('ai-notice').getByText(/관리자가 사용 내역을 볼 수 있습니다/).waitFor();
  await owner.waitForLoadState('networkidle'); // 화면 준비(하이드레이션) 전에 입력하면 글자가 사라진다
  await owner.getByLabel('AI 에게 요청').fill('이번 주 내 마감 업무 정리해줘');
  assert.equal(await owner.getByLabel('AI 에게 요청').inputValue(), '이번 주 내 마감 업무 정리해줘');
  await owner.getByLabel('AI 에게 요청').press('Enter');
  await owner.getByTestId('ai-chat').getByText('이번 주 마감은 2건입니다.').waitFor();
  await owner.waitForURL(/thread=/);
  await owner.reload();
  await owner.getByTestId('ai-chat').getByText('이번 주 마감은 2건입니다.').waitFor();
  await owner.getByTestId('ai-threads').getByText('이번 주 내 마감 업무 정리해줘').first().waitFor();
  await owner.getByTestId('ai-new-thread').click();
  await owner.getByText('이렇게 말해 보세요').waitFor();
  await owner.screenshot({ path: `${SHOTS}/65-ai-threads.png`, fullPage: true });
  // 자료실: AI 응답이 해석 안 되면 "정리 못 함 — 이유 · 다시 정리" → 다시 정리하면 "AI 정리됨"
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [{ content: [{ type: 'text', text: '모르겠어요' }], stop_reason: 'end_turn' }] }) });
  await owner.goto(BASE + '/library');
  await owner.getByTestId('library-file').setInputFiles([{ name: 'V14 단가표.txt', mimeType: 'text/plain', buffer: Buffer.from('PT 10회 550000') }]);
  const row = owner.getByTestId('library-list').locator('li').filter({ hasText: 'V14 단가표' });
  await row.getByTestId('organize-failed').waitFor();
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ folder: '영업/단가', tags: ['단가표', 'PT'], title: 'V14 단가표', summary: 'PT 단가', confidence: 0.9 }) }], stop_reason: 'end_turn' }] }) });
  await row.getByTestId('organize-retry').click();
  await owner.getByTestId('library-list').locator('li').filter({ hasText: 'V14 단가표' }).getByTestId('organize-done').getByText(/영업\/단가 ·.*#단가표/).waitFor();
});
await step('V14 15·18번 자료실 탐색기: 폴더 나무·경로, 파일을 폴더 위로 끌어 옮기기, 기밀 자물쇠·직원 화면에 없음, 기밀 제안 확인, 전체 정리 미리보기 → 적용', async () => {
  await ctx.owner.ok('POST', '/api/library/folders', { path: '보관/2026' });
  await owner.goto(BASE + '/library');
  const tree = owner.getByTestId('library-tree');
  await tree.getByRole('treeitem', { name: /보관/ }).waitFor();
  // 최상위의 파일 하나를 "보관" 폴더 위로 끌어 놓기
  const row = owner.getByTestId('library-list').locator('li', { hasText: '끌기 자료' });
  await row.dragTo(tree.getByRole('treeitem', { name: /보관/ }));
  await owner.getByText(/1개를 "보관"로 옮겼습니다/).waitFor();
  assert.equal((await sql`select folder from library_files where title = '끌기 자료'`)[0].folder, '보관');
  // 폴더로 들어가 경로 확인 → 하위 폴더
  await tree.getByRole('treeitem', { name: /보관/ }).click();
  await owner.getByTestId('library-path').getByText('보관').waitFor();
  await owner.getByTestId('library-subfolders').getByText('2026').waitFor();
  // 기밀: 급여 파일 → 기밀 제안 → 대표가 기밀로 → 자물쇠, 직원 화면에는 없음
  await owner.getByTestId('library-file').setInputFiles([{ name: 'E2E 급여 명세.txt', mimeType: 'text/plain', buffer: Buffer.from('급여 1') }]);
  const conf = owner.getByTestId('library-list').locator('li', { hasText: 'E2E 급여 명세' });
  await conf.getByTestId('sec-suggest').waitFor();
  await conf.getByTestId('sec-confirm').click();
  await conf.locator('[data-sec="confidential"]').waitFor();
  await owner.screenshot({ path: `${SHOTS}/90-library-explorer.png` });
  await staff.goto(BASE + '/library?folder=' + encodeURIComponent('보관'));
  await staff.getByTestId('library-path').getByText('보관').waitFor();
  await staff.getByText('끌기 자료').waitFor();
  assert.equal(await staff.getByText('E2E 급여 명세').count(), 0, '직원 화면에는 기밀 파일 없음');
  await staff.screenshot({ path: `${SHOTS}/91-library-mobile.png` });
  // 관리자 전체 정리: 미리보기 → 적용
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true }) });
  await sql`update library_files set organize_status = null, organized_by = null, organize_preview = null where title = '끌기 자료'`;
  await owner.getByTestId('library-organize-all').click();
  const pv = owner.getByTestId('organize-preview');
  await pv.getByText(/끌기 자료/).first().waitFor();
  await owner.getByTestId('organize-apply').click();
  await owner.getByText(/개 적용했습니다/).waitFor();
});
await step('V14 19번·R-15·R-16: 업무 상세 머리 요약·D-day·다음 행동·진행률·활동 타임라인·항목 담당 / 메신저 바로가기 패널 바로 답장 / 휴대폰 하단 댓글줄', async () => {
  const tk = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V19 상세 개선', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: addDays(today, 2), priority: 'high', approvalRequired: false })).id;
  await ctx.owner.ok('POST', `/api/tasks/${tk}/checklist`, { text: '자료 모으기', assigneeId: ctx.managerA.id });
  await ctx.owner.ok('POST', `/api/tasks/${tk}/comments`, { body: '시작합니다' });
  await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.ownerId}`, { titleShort: 'CEO' }); // V14 24번 직책 약칭
  await owner.goto(`${BASE}/tasks/${tk}`);
  await owner.locator('[data-testid="avatar-badge"][title$="· CEO"]').first().waitFor();
  const sum = owner.getByTestId('task-summary');
  await sum.getByTestId('dday').getByText('D-2').waitFor();
  await owner.getByTestId('task-progress').getByText('0%').waitFor();
  await owner.getByTestId('next-action').waitFor();
  await owner.getByTestId('comments').getByText('시작합니다').waitFor();
  assert.equal(await owner.getByRole('tab', { name: '활동' }).count(), 0, 'V14 23번: 활동 탭 없음 — 댓글(기본)·변경 이력');
  assert.equal(await owner.getByRole('tab', { name: /댓글/ }).getAttribute('aria-selected'), 'true');
  await owner.getByRole('tab', { name: '변경 이력' }).click();
  await owner.getByTestId('history').locator('li').first().waitFor();
  await owner.getByRole('tab', { name: /댓글/ }).click();
  assert.equal(await owner.getByTestId('more-fields').count(), 0, '필드 더보기 없음');
  await owner.getByLabel('자료 모으기 담당').waitFor();
  await owner.screenshot({ path: `${SHOTS}/92-task-detail-v19.png`, fullPage: true });
  await owner.getByTestId('next-action').click();
  await owner.getByText('완료 처리했습니다').first().waitFor();
  // 메신저 바로가기
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('msg-dock-open').click();
  const dock = owner.getByTestId('msg-dock');
  const dockBox = await dock.boundingBox();
  assert.ok(Math.abs(dockBox.width - 380) <= 2 && Math.abs(dockBox.height - 560) <= 2, `메신저 패널 380×560 (${dockBox.width}×${dockBox.height})`);
  await dock.getByTestId('chat-new').waitFor(); // V14 25번: 패널에도 ＋ 새 대화
  await dock.getByTestId('chat-rooms').locator('li button[data-room]').first().click();
  await dock.getByTestId('chat-input').fill('바로 답장 E2E');
  await dock.getByTestId('chat-input').press('Enter');
  await dock.getByTestId('chat-messages').getByText('바로 답장 E2E').waitFor();
  // 답장 인용 · 반응 (hover 메뉴)
  const mine = dock.getByTestId('chat-message').filter({ hasText: '바로 답장 E2E' }).last();
  await mine.hover();
  await mine.getByTestId('msg-reply').click();
  await dock.getByTestId('chat-replying').waitFor();
  await dock.getByTestId('chat-input').fill('인용 답장');
  await dock.getByTestId('chat-input').press('Enter');
  await dock.getByTestId('chat-reply-quote').filter({ hasText: '바로 답장 E2E' }).first().waitFor();
  await mine.hover();
  await mine.getByRole('button', { name: '👍 반응' }).first().click();
  await mine.getByTestId('chat-reactions').getByText('👍 1').waitFor();
  await owner.screenshot({ path: `${SHOTS}/93-messenger-dock.png` });
  await owner.getByRole('dialog', { name: '메신저' }).getByLabel('닫기').click();
  // 휴대폰: 댓글 입력줄이 화면 아래 고정
  const st = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V19 휴대폰', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  await staff.goto(`${BASE}/tasks/${st}`);
  const form = staff.getByTestId('comment-form');
  await form.waitFor();
  // 화면 폭 판정 뒤 아래로 옮겨 붙는다 — 고정될 때까지 기다림
  await staff.waitForFunction(() => { const r = document.querySelector('[data-testid="comment-form"]')?.getBoundingClientRect(); return !!r && r.bottom <= innerHeight && r.bottom > innerHeight - 140; }, null, { timeout: 5000 });
  await form.getByLabel('사진 찍기').waitFor();
  const bar = await form.boundingBox();
  assert.ok(bar.height <= 60, `휴대폰 댓글줄은 한 줄 (높이 ${bar.height})`);
  assert.equal(await form.evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(255, 255, 255)', '불투명 배경');
  // V14 30번: 업무 상세에서는 하단 탭·+ 버튼을 숨기고 입력줄이 맨 아래
  assert.equal(await staff.getByTestId('fab').isVisible(), false, '업무 상세에서 + 버튼 숨김');
  assert.ok(Math.abs((await form.boundingBox()).y + (await form.boundingBox()).height - (staff.viewportSize().height)) <= 2, '입력줄이 화면 맨 아래');
  await staff.screenshot({ path: `${SHOTS}/94-mobile-comment-bar.png` });
  const vp0 = staff.viewportSize();
  for (const w of [360, 390]) { await staff.setViewportSize({ width: w, height: 780 }); await staff.waitForTimeout(300); await staff.screenshot({ path: `${SHOTS}/94-mobile-comment-bar-${w}.png` }); }
  await staff.setViewportSize(vp0);
  await staff.goto(`${BASE}/tasks`);
  await staff.getByTestId('fab').waitFor(); // 상세를 벗어나면 하단 탭 다시 보임
});
await step('V14 11·8번: 모든 화면 AI 비서(✨ 패널·화면별 추천 질문) / 사용자 관리 "팀" 탭 → 팀 만들기 → 팀 업무 등록 → 팀 보드·업무 칩', async () => {
  await owner.goto(BASE + '/calendar');
  await owner.getByTestId('ai-dock-open').click();
  await owner.getByTestId('ai-dock').getByText('이 날 일정과 마감 업무 정리해줘').waitFor();
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: '오늘은 일정 2건입니다.' }], stop_reason: 'end_turn' }] }) });
  await owner.getByTestId('ai-dock-suggest').first().click();
  await owner.getByTestId('ai-dock-chat').getByText('오늘은 일정 2건입니다.').waitFor();
  await owner.screenshot({ path: `${SHOTS}/66-ai-dock.png` });
  // V14 26번: 패널 안 대화 목록(이 화면 관련 먼저) · 새 대화 · 이어서 대화
  await owner.getByTestId('ai-dock-new').click();
  assert.equal(await owner.getByTestId('ai-dock-chat').getByText('오늘은 일정 2건입니다.').count(), 0, '새 대화는 비어 있음');
  await owner.getByTestId('ai-dock-list-open').click();
  await owner.getByTestId('ai-dock-related').getByTestId('ai-dock-thread').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/66b-ai-dock-threads.png` });
  await owner.getByTestId('ai-dock-related').getByTestId('ai-dock-thread').first().click();
  await owner.getByTestId('ai-dock-chat').getByText('오늘은 일정 2건입니다.').waitFor();
  await owner.getByTestId('ai-dock').getByRole('button', { name: '닫기' }).click();
  // 팀
  await owner.goto(BASE + '/admin/users');
  await owner.getByTestId('tab-teams').click();
  await owner.getByTestId('team-new').click();
  await owner.getByLabel('팀 이름').fill('운영팀 E2E');
  await owner.getByLabel('김대표 팀원').check();
  await owner.getByLabel('최매니저 팀원').check();
  await owner.getByTestId('team-save').click();
  await owner.getByTestId('team-card').filter({ hasText: '운영팀 E2E' }).waitFor();
  const [tm] = await sql`select id from teams where name = '운영팀 E2E'`;
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '팀 보드 시험 업무', orgUnitId: ctx.siteA, teamId: tm.id, teamMode: 'lead', assigneeId: null })).id;
  await owner.goto(`${BASE}/teams/${tm.id}`);
  await owner.getByTestId('team-board').getByText('팀 보드 시험 업무').waitFor();
  await owner.screenshot({ path: `${SHOTS}/67-team-board.png`, fullPage: true });
  await owner.goto(`${BASE}/tasks?teamId=${tm.id}`);
  await owner.getByTestId('team-chip').first().getByText('운영팀 E2E').waitFor();
  assert.ok(t);
});
await step('V14 12·13번: 업무 여러 개 선택(Shift 범위) → 마감 일괄 변경 → 되돌리기 / 주간 캘린더 시간 있는 업무는 1시간 칸 높이', async () => {
  const base = (await ctx.owner.ok('POST', '/api/tasks', { title: '다중선택 가', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  for (const n of ['나', '다']) await ctx.owner.ok('POST', '/api/tasks', { title: `다중선택 ${n}`, orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
  await owner.goto(BASE + '/tasks?group=none&q=' + encodeURIComponent('다중선택'));
  await owner.getByText('다중선택 다').first().waitFor();
  await owner.getByTestId('select-mode').click();
  const rows = owner.locator('[data-row]').filter({ hasText: '다중선택' });
  await rows.first().getByTestId('row-select').click();
  await rows.nth(2).getByTestId('row-select').click({ modifiers: ['Shift'] });
  await owner.getByTestId('bulk-count').getByText('3건 선택').waitFor();
  const due = addDays(today, 12);
  await owner.getByLabel('마감 바꾸기').fill(due);
  await owner.getByText(/3건 마감 변경/).waitFor();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${base}`)).task.due_date, due);
  await owner.getByRole('button', { name: '되돌리기' }).first().click();
  await owner.getByText('되돌렸습니다').waitFor();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${base}`)).task.due_date, null);
  await owner.getByTestId('select-mode').click();
  // 주간 캘린더: 마감 15:00 업무 → 14~15시 한 칸 높이
  await ctx.owner.ok('POST', '/api/tasks', { title: '주간 블록 높이 시험', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: today, dueTime: '15:00', approvalRequired: false });
  await owner.goto(BASE + '/calendar');
  const blk = owner.locator('.fc-timegrid-event.task-item', { hasText: '주간 블록 높이 시험' }).first();
  await blk.waitFor();
  const slot = await owner.locator('.fc-timegrid-slot').first().boundingBox();
  const bb = await blk.boundingBox();
  assert.ok(bb.height >= slot.height * 0.9, `블록 높이 ${bb.height} ≥ 한 칸 ${slot.height}`);
  await blk.getByText('15:00 마감').waitFor();
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
  await p2.getByLabel('이메일', { exact: true }).waitFor();
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
