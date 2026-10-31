// V30 P1 ① 엑셀·CSV 업무 가져오기 화면: PC 표 미리보기·담당자 고르기·만들기·되돌리기, 휴대폰 카드 미리보기
import assert from 'node:assert/strict';
export async function v30import({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks`);
  const me = await owner.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user);
  const csv = `﻿제목,담당자,마감일,우선순위,상태,설명\n월간 안전 점검표 제출,${me.name},2026-11-03,높음,진행 전,사진 첨부\n소방 설비 견적 받기,모르는사람,11/10,긴급,,업체 3곳\n회원 이용 현황 정리,${me.name},날짜아님,보통,진행 중,\n`;
  const file = { name: '업무_가져오기.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') };
  await owner.getByTestId('task-import-open').click();
  await owner.waitForURL(/\/tasks\/import$/);
  await owner.getByTestId('import-file').setInputFiles(file);
  await owner.getByTestId('import-preview').waitFor();
  assert.equal(await owner.getByTestId('map-title').inputValue(), '0');
  assert.equal(await owner.getByTestId('map-assignee').inputValue(), '1');
  await owner.getByTestId('import-unmatched').getByText('모르는사람').waitFor();
  await owner.getByTestId('count-errors').getByText('오류 1').waitFor();
  await owner.getByTestId('unmatched-select').selectOption(me.id);
  await owner.getByTestId('count-ready').getByText('만들 업무 2').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v30-import-pc.png`, fullPage: true });
  await owner.getByTestId('import-run').click();
  await owner.getByTestId('import-done').getByText('업무 2건을 만들었습니다').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v30-import-done.png` });
  owner.once('dialog', (d) => d.accept());
  await owner.getByTestId('import-undo').click();
  await owner.getByTestId('import-done').getByText('휴지통으로 옮겼습니다').waitFor();
  // 휴대폰: 같은 파일 → 카드 미리보기
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/tasks/import`);
  await owner.getByTestId('import-file').setInputFiles(file);
  await owner.getByTestId('preview-card').first().waitFor();
  assert.equal(await owner.getByTestId('preview-card').count(), 3);
  const sw = await owner.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 392, `휴대폰 가로 넘침 ${sw}`);
  await owner.screenshot({ path: `${SHOTS}/v30-import-phone.png`, fullPage: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
}

/** 로컬 실기기 83: 휴대폰 업무 상세 → 문자·메일 시안 시트가 스크롤되고, 댓글 입력줄이 버튼 줄을 가리지 않음 */
export async function sheetPhone({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 390, height: 700 });
  const t = await owner.evaluate(async () => (await (await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '시트 스크롤 시험', approvalRequired: false }) })).json()));
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('comment-form').waitFor();
  await owner.getByTestId('mail-compose-open').click();
  await owner.getByTestId('mail-compose').waitFor();
  assert.equal(await owner.getByTestId('comment-form').isVisible(), false, '시트가 열린 동안 댓글 입력줄 숨김');
  for (const ch of ['email', 'sms']) {
    if (ch === 'sms') await owner.getByTestId('mail-channel-sms').click();
    const bar = owner.getByTestId('compose-actions');
    const box = await bar.boundingBox(); const dlg = await owner.getByRole('dialog').boundingBox();
    // 176차: CI 글꼴·소수점 차이로 1px 넘친 적 있어 여유 8px
    assert.ok(box && box.y + box.height <= Math.min(700, dlg.y + dlg.height) + 8 && box.y > 300, `${ch}: 버튼 줄이 화면 아래에 보임 (${box?.y}+${box?.height}, 시트 끝 ${dlg.y + dlg.height})`);
    const scrolled = await owner.getByRole('dialog').evaluate((d) => { d.scrollTop = 10000; return d.scrollTop > 0 || d.scrollHeight <= d.clientHeight; });
    assert.ok(scrolled, `${ch}: 시트 스크롤`);
  }
  await owner.screenshot({ path: `${SHOTS}/v31-sheet-phone.png` });
  await owner.keyboard.press('Escape');
  await owner.getByTestId('comment-form').waitFor();
  await owner.evaluate(async (id) => { await fetch(`/api/tasks/${id}`, { method: 'DELETE' }); }, t.id);
  await owner.setViewportSize({ width: 1366, height: 900 });
}

/** V32 0: 알림 화면 — 안 읽은 것만 기본, 누르면 바로 읽음(배지 감소), 업무 화면을 열면 그 알림 자동 읽음, 전체 탭에는 남음 */
export async function notifRead({ owner, BASE, SHOTS, ctx }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await ctx.owner.ok('POST', '/api/notifications/read', { all: true });
  const mk = async (title) => (await ctx.staffA.client.ok('POST', '/api/tasks', { title, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  const a = await mk('알림읽음 시험 A'), b = await mk('알림읽음 시험 B'), c = await mk('알림읽음 시험 C'), d = await mk('알림읽음 시험 D');
  await owner.goto(`${BASE}/notifications`);
  const list = owner.getByTestId('notifications');
  await list.getByText('알림읽음 시험 A', { exact: false }).waitFor();
  await owner.getByTestId('notif-unread').getByText('안 읽음 4').waitFor();
  // #110 줄마다 [읽음] → 흐리게 남고 배지 즉시 감소
  const rowC = list.locator('[data-testid="notif-item"]', { hasText: '알림읽음 시험 C' });
  await rowC.getByTestId('notif-read').click();
  await owner.getByTestId('notif-unread').getByText('안 읽음 3').waitFor();
  await list.locator('[data-testid="notif-item"][data-read="1"]', { hasText: '알림읽음 시험 C' }).waitFor(); // 읽은 줄이 흐리게 남음
  assert.equal(await rowC.getByTestId('notif-read').count(), 0, '읽은 줄에는 [읽음] 버튼 없음');
  // #110 [선택] → 체크 → 선택 띠 [보관] → 목록에서 빠지고 보관함 탭에
  await owner.getByTestId('notif-select').click();
  await list.locator('[data-testid="notif-item"]', { hasText: '알림읽음 시험 D' }).getByTestId('notif-check').check();
  await owner.getByTestId('notif-sel-bar').getByText('1건 선택').waitFor();
  // 화면은 바로 빼고 저장은 그 뒤 — 저장 응답 전에 보관함을 열면 D 가 아직 없음(자동 검사 1587번: 보관함에서 D 를 30초 기다림)
  await Promise.all([owner.waitForResponse((r) => r.url().includes('/api/notifications/read') && r.request().method() === 'POST'), owner.getByTestId('notif-sel-archive').click()]);
  await owner.getByTestId('notif-unread').getByText('안 읽음 2').waitFor();
  assert.equal(await list.getByText('알림읽음 시험 D', { exact: false }).count(), 0, '보관한 알림은 목록에서 빠짐');
  await owner.getByTestId('notif-archived').click();
  await owner.getByTestId('notifications').getByText('알림읽음 시험 D', { exact: false }).waitFor();
  await owner.getByTestId('notifications').locator('[data-testid="notif-item"]', { hasText: '알림읽음 시험 D' }).getByTestId('notif-unarchive').waitFor();
  await owner.screenshot({ path: `${SHOTS}/183-notif-row-read.png` });
  await owner.getByTestId('notif-unread').click();
  await list.getByText('알림읽음 시험 A', { exact: false }).waitFor();
  await list.getByText('알림읽음 시험 A', { exact: false }).click();
  await owner.waitForURL((u) => new URL(u).searchParams.get('task') === a || new URL(u).pathname === `/tasks/${a}`); // 300차 #850: 업무는 패널로(?task=)
  // 업무 B 를 직접 열면 자동 읽음
  await owner.goto(`${BASE}/tasks/${b}`);
  await owner.waitForFunction(async () => (await (await fetch('/api/notifications?unread=1')).json()).unread === 0, null, { timeout: 10000 });
  await owner.goto(`${BASE}/notifications`);
  // 안 읽은 목록에서 두 알림이 빠짐(그사이 예약 알림 등 다른 알림이 올 수 있어 "비었음" 대신 이 두 건으로 확인)
  await owner.locator('[data-testid="notifications"], :text("새 알림이 없습니다")').first().waitFor();
  // 목록이 새로 받아질 때까지 잠깐 기다림(먼저 그려진 옛 목록 대신)
  for (let i = 0; i < 25 && (await owner.getByText('알림읽음 시험', { exact: false }).count()) > 0; i++) await owner.waitForTimeout(200);
  assert.equal(await owner.getByText('알림읽음 시험', { exact: false }).count(), 0, '읽은 알림은 안 읽음 목록에 없음');
  await owner.getByTestId('notif-all').click();
  await owner.getByTestId('notifications').getByText('알림읽음 시험 B', { exact: false }).waitFor();
  await owner.getByTestId('notifications').getByText('알림읽음 시험 C', { exact: false }).waitFor();
  assert.equal(await owner.getByTestId('notifications').getByText('알림읽음 시험 D', { exact: false }).count(), 0, '보관한 알림은 전체 탭에도 없음');
  await owner.screenshot({ path: `${SHOTS}/v32-notifications.png` });
  void c; void d;
}

/** 로컬 실기기: 휴대폰 업무 상세(알림으로 #c-댓글 주소로 열림)에서 체크리스트를 체크해도 화면이 댓글로 내려가지 않음 */
export async function checkScroll({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 390, height: 844 });
  const t = await owner.evaluate(async () => {
    const j = (u, b) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const task = await j('/api/tasks', { title: '체크 스크롤 시험', approvalRequired: false, checklist: ['첫째 단계', '둘째 단계', '셋째 단계'], description: '설명\n'.repeat(30) });
    const c = await j(`/api/tasks/${task.id}/comments`, { body: '아래쪽 댓글' });
    return { id: task.id, comment: c.id };
  });
  await owner.goto(`${BASE}/tasks/${t.id}#c-${t.comment}`);
  const box = owner.getByTestId('checklist').getByRole('checkbox', { name: '둘째 단계' });
  await box.waitFor();
  await owner.waitForTimeout(800); // 처음 한 번은 댓글로 이동 — 그 뒤 체크리스트로 올라와서 시험
  await box.scrollIntoViewIfNeeded();
  await owner.evaluate(() => window.scrollBy(0, -120));
  const before = (await box.boundingBox()).y;
  const done = owner.waitForResponse((r) => r.url().includes('/api/checklist/') && r.request().method() === 'PATCH');
  await box.check();
  await done;
  await owner.waitForTimeout(700); // 다시 읽고 그린 뒤
  const after = (await box.boundingBox()).y;
  assert.ok(Math.abs(after - before) < 4, `체크 뒤 화면이 움직임 ${before} → ${after}`);
  assert.equal(await owner.evaluate(() => document.activeElement?.getAttribute('aria-label')), '둘째 단계', '포커스는 체크박스에');
  await owner.screenshot({ path: `${SHOTS}/v32-check-scroll.png` });
  await owner.evaluate(async (id) => { await fetch(`/api/tasks/${id}`, { method: 'DELETE' }); }, t.id);
  await owner.setViewportSize({ width: 1366, height: 900 });
}

/** 대표 10/20 15:05 (#101) 권한 배지: 사용자 관리 대표 줄 CEO · 회사 정보·디자인에서 한글로 → 새로 고침 뒤 '대표' · 끄기 → 배지 없음 · 영어로 복구 */
export async function roleBadge({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  const ceoRow = owner.getByTestId('users').locator('tr', { hasText: 'ceo@dagym.test' });
  await ceoRow.getByTestId('role-badge').filter({ hasText: 'CEO' }).waitFor();
  assert.equal(await ceoRow.getByTestId('role-badge').getAttribute('data-role'), 'owner');
  await owner.screenshot({ path: `${SHOTS}/184-role-badge.png` });
  await owner.goto(`${BASE}/admin/company`);
  await owner.getByTestId('role-badge-ko').click(); // 통제 라디오: 저장 뒤 다시 읽어 바뀜 → check() 대신 click()
  await owner.getByText('권한 배지 표시를 바꿨습니다', { exact: false }).waitFor();
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('users').locator('tr', { hasText: 'ceo@dagym.test' }).getByTestId('role-badge').filter({ hasText: '대표' }).waitFor();
  await owner.goto(`${BASE}/admin/company`);
  await owner.getByTestId('role-badge-off').click();
  await owner.getByText('권한 배지 표시를 바꿨습니다', { exact: false }).waitFor();
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('users').locator('tr', { hasText: 'ceo@dagym.test' }).waitFor();
  assert.equal(await owner.getByTestId('users').getByTestId('role-badge').count(), 0, '끄면 배지 없음');
  await owner.goto(`${BASE}/admin/company`);
  await owner.getByTestId('role-badge-en').click();
  await owner.getByText('권한 배지 표시를 바꿨습니다', { exact: false }).waitFor();
}

/** 대표 10/20 16:20 (#106) 휴대폰 말풍선: 390px 에서 보임·안 읽은 수 배지 → 누르면 최근 대화방 → 대화방 안에서는 숨김 → 설정에서 끄면 사라짐 → 다시 켬 */
export async function chatBubble({ owner, ctx, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 390, height: 844 });
  const room = await ctx.staffA.client.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.ownerId });
  await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room.id}/messages`, { body: '말풍선 시험 메시지' });
  // 대표 10/22(#422): 하단 탭에 '메시지'가 생겨 말풍선은 기본 끔 → 설정에서 켜야 보임
  await owner.goto(`${BASE}/`);
  await owner.getByTestId('mobile-tabs').waitFor();
  assert.equal(await owner.getByTestId('chat-bubble').count(), 0, '기본 끔');
  await owner.goto(`${BASE}/settings`);
  await owner.getByTestId('chat-bubble-toggle').check();
  await owner.goto(`${BASE}/`);
  await owner.getByTestId('chat-bubble').waitFor();
  await owner.getByTestId('chat-bubble-badge').waitFor();
  await owner.screenshot({ path: `${SHOTS}/185-chat-bubble.png` });
  await owner.getByTestId('chat-bubble').click();
  await owner.waitForURL(new RegExp(`/messages\\?room=${room.id}`));
  await owner.waitForSelector('html[data-chat-room]');
  assert.equal(await owner.getByTestId('chat-bubble').count(), 0, '대화방 안에서는 숨김');
  await owner.goto(`${BASE}/settings`);
  await owner.getByTestId('chat-bubble-toggle').uncheck();
  await owner.goto(`${BASE}/`);
  await owner.getByTestId('mobile-tabs').waitFor();
  assert.equal(await owner.getByTestId('chat-bubble').count(), 0, '설정에서 끄면 없음');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
