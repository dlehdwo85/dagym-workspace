// 실제 브라우저(Chromium) 사용자 시나리오 검증. 화면 증거를 docs/screens/ 에 저장한다.
// 실행: node tests/e2e/run.mjs   (사전: npm run build, PostgreSQL 실행)
import { chromium, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { bootstrap, resetDb, startServer, BASE, FAKE, Client, addDays, seoulToday, ensureTls, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';
import { v1440 } from './v14-40.step.mjs';
import { v1436 } from './v14-36.step.mjs';
import { v19a } from './v19a.step.mjs';
import { blocksStep } from './blocks.step.mjs';
import { v20 } from './v20.step.mjs';
import { v22 } from './v22.step.mjs';
import { v1441 } from './v1441.step.mjs';
import { v24 } from './v24.step.mjs';
import { v1442 } from './v1442.step.mjs';
import { v1443 } from './v1443.step.mjs';
import { chatRename } from './chatRename.step.mjs';
import { chatScroll } from './chatScroll.step.mjs';
import { dueExtend } from './dueExtend.step.mjs';
import { quickAi, homeTodayEvents } from './quickAi.step.mjs';
import { voiceMode } from './voiceMode.step.mjs';
import { verify1017 } from './verify1017.step.mjs';
import { docsCoedit } from './docs.step.mjs';
import { libraryOrganizeNotice } from './library-organize.step.mjs';
import { quotesFlow } from './quotes.step.mjs';
import { noticesFlow } from './notices.step.mjs';
import { attendanceFlow } from './attendance.step.mjs';
import { approvalsFlow } from './approvals.step.mjs';
import { contractsFlow } from './contracts.step.mjs';
import { awayFlow } from './away.step.mjs';
import { usageStatsFlow } from './usage-stats.step.mjs';
import { contactsFlow } from './contacts.step.mjs';
import { settlementFlow } from './settlement.step.mjs';
import { notifActionsFlow } from './notif-actions.step.mjs';
import { salesAppFlow } from './sales-app.step.mjs';
import { checklistAppFlow } from './checklist-app.step.mjs';
import { alarmFlow } from './alarm.step.mjs';
import { salesWorkFlow } from './sales-work.step.mjs';
import { calEditFlow } from './cal-edit.step.mjs';
import { teamChipsFlow } from './team-chips.step.mjs';
import { offboardFlow } from './offboard.step.mjs';
import { messengerV3 } from './messengerV3.step.mjs';
import { platformAdd } from './platformAdd.step.mjs';
import { orgTree } from './orgTree.step.mjs';
import { orgLevels } from './orgLevels.step.mjs';
import { chatKeyboard } from './chatKeyboard.step.mjs';
import { salesTodo } from './salesTodo.step.mjs';
import { salesLeads2 } from './salesLeads2.step.mjs';
import { landing } from './landing.step.mjs';
import { mktGoals } from './mktGoals.step.mjs';
import { mktQuality } from './mktQuality.step.mjs';
import { mktPreflight } from './mktPreflight.step.mjs';
import { chatBackPc, chatBackPcHard } from './chatBackPc.step.mjs';
import { bidGroups } from './bidGroups.step.mjs';
import { messengerV4 } from './messengerV4.step.mjs';
import { prespecLink } from './prespecLink.step.mjs';
import { hubArchive } from './hubArchive.step.mjs';
import { leadList197 } from './leadList197.step.mjs';
import { calSnap199 } from './calSnap199.step.mjs';
import { kaptWeekly200 } from './kaptWeekly200.step.mjs';
import { easyPay200 } from './easyPay200.step.mjs';
import { salesBrief202 } from './salesBrief202.step.mjs';
import { leadMove203 } from './leadMove203.step.mjs';
import { leadBulk204 } from './leadBulk204.step.mjs';
import { leadImport205 } from './leadImport205.step.mjs';
import { leadMerge206 } from './leadMerge206.step.mjs';
import { stageNames207 } from './stageNames207.step.mjs';
import { partner208 } from './partner208.step.mjs';
import { mktVideo209 } from './mktVideo209.step.mjs';
import { library210 } from './library210.step.mjs';
import { ceo211 } from './ceo211.step.mjs';
import { research212 } from './research212.step.mjs';
import { photos213 } from './photos213.step.mjs';
import { libraryDetail } from './libraryDetail.step.mjs';
import { messengerV5 } from './messengerV5.step.mjs';
import { attachEdit } from './attachEdit.step.mjs';
import { econtractPdf } from './econtractPdf.step.mjs';
import { payTest192 } from './payTest192.step.mjs';
import { platformTabs } from './platformTabs.step.mjs';
import { mktDraftQuality } from './mktDraftQuality.step.mjs';
import { mktPhotos } from './mktPhotos.step.mjs';
import { mktBlog } from './mktBlog.step.mjs';
import { revenueAuto } from './revenueAuto.step.mjs';
import { mktStudio } from './mktStudio.step.mjs';
import { mktOps } from './mktOps.step.mjs';
import { adAb } from './adAb.step.mjs';
import { adLocal } from './adLocal.step.mjs';
import { adSetup } from './adSetup.step.mjs';
import { adReadback } from './adReadback.step.mjs';
import { adLeads } from './adLeads.step.mjs';
import { leadAds } from './leadAds.step.mjs';
import { metaCapi } from './metaCapi.step.mjs';
import { mktConcepts } from './mktConcepts.step.mjs';
import { mktCarousel } from './mktCarousel.step.mjs';
import { mktAdRefs } from './mktAdRefs.step.mjs';
import { mktTeam } from './mktTeam.step.mjs';
import { designGuide187 } from './designGuide187.step.mjs';
import { photo188 } from './photo188.step.mjs';
import { photo189 } from './photo189.step.mjs';
import { kit190 } from './kit190.step.mjs';
import { mktPreview } from './mktPreview.step.mjs';
import { aiStream } from './aiStream.step.mjs';
import { mktVisual } from './mktVisual.step.mjs';
import { mktRevision } from './mktRevision.step.mjs';
import { mktTrash } from './mktTrash.step.mjs';
import { mktFeedKit } from './mktFeedKit.step.mjs';
import { collectorAlerts } from './collectorAlerts.step.mjs';
import { backClose } from './backClose.step.mjs';
import { supportPrograms } from './support.step.mjs';
import { mktVideo } from './mktVideo.step.mjs';
import { mktVideoReuse } from './mktVideoReuse.step.mjs';
import { coAssign } from './coAssign.step.mjs';
import { aiBudget } from './aiBudget.step.mjs';
import { listKeep } from './listKeep.step.mjs';
import { backKeep } from './backKeep.step.mjs';
import { attachLibrary } from './attachLibrary.step.mjs';
import { inbox } from './inbox.step.mjs';
import { cal1019 } from './cal1019.step.mjs';
import { cal480 } from './cal480.step.mjs';
import { welcome483 } from './welcome483.step.mjs';
import { permIntro528 } from './permIntro528.step.mjs';
import { permIntroIos199 } from './permIntroIos199.step.mjs';
import { inApp } from './inapp.step.mjs';
import { meeting } from './meeting.step.mjs';
import { spaces } from './spaces.step.mjs';
import { marketing } from './marketing.step.mjs';
import { v1444 } from './v1444.step.mjs';
import { v1445 } from './v1445.step.mjs';
import { v21 } from './v21.step.mjs';
import { v1447 } from './v1447.step.mjs';
import { v1448 } from './v1448.step.mjs';
import { panel1440, listNarrow } from './panel1440.step.mjs';
import { v283 } from './v283.step.mjs';
import { v30import, sheetPhone, notifRead, checkScroll, roleBadge, chatBubble } from './v30import.step.mjs';
import { metaAuto } from './metaAuto.step.mjs';
import { digestMail } from './digestMail.step.mjs';
import { app113 } from './app113.step.mjs';
import { cal592 } from './cal592.step.mjs';
import { customerSim } from './customerSim.step.mjs';
import { captureGuard } from './captureGuard.step.mjs';
import { moveIn186 } from './moveIn186.step.mjs';

const SHOTS = 'docs/screens';
mkdirSync(SHOTS, { recursive: true });
mkdirSync('test-results', { recursive: true });
const results = [];
async function step(name, fn) {
  if (process.env.E2E_ONLY && !process.env.E2E_ONLY.split('||').some((x) => name.includes(x))) return; // 개발 중 한 단계만(앞 단계에 기대지 않는 단계) — 'A||B' 면 여러 단계
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log('✔', name); }
  catch (e) {
    results.push({ name, ok: false, error: e.message.split('\n')[0] }); console.log('✖', name, '\n   ', e.message.split('\n').slice(0, 14).join('\n    '));
    if (process.env.E2E_STACK) console.log(String(e.stack ?? '').split('\n').slice(0, 12).join('\n')); // 개발용: 어느 줄에서 멈췄는지
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
  await dlg.getByTestId('invite-advanced').locator('summary').click(); // 재정비(10/20 15:15): 조직 체크는 '고급' 안
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
  await ctx.owner.ok('PATCH', `/api/tasks/${taskId}`, { approvalRequired: true, orgUnitId: ctx.siteA, requestedById: ctx.managerA.id }); // V12-11: 검토 승인 = 요청자
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
  await staff.getByTestId('next-action').getByText('검토 요청').click(); // 대표 피드백: 진행 단계 바의 [검토 요청]
  await staff.getByTestId('review-wait').waitFor(); // 담당자: 검토자 이름 안내 + [검토 요청 취소]
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

await step('V37 4 뒤로가기: 목록 → 업무 A(패널) → 하위 업무 B → 뒤로 = 목록 (기록 한 칸)', async () => {
  const a = await ctx.owner.ok('POST', '/api/tasks', { title: '뒤로가기 상위 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  const b = await ctx.owner.ok('POST', '/api/tasks', { title: '뒤로가기 하위 업무', assigneeId: ctx.ownerId, parentId: a.id, orgUnitId: ctx.siteA, approvalRequired: false });
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.getByRole('button', { name: '전체', exact: true }).click();
  await owner.getByLabel('업무 검색').fill('뒤로가기 상위');
  const link = owner.locator(`[data-task-id="${a.id}"] a[data-open-task]`).first();
  await link.waitFor();
  await link.click();
  const panel = owner.getByTestId('task-panel');
  await panel.waitFor();
  await panel.getByRole('link', { name: '뒤로가기 하위 업무' }).click();
  await owner.waitForURL((u) => u.pathname === `/tasks/${b.id}`);
  await owner.getByText('상위: 뒤로가기 상위 업무').first().waitFor();
  await owner.goBack();
  await owner.waitForURL((u) => u.pathname === '/tasks');
  assert.ok(owner.url().includes('mode=list'), '목록 주소로 돌아옴: ' + owner.url());
});

await step('V35 1 첨부 눈에 띄게: 목록 파란 📎 칩·"첨부 있음" 필터, 상세 머리 배지·파일 종류 색, 요약줄 "첨부 n" 누르면 첨부로', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '첨부 표시 시험 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  const up = await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'file', fileName: '견적서.pdf', mimeType: 'application/pdf', size: 12 });
  await fetch(BASE + up.upload.url, { method: 'PUT', headers: up.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
  await ctx.owner.ok('POST', `/api/attachments/${up.id}/complete`, {});
  await owner.goto(BASE + '/tasks?mode=list&hasAttach=1');
  await owner.getByRole('button', { name: '전체', exact: true }).click();
  const row = owner.locator(`[data-task-id="${t.id}"]`).first();
  await row.getByTestId('att-chip').waitFor();
  assert.equal((await row.getByTestId('att-chip').innerText()).trim(), '1');
  await row.locator('a[data-open-task]').first().click();
  const panel = owner.getByTestId('task-panel');
  await panel.getByTestId('att-count').waitFor();
  assert.equal(await panel.getByTestId('attach-section').locator('[data-file-kind="pdf"]').count() >= 1, true, 'PDF 빨강 아이콘');
  await panel.getByTestId('sum-attach').click();
  await panel.getByTestId('attachments').getByText('견적서.pdf').waitFor();
  await owner.keyboard.press('Escape');
});

await step('V36 4 이동 일정: 장소 있는 일정 = 📍·진한 테두리·장소·출발 권장 시각, 범례(일정·업무·이동)', async () => {
  const d = addDays(today, 5); // 다른 단계(V4: +3일 14시 빈 칸 탭)와 겹치지 않게
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '현장 방문 이동 시험', location: '음성 아이파크', start: `${d}T19:00:00+09:00`, end: `${d}T21:00:00+09:00` });
  await owner.goto(`${BASE}/calendar?date=${d}&view=timeGridWeek`);
  await owner.getByTestId('cal-legend').waitFor();
  const blk = owner.locator('[data-travel]', { hasText: '현장 방문 이동 시험' }).first();
  await blk.waitFor();
  await blk.getByText(/음성 아이파크 · 18:20 출발 권장/).waitFor();
  assert.equal(await owner.locator('.fc-event.is-travel', { hasText: '현장 방문 이동 시험' }).count() >= 1, true, '이동 일정 표시');
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
  if (new Date(d + 'T00:00:00Z').getUTCDay() === 0) await owner.locator('.fc-next-button').click(); // 일요일 시작 주: 내일이 일요일이면 다음 주
  const ev = owner.locator('.fc-timegrid-event', { hasText: '주간 운영 회의' }).first();
  await ev.waitFor();
  await ev.scrollIntoViewIfNeeded(); // 시간 보기 첫 위치 = 지금 - 1시간(대표 지적 10/19) → 10:00 일정이 칸 밖일 수 있음
  await ev.evaluate((el) => el.scrollIntoView({ block: 'center' })); // 자정 직후엔 첫 위치가 맨 아래라 일정이 스크롤 칸 가장자리에 걸려 아래로 끌면 칸 밖 → 가운데로
  await owner.waitForTimeout(200);
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
  await p.getByTestId('admin-no-access').getByText('관리 화면 권한이 없습니다').waitFor(); // V36 3 안내 화면
  await c.close();
});

await step('⑦ PC·모바일 데이터 일치 (모바일 수정 → PC 즉시 조회)', async () => {
  // V14 50: 일정 수정은 요청자·담당자만 — 직원이 담당인 업무로 시험
  // V32 4: 담당자는 마감을 미루면 연장 요청 → 여기서는 앞당기기(바로 반영)
  const t7 = (await ctx.owner.ok('POST', '/api/tasks', { title: '모바일 수정 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 8) })).id;
  await staff.goto(`${BASE}/tasks/${t7}`);
  const nd = addDays(today, 3);
  // V13 11번: 휴대폰은 "세부 정보" 요약 한 줄 → 눌러서 펼침
  await staff.getByTestId('details-toggle').waitFor();
  await staff.getByTestId('details-toggle').click();
  await staff.getByTestId('detail-due').getByTestId('due-picker').click(); // 마감일 칩 → 빠른 선택·달력
  await staff.getByLabel('마감일 날짜 선택').fill(nd);
  await staff.locator(`[data-testid="detail-due"][data-value="${nd}"]`).waitFor();
  await owner.goto(`${BASE}/tasks/${t7}`);
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
  // 대표 검수 10/20: 휴대폰은 '이번 주' 다음에 월 전체 격자(접지 않음)
  const wkBox = await staff.getByTestId('home-week').boundingBox(), moBox = await staff.getByTestId('home-month').boundingBox();
  assert.ok(moBox.y > wkBox.y, '휴대폰: 이번 주 일정이 먼저');
  assert.ok((await staff.getByTestId('home-month-grid').locator('[data-day]').count()) >= 28, '대표 검수 10/20: 휴대폰도 월 전체 격자(접지 않음)');
  assert.equal(await staff.getByTestId('home-month-grid').isVisible(), true, '월 격자 항상 펼침');
  await staff.screenshot({ path: `${SHOTS}/17-mobile-home.png` });
  await staff.goto(BASE + '/calendar');
  await staff.getByTestId('calendar').waitFor();
  await staff.waitForTimeout(500);
  await staff.screenshot({ path: `${SHOTS}/18-mobile-calendar.png` });
  // 대표 확정 10/22(#422): 하단 '더보기'·만들기 줄 없음 — 휴대폰 업무 등록은 업무 화면 [업무 추가](등록 시트)
  await staff.goto(BASE + '/tasks');
  await staff.getByTestId('add-task-top').click();
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
await step('목록: 상태 칩 [✓ 완료]로 완료 → 목록에서 빠지고 맨 아래 \'완료됨 1건\' → 되돌리기(#508) (V14 43번: 왼쪽 동그라미 없음), 필터 칩 표시·해제, 상단 검색(Ctrl K 버튼)', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '원형 체크 시험', orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.getByLabel('업무 검색').fill('원형 체크');
  const row = owner.locator(`[data-task-id="${id}"]`);
  assert.equal(await row.getByTestId('check-circle').count(), 0, '왼쪽 완료 동그라미 없음');
  await row.getByTestId('row-status-chip').filter({ visible: true }).click();
  await owner.getByTestId('status-quick').click();
  await owner.getByText('완료했습니다 — 완료됨으로 옮겼습니다').waitFor();
  await owner.waitForTimeout(500);
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'done');
  // #508: 목록에서 바로 빠지고 묶음 맨 아래 접힌 '완료됨 1건' — 안내 [완료됨 보기]가 펼치고, 되돌리기는 거기서
  await owner.locator(`[data-row="${id}"]`).waitFor({ state: 'detached' });
  // 168차 CI: 목록이 담당자별 묶음(기본)으로 열리면 '완료됨' 칸이 묶음마다 하나씩 → 안내 [완료됨 보기]로 연 뒤 이 글이 든 칸을 고른다
  await owner.getByTestId('done-fold').filter({ hasText: '완료됨 1건' }).first().waitFor();
  assert.equal(await owner.getByRole('button', { name: '되돌리기', exact: true }).count(), 0, '안내에는 되돌리기 없음');
  await owner.getByRole('button', { name: '완료됨 보기' }).click();
  const doneRow = owner.locator(`[data-done-id="${id}"]`).first(); await doneRow.waitFor();
  const fold = owner.getByTestId('done-fold').filter({ has: owner.locator(`[data-done-id="${id}"]`) }).first();
  assert.match(await fold.getByTestId('done-fold-toggle').innerText(), /완료됨 1건\s*\(오늘 1 · 이번 주 1\)/);
  assert.equal(await fold.getByTestId('done-fold-all').getAttribute('href'), '/tasks?view=done');
  await owner.screenshot({ path: `${SHOTS}/217-done-fold.png`, clip: await fold.boundingBox() });
  await doneRow.getByTestId('done-fold-undo').click();
  await owner.getByText('되돌렸습니다 — 진행 전').waitFor();
  await owner.locator(`[data-row="${id}"]`).waitFor();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'todo', '바로 전 상태(진행 전)로');
  await owner.reload(); await owner.getByLabel('업무 검색').fill('원형 체크'); await owner.locator(`[data-row="${id}"]`).waitFor(); // 새로 불러와도 목록에
  assert.equal(await owner.getByTestId('done-fold').count(), 0, '완료가 없으면 접힌 칸도 없음');
  // 다른 화면(API)에서 보류 → 완료: 새로 불러온 '완료됨'의 [되돌리기]는 서버 활동 기록의 완료 직전 상태(보류)로
  for (const st of ['on_hold', 'done']) await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { status: st, version: (await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.version });
  await owner.goto(BASE + '/tasks?mode=list&openDone=1'); await owner.getByLabel('업무 검색').fill('원형 체크'); // openDone=1 = '완료됨' 칸 펼친 채로(묶음 모드여도 이 글이 든 칸을 바로 찾음)
  await owner.locator(`[data-done-id="${id}"]`).first().getByTestId('done-fold-undo').click();
  await owner.getByText('되돌렸습니다 — 보류').waitFor();
  assert.equal((await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.status, 'on_hold', '새로 불러와도 완료 직전 상태(보류)로');
  await owner.evaluate(() => localStorage.removeItem('wos_done_fold')); // 펼침 기억은 이 단계 안에서만
  await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { status: 'todo', version: (await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.version });
  // #508 후속(로컬 10/23 운영): 반복 업무 완료 → 다음 회차 → '완료됨'에서 되돌리기 → 손대지 않은 다음 회차도 같이 휴지통(안내) · 안내는 4초 넘게 그대로(새로고침 신호에도 다시 그려지지 않음)
  const rid = (await ctx.owner.ok('POST', '/api/tasks', { title: '원형 체크 반복', orgUnitId: ctx.siteA, dueDate: addDays(today, 1), recurrenceRule: 'FREQ=WEEKLY', approvalRequired: false })).id;
  await owner.reload(); await owner.getByLabel('업무 검색').fill('원형 체크');
  await owner.locator(`[data-task-id="${rid}"]`).getByTestId('row-status-chip').filter({ visible: true }).click();
  await owner.getByTestId('status-quick').click();
  const doneToast = owner.getByTestId('toast').filter({ hasText: '완료했습니다 — 완료됨으로 옮겼습니다' }); await doneToast.waitFor();
  const th = await doneToast.elementHandle();
  await owner.evaluate(() => window.dispatchEvent(new Event('wos-refresh')));
  await owner.waitForTimeout(4500);
  assert.equal(await th.isVisible(), true, '4.5초 뒤·새로고침 신호 뒤에도 같은 안내');
  const [nx] = await sql`select id from tasks where recurrence_source_id = ${rid} and deleted_at is null`; assert.ok(nx, '다음 회차 생김');
  await owner.getByTestId('done-fold').filter({ hasText: '완료됨 1건' }).first().waitFor();
  const row3 = owner.locator(`[data-done-id="${rid}"]`).first();
  if (!(await row3.count())) await owner.getByTestId('done-fold').filter({ hasText: '완료됨 1건' }).first().getByTestId('done-fold-toggle').click(); // 주소 openDone=1 로 이미 펼쳐져 있으면 그대로(한 번 더 누르면 닫힘)
  await row3.getByTestId('done-fold-undo').click();
  await owner.getByText('완료 때 자동으로 만든 다음 업무 1건도 지웠습니다').waitFor();
  assert.ok((await sql`select deleted_at from tasks where id = ${nx.id}`)[0].deleted_at, '손대지 않은 다음 회차는 휴지통');
  await owner.evaluate(() => localStorage.removeItem('wos_done_fold'));
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
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${id}`, { approvalLineId: line.id }); // V14 50: 요청자가 결재선 지정
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
await step('모바일 밀기: 기본 꺼짐·짧은/세로 밀기 무시, 켜면 45% 이상 밀어 완료 → 맨 아래 "완료됨"에서 되돌리기(#508)', async () => {
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
  await row.waitFor({ state: 'detached' }); // #508 목록에서 바로 빠짐
  await staff.getByRole('button', { name: '완료됨 보기' }).click();
  const back = staff.getByTestId('done-fold').locator(`[data-done-id="${id}"]`);
  await back.getByTestId('done-fold-undo').click();
  await staff.waitForTimeout(600);
  assert.notEqual(await status(), 'done', '되돌리기');
  await row.waitFor();
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
  await slot.scrollIntoViewIfNeeded(); // 첫 위치 = 지금 - 1시간 → 15:00 칸이 위로 밀려 있을 수 있음
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
  await card.waitFor({ state: 'detached', timeout: 5000 }); // V14 46: 시간을 잡은 업무는 미배정 목록에서 바로 사라짐
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
  assert.deepEqual(items, ['설정·알림', '도움말·문의', '사용 안내 다시 보기', '단축키', '로그아웃']);
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
  // 대표 확정(10/19): '오늘'·'이달' 칸 없이 '이번 주 일정' 하나(오늘 칸 강조·업무 포함)
  for (const id of ['home-week', 'home-people', 'home-alerts', 'home-month']) await owner.getByTestId(id).waitFor(); // 로컬 10/19(대표 확정): 최근 활동 → 월 미니 캘린더
  for (const id of ['home-today', 'home-month-card']) assert.equal(await owner.getByTestId(id).count(), 0, `${id} 없음`);
  // 최근 활동은 알림 화면 '활동' 탭으로 (E2E_ONLY 로 이 단계만 돌릴 때는 앞 단계의 업무가 없어 하나 만들어 둔다)
  if (!(await sql`select 1 from tasks where title = '강남점 전단 배포' and deleted_at is null`).length) await ctx.owner.ok('POST', '/api/tasks', { title: '강남점 전단 배포', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false });
  await owner.goto(BASE + '/notifications');
  await owner.getByTestId('notif-activity').click();
  await owner.getByTestId('activity-list').getByText('강남점 전단 배포').first().waitFor();
  await owner.goto(BASE + '/');
  // 월 미니 캘린더: PC 는 오른쪽(이번 주 옆), 날짜를 누르면 그날 목록, 두 번 누르면 캘린더
  await owner.getByTestId('home-clock').waitFor(); // V30 ③ 출퇴근 카드가 뒤늦게 붙으면서 아래 칸이 밀리므로 다 그려진 뒤 잰다
  await owner.waitForLoadState('networkidle');
  const [wk, mo] = await Promise.all([owner.getByTestId('home-week').boundingBox(), owner.getByTestId('home-month').boundingBox()]);
  assert.ok(mo.x > wk.x + wk.width - 5 && Math.abs(mo.y - wk.y) < 40, `월 캘린더는 이번 주 오른쪽 (${JSON.stringify([wk, mo])})`);
  const cell = () => owner.getByTestId('home-month-grid').locator(`[data-day="${today}"]`); // 휴대폰용 접힌 주 줄(PC 숨김)에도 같은 날짜가 있어 월 격자로 한정
  await cell().click();
  await owner.getByTestId('home-month-list').waitFor();
  await cell().click();
  await owner.waitForURL(/\/calendar\?view=dayGridMonth&date=/);
  await owner.goto(BASE + '/');
  await owner.screenshot({ path: `${SHOTS}/59-home-dashboard.png`, fullPage: true });
});
await step('V14 35·V37 2·10/16 캘린더 빈 칸 = 일정만(업무 전환 없음), "할 일로도 만들기" = 누른 시각이 마감인 연결 업무 · 홈 미니 캘린더 그날 업무 + [＋업무][＋일정]', async () => {
  const d = addDays(today, 4);
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await owner.locator('.fc-toolbar-title').waitFor();
  await owner.waitForLoadState('networkidle');
  const lane = owner.locator('td.fc-timegrid-slot-lane[data-time="10:00:00"]').first();
  await lane.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const col = await owner.locator(`.fc-timegrid-col[data-date="${d}"]`).boundingBox();
  const slot = await lane.boundingBox();
  await owner.mouse.click(col.x + col.width / 2, slot.y + 4);
  // V37 2: 빈 칸 = 일정 등록이 먼저, [저장] 버튼 항상 보임, "할 일로도 만들기" 스위치
  const qc = owner.getByTestId('quick-create');
  await qc.waitFor();
  await qc.getByTestId('quick-save').waitFor();
  await qc.getByLabel('업무 리스트에도 추가').waitFor({ state: 'attached' });
  assert.equal(await qc.getByTestId('quick-switch-task').count(), 0, '캘린더에서는 일정만 — 업무 전환 버튼 없음');
  // 대표 실기기(10/16): 주는 일요일부터, 빠른 입력에 알림 고르기
  assert.ok(await owner.locator('.fc-col-header-cell').first().evaluate((el) => el.classList.contains('fc-day-sun')), '주 보기 첫 칸 = 일요일');
  await qc.getByLabel('빠른 입력 제목').fill('캘린더 빈칸 업무');
  await qc.getByTestId('quick-remind').selectOption('30');
  await qc.getByTestId('quick-also-task').check({ force: true });
  await qc.getByTestId('quick-save').click();
  await qc.waitFor({ state: 'detached' });
  const [t] = await sql`select assignee_id, to_char(due_date, 'YYYY-MM-DD') due, to_char(due_time, 'HH24:MI') tm from tasks where title = '캘린더 빈칸 업무' and deleted_at is null`;
  assert.deepEqual((await sql`select reminder_minutes from events where title = '캘린더 빈칸 업무' and deleted_at is null`)[0].reminder_minutes, [30], '고른 알림 30분 전');
  assert.equal(t.due, d); assert.equal(t.tm, '10:00');
  await owner.screenshot({ path: `${SHOTS}/v14-35-calendar-task.png` });
});
await step('#480 월 보기 빈 칸: 기본 종일 + [시간 지정] 시작·끝 시각(연결 업무 마감 시각 따라감) · [종일로] 되돌리기', () => cal480({ owner, sql, BASE, SHOTS, addDays, today }));
await step('#483 하루 첫 진입 환영 문구: 새 브라우저 로그인 → 인사 한 줄 0.8초(조작 안 막음) → 같은 날 다시 들어오면 없음 · 동작 줄이기면 움직임 없음', () => welcome483({ browser, BASE, SHOTS }));
await step('#528 앱 처음 시작 휴대폰 알림 맞추기(권한 안내, 웹 몫): 꺼진 줄 단추·이유 → 허용된 줄 체크 → [나중에] 같은 날 다시 없음 → 다 돼 있으면 안 뜸 (390 시연 상태)', () => permIntro528({ browser, desk, BASE, SHOTS }));
await step('결정 15-27 아이폰 휴대폰 알림 맞추기(웹 몫): 지금 앱 = 알림 허용 한 줄·거절했으면 [설정 열기] → 1.1.4 네이티브 = 집중 모드·잠금 화면 알람·홈 화면 위젯(단추 없이 안내) (390 시연 상태)', () => permIntroIos199({ browser, desk, BASE, SHOTS }));
await step('V14 36~39 캘린더: 업무 동그라미 없음·블록 12px 여러 줄·계단 겹침·휴대폰 3일·좌우 밀어 이동·뒤로가기는 상세만 닫고 날짜·보기·스크롤 유지', () => v1436({ browser, desk, owner, ctx, sql, BASE, SHOTS, addDays, today }));
await step('V19 부록 A: AI 비서 PC Enter 보내기·Shift+Enter 줄바꿈, 휴대폰 Enter 줄바꿈·자동 높이, [수정]·[다시 답하기]·[복사]·[멈춤], 패널 같은 동작 / 보기 칩 다시 누르면 해제', () => v19a({ browser, desk, owner, ctx, sql, BASE, FAKE, SHOTS }));
await step('캘린더: 완료한 업무의 시간 블록은 숨김(완료 보기 켜면 완료 모양), 삭제한 업무의 블록은 사라지고 휴지통 복원 시 다시 보임', () => blocksStep({ owner, ctx, BASE, SHOTS, addDays, today }));
await step('V20 업무 월별 보관·이월: 이월 표시·이월만 보기, 완료 = 이번 달만 펼침·지난달은 펼칠 때 불러오기·달 이동, 리포트 월별 기록', () => v20({ owner, ctx, sql, BASE, SHOTS, tick }));
await step('V22 AI 비서 문서 엔진: 회사 정보 화면, 파일 작업 카드(만드는 중 → 미리보기·쪽수) → 자료실에 저장 → 더 다듬기 입력 채움, 다시 열어도 카드 유지', () => v22({ owner, ctx, sql, BASE, FAKE, SHOTS }));
await step('V14 41 휴대폰 주·3일: 종일 칩 한 줄·블록 제목만 줄바꿈·머리글자 없음(일 보기는 있음)·칸 높이 40/48/64(#592)·오전/오후 축·색 버튼 머리줄', () => v1441({ browser, desk, ctx, BASE, SHOTS, addDays, today }));
await step('V24 음성 등록: AI 비서 화면·패널 마이크 → 실시간 글자 → 단어장 보정(최매니져→최매니저) → 입력창에 남김(바로 안 보냄), 도움말에 "말로 등록" 없음', () => v24({ browser, desk, BASE, sql }));
await step('V14 42 업무 보기 칩: 412px 에서 7개 모두 보임(4칸 2줄)·건수 = API·0건 숨김·사람 칩 둘째 줄·PC 한 줄', () => v1442({ browser, desk, ctx, BASE, SHOTS, addDays, today }));
await step('V14 43 업무 목록: 왼쪽 동그라미 없음·상태 칩 버튼(테두리·▾·32px)·메뉴 맨 위 완료 → 되돌리기·남의 업무 잠김·"확인 완료" 문구 없음', () => v1443({ browser, desk, ctx, BASE, SHOTS, sql }));
await step('메신저 대화방 이름 바꾸기: ✎ → 입력 → Enter = 머리줄·목록·상대에게 새 이름, Esc 취소, 1:1 은 버튼 없음', () => chatRename({ owner, ctx, BASE }));
await step('V32 4 마감 연장: 휴대폰 담당자 목록 마감 칩 → 연장 요청(사유 필수, 뒤 날짜는 요청 창) → PC 요청자 "연장 요청" 칩·행 표시 → 머리에서 승인 → 마감 변경·연장 1회', () => dueExtend({ staff, owner, ctx, sql, BASE }));
await step('V38 3 음성 모드(운전 중): 메시지방 새 메시지 읽어 주기·말로 보내기("보내" 확인·"취소")·AI 비서 말로 묻고 답 읽어 주기', () => voiceMode({ browser, desk, ctx, sql, BASE, FAKE }));
await step('로컬 검수 10/17: 홈 최근 활동 멘션 @이름 · 월 보기 요일 머리 · 휴대폰 일정 시트 닫기 버튼 화면 안 · 휴대폰 업무 둘째 줄 한 줄', () => verify1017({ owner, staff, ctx, sql, BASE }));
await step('로컬 10/19 회사 정보 AI 로 정리: 오른쪽 도우미·질문으로 시작 5문항·주의할 점 칸', async () => {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/company`);
  await owner.getByTestId('ai-helper').waitFor();
  await owner.getByTestId('ai-cautions').waitFor();
  // 대표 10/20 10:50: [초안 만들기]·[질문으로 시작]이 붙어 보임 → 간격(1366·390)
  for (const w of [1366, 390]) { await owner.setViewportSize({ width: w, height: 900 }); const a = await owner.getByTestId('ai-helper-run').boundingBox(), b = await owner.getByTestId('ai-helper-interview').boundingBox();
    assert.ok(b.x >= a.x + a.width + 8 || b.y >= a.y + a.height, `${w}: 두 버튼 사이 간격 (${JSON.stringify([a, b])})`); }
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.getByTestId('ai-helper-interview').click();
  await owner.getByTestId('ai-helper-questions').waitFor();
  assert.equal(await owner.getByTestId('ai-helper-answer').count(), 5);
  const h = await owner.getByTestId('ai-helper').boundingBox(), f = await owner.getByTestId('ai-business').boundingBox();
  assert.ok(h.x > f.x + f.width, 'PC: 도우미는 오른쪽');
});
await step('로컬 10/19 자동 로그인: 로그인 창 [로그인 유지] 기본 켬, 끄면 브라우저 세션 쿠키(만료 없음)·켜면 30일 쿠키', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await c.newPage();
  await p.goto(BASE + '/login');
  const box = p.getByTestId('login-remember');
  assert.equal(await box.isChecked(), true, '기본 켬');
  await box.uncheck();
  await p.getByLabel('이메일', { exact: true }).fill('ceo@dagym.test');
  await p.getByLabel('비밀번호').fill('owner-pass-1234');
  await p.getByRole('button', { name: '로그인' }).click();
  await p.waitForURL(BASE + '/');
  const ck = (await c.cookies()).find((x) => x.name === 'wos_session');
  assert.ok(ck && ck.expires === -1, `끄면 세션 쿠키(expires -1): ${ck?.expires}`);
  await c.close();
  const ck2 = (await desk.cookies()).find((x) => x.name === 'wos_session');
  assert.ok(ck2 && ck2.expires > Date.now() / 1000 + 29 * 86400, '기본 로그인은 30일 쿠키');
});
await step('스토어 심사 10/19: 앱 안에서는 요금제·결제·가격 숨김(사용량만), 웹은 그대로', () => inApp({ browser, BASE, devices, owner }));
await step('대표 지적 10/19 캘린더: 겹친 일정 나란히·누른 일정 미리보기, 자동 저장 뒤 [완료] 409 없음, 일정 색·캘린더 색 점, 월 보기 +N개', () => cal1019({ owner, ctx, sql, BASE }));
await step('V37 8 미팅 일정: 업무 상세 [미팅 일정 만들기] → 목록 📍장소·시간 칩 · 등록 창 "방문" → 미팅 일정 제안 → 연결 일정', () => meeting({ owner, ctx, sql, BASE }));
await step('V41 단계 1 공간: 영업 켜기 → PC 공간 카드로 영업(파란 강조)·Ctrl+1/2·뒤로가기 → 휴대폰 프로필 시트 전환 → 미배정 직원 카드 없음·주소 404', () => spaces({ browser, desk, owner, staff, BASE, sql, SHOTS }));
await step('V41 4-2 마케팅: 개요 카드 → 새 콘텐츠 → 시안 없으면 승인 거절 → 수정 요청(이유) → 캘린더 칩 → 전화 문의 → 영업 리드(업무)', () => marketing({ owner, BASE, sql, SHOTS }));
await step('홈 오늘의 일정: 오늘 일정도 함께(시간순)', () => homeTodayEvents({ owner, ctx, BASE }));
await step('업무 등록 창 AI 비서: 편하게 적고 [AI로 채우기] → 업무명·담당·마감·설명·체크리스트 채움 → 저장', () => quickAi({ owner, ctx, sql, BASE, FAKE }));
await step('V38 1 메시지방 흔들림: 휴대폰 위로 올려 보는 중 새 메시지 → 자리 유지·"새 메시지 n ↓", 맨 아래면 따라감, 화면 전체는 그대로', () => chatScroll({ browser, desk, ctx, BASE }));
await step('대표 16:30 핫픽스 휴대폰 대화방 키보드: 대화방 열리면 하단 탭 숨김, 뷰포트 500 에서도 입력창 보임·보내기, 목록으로 돌아가면 탭 복귀', () => chatKeyboard({ browser, desk, ctx, BASE, SHOTS }));
await step('V14 44 PC 업무 줄 선택 체크박스: 왼쪽 고정 홈·세로 가운데·올려도 제목 그대로·간격 좁게', () => v1444({ owner, ctx, BASE, SHOTS }));
await step('V14 45 업무 추가 줄 마감 선택 창: 칩 바로 아래/위·칩 왼쪽 맞춤·화면 안·시각 버튼 닿음', () => v1445({ owner, BASE, SHOTS }));
await step('V14 47 홈 이번 주: 같은 날·같은 제목 업무·일정 한 줄(업무 1 · 일정 1, 시각은 일정)', () => v1447({ owner, BASE, SHOTS }));
await step('V14 48 PC 업무 목록 열 제목: 맨 위 줄 고정(sticky)·묶음마다 작은 열 제목', () => v1448({ owner, BASE, SHOTS }));
await step('검수 81: PC 1440 패널을 열어도 목록 업무 이름이 눌리지 않음(덮개, 1280·1440·1720)', () => panel1440({ owner, BASE, SHOTS }));
await step('V28-3 플랫폼 회사 관리: 목록 → 상세(사용자·한도)', () => v283({ owner, BASE, SHOTS }));
await step('V21 메일 계정·명함 설정 + 업무 메일 시안(보내는 주소·회사 명함·미리보기)', () => v21({ owner, BASE, SHOTS, sql }));
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
await step('#161 매출 자료 자동 분석: 확인 대기 카드(지금 값과 다른 칸 강조) → 고쳐서 확정 → 분석 대기 → [지금 분석] → 보고서(동향·전망 추정·대안·확인 필요·근거 파일) · 휴대폰 넘침 없음', () => revenueAuto({ owner, ctx, BASE, SHOTS, sql }));
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
await step('V3 업무 0건인 본사 사람도 묶음·그 사람에게 추가, 행에서 요청자·우선순위 변경, 손잡이로 끌어 순서 → 새로고침해도 유지, 정렬·내가 요청한 업무', async () => {
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
  assert.equal(t.assignee_id, minsu); assert.equal(t.requested_by, ctx.ownerId, '요청자 = 나(만든 사람)');
  // 행에서 요청자·우선순위
  const row = owner.locator(`[data-row="${t.id}"]`);
  // V14 50: 요청자를 넘기면 나는 더 고칠 수 없으므로 우선순위 먼저
  await row.getByTestId('priority-picker').click();
  await owner.getByRole('dialog').getByRole('button', { name: /긴급/ }).click();
  await owner.waitForTimeout(500);
  await row.getByTestId('requester-picker').click();
  await owner.getByRole('dialog').getByRole('button', { name: /^최매니저/ }).click();
  await owner.waitForTimeout(800);
  const [u] = await sql`select requested_by, priority from tasks where id = ${t.id}`;
  assert.equal(u.requested_by, ctx.managerA.id); assert.equal(u.priority, 'urgent');
  // 손잡이로 끌어 순서 (내 묶음 안: 마지막 행을 맨 위로)
  const mine = groups.locator(`[data-group="${ctx.ownerId}"]`);
  const handles = mine.getByTestId('drag-handle');
  const n = await handles.count();
  assert.ok(n >= 2, '내 묶음에 업무 2건 이상');
  // 묶음이 길면 마지막 행 손잡이가 화면 밖 → 둘째 행을 맨 위로(새로고침해도 유지되는지가 핵심)
  const lastTitle = (await mine.locator('[data-row] a[data-open-task]').nth(1).textContent()).trim();
  // 내 묶음 머리가 화면 위쪽(고정 머리·열 제목 아래)에 오게 — 첫 손잡이가 화면 밖이면 끌 곳이 없다
  await mine.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -120); });
  await owner.waitForTimeout(200);
  const from = await handles.nth(1).boundingBox(), to = await handles.nth(0).boundingBox();
  await owner.mouse.move(from.x + 8, from.y + 8); await owner.mouse.down();
  for (let i = 1; i <= 12; i++) await owner.mouse.move(from.x + 8, from.y + 8 + ((to.y - from.y - 6) * i) / 12);
  await owner.mouse.up();
  await owner.waitForTimeout(1000);
  await owner.waitForLoadState('networkidle'); // 순서 저장이 끝난 뒤 새로고침
  await owner.reload();
  await mine.locator('[data-row] a[data-open-task]').first().waitFor();
  assert.equal((await mine.locator('[data-row] a[data-open-task]').first().textContent()).trim(), lastTitle, '새로고침 후에도 끌어 놓은 순서');
  await owner.screenshot({ path: `${SHOTS}/61-tasks-v3.png` });
  // 정렬·열 머리·내가 요청한 업무
  await owner.getByTestId('sort-by').selectOption('due');
  assert.equal(await mine.getByTestId('drag-handle').count(), 0, '직접 순서가 아니면 손잡이 없음');
  await owner.getByTestId('group-col-header').first().getByRole('button', { name: /우선순위/ }).click();
  assert.equal(await owner.getByTestId('sort-by').inputValue(), 'priority');
  await owner.getByTestId('sort-by').selectOption('manual');
  await owner.getByRole('button', { name: '내가 요청한 업무' }).click();
  await owner.waitForTimeout(600);
  assert.equal(await groups.getByText('신규 회원 이벤트 기획').count(), 0, '요청자를 최매니저로 바꿨으니 빠짐');
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
  assert.equal(await owner.getByTestId('users').getByText('심사용').count(), 0, '심사용 계정은 접혀 있음');
  await owner.getByTestId('demo-toggle').click();
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
  await owner.getByTestId('calendar-list').getByLabel('업무 숨기기').waitFor();
  await owner.waitForLoadState('networkidle'); // 일정을 불러온 뒤(이른 시각 일정이 있으면 시간 칸이 늘어남) 위치 측정
  await owner.locator('td.fc-timegrid-slot-lane[data-time="11:00:00"]').first().scrollIntoViewIfNeeded(); // 첫 위치 = 지금 - 1시간(10/19)
  // #148: 오늘이 목요일이면 d(오늘+2) 가 토요일 = 맨 오른쪽 열 → 가운데가 메신저 독 버튼(오른쪽 아래) 위에 와서 클릭이 독을 열었음. 클릭 전에 독 버튼을 숨김
  await owner.evaluate(() => { const b = document.querySelector('[data-testid="msg-dock-open"]'); if (b) b.style.visibility = 'hidden'; });
  const col = await owner.locator(`.fc-timegrid-col[data-date="${d}"]`).boundingBox();
  const slot = await owner.locator('td.fc-timegrid-slot-lane[data-time="11:00:00"]').first().boundingBox();
  await owner.mouse.click(col.x + col.width / 2, slot.y + 4);
  const q = owner.getByTestId('quick-create');
  assert.equal(await q.getByRole('tab').count(), 0, '탭 없이 일정 양식 하나(V6)');
  await q.getByLabel('빠른 입력 제목').fill('계약서 최종본 확인');
  await q.getByTestId('quick-also-task').check({ force: true }); // 업무에도 추가 스위치 → 담당·요청·우선 칸
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
  // V37 2: [업무 숨기기] → 업무 칩이 사라지고 일정 블록은 그대로, 다시 끄면 보임
  await owner.getByTestId('cal-hide-tasks').check();
  await item.waitFor({ state: 'detached' });
  assert.ok(await owner.locator('[data-ev-block]', { hasText: '계약서 최종본 확인' }).count() > 0, '일정은 그대로');
  await owner.getByTestId('cal-hide-tasks').uncheck();
  await item.waitFor();
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
  await owner.locator('div.fixed.inset-0.z-\\[70\\]').click({ position: { x: 4, y: 4 } }); // 선택 창 닫기
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
  // 대표 실기기(10/16): 휴대폰 업무 제목이 절반 폭에서 줄바꿈 → 제목은 줄 폭 거의 전부, 마감·담당은 아래 줄
  const tw = await row.evaluate((el) => { const t = el.querySelector('[data-testid="row-title"]'); return [t.getBoundingClientRect().width, el.getBoundingClientRect().width]; });
  assert.ok(tw[0] >= tw[1] * 0.8, `제목 폭 ${tw[0]} / 줄 폭 ${tw[1]}`);
  const id = await row.getAttribute('data-row');
  // 검수(10/16): 휴대폰 둘째 줄은 칩(상태·마감·담당 — 누르는 범위 넓음)이라 빈 곳 = 한 줄 제목 오른쪽 끝 여백
  const tb = await row.getByTestId('row-title').boundingBox();
  await m.touchscreen.tap(tb.x + tb.width - 6, tb.y + tb.height / 2);
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
  // 휴대폰 줄이 두 줄이라 묶음이 화면 아래로 밀릴 수 있음 → 사람처럼 그 묶음까지 내려서 끈다
  await g.locator('[data-sortable-row]').nth(0).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await m.waitForTimeout(200);
  let a = await g.locator('[data-sortable-row]').nth(0).boundingBox();
  let b = await g.locator('[data-sortable-row]').nth(1).boundingBox();
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
  // 시트를 닫으면 목록을 다시 불러옴 → 다 불러온 뒤 위치를 재야 다른 줄을 누르지 않음
  await m.waitForLoadState('networkidle');
  await g.locator('[data-sortable-row]').nth(0).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await m.waitForTimeout(300);
  a = await g.locator('[data-sortable-row]').nth(0).boundingBox(); b = await g.locator('[data-sortable-row]').nth(1).boundingBox();
  const pt = (x, y) => ({ touchPoints: [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
  // 휴대폰 줄은 제목(윗줄)·마감·담당(아랫줄) — 사람이 누르는 제목을 꾹 누른다(마감 칩은 누르면 날짜 선택)
  const tb = await g.locator('[data-sortable-row]').nth(1).getByTestId('row-title').boundingBox();
  const x = tb.x + Math.min(tb.width * 0.5, 120), y0 = tb.y + tb.height / 2;
  assert.equal(await m.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-sortable-row]')?.getAttribute('data-sortable-row'), [x, y0]), ids[1], '두 번째 줄을 누름');
  await m.evaluate(() => { window.__ev = []; for (const t of ['resize', 'visibilitychange', 'touchcancel', 'popstate']) window.addEventListener(t, () => window.__ev.push(t), true); });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', ...pt(x, y0) });
  await m.waitForTimeout(600); // 꾹 누르기
  const diag = [await m.locator('[data-dragging]').count()];
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', ...pt(x, y0 - ((y0 - (a.y + 4)) * i) / 8) }); await m.waitForTimeout(40); diag.push(await m.locator('[data-dragging]').count()); }
  diag.push(await m.evaluate(() => window.__ev.join(',')), await m.evaluate(() => location.href));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await m.waitForTimeout(800);
  assert.equal(await m.getByTestId('task-panel').count(), 0, '꾹 눌러 끈 뒤 상세가 열리지 않음');
  assert.equal(menus, 0, '길게 누르기 메뉴 없음');
  const after = await sql`select id from tasks where id = any(${ids.slice(0, 2)}::uuid[]) order by sort_order`;
  assert.deepEqual(after.map((r) => r.id), [ids[1], ids[0]], `두 번째 업무가 맨 위로 (끌기 상태 ${JSON.stringify(diag)})`);
  await mc.close();
});

await step('V14 40번 휴대폰: 꾹 눌러 선택 → 완료 → 다시 선택 → 삭제 뒤에도 다음 터치로 상세가 열림(선택 모드·끌기 상태 정리, 안내가 막대를 덮지 않음)', () => v1440({ browser, desk, ctx, sql, BASE, SHOTS }));
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
  await m.evaluate(() => { localStorage.setItem('wos_cal_allday', '1'); localStorage.setItem('wos_cal_allday_m', '1'); }); // 10/22 종일 칸 기본 숨김 — 아래는 켠 상태의 마감 칩 확인(휴대폰 키 _m 도, 176차)
  await m.goto(`${BASE}/calendar?date=${t.d}`);
  await m.getByTestId('cal-mobile-head').waitFor();
  assert.equal(await m.locator('[data-day-head]').count(), 3, '휴대폰 기본 = 3일 보기(V14 38번), 요일+날짜 머리');
  const dh = m.locator(`[data-day-head="${t.d}"]`);
  assert.equal((await dh.innerText()).replace(/\s+/g, ''), `${'일월화수목금토'[new Date(t.d + 'T00:00:00Z').getUTCDay()]}${Number(t.d.slice(8))}`, '날짜 머리 = 그 칸의 요일·날짜(하루 밀림 없음)');
  const block = m.locator('[data-ev-block]', { hasText: 'V5 홈에서 만든' }).first();
  await block.waitFor();
  assert.ok(await m.locator('[data-ev-block][data-linked-task]', { hasText: 'V5 홈에서 만든' }).count(), '연결 표시(V14 37번: ✓·동그라미 대신 왼쪽 선)');
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
  // 대표 확정 10/22(#422): 하단 탭 = 홈·업무·캘린더·메시지·결재, '더보기' 없음 — 프로필 버튼 시트에 '만들기' 줄 없음
  assert.equal(await m.getByTestId('tab-more').count(), 0, '더보기 탭 없음');
  await m.getByTestId('profile-menu').click();
  assert.equal(await m.getByTestId('more-sheet').getByRole('menuitem', { name: '업무 등록' }).count(), 0, '만들기 줄 없음');
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
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: /담당자 여러 명/ }).click();
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: '이직원' }).click();
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: '최매니저' }).click();
  await dlg.getByTestId('multi-each').check(); // #475 뒤: 여러 명 기본 = 함께 담당 → '각자 1건씩'은 고를 때만
  await dlg.getByRole('button', { name: '3명에게 각각 만들기' }).click();
  await owner.getByText('3명에게 각각 만들었습니다').waitFor();
  const batch = await sql`select id, batch_id from tasks where title = 'V6 다같이 점검' and deleted_at is null`;
  assert.equal(batch.length, 3); assert.equal(new Set(batch.map((b) => b.batch_id)).size, 1);
  await owner.goto(BASE + '/tasks');
  await owner.locator('[data-batch]').first().waitFor();
  // #508(대표 10/23): 완료하면 목록에서 빠지고 그 묶음 맨 아래 접힌 '완료됨'으로(예전 V6 16번 '제자리 취소선' 대신)
  const row = owner.locator('[data-row]', { hasText: 'V6 다같이 점검' }).first();
  const rid = await row.getAttribute('data-row');
  await row.getByTestId('row-status-chip').filter({ visible: true }).click(); await owner.getByTestId('status-quick').click(); // V14 43번: 상태 칩 메뉴 맨 위 완료
  await owner.locator(`[data-row="${rid}"]`).waitFor({ state: 'detached' });
  await owner.getByRole('button', { name: '완료됨 보기' }).click();
  await owner.getByTestId('done-fold').locator(`[data-done-id="${rid}"]`).waitFor();
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
  // 오늘 요일이 기본 선택이라(월요일에 돌리면 '월'이 이미 켜져 있음) 켜져 있지 않을 때만 누름
  for (const day of ['월', '금']) { const btn = cr.getByRole('group', { name: '반복 요일' }).getByRole('button', { name: day }); if ((await btn.getAttribute('aria-pressed')) !== 'true') await btn.click(); }
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
    const wb = await m.getByTestId('home-week').boundingBox();
    assert.ok(wb.y < h, `첫 화면에 이번 주 일정이 보임 (${Math.round(wb.y)}, 화면 ${h})`);
    assert.equal(await m.getByTestId('home-today').count(), 0, '오늘 칸은 이번 주 안(강조)');
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
  // 금요일 16시가 지나면 예약 작업이 초안을 먼저 만들어 둠 → 그때는 버튼 없이 바로 초안
  await owner.getByTestId('my-report').waitFor();
  if (await owner.getByTestId('report-draft').count()) await owner.getByTestId('report-draft').click();
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
  // #412 세 AI 한도 한 표(업무·영업·마케팅) + 요금제별 기준표
  await owner.getByTestId('ai-limits').waitFor();
  assert.equal(await owner.getByTestId('ai-limits').locator('tbody tr').count(), 3);
  assert.match(await owner.getByTestId('ai-limit-work').innerText(), /AI 비서[\s\S]*질문·답변/);
  assert.match(await owner.getByTestId('ai-limit-sales').innerText(), /AI 세일즈[\s\S]*회사 한도를 나눠/);
  assert.match(await owner.getByTestId('ai-limit-marketing').innerText(), /AI 마케터[\s\S]*시안 이미지/);
  assert.match(await owner.getByTestId('ai-plan-matrix').innerText(), /베이직[\s\S]*1인 월 500원분[\s\S]*스탠다드[\s\S]*1인 월 1,200원분[\s\S]*프로/); // 대표 10/24 ② 1인 월 AI 예산(원)
  await owner.getByTestId('ai-limits').screenshot({ path: `${SHOTS}/178-ai-limits.png` });
  await owner.getByTestId('plan-request').click();
  await owner.getByLabel('요청할 요금제').selectOption('w_standard'); // V27 요금표
  await owner.getByRole('button', { name: '요청 보내기' }).click();
  await owner.getByText(/요청을 보냈습니다/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/78-usage-plan.png`, fullPage: true });
  await owner.goto(BASE + '/platform');
  assert.match(await owner.getByTestId('platform-ai-margin').innerText(), /AI 원가\(고객사\)[\s\S]*요금 합계[\s\S]*마진/, '#412 플랫폼 원가·마진 한 줄');
  await owner.getByTestId('company-ai-default').getByText('AI 요청 무제한').waitFor();
  await owner.getByTestId('platform-tab-support').click(); // #565 종류별 탭: 변경 요청 = 고객 지원
  await owner.getByTestId('platform-requests').getByRole('button', { name: '반려' }).first().click();
  await owner.getByText('반려했습니다').waitFor();
  await owner.getByTestId('platform-tab-billing').click(); // 요금제·결제 시험 = 요금·결제
  await owner.getByLabel('business 월 요금').fill('80000');
  await owner.getByTestId('platform-plans').locator('tr', { hasText: 'business' }).getByRole('button', { name: '저장' }).click();
  await owner.getByText('저장했습니다').first().waitFor();
  assert.equal((await sql`select monthly_krw from plans where code = 'business'`)[0].monthly_krw, 80000);
  await sql`update plans set monthly_krw = 79000 where code = 'business'`;
  assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = 'default'`)[0].plan_code, 'internal', '반려하면 그대로');
  await owner.screenshot({ path: `${SHOTS}/79-platform.png`, fullPage: true });
  // V32 1 → 192차(대표 10/27) 결제 시험: 결제 모듈 상태 + [시험 결제](숨은 시험 계정 하나 — 회사 만들기 없음) → (결제창은 외부라 승인 결과를 기록으로 넣고) 자동 확인 화면
  await owner.getByTestId('pay-status').waitFor();
  assert.equal(await owner.getByTestId('pay-test-create').count(), 0, '192차: 시험 회사 만들기 없음');
  const w0 = await ctx.owner.ok('POST', '/api/platform/pay-test/tester/window', { kind: 'monthly', planCode: (await ctx.owner.ok('GET', '/api/platform/pay-test')).plans[0].code, payMethod: 'CARD' });
  const [tt] = await sql`select tenant as id from payments where id = ${w0.paymentId}`;
  await sql`update tenant_subscriptions set plan_code = 'team', status = 'active', billing_cycle = 'monthly' where tenant = ${tt.id}`;
  const [tp] = await sql`insert into payments (tenant, kind, plan_code, moid, amount, status, paid_at, meta) values (${tt.id}, 'subscription', 'team', ${'WTE2E' + Date.now()}, 9900, 'paid', now(),
    ${sql.json({ test: true, payMethod: 'CARD', receiptSentAt: new Date().toISOString(), prev: { plan_code: 'trial', status: 'trial' } })}) returning id`;
  await owner.goto(`${BASE}/platform?tab=paytest&check=${tp.id}`);
  await owner.getByTestId('pay-test-check').waitFor();
  assert.equal(await owner.getByTestId('check-plan').getAttribute('data-state'), 'ok');
  assert.equal(await owner.getByTestId('check-receipt').getAttribute('data-state'), 'ok');
  await owner.getByTestId('pay-test').screenshot({ path: `${SHOTS}/v32-pay-test.png` });
  const r = await ctx.staffA.client.req('GET', '/api/platform');
  assert.equal(r.status, 404);
  // #413 결제창이 열리자마자 닫힘: 나이스페이 PC 스크립트는 팝업이 아니라 같은 페이지의 iframe 레이어이고, 오류 때 레이어를 지우고 nicepayClose() 를 부른다.
  // 가짜 스크립트로 그 계약(goPay → #nice_layer → {code:'1', result:{AuthResultCode, AuthResultMsg}} → 레이어 삭제 → nicepayClose)만 흉내 낸다 — 구조 시험(실제 나이스페이 아님).
  const FAKE_NP = `window.goPay = function(f){
    if (f.MobileYN && f.MobileYN.value === 'Y') { window.__npMobile = Object.fromEntries(Array.from(f.elements).map(function(i){ return [i.name, i.value]; })); return false; }
    var l = document.createElement('div'); l.id = 'nice_layer'; l.innerHTML = '<iframe name="nice_frame" id="nice_frame"></iframe>'; document.body.appendChild(l);
    var bg = document.createElement('div'); bg.id = 'bg_layer'; document.body.appendChild(bg);
    function set(n, v){ var i = f.elements.namedItem(n); if (!i) { i = document.createElement('input'); i.type = 'hidden'; i.name = n; f.appendChild(i); } i.value = v; }
    function on(e){ var o = e.data; if (!o || !o.code) return; window.removeEventListener('message', on);
      if (o.code === '1' || o.code === '2') { set('AuthResultCode', o.result ? o.result.AuthResultCode : '9999'); set('AuthResultMsg', o.result ? o.result.AuthResultMsg : o.message); l.remove(); bg.remove(); try { nicepayClose(); } catch (err) {} } }
    window.addEventListener('message', on);
    setTimeout(function(){ window.postMessage({ code: '1', message: 'fail', result: { AuthResultCode: 'W007', AuthResultMsg: '위변조 데이터를 체크하세요' } }, '*'); }, 300);
  };`;
  await owner.route('https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js', (rt) => rt.fulfill({ status: 200, contentType: 'application/javascript', body: FAKE_NP }));
  await owner.goto(`${BASE}/platform?tab=paytest`);
  await owner.getByTestId('pay-test-open').waitFor();
  assert.equal(await owner.getByTestId('pay-test-pagemode').isChecked(), false);
  await owner.getByTestId('pay-test-open').first().click();
  await owner.getByTestId('pay-test-closed').waitFor();
  const closed = await owner.getByTestId('pay-test-closed').textContent();
  assert.match(closed, /위변조 데이터를 체크하세요 \(W007\)/, '닫힘 사유(AuthResultMsg·코드)를 보여 준다');
  assert.match(closed, /같은 탭에서 열기를 켰습니다/);
  await owner.getByText(/결제창이 닫혔습니다 — 위변조 데이터를 체크하세요/).first().waitFor();
  assert.equal(await owner.getByTestId('pay-test-pagemode').isChecked(), true, '바로 닫히면 같은 탭 방식으로 자동 전환');
  assert.equal(await owner.locator('#nice_layer').count(), 0);
  assert.equal(await owner.locator('[data-testid=nicepay-form]').count(), 0, '숨은 폼 정리');
  await owner.getByTestId('pay-test').screenshot({ path: `${SHOTS}/177-pay-test-closed.png` });
  await owner.getByTestId('pay-test-open').first().click();
  await owner.waitForFunction(() => !!window.__npMobile);
  const mob = await owner.evaluate(() => window.__npMobile);
  assert.equal(mob.MobileYN, 'Y', '같은 탭 = 나이스페이 모바일 방식(MobileYN=Y)');
  assert.equal(mob.MID, 'nictest00m'); assert.match(mob.ReturnURL, /\/api\/billing\/nicepay\/return$/); assert.ok(mob.SignData);
  await owner.unroute('https://pg-web.nicepay.co.kr/v3/common/js/nicepay-pgweb.js');
  await owner.evaluate(() => { delete window.goPay; });
});

await step('V11 휴대폰: 행 상태 칩 → 시트에서 진행 중, 묶기 상태별, 완료 칩 보임·월별 요약, 마감 선택 = 아래 시트(화면 안)·시각 버튼, 글자 칩, 🎤 음성 등록 → 인식 카드(빠진 마감 빨간 표시)', async () => {
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V11 상태 칩 업무', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: addDays(today, 1), approvalRequired: false })).id;
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_task_group', 'assignee'); } catch {} }); // V14 34번: 휴대폰 기본은 마감별 — 이 시험은 담당자별 묶음
  const m = await mc.newPage();
  await m.goto(BASE + '/tasks');
  const row = m.locator(`[data-row="${t}"]`);
  await row.getByTestId('row-status-chip').filter({ visible: true }).getByText('진행 전').waitFor();
  assert.equal(await row.getByTestId('row-status-chip').filter({ visible: true }).getByText('· 확인함').filter({ visible: true }).count(), 0, '검수 10/16: 휴대폰은 "확인 전"만 표시');
  await row.getByTestId('row-status-chip').filter({ visible: true }).tap();
  const sheet = m.locator('[data-sheet]');
  await sheet.getByRole('button', { name: '진행 중' }).tap();
  await row.getByTestId('row-status-chip').filter({ visible: true }).getByText('진행 중').waitFor();
  assert.equal((await sql`select status from tasks where id = ${t}`)[0].status, 'in_progress');
  // 완료 칩은 줄 끝에 고정되어 화면 안에 보임
  const box = await m.getByTestId('done-chip').getByRole('button').boundingBox();
  assert.ok(box && box.x + box.width <= 390, '완료 칩 화면 안');
  assert.equal(await m.getByText('완료된 업무도 보기').count(), 0, '체크박스 없음');
  await m.getByTestId('filter-toggle').click(); // 로컬 검수 10/17: 휴대폰은 묶기·정렬이 필터 안에
  await m.getByTestId('group-by').selectOption('status');
  await m.locator('[data-group="in_progress"]').getByText('V11 상태 칩 업무').waitFor();
  await m.getByTestId('group-by').selectOption('assignee');
  await m.getByTestId('filter-toggle').click();
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
  // 음성 등록 (텍스트로 대체 시험)
  // #422: 음성 등록은 업무 등록 시트의 [음성](더보기 › 만들기 줄은 없앰)
  await m.goto(BASE + '/tasks'); await m.getByTestId('add-task-top').tap();
  await m.getByTestId('quick-voice-add').tap();
  const dlg = m.getByRole('dialog', { name: '음성으로 업무 등록' });
  await dlg.getByTestId('voice-guide').getByText('마감(언제까지)').waitFor();
  await dlg.getByTestId('voice-text').fill('견적서 보내기');
  await dlg.getByTestId('voice-recognize').tap();
  await dlg.getByTestId('voice-card').getByText(/말씀하지 않으셨어요/).waitFor();
  // 대표 실기기: "선택" 버튼이 세로로 꺾이지 않고 한 줄, 안내는 버튼 아래 왼쪽 맞춤
  const dueRow = dlg.getByTestId('voice-due-row');
  const btn = await dueRow.getByTestId('due-picker').first().boundingBox();
  assert.ok(btn.height <= 44, `마감 버튼 한 줄 높이: ${btn.height}`);
  const msg = await dueRow.getByText(/말씀하지 않으셨어요/).boundingBox();
  assert.ok(msg.y >= btn.y + btn.height - 1 && Math.abs(msg.x - btn.x) <= 2, `안내는 버튼 아래 왼쪽 맞춤: ${JSON.stringify({ btn, msg })}`);
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
  await dlg.getByTestId('inline-multi-each').check(); // #475 뒤: 한 줄 추가도 여러 명 기본 = 함께 담당
  await owner.locator('div.fixed.inset-0.z-\\[70\\]').click({ position: { x: 4, y: 4 } });
  await add.getByRole('button', { name: '3명에게 각각 만들기' }).click();
  await owner.getByText(/3명 각각에게 추가됨: V12 각자 제출/).first().waitFor();
  assert.equal((await sql`select count(distinct batch_id)::int b, count(*)::int n from tasks where title = 'V12 각자 제출'`)[0].n, 3);
  await owner.keyboard.press('Escape');
  // 남의 업무: 원형 체크 비활성, 검토 요청 알림에서 승인
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12 검토 승인 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.locator(`[data-row="${t}"]`).getByTestId('row-status-locked').filter({ visible: true }).waitFor(); // 담당자만 상태 변경 — 남의 업무는 잠김 표시
  assert.equal(await owner.locator(`[data-row="${t}"]`).getByTestId('row-status-chip').count(), 0, '담당자만 완료');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
  await owner.goto(BASE + '/notifications');
  const li = owner.getByTestId('notifications').locator('li', { hasText: '검토 요청: V12 검토 승인 업무' });
  await li.getByTestId('review-actions').getByRole('button', { name: '승인' }).click();
  await li.getByTestId('notif-done').waitFor(); // 로컬 10/20: 알림에서 바로 처리 → 그 자리에 "승인함 ✓"
  assert.match(await li.getByTestId('notif-done').innerText(), /승인함/);
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
  // 앞 단계에서 남은 가짜 AI 응답이 있으면 자료 자동 정리가 그 응답으로 폴더를 옮겨 버린다 → 비우고 시작(정리 실패 = 맨 위에 남음)
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true }) });
  await owner.goto(BASE + '/library');
  // 화면 준비(하이드레이션·목록 불러옴) 전에 놓으면 받는 쪽이 아직 없어 무시됨 → 목록이 뜬 뒤 놓기
  await owner.getByTestId('library-list').waitFor();
  await owner.waitForLoadState('networkidle');
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
  // 대표 실기기: 답글에서 사람 태그가 안 됨 → "@" 자동완성으로 고르면 멘션
  await th.getByLabel('답글').fill('감사합니다 @최');
  await th.getByTestId('reply-mention-suggest').getByRole('option', { name: /최매니저/ }).click();
  await th.getByLabel('답글').press('End');
  await th.getByLabel('답글').pressSequentially('확인 부탁');
  await th.getByTestId('reply-form').getByRole('button', { name: '등록' }).click();
  await th.getByText(/감사합니다/).first().waitFor();
  const [rp] = await sql`select body, mentions from comments where body like '감사합니다%' order by created_at desc limit 1`;
  assert.ok(rp.mentions.includes(ctx.managerA.id), '답글 멘션 저장: ' + rp.body);
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
  await a.getByTestId('chat-rooms').getByText('김대표', { exact: true }).click(); // 그룹방 미리보기 '김대표님이 …초대했습니다' 와 구분
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
  // 대표 검수 10/20: 담당자 1명인 업무는 항목별 담당 선택을 숨기고, 다른 사람이 지정된 항목은 이름만
  await owner.getByTestId('checklist-assignee-name').waitFor();
  assert.equal(await owner.getByLabel('자료 모으기 담당').count(), 0, '담당 1명 → 항목 담당 선택 숨김');
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
  assert.equal(await staff.getByTestId('mobile-tabs').isVisible(), false, '업무 상세에서 하단 탭 숨김');
  assert.ok(Math.abs((await form.boundingBox()).y + (await form.boundingBox()).height - (staff.viewportSize().height)) <= 2, '입력줄이 화면 맨 아래');
  await staff.screenshot({ path: `${SHOTS}/94-mobile-comment-bar.png` });
  const vp0 = staff.viewportSize();
  for (const w of [360, 390]) { await staff.setViewportSize({ width: w, height: 780 }); await staff.waitForTimeout(300); await staff.screenshot({ path: `${SHOTS}/94-mobile-comment-bar-${w}.png` }); }
  await staff.setViewportSize(vp0);
  await staff.goto(`${BASE}/tasks`);
  await staff.getByTestId('mobile-tabs').waitFor(); // 상세를 벗어나면 하단 탭 다시 보임
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
  // 대표 요청(2026-10-14): 패널에서도 사진 첨부 — 📎 버튼 + 붙여넣기(Ctrl+V 캡처) → 글 없이 보내도 됨 → 문서 만들기 제안 → 확인 → 자료실
  const dock = owner.getByTestId('ai-dock');
  await dock.getByTestId('ai-dock-new').click();
  const png1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await dock.getByTestId('ai-dock-file-input').setInputFiles([{ name: '화이트보드.png', mimeType: 'image/png', buffer: png1 }]);
  await dock.getByTestId('ai-files').getByText('화이트보드.png').waitFor();
  await dock.getByLabel('AI 에게 요청 (화면 맥락)').evaluate((el, b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([bin], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, png1.toString('base64'));
  await dock.getByTestId('ai-files').getByText(/붙여넣은 이미지/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/v14-ai-dock-attach.png` });
  const n0 = (await fetch(`${FAKE}/__state`).then((r) => r.json())).anthropic.length;
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [
    { content: [{ type: 'tool_use', id: 'doc1', name: 'propose_create_document', input: { title: 'E2E 회의 정리', content: '# 결정\n- 전단 배포 금요일', folder: '회의록' } }], stop_reason: 'tool_use' },
    { content: [{ type: 'text', text: '사진 두 장으로 문서를 준비했습니다. 확인을 누르면 만들어집니다.' }], stop_reason: 'end_turn' }] }) });
  await dock.getByRole('button', { name: '보내기' }).click(); // 글 없이 사진만
  await dock.getByText('📁 저장 폴더: 회의록').waitFor();
  const sent = (await fetch(`${FAKE}/__state`).then((r) => r.json())).anthropic.slice(n0)[0].body.messages.at(-1).content;
  assert.equal(sent.filter((b) => b.type === 'image').length, 2, '사진 2장이 AI 에 전달');
  await dock.getByRole('button', { name: '확인' }).click();
  await dock.getByText('✓ 반영됨').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v14-ai-dock-document.png` });
  const [doc] = await sql`select folder, file_name from library_files where title = 'E2E 회의 정리' and deleted_at is null`;
  assert.equal(doc.folder, '회의록'); assert.equal(doc.file_name, 'E2E 회의 정리.docx');
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
  // 대기열 ①(10/19): 부서 › 팀 — 첫 번째는 부서, 카드에 '부서' 표시
  await owner.getByTestId('team-card').filter({ hasText: '운영팀 E2E' }).getByText('부서', { exact: true }).waitFor();
  const [tm] = await sql`select id, kind from teams where name = '운영팀 E2E'`;
  assert.equal(tm.kind, 'dept');
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '팀 보드 시험 업무', orgUnitId: ctx.siteA, teamId: tm.id, teamMode: 'lead', assigneeId: null })).id;
  await owner.goto(`${BASE}/teams/${tm.id}`);
  await owner.getByTestId('team-board').getByText('팀 보드 시험 업무').waitFor();
  await owner.getByTestId('team-back').click(); // 하위 화면 뒤로가기
  await owner.waitForURL(/\/admin\/users/);
  await owner.getByTestId('teams-tab').waitFor(); // ?tab=teams 로 돌아오면 팀 탭
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


await step('V30 ① 엑셀·CSV 업무 가져오기(PC 표·담당자 고르기·만들기·되돌리기, 휴대폰 카드)', () => v30import({ owner, BASE, SHOTS }));
await step('실기기 83: 휴대폰 문자·메일 시안 시트 스크롤·버튼 줄이 댓글 입력줄에 안 가림', () => sheetPhone({ owner, BASE, SHOTS }));
await step('V32 0 알림 읽음: 안 읽은 것만·누르면 바로 읽음·업무를 열면 자동 읽음·전체 탭', () => notifRead({ owner, BASE, SHOTS, ctx }));
await step('#101 권한 배지: 사용자 관리 CEO → 회사 설정 한글 → 끄기 → 영어', () => roleBadge({ owner, BASE, SHOTS }));
await step('#106 휴대폰 말풍선: 보임·배지 → 최근 대화방 → 방 안 숨김 → 설정 끄기', () => chatBubble({ owner, ctx, BASE, SHOTS }));
await step('실기기: 휴대폰 업무 상세(#댓글 주소)에서 체크리스트 체크해도 화면이 내려가지 않음·포커스 유지', () => checkScroll({ owner, BASE, SHOTS }));
await step('점검 ①: 태블릿·좁은 창(768·1024·1100) 업무 목록 이름이 눌리지 않음', () => listNarrow({ owner, BASE, SHOTS }));
await step('V36 3 관리 화면 권한: 직원이 관리 주소로 들어가면 안내(무슨 메뉴·누구에게 요청), 대표가 그 메뉴만 켜 주면 그 화면만 열림', async () => {
  await staff.goto(BASE + '/admin/company');
  const na = staff.getByTestId('admin-no-access');
  await na.waitFor();
  await na.getByText('관리 화면 권한이 없습니다').waitFor(); // 관리 메뉴가 하나도 없으면 공통 안내
  await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'mail_settings', userId: ctx.staffA.id, level: 'view' });
  await staff.goto(BASE + '/admin/company');
  await staff.getByTestId('admin-no-access').getByText('"회사 정보·디자인" 화면 권한이 없습니다').waitFor();
  await staff.goto(BASE + '/admin/mail');
  assert.equal(await staff.getByTestId('admin-no-access').count(), 0, '켜 준 메일 계정 화면은 열림');
  await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'mail_settings', userId: ctx.staffA.id, level: null });
});
// 맨 끝: 지금 진행 중인 휴가를 만들므로 다른 단계에 영향 없게 마지막에
await step('V36 1·2 근무 상태: 휴가 중인 사람 아바타에 회색 점·"휴가 ~" 표시, 여러 명 배정은 휴가자 포함 + "복귀 후 확인" 안내', async () => {
  const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: 'E2E 휴가', kind: 'vacation', start: new Date(Date.now() - 3600e3).toISOString(), end: new Date(Date.now() + 2 * 86400e3).toISOString() });
  const r = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 휴가자 포함 업무', assigneeIds: [ctx.staffA.id, ctx.managerA.id], orgUnitId: ctx.siteA, approvalRequired: false });
  assert.equal(r.ids.length, 2); assert.equal(r.away[0].id, ctx.staffA.id);
  await owner.goto(BASE + '/tasks?mode=list');
  await owner.getByRole('button', { name: '전체', exact: true }).click();
  await owner.getByLabel('업무 검색').fill('E2E 휴가자 포함');
  const dot = owner.locator(`[data-task-id="${r.ids[0]}"] [data-presence="leave"]`).first();
  await dot.waitFor();
  assert.match(await dot.getAttribute('title'), /휴가 ~/);
});
await step('10/19 자료실 문서 공동 편집: PC·휴대폰 동시 편집 같은 글·아바타·오프라인 합침·보기 전용 입력 막힘·편집 공유·기록·되돌리기·Word', () => docsCoedit({ browser, owner, staff, ctx, sql, BASE, SHOTS, login }));

await step('V14 32-보정 자료실 올린 직후 안내: "○○ → 폴더로 정리했어요 · 열기" 토스트·진행 목록, 여러 개 요약', () => libraryOrganizeNotice({ owner, BASE, FAKE, SHOTS }));

await step('V19 AI 비서 문자 시안(번호·본문 고치기·QR·보냈어요 기록) · 견적서 시안(합계·만들기) → 견적서 화면(PDF·문자 시안·보냄)', () => quotesFlow({ owner, ctx, sql, BASE, FAKE, SHOTS }));

await step('V30 ② 공지: 쓰기(중요·고정) → 직원 홈 카드 → 열면 읽음 → 읽음 현황 → 다시 알림', () => noticesFlow({ owner, staff, ctx, sql, BASE, SHOTS }));

await step('V30 ③ 출퇴근: 현장 등록 → 직원 홈 출근(위치 동의) 현장 안 → 퇴근 현장 밖 사유 → 관리자 표·월 요약·현장', () => attendanceFlow({ browser, owner, ctx, BASE, SHOTS, login }));

await step('V30 ④ 결재 양식: 직원 휴가 신청 → 대표 결재 업무 승인 → 승인·연차 캘린더 자동 등록 → 양식 편집', () => approvalsFlow({ owner, staff, ctx, sql, BASE, SHOTS, addDays, today }));

await step('V30 ⑤ 이용 현황: 사용량·요금제 → 이용 현황 탭(요약·날짜별·사용자 표·기간·엑셀)', () => usageStatsFlow({ owner, ctx, BASE, SHOTS }));

await step('V31 연락처: 등록·검색·상세 → 업무 메일/문자 시안 받는 사람 자동 완성', () => contactsFlow({ owner, ctx, BASE, SHOTS, sql }));

await step('V32 2 정산: 플랫폼 정산 집계·장부 [정산 완료] → 고객 결제 내역 [세금계산서] 요청 → 운영자 발행 체크', () => settlementFlow({ owner, ctx, BASE, SHOTS, sql }));

await step('로컬 10/20 알림 바로 처리: 배정 알림 [오늘 할 일에 넣기] → 처리 표시·버튼 사라짐 → 설정 조용한 시간 칸', () => notifActionsFlow({ staff, ctx, BASE, SHOTS }));

// 대표 10/21 13:50 #410: 검토 필수가 아닌 일반 업무에서도 담당자가 [검토 요청] → 요청자가 [반려(보완 요청)]/[승인(최종 완료)] · '검토' 칸 항상 표시 · 요청자 '검토 필수' 토글
await step('#410 일반 업무 검토 요청(휴대폰 담당자) → 요청자 반려 → 다시 요청 → 승인(PC) · 검토 필수 토글', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '#410 검토 흐름 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await staff.goto(`${BASE}/tasks/${id}`);
  await staff.getByTestId('review-ask').waitFor();
  assert.equal(await staff.getByTestId('step-review').count(), 1, '검토 칸 항상 표시(일반 업무)');
  await staff.getByTestId('review-ask').click();
  await staff.getByTestId('review-wait').waitFor();
  await staff.screenshot({ path: `${SHOTS}/176-task-review-ask.png`, fullPage: true });
  await owner.goto(`${BASE}/tasks/${id}`);
  await owner.getByTestId('review-decide').waitFor();
  owner.once('dialog', (d) => d.accept('사진 더 붙여 주세요'));
  await owner.getByTestId('review-reject-here').click();
  await owner.getByText('보완을 요청했습니다').waitFor();
  let d = await ctx.staffA.client.ok('GET', `/api/tasks/${id}`); assert.equal(d.task.status, 'in_progress', '반려 → 진행 중');
  await staff.reload(); await staff.getByTestId('review-ask').waitFor(); await staff.getByTestId('review-ask').click(); await staff.getByTestId('review-wait').waitFor();
  await owner.reload(); await owner.getByTestId('review-decide').getByTestId('next-action').click();
  await owner.getByText('승인했습니다').waitFor();
  d = await ctx.owner.ok('GET', `/api/tasks/${id}`); assert.equal(d.task.status, 'done');
  assert.ok((await sql`select 1 from activities where entity_type = 'task' and entity_id = ${id} and action = 'approved'`).length, '활동 approved');
  // 요청자 '검토 필수' 토글(세부 정보 칸) — 켜면 담당자 바로 완료 불가(서버 403)
  const id2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '#410 검토 필수 토글 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${id2}`);
  const cb = owner.getByTestId('approval-required');
  if (!(await cb.isVisible().catch(() => false))) await owner.getByRole('button', { name: /세부 정보/ }).first().click().catch(() => {});
  await cb.click();
  await owner.getByText('검토 필수로 바꿨습니다').waitFor();
  const t2 = (await ctx.staffA.client.ok('GET', `/api/tasks/${id2}`)).task; assert.equal(t2.approval_required, true);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${id2}`, { status: 'done', version: t2.version })).status, 403, '검토 필수 → 담당자 바로 완료 불가');
});

await step('대표 검수 10/20 ② 앱 영업 정리(390): 리드 전화·문자·홈페이지 → 파이프라인 단계 칩 목록 → 입찰 원문·공고문·한국어 상세·관리자 원본 접힘 → 허브 시설 전화 줄', () => salesAppFlow({ browser, desk, ctx, sql, BASE, SHOTS }));

await step('대표 검수 10/20 체크리스트(360): 항목별 미팅 버튼 제거 · 담당 1명 → 담당 칩 숨김·새 항목 자동 배정 · 담당 여럿 → 선택 노출 · (?) 안내 탭 · 가로 넘침 0', () => checklistAppFlow({ browser, desk, ctx, sql, BASE, SHOTS }));

await step('로컬 10/20 알람처럼 울리기(웹): 설정 기본값 3칸 → 업무 상세 알람 선택 → 알람 알림 띠([해제][10분 뒤][열기]) → 해제 → 활동 탭 기록', () => alarmFlow({ staff, ctx, sql, BASE, SHOTS }));

await step('S1-2 진행 기록 쓰기(390): 입찰 상세 원본 상태 버튼·메모·다음 연락일 저장 → 카드 칩 → 196차 입찰 [넘기기] → 리드 없이 입찰 업무·입찰 업무 칸 [유찰] · 입찰은 리드 전환 없음', () => salesWorkFlow({ browser, desk, ctx, sql, BASE, SHOTS }));

await step('로컬 10/20 캘린더 재발: 빠른 입력 첫 화면 색 줄 → 생성 직후 편집(새로고침 신호에도 입력 유지·저장) → 다른 기기 충돌 뒤 [완료] 자동 재시도', () => calEditFlow({ browser, desk, owner, ctx, sql, BASE, SHOTS }));
await step('대표 10/20 4) 팀별 보기: 업무 화면 팀 칩(볼 수 있는 팀만) → 칩으로 그 팀 업무만 → 메뉴 권한 \'팀 업무 보기\' 지정 팀 → 직원 화면에 그 팀 칩', () => teamChipsFlow({ browser, owner, ctx, sql, BASE, SHOTS, login }));
await step('대표 10/20 7) 퇴사 처리·인수인계: 창에서 퇴사일·받을 사람·항목 개수 → 퇴사(날짜)·접힘·인수인계·복직 버튼 → 로그인 차단·업무 이전', () => offboardFlow({ owner, ctx, BASE, SHOTS }));
await step('메신저 1차(대표 10/20): 새 대화 다중 선택·그룹 자동 이름·방 정보(초대·내보내기)·시스템 메시지·안 읽은 수(이름)·공지 바·전달', () => messengerV3({ owner, ctx, BASE, SHOTS }));
await step('대표 10/20 ① 플랫폼 운영 [고객사 추가]: 회사명·업종 여러 개·규모·체험 기간·시작 공간·대표 → 초대 링크 → 회사 관리 초대 대기·공간·메모·감사 기록', () => platformAdd({ owner, BASE, SHOTS, sql }));
await step('대표 10/20 15:15 부서·팀 재정비: 트리(들여쓰기·경로 "영업부 › 영업1팀")·상위 부서·장 1명 → 초대 \'소속\' 하나(주 소속 + 겸직, 고급 접힘) → 목록 경로·접근 조직 자동', () => orgTree({ owner, ctx, BASE, SHOTS }));
await step('영업 S2 1차(대표 14:15): 허브 일괄 [영업 진행으로] → 업무 자동 → 홈 오늘 할 일 7묶음·요약 타일·진행표 → 업무 영업 원천 배지 → 계약만료·재입찰', () => salesTodo({ owner, ctx, sql, BASE, SHOTS }));
await step('영업 S2 2차(감사 1-13~1-16): 새 리드 13칸·비슷한 거래처 경고 → 칩·정렬·보기·CSV → 상세 업무 탭·타임라인·상담 다음 연락일 → 제안·계약·ROI → 삭제(사유)', () => salesLeads2({ owner, ctx, sql, BASE, SHOTS }));
await step('소개 사이트(대표 16:45): / 랜딩(H1·무료로 시작·앱·세 공간·AI·3단계·요금 14일 무료 체험·문의·계정 삭제·JSON-LD·OG·UTM·클릭 이벤트·390) → 로그인하면 홈', () => landing({ browser, owner, BASE, SHOTS }));
await step('대표 18:00 월 운영 목표·근거: 초안 → 고치기 → 승인 → 홈 막대 → 새 콘텐츠 근거 칸 → 승인함 왜 이 글인가', () => mktGoals({ owner, ctx, BASE, SHOTS }));
await step('대표 19:00 제작의뢰실: 의뢰 → 프롬프트 → 수정 → 제작 요청 카드로 → 카드에 제작의뢰실 표시', () => mktStudio({ owner, ctx, BASE, SHOTS }));
await step('대표 20:00 운영실: AI 마케터 카드 반려·승인 → 제작의뢰 · 광고 예산 고치기 → 승인·집행 · 월 매출 목표 막대(마케팅·영업 홈) · 월간 보고 CAC·ROI', () => mktOps({ owner, ctx, sql, BASE, SHOTS }));
await step('광고 최적화 1차 3안 소액 테스트: 판정 상자(이긴 안·진 안·서버 판정 문구) → [이긴 안에 집중](확인 창 → 진 안 끄기 + 예산) · 소재 끄기 · 변경 기록 · 새 세팅안 테스트 칸 · 절감액 수수료율 · 휴대폰 폭', () => adAb({ owner, ctx, sql, BASE, SHOTS }));
await step('광고 최적화 1차 동네 타깃: 새 세팅안 동네 칸(중심·반경 → AI 동네 추천 → 검색량 → 고른 것 키워드에 넣기 · 광고 지역 충남) → 저장 → 카드 줄 · 켠 광고 [광고 지역]·[동네 키워드 추가] 보내는 값 · 변경 기록 · 휴대폰 폭', () => adLocal({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-2 파워링크 세팅안 보강: 광고 설정 칸(추천값·가중치·3안 테스트 동일 비중·제외 키워드) · 키워드 조합기(그룹 곱·빼도 됨·검색량·낮음도 함께) · 하루 예산 권장 → 저장(보내는 값) → 카드 설정 줄·권고 · 고치기 · 휴대폰 폭', () => adSetup({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-2 후속 파워링크 카드: 캠페인·광고그룹 id·네이버에서 보기 링크·실패 뒤 이어 씀 · 네이버 반영 값 상자(다름·읽지 못함·소재 검수·남은 빈 캠페인) · [다시 읽기] 보내는 값 · 끊긴 만드는 중 [이어서 만들기] · 이름 30자 안내 · 가운뎃점 → 쉼표 · 휴대폰 폭', () => adReadback({ owner, ctx, sql, BASE, SHOTS }));
await step('광고 최적화 1차 통화 기반: 전화·문의 기준 키워드 점검(요약·끄기 제안·잘 됨) → 워크인 키워드 [끄기] 보내는 값 → 목표 전환당 비용 → 기간 7일 → 휴대폰 폭 → 전화 문의 기록에 광고 키워드', () => adLeads({ owner, ctx, sql, BASE, SHOTS }));
await step('광고 2차 ① 리드 광고(메타) → 영업 리드: 광고 운영 리드 광고 상자(받는 중·웹후크·요약·이름 가림·첫 연락·재알림·광고별 리드당 비용) → 실패 [다시 처리] → 휴대폰 폭 → 연결 계정 받는 중 → 영업 리드 상세 리드 광고 상자·[전화] 첫 연락 기록', () => leadAds({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-3 리드 단계 → 메타 전환 API: 리드 광고 상자 안 설정(기본 꺼짐·보내는 것 안내·데이터 세트 숫자만·토큰 저장됨·단계 이름표) → 저장(보내는 값) → [시험 보내기] → 켜기 → [지금 보내기](형식 아닌 리드 ID 건너뜀) → 최근 기록 · 휴대폰 폭', () => metaCapi({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-4 상황 매트릭스: 운영실 광고 컨셉 [새 상황 매트릭스] → AI로 채우기 → 역할 추가 → 컨셉 만들기(보내는 값) → 카드(역할×상황 칸·광고형 점수) → 승인함 광고 컨셉 탭 → 2개 채택 → 제작 의뢰(피드·릴스·광고형) → 운영실 채택함·새 각도 · 휴대폰 폭', () => mktConcepts({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-5 카드뉴스 장별 생성기: 자동 제작 › 카드뉴스 탭 → 제품·대상·키워드 → 주제 후보 4유형(훅 점수) → 고르기 → 장별 문구 만들기(보내는 값) → 채울 곳 경고·그리기 잠김 → 채우기·순서·틀 → 저장(미리보기 다시 그림) → 이미지로 만들어 승인 요청(인스타 피드 7장) · 휴대폰 폭', () => mktCarousel({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-6 경쟁 광고 보관함: 운영실 [광고 넣기](업체·링크·게재 시작·비슷한 소재·대본 — 보내는 값) → 질문형 → 칩 거르기 → ★ → 자세히·AI 분석(뼈대) → 3개 골라 공통 구조 분석(대본 3안·제작의뢰실 링크) → 주간 분석 지금 · 휴대폰 폭', () => mktAdRefs({ owner, ctx, sql, BASE, SHOTS }));
await step('#499-7 AI 마케팅팀: 사이드바 → 역할 7개(기획 담당 꺼짐·예산 담당 항상) → 켜기 → [오늘 주제 받기](3안·형식·근거) → 반려(사유 칩) → 채택(카드뉴스) → 디자인 담당이 그려서 승인 대기([열기]) → 기억시키기 · 휴대폰 폭', () => mktTeam({ owner, ctx, sql, BASE, SHOTS }));
await step('187차 ④⑤ 디자인 지침(로컬 10/26 P1): AI 마케팅팀 › 디자인 담당 [디자인 지침] 회사 전체 3줄·브랜드 2줄 저장 → 요약·글자 수 · 기억 칸 1,000자 · 브랜드 키트 머리말 칸 안내(비우면 AI 가 글마다) · 휴대폰 폭', () => designGuide187({ owner, ctx, sql, BASE, SHOTS }));
await step('188차 실사 전면(로컬 10/26 P1 ① · #621): 콘텐츠 상세 사진 기록(표지·장마다 사진·까닭·보정·업무 공간·행동 장 글자만) → 사진 AI 설명 자료실 영상 [영상 장면 뽑기] → 장면 사진 3장·영상 장면 칩 · 휴대폰 폭', () => photo188({ owner, ctx, BASE, FAKE, SHOTS, sql }));
await step('189차 실사 참고 생성(대표 #685 · #621): 콘텐츠 상세 빈 사진 칸 2칸 → [빈 칸 생성으로 채우기] → [지금 확인] → 그 칸만 생성 사진으로 새 버전 · 사진 기록 AI 생성 2장 → 사진 AI 설명 AI 생성 칩 · [AI로 다시 만들기](크레딧) · 설정 기본 꺼짐 · 휴대폰 폭', () => photo189({ owner, ctx, BASE, FAKE, SHOTS, sql }));
await step('190차 브랜드 키트 AI로 채우기(대표 #689): 자동 제작 › 브랜드 키트 [AI로 채우기] → 초안 패널(근거·재료에서 확인 못 해 뺀 것) → 비어 있던 칸만 체크 → 소개 고치기·머리말 후보 → [고른 칸 저장] → 칸들 새 값·감사 기록 · 휴대폰 폭', () => kit190({ owner, ctx, BASE, FAKE, SHOTS, sql }));
await step('#497 R06 채널별 실제 게시 화면 미리보기: 인스타 피드(3장 옆으로 넘기기·n/N·점·2번째 장 보임·더 보기·해시태그·계정 이름) · 승인함 카드 [게시 화면으로 보기] · 페이스북(글 위·사진 격자) · 릴스(세로·오른쪽 아이콘·팔로우) · 스레드 · 블로그(문단 사이 사진) · 유튜브 · 휴대폰 손가락 넘기기', () => mktPreview({ owner, ctx, sql, BASE, SHOTS }));
await step('#497 R44 AI 비서 답 실시간 출력: 쓰는 중 말풍선(글이 이어서·[멈춤]) → 끝나면 서식(제목·굵게·목록·표·링크) · 도구 단계 한 줄 · 패널 같음 · 휴대폰 표 넘침 없음', () => aiStream({ browser, desk, owner, BASE, FAKE, SHOTS }));
await step('#516 승인함 시안 없음: 승인할 시안 수에서 빼고 빨간 묶음·빨간 띠·[승인] 없음 → [지금 만들기](서버 그리기·크레딧 0) → 승인할 시안으로 올라가 [승인]·[AI 이미지로 다시 · 약 6.5크레딧]', () => mktVisual({ owner, ctx, sql, BASE, SHOTS }));
await step('#545(+#534) 수정 요청 → AI 수정본: 카드 [수정 요청] → AI 가 글·시안을 함께 고친 수정본 v3 바로 승인함 → 배지 \'수정본 v3 — 반영한 요청\'·AI 수정 1번째·[수정본 v3 승인] → 이전 버전과 나란히 비교(시안·바뀐 줄) → 같은 카드 다시 수정 요청(사진만 = v4) → 상세 비교 · 휴대폰 폭', () => mktRevision({ owner, ctx, sql, BASE, FAKE, SHOTS }));
await step('#544 브랜드 키트 피드 틀: 성격(신뢰형) → 틀 4개 → 색·머리줄·연락처 → 미리보기(틀마다 한 장·사진 자리 안내) → 저장(4종 사용 중) → 승인함 초안 보관 글 [새 틀로 다시 그리기](보관 그대로) · 휴대폰 폭', () => mktFeedKit({ owner, ctx, sql, BASE, SHOTS }));
await step('#177 휴지통(로컬 10/23 · 대표 "비슷한 글은 하나만"): 승인함 수정 요청·보류 칸 [골라서 지우기] → 2건 → [휴지통으로] → 칸에서 빠짐 · 휴지통 칸 [되살리기] → 보류 복귀 · 상세 [휴지통으로] → 띠 [되살리기]', () => mktTrash({ owner, ctx, sql, BASE, SHOTS }));
await step('#522 영업 DB 누락 점검: 원천 2회 연속 실패·24시간 넘게 성공 없음 → 영업 홈 빨간 띠(받는 원천은 빼기·원천 하나뿐이면 수집기 이름) → [수집기 보기] → 수집기 칸 같은 띠·원천별 줄(받은 줄·관련·실패 빨간 줄)·첫 줄 칸 이름(값 없이) 펼치기', () => collectorAlerts({ owner, ctx, sql, BASE, SHOTS }));
await step('#535 승인함·콘텐츠 캘린더 상세 뒤로가기: 열면 ?c 기록 → 뒤로가기는 상세만 닫힘(승인함 그대로) · 닫기 단추는 기록 되돌림 · 링크로 연 상세는 ?c 만 지움 (390폭)', () => backClose({ owner, ctx, BASE }));
await step('#494 메타 광고 자동 세팅: 광고 운영 메타 칸(초안 대기 줄·승인함 링크·권한 다시 연결) → [새 메타 광고] 창(양식 번호 직접·개인정보 확인·자료실 소재·반경·자동 일시정지) 저장 → 승인함 광고 초안 탭(배지·요약·피드 미리보기·확인 문구) → 휴대폰 폭 → [반려] 사유 → 보관', () => metaAuto({ owner, ctx, sql, BASE, SHOTS }));
await step('#450 영업실 지원사업: 사이드바 메뉴 → 맞춤 목록(1차 판단·조건 칩·D-day·자격 안 맞는 공고 빼기) → [AI 판단] → [신청 준비] 담당 업무 → 영업 홈 마감 임박 카드 → 상세(준비 서류·진행) → [신청 완료] → [직접 추가] 지난 신청 → 신청·결과 탭 → 휴대폰 폭', () => supportPrograms({ owner, ctx, sql, BASE, FAKE, SHOTS }));
await step('#454 영상 파이프라인 v2: 플랫폼 운영 내레이션(TTS) 카드·연결 시험 → 브랜드 키트 영상 끝 화면·자막 → 제작의뢰실 릴스 준비 상태 → [생성] 장면별 생성·검수·합성 → 장면 칩(실제 화면·검수 ✓)·완성 영상·승인 대기 → 휴대폰 폭', () => mktVideo({ owner, ctx, sql, BASE, FAKE, SHOTS }));
await step('187차 ⑦ 이번 달 만든 영상 다시 합성: 제작의뢰실 상자(원래 영상·계획·자막 줄·끝 화면 전화·내레이션 키 안내) → [다시 합성] → 다시 합성됨·승인함 링크·의뢰 카드(장면 2개·생성 크레딧 0) → 새 버전 승인 대기·보관 표시 지움·원장 그대로 → 휴대폰 폭', () => mktVideoReuse({ owner, ctx, sql, BASE, SHOTS }));
await step('#475 업무 공동 배정(10/24 다시 설계): 업무 등록 시트 여러 명 = 기본 함께 담당(1건·완료 규칙 칸 없음) → 상세 담당자 칸 하나에 칩 3개 빼기·[+] 추가·활동 기록 → 담당자별 묶음 3곳·+2 → 휴대폰 [내 몫 완료] → 내 몫 완료 · 1/3(목록에 남음)·상세 진행 상자', () => coAssign({ owner, staff, ctx, sql, BASE, SHOTS }));
await step('대표 10/24 ② 회사 월 AI 예산(원): 사용량 화면 게이지(84% 주황·다시 채워지는 날·영상 제작 따로) → AI 비서 회사 사용량 한 줄 → 100% 빨간 안내(다음 달 1일)·입력 막힘 → 플랫폼 운영 요금제 표 원 칸·회사 목록', () => aiBudget({ owner, sql, BASE, SHOTS }));
await step('대표 23:40·23:55 마감일 버튼 크기 + 업무 첨부 자료실에서 가져오기(검색·체크 → 연결·타임라인)', () => attachLibrary({ owner, ctx, BASE, SHOTS }));
await step('대표 02:30·03:00 승인함 통합(종류별 탭·건수·바로 승인/반려) · 예산 브랜드 축(세팅안 필요·총액 적기) · 월 목표 반려 · 매출 목표 AI 추천 · 지금 상태', () => inbox({ owner, ctx, sql, BASE, SHOTS }));

await step('#116 전자계약서: 사용자 줄 [전자계약서] → 근로계약서 보내기 → 링크·접속 코드 → 로그인 없는 서명 화면(코드·본문·그리기·동의) → 서명 → 전자계약서 탭 1/2', () => contractsFlow({ browser, owner, ctx, BASE, SHOTS, sql }));
await step('대기열 소형 3건: 설정 부재중(기간·문구 → 부재 중 안내·근무 상태 부재 → 해제) · 일정 화상 회의 링크(수정 화면 칸 → 미리보기 [회의 참여])', () => awayFlow({ owner, staff, ctx, BASE, SHOTS, today, addDays }));

await step('대표 10/22 #427 PC 목록: 상태 칸 오른쪽 정렬 · "진행 전 · 확인 전" 칩이 1280·1440·1920 폭에서 마감일 칸(달력 아이콘)과 겹치지 않음', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '상태 칩 겹침 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false, dueDate: addDays(today, 3) })).id;
  // 로컬 10/22: 기한 지난 줄('10/21 · 1일 지남')은 마감일 내용이 칸 왼쪽 밖으로 넘쳐 상태 칩과 겹쳤다
  const late = (await ctx.owner.ok('POST', '/api/tasks', { title: '상태 칩 겹침 시험 기한 지남', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false, dueDate: addDays(today, -1) })).id;
  for (const w of [1280, 1440, 1920]) {
    for (const rid of [id, late]) {
      await owner.setViewportSize({ width: w, height: 900 });
      await owner.goto(BASE + '/tasks?mode=list');
      await owner.getByLabel('업무 검색').fill('상태 칩 겹침');
      const r = owner.locator(`[data-task-id="${rid}"]`); await r.waitFor();
      const dc = await r.getByTestId('due-cell').boundingBox(), dp = await r.getByTestId('due-cell').locator('[data-testid="due-picker"]').boundingBox();
      const sc = await r.getByTestId('status-cell').locator('[data-testid^="row-status"]').first().boundingBox();
      assert.ok(dp.x >= dc.x - 0.5, `${w}px ${rid === late ? '기한 지남' : '보통'}: 마감 내용이 칸 안(${Math.round(dp.x)} ≥ ${Math.round(dc.x)})`);
      assert.ok(sc.x + sc.width <= dp.x + 0.5, `${w}px ${rid === late ? '기한 지남' : '보통'}: 상태 칩(${Math.round(sc.x + sc.width)}) ≤ 마감 내용(${Math.round(dp.x)})`);
    }
  }
  { const txt = (await owner.locator(`[data-task-id="${late}"]`).getByTestId('due-cell').innerText()).replace(/\s+/g, ' ').trim();
    assert.match(txt, /\d+\/\d+ · 1일 지남/, `기한 지남은 짧은 날짜(1920): "${txt}"`); }
  for (const w of [1280, 1440, 1920]) {
    await owner.setViewportSize({ width: w, height: 900 });
    await owner.goto(BASE + '/tasks?mode=list');
    await owner.getByLabel('업무 검색').fill('상태 칩 겹침');
    const row = owner.locator(`[data-task-id="${id}"]`); await row.waitFor();
    const cell = row.getByTestId('status-cell'), due = row.getByTestId('due-cell');
    const [c, d] = [await cell.boundingBox(), await due.boundingBox()];
    const chip = await cell.locator('[data-testid^="row-status"]').first().boundingBox();
    assert.ok(c && d && chip, `${w}px 칸 위치`);
    assert.ok(chip.x + chip.width <= d.x + 0.5, `${w}px: 상태 칩 오른쪽 끝(${Math.round(chip.x + chip.width)}) ≤ 마감일 칸 시작(${Math.round(d.x)})`);
    assert.ok(Math.abs((chip.x + chip.width) - (c.x + c.width)) <= 2, `${w}px: 상태 칩 오른쪽 정렬`);
    if (w === 1440) await owner.screenshot({ path: `${SHOTS}/191-status-chip-1440.png` });
  }
  await owner.setViewportSize({ width: 1366, height: 900 });
});

await step('대표 10/22 19:47 캘린더 시간 격자(주): 종일·시간 없는 업무 칸 기본 숨김 → 날짜 머리 "종일 n" 칩 → 그날 목록 시트 → [종일 칸] 켜면 다시 보임', async () => {
  const d = addDays(today, 1);
  const tid = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 종일 숨김 업무', orgUnitId: ctx.siteA, assigneeId: ctx.ownerId, approvalRequired: false, dueDate: d })).id;
  await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
  await owner.locator('.fc-timegrid').first().waitFor();
  assert.equal(await owner.locator('.fc-timegrid .fc-daygrid-body').count(), 0, '시간 격자 위 종일 칸 없음(기본)');
  const chip = owner.locator(`[data-testid="allday-chip"][data-day="${d}"]`); await chip.waitFor();
  assert.match(await chip.innerText(), /종일 \d+/);
  await chip.click();
  const sheet = owner.getByTestId('allday-sheet'); await sheet.getByText('E2E 종일 숨김 업무').waitFor();
  await owner.screenshot({ path: `${SHOTS}/192-calendar-allday-chip.png` });
  await sheet.getByText('E2E 종일 숨김 업무').click();
  await owner.getByTestId('task-panel').waitFor().catch(() => {});
  await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
  const allDayToggle = owner.locator('[data-testid^="cal-show-allday"]:visible').first(); // PC = 왼쪽 목록 체크, 휴대폰 = 칩 줄
  await allDayToggle.click();
  await owner.locator('.fc-timegrid .fc-daygrid-body').first().waitFor();
  assert.equal(await owner.locator(`[data-testid="allday-chip"]`).count(), 0, '종일 칸을 켜면 칩 대신 칸');
  await allDayToggle.click(); // 기본(끔)으로 돌려 둠
  await owner.locator('.fc-timegrid .fc-daygrid-body').first().waitFor({ state: 'detached' });
  await ctx.owner.ok('DELETE', `/api/tasks/${tid}`).catch(() => {});
});

await step('#429 결재 설정: 결재 화면 [결재 설정] → 탭(결재선·양식·팀별 배정) → ← 이전 화면 / 주소로 바로 열면 결재로 · 1차·2차 순서 바꾸기 · 3단계 예시 · 팀별 배정·적용 확인 · 휴대폰 넘침 없음', async () => {
  // 부서·팀(E2E 결재부 › E2E 결재1팀) 준비 — 다른 단계 소속이 없는 새 직원으로
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'appr429@dagym.test', name: '결재직원', role: 'staff', orgUnitIds: [ctx.hq] });
  await new Client('appr429').ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'appr429-pass-1234' });
  const dept = (await ctx.owner.ok('POST', '/api/teams', { name: 'E2E 결재부', kind: 'dept', members: [{ userId: ctx.managerA.id, lead: true }] })).id;
  await ctx.owner.ok('POST', '/api/teams', { name: 'E2E 결재1팀', kind: 'team', parentId: dept, isolated: false, members: [{ userId: ctx.ownerId, lead: true }, { userId: inv.userId, lead: false }] });
  await owner.goto(BASE + '/approvals');
  // 이 단계만 돌리면 처음 연 화면(하이드레이션 중)의 첫 누름이 빠지는 경우가 있어(1/3) 이동할 때까지 다시 누른다 — 링크로 가는지는 그대로 확인
  for (let k = 0; k < 3 && !owner.url().includes('/admin/approval-settings'); k++) {
    await owner.getByTestId('approval-settings-link').click();
    await owner.waitForURL(/\/admin\/approval-settings/, { timeout: 10_000 }).catch(() => {});
  }
  await owner.waitForURL(/\/admin\/approval-settings/);
  await owner.getByTestId('aps-tabs').waitFor();
  assert.match(await owner.getByTestId('breadcrumbs').innerText(), /결재[\s\S]*결재 설정[\s\S]*결재선/);
  // 결재선 편집: 1차·2차 표시 → 2차를 위로 → 순서·번호 바뀜(저장 안 하고 닫음)
  await owner.getByRole('button', { name: '결재선 만들기' }).first().click();
  const dlg = owner.getByRole('dialog', { name: '결재선 만들기' });
  assert.deepEqual(await dlg.getByTestId('step-order').allInnerTexts(), ['1차', '2차']);
  assert.equal(await dlg.getByLabel('1차 이름').inputValue(), '현장 관리자');
  await dlg.getByLabel('2차 위로').click();
  assert.equal(await dlg.getByLabel('1차 이름').inputValue(), '대표', '2차를 위로 → 1차가 됨');
  await dlg.getByLabel('1차 조건').selectOption('days');
  await dlg.getByLabel('1차 일수').waitFor();
  await owner.screenshot({ path: `${SHOTS}/194-approval-line-steps.png` });
  await dlg.getByRole('button', { name: '취소' }).click();
  // 예시 3단계 → 카드에 1차 팀장 → 2차 본부장 → 3차 대표
  await owner.getByTestId('tpl-three').click();
  const card = owner.getByTestId('approval-line-card').filter({ hasText: '3단계(팀장 → 본부장 → 대표)' }).first();
  await card.waitFor();
  assert.match((await card.innerText()).replace(/\s+/g, ' '), /1차 팀장.*2차 본부장.*3차 대표/);
  // 팀별 배정: 휴가 × E2E 결재부 → 3단계 → 표에 한 줄 → 결재직원 적용 확인(1차 김대표(결재1팀 장) → 2차 최매니저(결재부 장) → 3차 김대표)
  await owner.getByTestId('aps-tab-assign').click();
  await owner.waitForURL(/tab=assign/);
  await owner.getByTestId('assign-order').waitFor();
  await owner.getByTestId('assign-team').selectOption({ label: 'E2E 결재부 (장 최매니저)' });
  await owner.getByTestId('assign-kind').selectOption('leave');
  await owner.getByTestId('assign-line').selectOption({ label: '3단계(팀장 → 본부장 → 대표) · 3단계' });
  await owner.getByTestId('assign-add').click();
  const row = owner.getByTestId('assign-row').filter({ hasText: 'E2E 결재부' });
  await row.waitFor();
  assert.match(await row.innerText(), /휴가[\s\S]*1차 팀장 → 2차 본부장 → 3차 대표/);
  await owner.getByTestId('assign-check-user').selectOption({ label: '결재직원' });
  const lv = owner.getByTestId('assign-check-row').filter({ hasText: '휴가' });
  await lv.waitFor();
  assert.match((await lv.innerText()).replace(/\s+/g, ' '), /양식 × 팀 배정 · E2E 결재부.*1차 팀장: 김대표.*2차 본부장: 최매니저.*3차 대표: 김대표/);
  await owner.screenshot({ path: `${SHOTS}/193-approval-settings-assign.png` });
  // ← 이전 화면 = 결재 화면(앱 안에서 왔으므로 기록대로)
  await owner.getByTestId('back-link').click();
  await owner.waitForURL((u) => new URL(u).pathname === '/approvals');
  // 예전 주소를 바로 열면(기록 없음) ← 이전 화면 = 결재
  await owner.goto(BASE + '/admin/approvals');
  await owner.getByTestId('aps-tabs').waitFor();
  assert.equal(await owner.getByTestId('aps-tab-lines').getAttribute('aria-selected'), 'true');
  await owner.getByTestId('back-link').click();
  await owner.waitForURL((u) => new URL(u).pathname === '/approvals');
  // 다른 관리 화면에도 ← 이전 화면·경로
  await owner.goto(BASE + '/admin/audit');
  assert.match(await owner.getByTestId('breadcrumbs').innerText(), /관리[\s\S]*감사 기록/);
  // 휴대폰(390): 팀별 배정 탭 가로 넘침 없음
  const vp = owner.viewportSize();
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(BASE + '/admin/approval-settings?tab=assign');
  await owner.getByTestId('assign-order').waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '휴대폰 가로 넘침 없음');
  if (vp) await owner.setViewportSize(vp);
  await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: 'leave', teamId: dept, lineId: null });
});

await step('#77 처음 사용 안내: 처음 로그인 홈 → 버튼을 가리키는 말풍선(다음·이전·건너뛰기) → 끝나면 다시 안 뜸(서버 기록) · 업무 화면 첫 방문 안내 · [사용 안내 다시 보기] · 휴대폰은 하단 탭을 가리킴', async () => {
  const newUser = async (key, name) => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${key}@dagym.test`, name, role: 'staff', orgUnitIds: [ctx.hq] });
    await new Client(key).ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${key}-pass-1234` });
  };
  await newUser('tour77', '투어직원'); await newUser('tour77m', '투어폰');
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await c.addInitScript(() => { try { localStorage.setItem('wos_tour_auto', '1'); } catch {} }); // 시험 서버는 TOURS_AUTO=0 — 이 브라우저만 자동 켬
  const p = await login(c, 'tour77@dagym.test', 'tour77-pass-1234');
  const tour = p.getByTestId('tour');
  await tour.waitFor({ timeout: 15000 });
  assert.equal(await p.getByTestId('tour-title').innerText(), '워크인 사용 안내');
  const titles = [];
  for (let k = 0; k < 14 && (await tour.count()); k++) {
    const title = await p.getByTestId('tour-title').innerText(); titles.push(title);
    if (title === '업무·일정 만들기') {
      // 대상 버튼 둘레가 밝게(구멍) — [만들기] 버튼을 감쌈, 말풍선은 화면 안(단계 사이 이동 애니메이션 0.2초 뒤)
      await p.waitForTimeout(350);
      const [spot, btn, bub] = await Promise.all([p.getByTestId('tour-spot').boundingBox(), p.getByTestId('create-menu').boundingBox(), tour.boundingBox()]);
      assert.ok(spot.x <= btn.x && spot.y <= btn.y && spot.x + spot.width >= btn.x + btn.width && spot.y + spot.height >= btn.y + btn.height, `만들기 버튼 강조 spot=${JSON.stringify(spot)} btn=${JSON.stringify(btn)}`);
      assert.ok(bub.y >= 0 && bub.y + bub.height <= 900 && bub.x >= 0 && bub.x + bub.width <= 1366, '말풍선 화면 안');
      assert.match(await p.getByTestId('tour-count').innerText(), /^2 \/ \d+$/);
      await p.waitForTimeout(250); await p.screenshot({ path: `${SHOTS}/195-tour-home.png` });
      // 이전 → 처음, 다음으로 돌아옴
      await p.getByTestId('tour-prev').click(); assert.equal(await p.getByTestId('tour-title').innerText(), '워크인 사용 안내');
      await p.getByTestId('tour-next').click(); assert.equal(await p.getByTestId('tour-title').innerText(), '업무·일정 만들기');
    }
    await p.getByTestId('tour-next').click();
    await p.waitForTimeout(150);
  }
  assert.equal(await tour.count(), 0, '끝까지 → 닫힘');
  for (const t of ['업무·일정 만들기', '업무', '캘린더', '알림', '검색 (Ctrl K)']) assert.ok(titles.includes(t), `${t} 단계 (${titles.join(' / ')})`);
  assert.ok(!titles.includes('동료 초대·회사 설정'), '직원에게는 관리자 단계 없음');
  assert.ok(!titles.includes('바탕화면 위젯'), '웹에는 위젯 단계 없음');
  const seen = async (pg) => (await pg.evaluate(() => fetch('/api/tours').then((r) => r.json()))).seen;
  // 봤음 기록은 말풍선이 닫힌 뒤 서버에 따로 저장됨 — 기록이 들어올 때까지 잠깐 기다려 읽음(CI 1493: 닫힘 직후 읽어 [] 로 실패)
  const seenWait = async (pg, ok) => { const until = Date.now() + 10_000; let s = await seen(pg); while (!ok(s) && Date.now() < until) { await pg.waitForTimeout(200); s = await seen(pg); } return s; };
  assert.ok((await seenWait(p, (s) => s.includes('home'))).includes('home'), '서버에 봤음 기록');
  await p.reload(); await p.waitForTimeout(2500);
  assert.equal(await tour.count(), 0, '다시 열어도 안 뜸');
  // 업무 화면 처음 → 그 화면 안내, Esc = 건너뛰기(봤음)
  await p.goto(BASE + '/tasks');
  await tour.waitFor({ timeout: 15000 });
  assert.equal(await p.getByTestId('tour-title').innerText(), '업무 추가');
  await p.keyboard.press('Escape');
  await tour.waitFor({ state: 'detached' });
  assert.ok((await seenWait(p, (s) => s.includes('tasks'))).includes('tasks'));
  // [사용 안내 다시 보기] → 홈부터 다시
  await p.getByRole('button', { name: '내 계정 메뉴' }).click();
  await p.getByTestId('tour-restart').click();
  await p.waitForURL((u) => new URL(u).pathname === '/');
  await tour.waitFor({ timeout: 15000 });
  assert.equal(await p.getByTestId('tour-title').innerText(), '워크인 사용 안내');
  await p.getByTestId('tour-skip').click();
  await tour.waitFor({ state: 'detached' });
  assert.deepEqual(await seenWait(p, (s) => s.length === 1 && s[0] === 'home'), ['home'], '다시 보기 = 기록 초기화 후 홈만 봤음');
  await c.close();
  // 휴대폰: 하단 탭(업무)을 가리키고 말풍선은 탭 위·화면 안, 가로 넘침 없음
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_tour_auto', '1'); } catch {} });
  const m = await login(mc, 'tour77m@dagym.test', 'tour77m-pass-1234');
  const mt = m.getByTestId('tour');
  await mt.waitFor({ timeout: 15000 });
  let found = false;
  for (let k = 0; k < 10 && (await mt.count()); k++) {
    if ((await m.getByTestId('tour-title').innerText()) === '업무') {
      await m.waitForTimeout(350);
      const [spot, tabs, bub] = await Promise.all([m.getByTestId('tour-spot').boundingBox(), m.getByTestId('mobile-tabs').boundingBox(), mt.boundingBox()]);
      assert.ok(spot.y >= tabs.y - 8, `하단 탭의 업무를 가리킴 spot=${JSON.stringify(spot)} tabs=${JSON.stringify(tabs)}`);
      assert.ok(bub.y >= 0 && bub.y + bub.height <= spot.y + 1 && bub.x >= 0 && bub.x + bub.width <= 390, '말풍선은 탭 위·화면 안');
      await m.waitForTimeout(250); await m.screenshot({ path: `${SHOTS}/196-tour-mobile.png` });
      found = true; break;
    }
    await m.getByTestId('tour-next').tap(); await m.waitForTimeout(150);
  }
  assert.ok(found, '휴대폰 업무 탭 단계');
  assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '가로 넘침 없음');
  await m.getByTestId('tour-skip').tap();
  await mt.waitFor({ state: 'detached' });
  await mc.close();
});

await step('#443 실행 애니메이션: 앱을 처음 열면 로고(튀어나옴·체크 그리기·워드마크) 약 1초 뒤 사라짐 · 같은 실행(세션)에선 다시 안 나옴 · 동작 줄이기면 안 나옴', async () => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await login(c, 'tour77@dagym.test', 'tour77-pass-1234');
  assert.equal(await p.evaluate(() => sessionStorage.getItem('wos_intro')), '1', '첫 화면에서 재생됨');
  await p.waitForTimeout(1500);
  assert.equal(await p.locator('#wos-intro').count(), 0, '재생 뒤 지워짐');
  await p.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await p.locator('#wos-intro').count(), 0, '같은 세션 다시 열면 바로 없음');
  // 새 실행(세션) 흉내: 표시를 지우고 다시 열면 → 재생 중(로고·워드마크 보임) → 사라짐
  await p.evaluate(() => sessionStorage.removeItem('wos_intro'));
  await p.reload({ waitUntil: 'domcontentloaded' });
  const intro = p.getByTestId('launch-intro');
  assert.equal(await intro.getAttribute('class'), 'wi-play');
  await p.waitForTimeout(700); await p.screenshot({ path: `${SHOTS}/197-launch-intro.png` });
  await intro.waitFor({ state: 'detached', timeout: 3000 });
  await c.close();
  const rc = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', reducedMotion: 'reduce' });
  const rp = await login(rc, 'tour77@dagym.test', 'tour77-pass-1234');
  assert.equal(await rp.evaluate(() => sessionStorage.getItem('wos_intro')), null, '동작 줄이기 = 재생 안 함');
  assert.equal(await rp.locator('#wos-intro').count(), 0);
  await rc.close();
});

await step('#426 글 품질 엔진: 승인함 다듬기 필요·훅 약함 → 상세 글 품질 패널(훅 후보·미리보기) → [AI로 다듬기] v2 → 휴대폰 넘침 없음 → 말투 프로필 저장 → 플랫폼 글 품질 규칙', () => mktQuality({ owner, ctx, BASE, FAKE, SHOTS, sql }));

await step('#449 가입 전환 태그: 플랫폼 운영 [가입 전환 태그]에 Google Ads 전환 ID/라벨 저장 → 광고 클릭(gclid) 소개 화면 → 가입(광고 효과 측정 동의) → 회사가 만들어지는 순간 conversion 1회 + _gcl_aw · 동의 안 하면 안 보냄', async () => {
  srv.proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1000));
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50' });
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await owner.goto(BASE + '/platform');
  await owner.getByTestId('ct-googleAds').fill('AW-123456789/AbCdEf123');
  await owner.getByTestId('ct-save').click();
  await owner.getByText('가입 전환 태그를 저장했습니다').first().waitFor();
  const signupWith = async (email, consent) => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    const tagHits = [];
    await c.route(/googletagmanager\.com|googleadservices\.com|connect\.facebook\.net|wcs\.naver\.net/, (r) => { tagHits.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); });
    const p = await c.newPage();
    await p.goto(BASE + '/welcome?gclid=TeSt_GcLiD_1234567890');
    await p.waitForTimeout(500);
    // #627(153차): 소개 화면은 측정용 사이트 태그(gtag/js?id=AW-…)만 싣고, 전환(conversion) 이벤트는 가입 화면에서 동의한 브라우저만 보낸다
    assert.equal(tagHits.filter((u) => /googleadservices/.test(u)).length, 0, '소개 화면에서는 전환을 보내지 않음');
    assert.equal(await p.evaluate(() => (window.dataLayer ?? []).filter((a) => a[1] === 'conversion').length), 0, '소개 화면 dataLayer 에 전환 없음');
    await p.goto(BASE + '/signup');
    await p.getByLabel('이름').fill('전환시험'); await p.getByLabel('이메일').fill(email);
    await p.locator('input[type="password"]').first().fill('signup-pass-1234');
    for (const k of ['terms', 'privacy', 'age14']) await p.getByTestId(`agree-${k}`).check();
    await p.getByTestId('agree-ads').waitFor();
    if (consent) await p.getByTestId('agree-ads').check();
    await p.getByTestId('signup-next').click();
    await p.getByTestId('mode-team').click();
    await p.getByTestId('signup-step-company').locator('input').first().fill('전환시험상사');
    await p.getByTestId('signup-industry').selectOption({ index: 1 }); // 업종 필수
    await p.waitForTimeout(2700); // 가입 화면 연 뒤 2.5초 안 제출은 봇으로 봄
    await p.getByTestId('signup-submit').click();
    await p.getByTestId('signup-done').waitFor().catch(async (e) => { await p.screenshot({ path: 'test-results/debug-449.png', fullPage: true }); throw new Error(`가입 완료 화면 안 뜸: ${(await p.locator('[role="alert"]').allInnerTexts()).join(' | ')} — ${e.message.split('\n')[0]}`); });
    const dl = await p.evaluate(() => (window.dataLayer ?? []).map((a) => JSON.parse(JSON.stringify(Array.from(a)))));
    const cookies = await c.cookies();
    await c.close();
    return { dl, hits: tagHits, gcl: cookies.find((k) => k.name === '_gcl_aw')?.value };
  };
  const yes = await signupWith('conv-yes@workin.test', true);
  const conv = yes.dl.filter((a) => a[0] === 'event' && a[1] === 'conversion');
  assert.equal(conv.length, 1); assert.equal(conv[0][2].send_to, 'AW-123456789/AbCdEf123');
  assert.match(yes.gcl ?? '', /^GCL\.\d{10}\.TeSt_GcLiD_1234567890$/, '광고 클릭 id → Google 표준 쿠키');
  assert.ok(yes.hits.some((u) => u.includes('gtag/js?id=AW-123456789')), 'Google 태그 불러옴');
  const [t] = await sql`select t.id from tenants t join users u on u.tenant = t.id where u.email = 'conv-yes@workin.test'`;
  assert.ok(t, '회사가 만들어짐');
  const no = await signupWith('conv-no@workin.test', false);
  assert.equal(no.dl.filter((a) => a[1] === 'conversion').length, 0, '동의 안 하면 안 보냄');
  assert.equal(no.hits.filter((u) => /googleadservices/.test(u)).length, 0, '동의 안 하면 전환 호출 없음(소개 화면 측정 태그는 #627 로 실림)'); assert.equal(no.gcl, undefined);
  await ctx.owner.ok('PUT', '/api/platform/conversion-tags', { googleAds: '' });
});

await step('#509·#510 당일 공고 메일: 데이터 설정 받는 주소 직접 추가(형식 확인·칩)·보낸 사람 이름·발송 경로 안내 → [오늘 메일 미리보기] 구역·지역·미공개·D-day, 휴대폰 폭 넘침 없음 → 메일 제목 링크로 공고 상세 바로', () => digestMail({ owner, ctx, sql, BASE, SHOTS }));

await step('#192·#194 앱 1.1.3 웹 몫: 위젯 [+]·딥링크 /tasks?new=1 → 업무 등록 창(new 지움·새로고침에 다시 안 열림·같은 화면에서도 열림) · 브라우저에는 전체화면 알람 안내 없음', () => app113({ owner, BASE }));

await step('#242 대표 10/24 업무 목록 거르기 유지: 내 업무·검색어·스크롤 → 업무 열기(패널) → 닫기 단추·Esc·뒤로가기 = 같은 목록·같은 위치(주소에 view·q, 새로 고침도) · 전체 화면 [닫기] = 직전 화면 · 링크로 연 상세 [닫기] = 업무 목록 · 휴대폰 390', () => listKeep({ owner, ctx, BASE, SHOTS }));

await step('132차 확인 후속 ⑧ PC 대화방: 위로 올려 보다 사이드바로 다른 화면 → 뒤로가기 = 보던 자리(맨 아래로 안 감)', () => chatBackPc({ owner, ctx, BASE }));
await step('132차 확인 후속 ⑧-2 PC 대화방: 주소를 새로 열어 다른 화면 → 뒤로가기 = 보던 자리', () => chatBackPcHard({ owner, ctx, BASE }));
await step('로컬 QA 10/24 ②~⑥ 올리기 전 검사·사실 카드·주제 풀: 브랜드 키트 사실 카드(연락처·운영 시간·섞으면 안 되는 이름)·주제 풀 [AI로 주제 20개 제안] → 저장(빈 칸 빼고) → 릴스 상세 \'올리기 전 검사 n건\'·노란 칸은 그 밖만·대본(컷) 칸·주제 풀 표시 → 사람이 고친 수정본 = 승인 대기·검사 통과 → 휴대폰 넘침 없음', () => mktPreflight({ owner, ctx, BASE, FAKE, SHOTS, sql }));
await step('#242 2단계 다른 화면 돌아오기: 알림 탭·위치·방금 읽은 줄 · 홈 월 캘린더 달·날 · 프로젝트 보관함 · 영업 리드 정렬·우선·칩 · 허브 탭 · 마케팅 콘텐츠 캘린더 주 — 다른 화면에 갔다 뒤로가기 = 그대로', () => backKeep({ owner, ctx, sql, BASE }));

await step('대표 10/24 추가 ② 입찰 같은 제목: 취소 공고 = 원 공고 카드 \'취소\'·\'M/D 취소 공고\' · K-apt 재게시 한 장 \'2회 게시\' → [대상 아님으로](사유) → 전체 탭에서 빠짐 → [대상 아님 n건] 탭(누가·사유) → [되돌리기] · 상세 \'대상아님\' 사유·되돌리기 · 휴대폰 넘침 없음', () => bidGroups({ owner, ctx, sql, BASE, SHOTS }));
await step('메신저 2차(대표 10/20 카톡 수준 B8~B11·C13): 여기까지 읽음 선·긴 글 전체 보기·[+] 투표(실시간·누가·마감)·일정 잡기 카드·스티커·사진 3장 한 묶음·좌우 뷰어·@전체·메시지→일정(날짜·시각)·자주 쓰는 반응·답장 원문 이동(최신으로)·휴대폰 [+]·방 목록 밀기', () => messengerV4({ owner, ctx, sql, BASE, SHOTS }));
await step('137차 사전규격 ↔ 본 공고 같은 사업: 본 공고를 대상 아님 → 사전규격도 전체 탭에서 빠짐 → [대상 아님] 탭 한 장(같은 사업이라 함께 숨김) → [되돌리기] 둘 다', () => prespecLink({ owner, ctx, sql, BASE, SHOTS }));
await step('151차 영업 허브(대표 10/25 ①②④⑤⑥⑦⑨): 1열 · 정렬 주소 저장 · 시설 대상 아님 → 보관함(사유·누가) → 되돌리기 · 현 위탁사·계약만료일 · 넘긴 공고 [되돌리기] · 리드 [영업 진행으로]·실패 → 보류·실패 보관함 → 되돌리기 · 사이드바 입찰·공고 없음', () => hubArchive({ owner, ctx, sql, BASE, SHOTS }));
await step('154차 자료실 상세(대표 10/25 #615 ②·④): 사진 앱 안 보기창([← 목록]·뒤로가기로 닫힘·주소 ?file=) · 얼굴 실사 배지·촬영 동의 경고 · 문서 화면 [← 목록] → 폴더·줄 강조', () => libraryDetail({ owner, ctx, sql, BASE, SHOTS }));
await step('메신저 3차(대표 10/20 카톡 수준 C12·D14·D15): 머리줄 알림 메뉴(전체·멘션만·끄기)·목록 줄 표시·방 안 찾기(▲▼·강조·처음 화면 밖)·전체 검색 결과 → 그 메시지로·방 정보 알림 3칸·방장만 관리·방장 넘기기·방 사진', () => messengerV5({ owner, ctx, sql, BASE, SHOTS }));
await step('#533 업무 첨부 [고치기](대표 10/23 23:50): 첨부 있는 업무 제목·설명 고쳐 저장 → 그대로 · 글 고쳐 v2(글 고침) · 사진 돌리기·펜 v2(가로·세로 바뀜, 크기 표시 바로 — #258) · PDF 글자·체크 v2(긴 글 줄바꿈·글자 줄이기, 넘치면 저장 막기 — #258) · 저장 PDF 다시 읽기(글 그대로·한글 그려짐 — 147차) · 한글 = 내려받아 고친 뒤 올리기 안내 → v2 · 휴대폰 폭 [고치기]', () => attachEdit({ owner, ctx, BASE, SHOTS }));
await step('139차 전자계약 2차 화면: [새 계약] PDF 올리기 → 서명자 → 칸 놓기(쪽 그림·서명·글자) → 보내기 → 받은 사람 휴대폰 화면 PDF 쪽·칸 채우기·서명 완료', () => econtractPdf({ owner, ctx, sql, BASE, SHOTS }));
await step('192차 결제 시험 화면(대표 10/27): 결제 모듈 상태(설정 필요·정상·확인 필요 + 운영 결제 방식) + [시험 결제]만 · 시험 회사 만들기·목록·지우기 없음 · 숨은 시험 계정 하나 다시 씀 · 고객사 목록에 없음 · 휴대폰 폭', () => payTest192({ owner, ctx, sql, BASE, SHOTS }));
await step('#565 플랫폼 운영 정리(대표 10/24 저녁 1): 오늘 볼 것 5개 → 누르면 그 탭 · 종류별 탭 5개·한 줄 설명·주소 유지 · 예전 주소(paytest·#support) · 휴대폰 폭', () => platformTabs({ owner, ctx, sql, BASE, SHOTS }));
await step('#235 마케팅 시안 품질 ⓐ·ⓔ(로컬 10/24 저녁 6): 브랜드 키트 이번 달 소식(기간 기본 30일)·잘 된 예시 글(형식별·좋은 점·빼기) → 승인한 글 [좋은 예시로 저장]·[예시에서 빼기] → 휴대폰 넘침 없음', () => mktDraftQuality({ owner, ctx, BASE, SHOTS, sql }));
await step('#235 ⓒ 사진 AI 설명(대표 #563): 자동 제작 › 사진 AI 설명 [설명 없는 사진 설명하기] → 숫자·사진별 설명·종류·글자·홍보물·쓰임 → 판정 고치기(글자 없음 = 바탕으로 씀)·되돌리기 → 자료실 AI 사진 설명 줄 → 휴대폰 넘침 없음', () => mktPhotos({ owner, ctx, BASE, FAKE, SHOTS, sql }));
await step('#235 ⓑ 블로그 네이버 형식(대표 #256): 글 모델 블로그 줄(비용) · 사실 카드 블로그 검색 키워드 · 사진 판정 쓰지 않음(로컬 10/25) → 승인한 블로그 상세 블로그 형식 줄 · 게시 도우미 표지·사진 n 순서·[사진 n] 안내 → 휴대폰 넘침 없음', () => mktBlog({ owner, ctx, BASE, SHOTS, sql }));
await step('186차 입주 시기 목록(로컬 10/26 19:20 B2): 영업기회 [입주 시기(6개월 전~12개월 뒤)] → 창 안 3곳만·입주 예정월 늦은 것부터·입주까지 n개월/이번 달 입주/입주 n개월 지남 → 휴대폰 넘침 없음 → 끄면 전체 · B1 수집기 칸 신규 공동주택 단지 카드(09·11·13·15시·서비스 번호)', () => moveIn186({ owner, ctx, sql, BASE, SHOTS }));
await step('#592 휴대폰 캘린더 주 보기 구글 수준(대표 10/25): 390px 칸 40px·한 화면 14시간 이상 · 블록 11px 중간 굵기 2줄 · 앞머리 [태그] 떼기(부재 종류 유지, 일 보기 그대로) · 종일 줄 기본 켬(2개 + +1개 → 그날 목록) · 미팅 단추 둥근 48px·아래로 밀면 숨김 · 3일 48·일 64px', () => cal592({ browser, desk, ctx, BASE, SHOTS, addDays, today }));
await step('#599 새 고객사 시뮬레이션(대표 10/25 저녁·로컬 16:50): 시험 서버 가입 → 회사 정보·업종 → 확인 링크 → 온보딩 3단계 → 첫 화면(1366·390) → 공간 켜기 → 영업 데이터 설정 → 마케팅 첫 화면·자동 제작 → 사용량 → 알림 — SUPER_ADMIN_SCOPE §3 점검(내부 이름·수집기 문구·연결 3단계·첫날 알림·원가/모델 이름)·API 금지 낱말(#602 뒤 발견 0건 단언)', async () => {
  srv.proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1000));
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50' });
  await customerSim({ browser, BASE, SHOTS, sql });
});

await step('#626 캡처 차단(대표 10/25 20:05): 외부 고객사 로그인 → 워터마크(회사·이름·시각)·인쇄 차단(html.capture-block)·Ctrl+P 안내·창 이탈 가림·자동화 판정(시험 서버는 판정만) → 사건 기록 / 우리 회사(내부)는 워터마크 없음', async () => {
  srv.proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 1000));
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50' });
  await captureGuard({ browser, BASE, SHOTS, sql, Client, owner });
});

// 본사가 생기면 맨 위 부서를 새로 만들 수 없어 맨 끝(앞 단계들이 맨 위 부서를 만듦)
await step('P2 조직 개편 4단(대표 10/26 · #679~#681): 종류 카드 4개·본사 만들며 맨 위 부서 이관·사업부 위 단위는 본사만·사업부장 없음·이름-종류 검사 → 사용자 목록 왕관 칩·장 비게 됨 경고 → 업무 함께하는 부서', () => orgLevels({ owner, ctx, BASE, SHOTS }));
await step('197차 영업 진행 목록 개편(#461·#460): 오늘 볼 것 띠 → 다음 행동 없음 경고 → 열 머리 정렬 · 열 고르기 · 보기 저장(새로 고침에도) → 업무 [완료] 다음 행동 창(1주 뒤 + 할 일 · 종결 보류·사유·다시 볼 날) → 종결 보기 · 휴대폰 카드', () => leadList197({ owner, ctx, sql, BASE, SHOTS }));
await step('#690 캘린더 끌기 15분 단위(대표 10/26): 주 보기 일정 15분만큼 끌기 → 10:15(잡은 자리 그대로) · 클릭 = 정시 1시간 · 끌어 그리기 14:15~15:00 · PC [끌기 단위 30분] → 15분 끌어도 10:45 · 휴대폰 칩도 같은 기억', () => calSnap199({ owner, ctx, sql, BASE }));
await step('200차 #699 준공·입주 시설 원본 기준일(대표 10/26): K-apt 자료실 추출일(주 1회) · 한국부동산원 파일 수정일(연 1회) 한 줄 · 자료실 단지 카드(전화·세대수·주민운동시설) · 1366·390 넘침 없음 · 기준일 없으면 줄 없음', () => kaptWeekly200({ owner, ctx, sql, BASE, SHOTS }));
await step('200차 #706 간편결제 바로 열기(대표 10/26): 켠 간편결제만 버튼 · [필수] 결제 대행 약관 동의 없으면 안 열림 · 결제창 요청 = 카드 + 간편결제 + 동의 · 다른 수단 고르면 풀림 · 결제 내역 간편결제 이름 · 1366·390', () => easyPay200({ owner, BASE, SHOTS }));
await step('202차 #461 ⑤ 본사 주간 보고 영업 진행(놓침 방지): 연락일 지남·다음 행동 없음·오래 쉼(14일)·담당 없음 + 오래 쉼 목록(단계·담당·마지막 접촉·리드 링크) · 1366·390', () => salesBrief202({ owner, ctx, sql, BASE, SHOTS }));
await step('203차 #461 ⑥ 칸반 끌어 놓기·휴대폰 카드 밀기: 끌면 묻는 창(다음 연락일 / 보류 사유·다시 볼 날) · 취소 = 그대로 · select 도 같은 창 · 390 → 연락함 기록 · ← 다음 연락일 · 종결은 밀기 없음', () => leadMove203({ owner, ctx, sql, BASE, SHOTS }));
await step('204차 #461 ⑦ 표 일괄 작업: 체크 → 아래 막대 · 다음 연락일 일괄 · 단계 일괄(보류 사유 필수) · 2차 정렬(Shift+클릭) · 표의 단계 바꾸기 = 묻는 창 · 종결 보기엔 체크 칸 없음', () => leadBulk204({ owner, ctx, sql, BASE, SHOTS }));
await step('205차 #461 ⑦ CSV 가져오기 미리보기: 이미 있음 = 기본 합치기(빈 칸만) · 같은 연락처(사업자번호) = 기본 새로 → 합치기 · 파일 안 겹침 = 건너뛰기 · 상세 사업자번호', () => leadImport205({ owner, ctx, sql, BASE, SHOTS }));
await step('206차 #461 ⑦ 기존 거래처끼리 합치기: 상세 › 중복 합치기 → 같은 전화 후보 → 남길 쪽 제안·채울 칸 → 합치기 → 남긴 쪽 상세 · 예전 링크도 남긴 쪽 · 목록에서 빠짐', () => leadMerge206({ owner, ctx, sql, BASE, SHOTS }));
await step('207차 #461 회사별 단계 이름: 데이터 설정 › 이름·색·숨김 저장 → 영업 진행 표·상세 칩·진행 단계 칸에 회사 이름 · 숨긴 단계는 고르는 칸에서 빠짐 · 저장 값 그대로', () => stageNames207({ owner, ctx, sql, BASE, SHOTS }));
await step('208차 #667 설계 파트너: [고객사 추가] 구분 = 설계 파트너 → 기간 꼭 적기(기본값 없음)·체험 고정 → AI 월 5,000원·마케팅 크레딧 0 상자 → 끝 3일 전 슈퍼관리자 알림 링크로 그 회사 창 → 기간 +30일·지금 종료 → 파트너 화면 읽기 전용 띠', () => partner208({ owner, browser, ctx, sql, BASE, SHOTS, tick, Client }));
await step('209차 #666 영상 선행 조건: 브랜드 키트 주인공(실존 인물은 동의 표시 뒤에만 사진) → 출연진 고정 릴스(장면 첫 사진 → 이미지→영상) · 장면 칩 훅·해결·상황·결과 · 검수 기준 5개 통과 → 휴대폰 폭', () => mktVideo209({ owner, ctx, sql, BASE, FAKE, SHOTS }));
await step('210차 #619 자료실 자동 분류: 영상 올리면 장면 사진 2장(처음 쪽·가운데)을 AI 정리에 · 확신 70% 미만만 정리 필요 → 안내 줄·모두 선택·[정리 맞음] 묶어서 확인 → 보기에서 나옴 · 휴대폰 폭', () => library210({ owner, sql, BASE, FAKE, SHOTS }));
await step('211차 대표 10/27: ② 업무 사진 14장(휴대폰) → 한 줄 진행·사진 n장 묶음(+3)·사진첩 고르기 → 지우기·활동 기록 한 줄 · ④ 같은 입찰 일정+업무 = 캘린더 한 줄 · ⑤ 마케팅 요금제는 사용량·요금제 화면', () => ceo211({ owner, ctx, sql, BASE, SHOTS }));
await step('212차 #612 후속조사: 머리 줄 [이번 주 묶음 지금 만들기] → 업무 하나 · 카드 미확인·조사 예정 날짜(담당) · 업무 완료 창에 곳마다 값 → 카드 현 위탁사·계약만료 · 비운 곳 확인 못함', () => research212({ owner, ctx, sql, BASE, SHOTS }));
await step('213차 대표 10/27 18:35 아이폰 사진 147장: [사진·영상] 고르기 창 → 준비 중 띠(취소하면 걷힘·파일이 들어오면 진행) · 메신저 35장 한 묶음(30장 잘림 없앰)·고른 순서', () => photos213({ owner, ctx, sql, BASE, SHOTS }));

await browser.close();
srv.proc.kill();
fake.server.close();
await sql.end();
const failed = results.filter((r) => !r.ok);
console.log(`\nE2E ${results.length - failed.length}/${results.length} 통과`);
const { writeFileSync } = await import('node:fs');
writeFileSync('test-results-e2e.json', JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(failed.length ? 1 : 0);
