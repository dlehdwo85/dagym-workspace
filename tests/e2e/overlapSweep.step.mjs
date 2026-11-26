// 대표 11/26 상시 규칙 '겹침 금지'·'낱말 중간 줄바꿈 금지'(휴대폰 375·412) 자동 검사: 375·412·1024·1880 네 폭 × 주요 화면 전부에서 글자·칩·아이콘 겹침과 칸 밖 넘침을 찾는다(tests/e2e/overlap.mjs)
// 시험 자료: 긴 제목 + 첨부 다섯 가지(HWPX 2·HWP·PDF·XLSX) + 시각 있는 마감 + 댓글 — 대표 갤럭시에서 첨부 칩이 마감 칸 위로 겹쳐 그려진 업무 줄과 같은 모양
// 하나라도 있으면 실패(OVERLAP_REPORT=1 이면 목록만 남기고 통과 — 처음 전수 조사용)
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { findOverlaps, findWordBreaks, overlapText } from './overlap.mjs';

const WIDTHS = [375, 412, 1024, 1880];

export async function overlapSweep({ browser, desk, ctx, sql, BASE, SHOTS }) {
  // ── 시험 자료
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '[입찰] 2027년 하남시 체육시설 통합 위탁운영 및 시설물 유지관리 용역 제안서 작성·제출 준비(겹침 검사)', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: ymd(7), dueTime: '17:00', approvalRequired: false });
  const up = async (name, mime) => {
    const r = await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'file', fileName: name, mimeType: mime, size: 12 });
    await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: Buffer.from('overlap-test') }); await ctx.owner.ok('POST', `/api/attachments/${r.id}/complete`, {});
  };
  for (const [n, m] of [['과업지시서.hwpx', 'application/haansofthwpx'], ['제안요청서.hwpx', 'application/haansofthwpx'], ['산출내역.hwp', 'application/x-hwp'], ['공고문.pdf', 'application/pdf'], ['단가표.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']]) await up(n, m);
  await ctx.owner.ok('POST', `/api/tasks/${t.id}/comments`, { body: '겹침 검사용 댓글 — 첨부 다섯 개와 긴 제목' }).catch(() => {});
  const [{ platform_admin: wasAdmin }] = await sql`select platform_admin from users where id = ${ctx.ownerId}`;
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; // 플랫폼 관리 화면도 보려고(끝나면 되돌림)

  const SCREENS = [
    ['홈', '/', 'home-todo'],
    ['업무 목록', '/tasks', null],
    ['업무 보드', '/tasks?view=board', null],
    ['업무 상세', `/tasks/${t.id}?full=1`, null],
    ['캘린더 월', '/calendar?view=dayGridMonth', null],
    ['캘린더 주', '/calendar?view=timeGridWeek', null],
    ['메시지', '/messages', null],
    ['결재', '/approvals', null],
    ['보고', '/reports', null],
    ['영업 허브', '/s/sales/hub', null],
    ['영업 공고', '/s/sales/hub?tab=bids&bt=all', null],
    ['마케팅 승인함', '/s/marketing/approvals', null],
    ['설정', '/settings', null],
    ['플랫폼 관리', '/platform', null],
  ];
  const found = [];
  try {
    for (const w of WIDTHS) {
      const mobile = w < 640;
      const c = await browser.newContext({ viewport: { width: w, height: mobile ? 844 : 900 }, ...(mobile ? { isMobile: true, hasTouch: true } : {}), locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', storageState: await desk.storageState() });
      try {
        const p = await c.newPage();
        for (const [name, path, testid] of SCREENS) {
          const r = await p.goto(BASE + path, { waitUntil: 'domcontentloaded' });
          if (!r || r.status() >= 400) continue; // 켜지 않은 공간 등
          if (testid) await p.getByTestId(testid).first().waitFor({ timeout: 20_000 }).catch(() => {});
          await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
          await p.waitForTimeout(400);
          const res = await findOverlaps(p);
          if (w <= 412) { const wb = await findWordBreaks(p); res.count += wb.count; res.issues.push(...wb.issues); } // 휴대폰 폭: 낱말 중간 줄바꿈도
          if (res.count) { found.push({ w, name, path, ...res }); await p.screenshot({ path: `${SHOTS}/overlap-${w}-${name.replace(/\s/g, '_')}.png` }).catch(() => {}); }
        }
      } finally { await c.close(); }
    }
    // 검사기 자체 확인: 업무 목록(412)에서 첨부 칩을 일부러 칸보다 넓게(대표 갤럭시에서 본 모양) → 반드시 겹침으로 잡아야 함
    {
      const c = await browser.newContext({ viewport: { width: 412, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', storageState: await desk.storageState() });
      try {
        const p = await c.newPage(); await p.goto(`${BASE}/tasks`); await p.locator(`[data-task-id="${t.id}"], [data-testid="task-row"]`).first().waitFor({ timeout: 20_000 }).catch(() => {});
        const chip = p.locator('[data-testid="att-chip"]').first(); await chip.waitFor({ timeout: 20_000 });
        await p.addStyleTag({ content: 'span:has(> [data-testid="att-chip"]){flex-wrap:nowrap!important} [data-testid="att-chip"]{min-width:300px!important}' }); // 칩이 마감 칸과 같은 줄에서 칸보다 넓을 때
        const res = await findOverlaps(p);
        await p.screenshot({ path: `${SHOTS}/overlap-selftest-412.png` });
        assert.ok(res.issues.some((x) => /att-chip|HWPX/.test(`${x.a} ${x.b}`)), `검사기가 일부러 넓힌 첨부 칩 겹침을 못 잡음: ${overlapText(res) || '0건'}`);
      } finally { await c.close(); }
    }
    // 검사기 자체 확인 ②: 홈(375)에서 낱말 아무 데서나 끊기게 하면(break-all) 인사말 등에서 반드시 잡아야 함
    {
      const c = await browser.newContext({ viewport: { width: 375, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce', storageState: await desk.storageState() });
      try {
        const p = await c.newPage(); await p.goto(`${BASE}/`); await p.getByTestId('home-todo').waitFor({ timeout: 20_000 });
        assert.equal((await findWordBreaks(p)).count, 0, '홈 375: 낱말 중간 줄바꿈 0건');
        await p.addStyleTag({ content: 'body,body *{word-break:break-all!important;white-space:normal!important} h1{width:9.5em!important}' });
        const res = await findWordBreaks(p);
        assert.ok(res.count > 0, '검사기가 일부러 낱말 중간에서 끊은 줄을 못 잡음');
      } finally { await c.close(); }
    }
  } finally {
    await sql`update users set platform_admin = ${wasAdmin} where id = ${ctx.ownerId}`;
    if (process.env.OVERLAP_OUT) await writeFile(process.env.OVERLAP_OUT, JSON.stringify(found, null, 1)).catch(() => {});
  }
  const total = found.reduce((a, x) => a + x.count, 0);
  if (total) console.log(found.map((x) => `── ${x.w}폭 ${x.name}(${x.count}건)\n${overlapText(x)}`).join('\n'));
  if (!process.env.OVERLAP_REPORT) assert.equal(total, 0, `겹침·넘침 ${total}건(위 목록)`);
}
