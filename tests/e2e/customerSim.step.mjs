// #599(대표 10/25 저녁, 로컬 16:50 — '고객사로 보기'는 #94 "대신 보기 없음" 결정이라 보류): 새 고객사 시뮬레이션을 시험 서버 가입 흐름으로.
// 가입 → 회사 정보·업종 → 확인 링크(개발 모드) → 온보딩 3단계 → 첫 화면(1366·390) → 관리 › 공간 켜기 → 영업 데이터 설정 → 마케팅 첫 화면 → 사용량 → 알림.
// 점검 기준 = docs/handoff/SUPER_ADMIN_SCOPE_2026-10-25.md §3:
//   1 우리 회사 이름·브랜드가 어디에도 안 나오는지  2 수집기 키 없는 것이 '오류'가 아니라 '신청 필요'인지  3 마케팅 연결 계정 0개 = '채널 연결 3단계'
//   4 첫날 알림이 환영·다음 할 일뿐인지  5 사용량에 원가·모델 이름이 없는지  + §4 고객 관리자 API 응답 금지 낱말 검사.
// 발견한 것은 findings 로 모아 끝에 0건을 단언한다(149차: 조사·캡처 → #602 서버 구현 뒤 단언. E2E_SIM_LOOSE=1 이면 로그만). 운영 계정은 만들지 않는다(시험 DB 만).
import assert from 'node:assert/strict';
import { Client } from '../helpers.mjs';
import { FORBIDDEN_WORDS, INTERNAL_NAMES, snip } from '../customerWords.mjs';

export async function customerSim({ browser, BASE, SHOTS, sql }) {
  const email = 'owner@hanbit.test', pw = 'hanbit-pass-1234', company = '한빛물류';
  const findings = []; const note = (k, s) => { findings.push(`${k}: ${s}`); console.log('    #599 발견', k, '—', s); };
  const scanText = (k, text) => { const a = snip(text, INTERNAL_NAMES); if (a.length) note(`§3-1 ${k} 내부 이름`, a.join(' | ')); const b = snip(text, FORBIDDEN_WORDS); if (b.length) note(`§4 ${k} 금지 낱말`, b.join(' | ')); };
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await c.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
  const shot = (name, opt = {}) => p.screenshot({ path: `${SHOTS}/${name}`, ...opt });
  const body = () => p.locator('body').innerText();
  let mc = null;
  try {
    // ── 1) 가입: 계정 → 회사 정보·업종(1366)
    await p.goto(BASE + '/signup');
    await p.getByLabel('이름').fill('김대표'); await p.getByLabel('이메일').fill(email);
    await p.locator('input[type="password"]').first().fill(pw);
    for (const k of ['terms', 'privacy', 'age14']) await p.getByTestId(`agree-${k}`).check();
    await shot('281-cust-signup-account.png');
    scanText('가입 1단계', await body());
    await p.getByTestId('signup-next').click();
    await p.getByTestId('mode-team').click();
    await p.getByTestId('signup-step-company').locator('input').first().fill(company);
    await p.getByTestId('signup-industry').selectOption('유통·판매');
    await shot('282-cust-signup-company.png');
    scanText('가입 2단계(회사 정보·업종)', await body());
    await p.waitForTimeout(2700); // 가입 화면 연 뒤 2.5초 안 제출은 봇으로 봄
    await p.getByTestId('signup-submit').click();
    await p.getByTestId('signup-done').waitFor();
    await shot('283-cust-signup-done.png');
    const link = await p.getByTestId('dev-verify-link').getAttribute('href');
    assert.ok(link?.startsWith('/verify/'), `개발용 확인 링크 ${link}`);
    const [t] = await sql`select t.id, t.name, t.industry, t.spaces from tenants t join users u on u.tenant = t.id where u.email = ${email}`;
    assert.equal(t?.name, company, '회사가 만들어짐');
    assert.equal(t.industry, '유통·판매');
    // ── 2) 확인 링크 → 바로 로그인 → 첫 화면 + 온보딩 창(연락 채널 → 동료 초대 → 알림)
    await p.goto(BASE + link);
    await p.waitForURL(BASE + '/');
    await p.getByTestId('onboarding').waitFor();
    // 149차에서 발견한 버그 되풀이 막기: 첫 화면부터 열린 온보딩 창(포털)이 수화 오류(#418)를 내고 → 실행 애니메이션 덮개가 다시 그려져 영영 안 걷혔음
    await p.locator('#wos-intro').waitFor({ state: 'hidden', timeout: 8000 }); // 재생 뒤 지워지거나(스크립트) 다시 놓여도 html.wi-done 으로 안 보임
    assert.deepEqual(errs.filter((e) => /#418|#423|#425|Hydrat/i.test(e)), [], '첫 화면 수화 오류 없음');
    await p.getByTestId('ob-mail').waitFor();
    await shot('284-cust-onboarding-channels.png');
    scanText('온보딩 ③ 연락 채널', await body());
    await p.getByTestId('onboarding-next').click(); // 가입 이메일을 회신 주소로(기본) 저장하고 다음
    await p.getByTestId('ob-invite-send').waitFor();
    await shot('285-cust-onboarding-invite.png');
    await p.getByTestId('onboarding-next').click();
    await p.getByTestId('onboarding-push').waitFor();
    await p.getByTestId('onboarding-done').click();
    await p.getByTestId('onboarding').waitFor({ state: 'detached' });
    // 처음 사용 안내 투어(#77)가 바로 뜨면 그 모습도 남기고 건너뛴다
    const tour = p.getByTestId('tour');
    if (await tour.waitFor({ timeout: 4000 }).then(() => true, () => false)) {
      await shot('286-cust-home-tour.png');
      await tour.getByRole('button', { name: '건너뛰기' }).click();
      await p.getByTestId('tour-overlay').waitFor({ state: 'detached' });
    }
    // ── 3) 첫 화면(홈) 1366·390 — 온보딩을 끝내며 레이아웃을 새로 받아도(router.refresh) 실행 애니메이션 덮개가 다시 남지 않아야(IntroGuard)
    await p.getByTestId('home-week').waitFor();
    await p.locator('#wos-intro').waitFor({ state: 'hidden', timeout: 3000 });
    await shot('287-cust-home-1366.png');
    const homeText = await body(); scanText('첫 화면(홈)', homeText);
    assert.ok(homeText.includes(company), '홈에 회사 이름');
    mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await c.storageState() });
    const m = await mc.newPage();
    await m.goto(BASE + '/'); await m.getByTestId('home-week').waitFor();
    await m.locator('#wos-intro').waitFor({ state: 'detached' }).catch(() => {});
    await m.screenshot({ path: `${SHOTS}/288-cust-home-390.png` });
    scanText('첫 화면(휴대폰)', await m.locator('body').innerText());
    // ── 4) 관리 › 사용자 › 공간: 영업·마케팅 켜기(가입 직후 기본값은 로그에 — 둘 다 켜져 있으면 그대로)
    console.log('    #599 가입 직후 공간', JSON.stringify(t.spaces ?? []));
    await p.goto(BASE + '/admin/users?tab=spaces');
    await p.getByTestId('space-toggle-sales').waitFor();
    for (const s of ['sales', 'marketing']) {
      if (await p.getByTestId(`space-toggle-${s}`).isChecked()) continue;
      await p.getByTestId(`space-toggle-${s}`).click(); // 제어 입력: 저장 뒤 화면을 새로 고치며 켜짐(바로 바뀌지 않아 check() 는 못 씀)
      await p.waitForFunction((id) => document.querySelector(`[data-testid="${id}"]`)?.checked === true, `space-toggle-${s}`, { timeout: 15000 });
    }
    await p.getByTestId('space-tabs').waitFor();
    await shot('289-cust-spaces.png');
    // ── 5) 영업 데이터 설정(수집기 12개 첫 화면)
    await p.goto(BASE + '/s/sales/sources');
    await p.getByTestId('sales-collectors').waitFor();
    await p.getByTestId('sales-ai-setup').waitFor();
    await shot('290-cust-sales-sources.png', { fullPage: true });
    const srcText = await body(); scanText('영업 데이터 설정', srcText);
    const cols = await p.locator('[data-testid="sales-collector"]').evaluateAll((els) => els.map((el) => ({ slug: el.dataset.slug, text: el.innerText.replace(/\s+/g, ' ').slice(0, 220) })));
    assert.ok(cols.length >= 12, `수집기 ${cols.length}개`);
    console.log('    #599 수집기 첫 화면', cols.map((x) => `${x.slug}: ${x.text.replace(/^[^·]*/, '').slice(0, 90)}`).join('\n      '));
    const keyChips = cols.filter((x) => /키 필요/.test(x.text));
    if (keyChips.length) note('§3-2 수집기 키 없는 것', `'키 필요: 환경변수 이름'으로 ${keyChips.length}개(${keyChips.map((x) => x.slug).join(', ')}) — 고객에게는 '신청 필요 — 방법 보기'여야`);
    const noState = cols.filter((x) => !/연결됨|신청 필요|연결 안 됨|잠시 중단/.test(x.text));
    if (noState.length) note('§3-2 수집기 연결 상태 없음', noState.map((x) => x.slug).join(', '));
    const srcLeak = cols.filter((x) => /https?:\/\/|\.go\.kr|\.do\b|app_settings|_csrf/i.test(x.text));
    if (srcLeak.length) note('§2 원천 주소·내부 상세', srcLeak.map((x) => x.slug).join(', '));
    const applies = await p.locator('[data-testid="sales-collector-how"]').count();
    console.log('    #599 수집기 상태 칩', `신청 필요 ${await p.locator('[data-state="apply_needed"]').count()}개(방법 보기 ${applies}개) · 연결됨 ${await p.locator('[data-state="connected"]').count()}개 · 잠시 중단 ${await p.locator('[data-state="off"]').count()}개`);
    const errChips = cols.filter((x) => /실패|오류|일부/.test(x.text));
    if (errChips.length) note('§3-2 수집기 실패·오류 표시', `${errChips.length}개(${errChips.map((x) => x.slug).join(', ')}) — 원인은 슈퍼관리자만`);
    const runs = await p.locator('[data-testid="sales-collector-runs"] li').count();
    if (runs) note('§2 공용 실행 기록', `최근 실행 ${runs}건이 새 회사에도 보임(공용 수집 기록·오류 원인)`);
    if (await p.locator('[data-testid="sales-collector-sent"], [data-testid="sales-collector-keys"]').count()) note('§2 보낸 주소·칸 이름', '원천 주소·첫 줄 칸 이름 상세가 고객 관리자에게 보임');
    // ── 6) 마케팅 첫 화면: 연결 계정 0개 → '채널 연결 3단계'
    await p.goto(BASE + '/s/marketing');
    await p.getByTestId('space-home-marketing').waitFor();
    await p.getByText('채널 연결 3단계').first().waitFor();
    await shot('291-cust-marketing.png', { fullPage: true });
    const mktText = await body(); scanText('마케팅 첫 화면', mktText);
    await m.goto(BASE + '/s/marketing'); await m.getByText('채널 연결 3단계').first().waitFor();
    await m.screenshot({ path: `${SHOTS}/292-cust-marketing-390.png` });
    // 자동 제작 화면: 브랜드 키트 없이 돌지 않는지·글 모델 줄(모델 등급·비용)
    await p.goto(BASE + '/s/marketing/automation');
    await p.waitForLoadState('networkidle');
    await shot('293-cust-automation.png', { fullPage: true });
    const autoText = await body(); scanText('자동 제작', autoText);
    const wm = p.getByTestId('auto-write-model');
    if (await wm.count()) { // #602 뒤 고객은 등급 이름('빠른 모델')만 — 모델 이름·원고 1건 비용·달러가 붙어 있으면 발견
      const t = (await wm.innerText()).replace(/\s+/g, ' ');
      if (/claude|gpt|1건 약 [\d,]+원|\$\s?\d|원가/i.test(t) || FORBIDDEN_WORDS.test(t)) note('§2 글 모델 줄', `자동 제작에 모델·비용 줄 보임: ${t.slice(0, 120)}`);
    }
    // ── 7) 관리 › 사용량·요금제
    await p.goto(BASE + '/admin/usage');
    await p.locator('[data-testid^="ai-limit-"]').first().waitFor();
    await shot('294-cust-usage.png', { fullPage: true });
    const usageText = await body(); scanText('사용량', usageText);
    const usageHtml = (await p.content()).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''); // RSC 자료("$1" 참조)는 글이 아니라 뺀다
    const hid = snip(usageHtml, /원가|\$\s?\d|오퍼스|하이쿠|Opus|Haiku/);
    if (hid.length) note('§3-5 사용량 숨은 글(title 등)', hid.join(' | '));
    const perHit = usageText.match(/1(회|건|장|편) 약 [\d,]+원/g);
    if (perHit) note('§3-5 사용량 1건 원가', [...new Set(perHit)].join(', '));
    // ── 8) 알림: 첫날 받은 알림
    await p.goto(BASE + '/notifications');
    await p.waitForLoadState('networkidle');
    await shot('295-cust-notifications.png');
    scanText('알림', await body());
    // ── 9) 고객 관리자 계정으로 API 응답 금지 낱말 검사(§4)
    const api = new Client('hanbit');
    await api.ok('POST', '/api/auth/login', { email, password: pw });
    const notif = await api.ok('GET', '/api/notifications');
    const types = [...new Set((notif.items ?? []).map((n) => n.type))];
    console.log('    #599 첫날 알림', (notif.items ?? []).length, '건', types.join(', '));
    const bad = (notif.items ?? []).filter((n) => !/welcome|onboard|환영|시작/.test(`${n.type} ${n.title}`));
    if (bad.length) note('§3-4 첫날 알림', bad.map((n) => `${n.type} ${n.title}`).slice(0, 5).join(' | '));
    for (const path of ['/api/sales/collectors', '/api/sales/sources', '/api/sales/digest/prefs', '/api/marketing/home', '/api/marketing/auto', '/api/usage', '/api/onboarding', '/api/auth/me']) {
      const r = await api.req('GET', path);
      if (r.status >= 400) { note('API 응답 오류', `${path} → ${r.status}`); continue; }
      const text = JSON.stringify(r.body);
      const a = snip(text, INTERNAL_NAMES); if (a.length) note(`§3-1 API ${path} 내부 이름`, a.join(' | '));
      const b = snip(text, FORBIDDEN_WORDS, 4); if (b.length) note(`§4 API ${path} 금지 낱말`, b.join(' | '));
    }
    console.log(`    #599 점검 결과: 발견 ${findings.length}건`);
    if (!process.env.E2E_SIM_LOOSE) assert.deepEqual(findings, [], '#599·#602 §3·§4 점검 — 고객 화면·응답에 내부 이름·원인·원가·모델·외부 서비스 이름이 없어야(E2E_SIM_LOOSE=1 이면 로그만)');
    return findings;
  } catch (e) {
    await p.screenshot({ path: 'test-results/debug-599.png', fullPage: true }).catch(() => {}); // 실패 순간(저장소에는 안 올림)
    throw e;
  } finally {
    await mc?.close().catch(() => {});
    await c.close();
  }
}
