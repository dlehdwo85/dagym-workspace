// 359차(대표 11/04 저녁 결정 #965): 승인제 가입 — 가입부터 사용까지 한 사람의 여정(화면 그림 305~319)
// 소개 [14일 무료 체험 신청] → 신청(연락처) → 확인 메일 링크 → '가입 신청이 접수됐습니다 · 24시간 안에 연락' 화면(쓰기 막힘)
// → 슈퍼관리자 알림 → 플랫폼 운영 › 가입 신청 [승인] → 신청자 새로 고침: 체험 D-14 · 처음 안내(연락 채널 → 동료 초대 → 알림)
// → 동료가 초대 링크로 가입 → 업무 등록(화면) · 일정·자료실(만든 뒤 화면) · 업무 메일 쓰기 창 → 체험 끝 = '읽기 전용' 띠
// 시험 서버(가짜 메일 — 개발용 확인 링크)라 실제 메일 발송·운영 화면은 '확인 못함'(운영 확인은 로컬)
import assert from 'node:assert/strict';
import { Client, addDays, seoulToday } from '../helpers.mjs';

export async function signupJourney359({ browser, owner, ctx, sql, BASE, SHOTS }) {
  const email = 'ceo@saebyeol.test', pw = 'saebyeol-pass-1234', company = '새별상사';
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
  await c.addInitScript(() => { try { sessionStorage.setItem('wos_intro', '1'); } catch { /* 시작 애니메이션 건너뜀 */ } });
  const p = await c.newPage();
  const shot = (n, o = {}) => p.screenshot({ path: `${SHOTS}/${n}`, ...o });
  let sc = null;
  try {
    // ── 1) 소개 → [14일 무료 체험 신청]
    await p.goto(BASE + '/welcome?utm_source=meta&utm_campaign=trial359');
    const cta = p.getByTestId('landing-start');
    assert.match(await cta.innerText(), /14일 무료 체험 신청/);
    assert.match(await p.locator('[data-track="start-top"]').innerText(), /체험 신청/);
    await shot('305-journey-welcome.png');
    await cta.click(); await p.waitForURL(/\/signup/);
    // ── 2) 신청: 계정 → 회사 정보(연락처 필수)
    await p.getByText('14일 무료 체험 신청').first().waitFor();
    await p.getByLabel('이름').fill('김새별'); await p.getByLabel('이메일').fill(email);
    await p.locator('input[type="password"]').first().fill(pw);
    for (const k of ['terms', 'privacy', 'age14']) await p.getByTestId(`agree-${k}`).check();
    await p.getByTestId('signup-next').click();
    await p.getByTestId('mode-team').click();
    await p.getByTestId('signup-step-company').locator('input').first().fill(company);
    await p.getByTestId('signup-industry').selectOption({ index: 1 });
    await p.waitForTimeout(2700); // 가입 화면 연 뒤 2.5초 안 제출은 봇으로 봄
    assert.equal(await p.getByTestId('signup-contact').evaluate((el) => el.required), true, '연락처 필수(빈 칸이면 신청 안 됨)');
    await p.getByTestId('signup-submit').click();
    await p.waitForTimeout(600);
    assert.equal(await p.getByTestId('signup-done').count(), 0, '연락처 없으면 신청 안 됨');
    await p.getByTestId('signup-contact').fill('010-2345-6789');
    await shot('306-journey-apply-company.png');
    await p.getByTestId('signup-submit').click();
    await p.getByTestId('signup-done').waitFor();
    await p.getByText('체험 신청을 받았습니다').first().waitFor();
    await shot('307-journey-apply-done.png');
    const link = await p.getByTestId('dev-verify-link').getAttribute('href');
    const [t] = await sql`select t.id, t.signup_status, t.signup_info, s.trial_ends_at from tenants t join users u on u.tenant = t.id join tenant_subscriptions s on s.tenant = t.id where u.email = ${email}`;
    assert.equal(t.signup_status, 'pending'); assert.equal(t.trial_ends_at, null, '체험은 아직');
    assert.equal(t.signup_info.contact, '010-2345-6789'); assert.equal(t.signup_info.utm?.source, 'meta', '광고 유입 기록');
    // ── 3) 확인 링크 → 로그인 → '가입 신청이 접수됐습니다' 화면(다른 화면·처음 안내 없음)
    await p.goto(BASE + link);
    await p.waitForURL(BASE + '/');
    const wait = p.getByTestId('signup-pending'); await wait.waitFor();
    assert.match(await wait.innerText(), /가입 신청이 접수됐습니다[\s\S]*24시간 안에 연락드립니다[\s\S]*14일 무료 체험이 시작됩니다/);
    assert.equal(await p.getByTestId('onboarding').count(), 0, '승인 전에는 처음 안내 없음');
    await shot('308-journey-pending.png');
    await p.goto(BASE + '/tasks'); await wait.waitFor(); // 주소로 들어가도 같은 화면
    const ck = (await c.cookies()).find((x) => x.name === 'wos_session');
    const me = new Client('saebyeol'); me.cookie = `wos_session=${ck.value}`;
    assert.equal((await me.post('/api/tasks', { title: '승인 전 업무' })).status, 403, '서버도 쓰기 막음');
    // ── 4) 슈퍼관리자: 알림 → 플랫폼 운영 › 가입 신청 [승인]
    const [n] = await sql`select title, link from notifications where type = 'signup_request' and user_id = ${ctx.ownerId} order by created_at desc limit 1`;
    assert.match(n?.title ?? '', /새 체험 신청: 새별상사 · 김새별/);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + n.link);
    const row = owner.getByTestId('signup-request').filter({ hasText: company });
    await row.waitFor();
    assert.match(await row.getByTestId('signup-request-contact').innerText(), /010-2345-6789/);
    assert.match(await owner.getByTestId('signup-pending-count').innerText(), /승인 대기 \d+/);
    await owner.getByTestId('platform-signup-requests').evaluate((el) => { el.style.scrollMarginTop = '72px'; el.scrollIntoView({ block: 'start' }); });
    await owner.waitForTimeout(300);
    await owner.screenshot({ path: `${SHOTS}/309-journey-admin-requests.png` });
    owner.once('dialog', (d) => d.accept().catch(() => {}));
    await row.getByTestId('signup-approve').click();
    await owner.getByText('승인했습니다').first().waitFor();
    const [s] = await sql`select t.signup_status, s.trial_ends_at from tenants t join tenant_subscriptions s on s.tenant = t.id where t.id = ${t.id}`;
    assert.equal(s.signup_status, 'approved'); assert.ok(s.trial_ends_at, '승인 = 체험 시작');
    // ── 5) 신청자 첫 사용: 체험 D-14 · 처음 안내(연락 채널 → 동료 초대 → 알림)
    await p.goto(BASE + '/');
    await p.getByTestId('onboarding').waitFor({ timeout: 30_000 }); // 승인 뒤 읽기 막음 캐시(15초)가 남아 있을 수 있음
    assert.equal(await p.getByTestId('signup-pending').count(), 0);
    await p.getByTestId('ob-mail').waitFor();
    await shot('310-journey-onboarding-channels.png');
    await p.getByTestId('onboarding-next').click();
    await p.getByTestId('ob-invite-emails').fill('staff@saebyeol.test');
    const invRes = p.waitForResponse((r) => r.url().includes('/api/admin/users') && r.request().method() === 'POST');
    await p.getByTestId('ob-invite-send').click();
    const inv = await (await invRes).json();
    await p.getByTestId('ob-invite-links').waitFor();
    await shot('311-journey-onboarding-invite.png');
    await p.getByTestId('onboarding-next').click();
    await p.getByTestId('onboarding-push').waitFor();
    await p.getByTestId('onboarding-done').click();
    await p.getByTestId('onboarding').waitFor({ state: 'detached' });
    const tour = p.getByTestId('tour');
    if (await tour.waitFor({ timeout: 3000 }).then(() => true, () => false)) { await tour.getByRole('button', { name: '건너뛰기' }).click(); await p.getByTestId('tour-overlay').waitFor({ state: 'detached' }); }
    const band = p.getByTestId('trial-banner'); await band.waitFor();
    assert.match(await band.innerText(), /무료 체험 D-1[34]/);
    // PC 체험 띠가 [+ 만들기]·알림·내 계정을 가리지 않음(359차 — 머리줄 오른쪽을 띠 너비만큼 비움)
    await p.waitForFunction(() => { const b = document.querySelector('[data-testid="trial-banner"]')?.getBoundingClientRect(); const c = document.querySelector('[data-testid="create-menu"]')?.getBoundingClientRect(); return !!b && !!c && c.right <= b.left; }, null, { timeout: 5000 });
    await shot('312-journey-home.png');
    // ── 6) 동료가 초대 링크로 가입(승인 없이 바로 — 이미 승인된 회사)
    const invPath = inv.path ?? inv.users?.[0]?.path ?? inv.results?.[0]?.path ?? inv.invites?.[0]?.path;
    assert.ok(invPath, `초대 링크 ${JSON.stringify(inv).slice(0, 200)}`);
    sc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
    await sc.addInitScript(() => { try { sessionStorage.setItem('wos_intro', '1'); } catch { /* 시작 애니메이션 건너뜀 */ } });
    const sp = await sc.newPage();
    await sp.goto(BASE + new URL(invPath, BASE).pathname);
    await sp.locator('input[type="password"]').first().fill('staff-pass-1234');
    const pws = sp.locator('input[type="password"]'); if (await pws.count() > 1) await pws.nth(1).fill('staff-pass-1234');
    await sp.screenshot({ path: `${SHOTS}/313-journey-invite-accept-390.png` });
    await sp.getByRole('button', { name: '가입하고 시작하기' }).click();
    await sp.waitForURL(BASE + '/');
    assert.equal(await sp.getByTestId('signup-pending').count(), 0, '초대받은 직원은 승인 대기 없음');
    // ── 7) 업무 등록(화면) → 상세
    await p.goto(BASE + '/tasks');
    await p.getByTestId('create-menu').click();
    await p.getByRole('menuitem', { name: /^업무/ }).click();
    const dlg = p.getByRole('dialog', { name: '업무 등록' });
    await dlg.getByLabel('제목').fill('거래처 견적서 보내기');
    await dlg.getByLabel('마감일').fill(addDays(seoulToday(), 2));
    await p.screenshot({ path: `${SHOTS}/314-journey-task-new.png` });
    await dlg.getByRole('button', { name: '저장' }).click();
    await p.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
    const taskId = p.url().split('/').pop();
    // ── 8) 일정 · 자료실(만든 뒤 화면)
    const cals = (await me.ok('GET', '/api/calendars')).calendars;
    const cal = cals.find((x) => x.type === 'personal') ?? cals[0];
    const day = seoulToday(); // 383차(CI 11/07 토요일): 내일(일요일)은 주 보기(일~토) 다음 주라 안 보였음 — 오늘 일정으로
    await me.ok('POST', '/api/events', { calendarId: cal.id, title: '새별상사 주간 회의', start: `${day}T10:00:00+09:00`, end: `${day}T11:00:00+09:00` });
    await p.goto(BASE + '/calendar');
    const ev = p.getByText('새별상사 주간 회의').first(); await ev.waitFor();
    await ev.scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
    await shot('315-journey-calendar.png');
    const up = await me.ok('POST', '/api/library', { fileName: '회사소개서.txt', mimeType: 'text/plain', size: 18, folder: '' });
    await fetch(BASE + up.upload.url, { method: 'PUT', headers: up.upload.headers, body: Buffer.from('새별상사 회사 소개서 1쪽') });
    await me.ok('POST', `/api/library/${up.id}/complete`);
    await p.goto(BASE + '/library');
    await p.getByText('회사소개서').first().waitFor();
    await shot('316-journey-library.png');
    // ── 8-1) 360차 #976 광고성 정보 수신 동의: 설정 › '새 기능·혜택 소식(광고성 정보) 받기' 켜기 → 처리 결과 메일 안내 · 날짜 줄
    await p.goto(BASE + '/settings#marketing-consent');
    const consent = p.getByTestId('marketing-consent'); await consent.waitFor();
    await consent.scrollIntoViewIfNeeded();
    assert.match(await consent.innerText(), /광고성 정보/);
    const tg = p.getByTestId('marketing-consent-toggle');
    if (!(await tg.isChecked())) { await tg.check(); await p.getByText('수신 동의했습니다').first().waitFor(); }
    await p.waitForFunction(() => /2년마다/.test(document.querySelector('[data-testid="marketing-consent"]')?.textContent ?? ''));
    assert.equal((await me.ok('GET', '/api/account/marketing-consent')).agreed, true);
    await consent.evaluate((el) => { el.style.scrollMarginTop = '72px'; el.scrollIntoView({ block: 'start' }); });
    await p.waitForTimeout(300);
    await shot('320-journey-marketing-consent.png');
    // ── 9) 업무 메일 쓰기 창(보내기는 메일 계정 연결 뒤 — 새 회사 첫 화면 그대로)
    await p.goto(BASE + `/tasks/${taskId}`);
    const open = p.getByTestId('mail-compose-open');
    if (await open.waitFor({ timeout: 15_000 }).then(() => true, () => false)) {
      await open.click();
      await p.getByTestId('mail-compose').waitFor().catch(() => {});
      await p.waitForTimeout(400);
    }
    await shot('317-journey-task-mail.png');
    // ── 10) 체험 끝 → '무료 체험이 끝나 읽기 전용입니다' 띠 · 쓰기 막힘(보기는 됨)
    await sql`update tenant_subscriptions set trial_ends_at = now() - interval '1 hour', period_end = (now() at time zone 'Asia/Seoul')::date - 1 where tenant = ${t.id}`;
    await p.waitForTimeout(16_000); // 읽기 막음 캐시 15초
    await p.goto(BASE + '/tasks');
    await band.waitFor();
    assert.match(await band.innerText(), /무료 체험이 끝나 읽기 전용입니다/);
    await p.getByText('거래처 견적서 보내기').first().waitFor(); // 보기는 그대로
    await p.waitForFunction(() => { const b = document.querySelector('[data-testid="trial-banner"]')?.getBoundingClientRect(); const c = document.querySelector('[data-testid="create-menu"]')?.getBoundingClientRect(); return !!b && !!c && c.right <= b.left; }, null, { timeout: 5000 });
    await shot('318-journey-trial-ended.png');
    const ro = await me.post('/api/tasks', { title: '체험 끝난 뒤' });
    assert.equal(ro.status, 402, '체험 끝 = 쓰기 막힘');
    assert.equal((await me.req('GET', '/api/tasks')).status, 200, '보기는 그대로');
    // 휴대폰 폭 '가입 신청 접수' 화면(거절 안내와 같은 틀) — 두 번째 신청은 거절까지
    const r2 = new Client('reject359');
    const sres = await r2.ok('POST', '/api/auth/signup', { email: 'nope@reject.test', name: '거절시험', password: 'reject-pass-1234', mode: 'team', company: '거절상사', size: '1', contact: '01099998888', agree: { terms: true, age14: true, privacy: true } });
    await r2.ok('POST', '/api/auth/verify', { token: sres.devLink.split('/').pop() });
    const [rt] = await sql`select tenant from users where email = 'nope@reject.test'`;
    await ctx.owner.ok('POST', `/api/platform/signups/${rt.tenant}/reject`, { reason: '연락이 닿지 않았습니다' });
    const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', reducedMotion: 'reduce' });
    try {
      await mc.addCookies([{ name: 'wos_session', value: r2.cookie.split(';')[0].slice('wos_session='.length), url: BASE }]);
      await mc.addInitScript(() => { try { sessionStorage.setItem('wos_intro', '1'); } catch { /* 시작 애니메이션 건너뜀 */ } });
      const m = await mc.newPage();
      await m.goto(BASE + '/');
      const rj = m.getByTestId('signup-rejected'); await rj.waitFor();
      assert.match(await rj.innerText(), /연락이 닿지 않았습니다/);
      assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 넘침 없음');
      await m.screenshot({ path: `${SHOTS}/319-journey-rejected-390.png` });
    } finally { await mc.close(); }
  } finally {
    await sc?.close();
    await c.close();
  }
}
