// 211차 대표 10/27: ② 업무에 사진 여러 장(휴대폰) — 3장씩 함께 올리고 한 줄 진행(올린 수/전체·실패), 사진은 '사진 n장' 묶음(앞 11장 + '+n') · 사진첩(날짜별·고르기 → 지우기) · 활동 기록 한 줄
// ④ 같은 입찰의 일정('[영업] 입찰 마감 · 단지')과 업무('[영업] 단지 — 입찰 서류')는 캘린더 한 줄(일정 + '업무 1') · ⑤ 마케팅 제작 요금제는 사용량·요금제 화면(요금제마다 남은 크레딧), 자동 제작실엔 링크만
import assert from 'node:assert/strict';
import sharp from 'sharp';

export async function ceo211({ owner, ctx, sql, BASE, SHOTS }) {
  // ② 휴대폰 폭에서 사진 14장
  await owner.setViewportSize({ width: 390, height: 844 });
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 211 현장 사진 정리', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
  const files = await Promise.all(Array.from({ length: 14 }, async (_, k) => ({ name: `E2E현장${String(k + 1).padStart(2, '0')}.png`, mimeType: 'image/png',
    buffer: await sharp({ create: { width: 96, height: 96, channels: 3, background: { r: (k * 37) % 255, g: (k * 71) % 255, b: (k * 113) % 255 } } }).png().toBuffer() })));
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('attachments').waitFor();
  await owner.getByTestId('album-input').setInputFiles(files);
  await owner.getByTestId('upload-summary').waitFor();
  await owner.getByText('14개 첨부 완료').first().waitFor({ timeout: 60_000 });
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null and upload_status = 'ready'`)[0].n, 14);
  const more = owner.getByTestId('photo-more'); await more.waitFor();
  assert.equal((await more.innerText()).trim(), '+3', '앞 11장 + 나머지 3장');
  assert.equal(await owner.getByTestId('photo-grid').locator('[data-photo]').count(), 11);
  await owner.getByTestId('att-photo-summary').getByText('사진 14장').waitFor();
  assert.equal(await owner.getByTestId('attachments').getByText('E2E현장01.png').count(), 0, '파일 목록에 사진 줄 없음');
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, '휴대폰 폭 넘침 없음');
  await owner.getByTestId('photo-section').scrollIntoViewIfNeeded();
  await owner.waitForFunction(() => [...document.querySelectorAll('[data-testid="photo-grid"] img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 }).catch(() => {});
  await owner.screenshot({ path: `${SHOTS}/557-task-photo-grid.png` });
  // 사진첩: 날짜별 · 고르기 → 2장 지우기
  await more.click();
  const album = owner.getByTestId('photo-album'); await album.waitFor();
  assert.equal(await album.getByTestId('photo-album-item').count(), 14);
  // 사진 칸은 loading=lazy — 다 그려진 뒤 찍음(빈 회색 칸 캡처 방지)
  await owner.waitForFunction(() => [...document.querySelectorAll('[data-testid="photo-album-item"] img')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 }).catch(() => {});
  await owner.screenshot({ path: `${SHOTS}/558-task-photo-album.png` });
  await album.getByTestId('photo-album-pick').click();
  await album.getByTestId('photo-album-item').nth(0).click(); await album.getByTestId('photo-album-item').nth(1).click();
  await album.getByTestId('photo-album-count').getByText('2장 선택').waitFor();
  owner.once('dialog', (d) => d.accept());
  await album.getByTestId('photo-album-delete').click();
  await owner.getByText('사진 2장을 지웠습니다').first().waitFor();
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="photo-album-item"]').length === 12, null, { timeout: 15_000 }); // 업무를 다시 불러오면 사진첩도 12장
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null`)[0].n, 12);
  await album.getByTestId('photo-album-close').click(); await album.waitFor({ state: 'detached' });
  // 활동 기록: 첨부 14개가 한 줄
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByRole('tab', { name: '변경 이력' }).click();
  const hf = owner.getByTestId('hist-files').first(); await hf.waitFor();
  assert.match(await hf.innerText(), /^14개 — .+ 외 11개$/);

  // ④ 같은 입찰: 일정 + 업무 = 캘린더 한 줄
  const day = '2026-11-20';
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'company');
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: '[영업] 입찰 마감 · E2E211단지 [경기] 커뮤니티 위탁 운영', start: `${day}T17:00:00+09:00`, end: `${day}T18:00:00+09:00` });
  await ctx.owner.ok('POST', '/api/tasks', { title: '[영업] E2E211단지 [경기] 커뮤니티 위탁 운영 — 입찰 서류 제출', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false, dueDate: day, dueTime: '17:00' });
  await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${day}`);
  const items = owner.locator('.fc-event').filter({ hasText: 'E2E211단지' });
  await items.first().waitFor();
  await owner.waitForTimeout(300);
  assert.equal(await items.count(), 1, '같은 입찰은 한 줄');
  assert.match(await items.first().innerText(), /· 업무 \S+/, '246차 #770 묶인 업무 담당(1건이면 이름)');

  // ⑤ 요금제는 사용량·요금제 화면 한곳에(마케팅 공간을 켠 회사)
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.goto(`${BASE}/admin/usage`);
  const plan = owner.getByTestId('mkt-plan'); await plan.waitFor();
  for (const k of ['basic', 'standard', 'pro']) assert.match(await plan.getByTestId(`auto-plan-left-${k}`).innerText(), /^이번 달 [\d.]+ 크레딧 (남음|초과)$/, k);
  await plan.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/559-usage-marketing-plan.png` });
  await owner.goto(`${BASE}/s/marketing/automation`);
  await owner.getByTestId('auto-plan-link').waitFor();
  assert.equal(await owner.getByTestId('auto-plan-standard').count(), 0);
}
