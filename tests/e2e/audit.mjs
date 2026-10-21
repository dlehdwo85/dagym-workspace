// V14 14번 화면 검수: 360/390/768/1280px 에서 주요 화면 캡처 + 자동 점검(좌우 넘침·글자 잘림·입력칸 안내 넘침·44px 미만 터치 대상·고정 요소 겹침)
// 실행: node tests/e2e/audit.mjs  (사전: npm run build, PostgreSQL) → docs/screens/audit/*.jpg, docs/screens/audit-report.md
// LANDING=1 이면 랜딩 페이지용 화면 캡처(public/landing/*.png)도 만든다(가입한 샘플 공간 데이터로).
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { bootstrap, resetDb, startServer, BASE, Client, addDays, seoulToday } from '../helpers.mjs';
import { measure } from './widths.mjs';

const OUT = 'docs/screens/audit';
mkdirSync(OUT, { recursive: true });
const WIDTHS = [360, 390, 768, 1280];
const PAGES = ['/', '/tasks', '/calendar', '/projects', '/notifications', '/messages', '/library', '/assistant', '/settings', '/plan', '/admin/users', '/reports/team'];
const PUBLIC = ['/welcome', '/signup', '/login', '/terms'];

await resetDb();
const srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50' });
const ctx = await bootstrap();
const today = seoulToday();
// 현실적인 길이의 데이터
const cal0 = 0; const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit').id;
for (let i = 0; i < 4; i++) await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: `분기 운영 점검 회의 및 시설 안전 점검 결과 공유 ${i}`, location: '판교역로 235 N동 8층 대회의실', start: `${addDays(today, i)}T${10 + i}:00:00+09:00`, end: `${addDays(today, i)}T${11 + i}:00:00+09:00` });
for (let i = 0; i < 8; i++) await ctx.owner.ok('POST', '/api/tasks', { title: `GX 시간표 전면 개편안 작성 및 강사 일정 조율 ${i}`, orgUnitId: ctx.siteA, assigneeId: i % 2 ? ctx.staffA.id : ctx.managerA.id, dueDate: addDays(today, i - 2), priority: i % 3 ? 'normal' : 'high' });
const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
await ctx.owner.ok('POST', '/api/chat/messages', { roomId: room, body: '내일 오전 회의 자료 미리 공유 부탁드립니다. 시설 점검 사진도 같이 올려 주세요.' }).catch(() => {});

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
async function loginState(email, password) {
  const c = await browser.newContext(); const p = await c.newPage();
  await p.goto(BASE + '/login');
  await p.getByLabel('이메일', { exact: true }).fill(email); await p.getByLabel('비밀번호').fill(password);
  await p.getByRole('button', { name: '로그인' }).click(); await p.waitForURL(BASE + '/');
  const s = await c.storageState(); await c.close(); return s;
}

/** 화면 안 점검: 글자 잘림(말줄임 아님)·입력칸 안내 넘침·작은 터치 대상·고정 요소 겹침 */
async function inspect(page, mobile) {
  return page.evaluate((mobile) => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && r.bottom > 0 && r.top < innerHeight; };
    const name = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 30);
    const clip = [], ph = [], small = [], overlap = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el) || !el.childNodes.length) continue;
      const s = getComputedStyle(el);
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText && /(hidden|clip)/.test(s.overflowX) && s.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 2 && !s.webkitLineClamp?.match(/\d/)) clip.push(name(el));
    }
    const cv = document.createElement('canvas').getContext('2d');
    for (const el of document.querySelectorAll('input[placeholder], textarea[placeholder]')) {
      if (!vis(el) || el.value) continue;
      const s = getComputedStyle(el); cv.font = `${s.fontSize} ${s.fontFamily}`;
      const room = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      if (cv.measureText(el.placeholder).width > room + 1) ph.push(el.placeholder.slice(0, 30));
    }
    if (mobile) for (const el of document.querySelectorAll('button, a[href], [role=button], [role=tab], select, input[type=checkbox], input[type=radio]')) {
      if (!vis(el) || el.closest('[aria-hidden=true]')) continue;
      if (el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p, li, td, footer, nav')) continue; // 문장·꼬리말 속 링크
      const lab = /checkbox|radio/.test(el.type) && el.closest('label');
      const b = (lab || el).getBoundingClientRect();
      const hit = el.classList.contains('hit') && matchMedia('(pointer: coarse)').matches; // .hit::after 로 넓힌 누름 영역
      const r = { width: b.width + (hit ? 12 : 0), height: b.height + (hit ? 20 : 0) };
      if (r.height < 44 && r.width < 44 * 3 || r.width < 44 && r.height < 44 * 3) {
        if (r.height < 32 || r.width < 32) small.push(`${name(el)}(${Math.round(r.width)}×${Math.round(r.height)})`);
      }
    }
    const fixed = [...document.querySelectorAll('body *')].filter((el) => vis(el) && getComputedStyle(el).position === 'fixed' && !el.closest('[role=dialog]') && getComputedStyle(el).pointerEvents !== 'none');
    for (let i = 0; i < fixed.length; i++) for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i], b = fixed[j]; if (a.contains(b) || b.contains(a)) continue;
      const r1 = a.getBoundingClientRect(), r2 = b.getBoundingClientRect();
      if (r1.width >= innerWidth - 1 && r1.height >= innerHeight - 1 || r2.width >= innerWidth - 1 && r2.height >= innerHeight - 1) continue; // 배경 막
      if (r1.left < r2.right - 2 && r2.left < r1.right - 2 && r1.top < r2.bottom - 2 && r2.top < r1.bottom - 2) overlap.push(`${name(a)} ↔ ${name(b)}`);
    }
    return { clip: [...new Set(clip)].slice(0, 8), ph: [...new Set(ph)], small: [...new Set(small)].slice(0, 12), smallN: new Set(small).size, overlap: overlap.slice(0, 4) };
  }, mobile);
}

const rows = [];
async function audit(state, pages, tag) {
  for (const w of WIDTHS) {
    const mobile = w < 768;
    const c = await browser.newContext({ viewport: { width: w, height: mobile ? 800 : 900 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...(state ? { storageState: state } : {}) });
    const p = await c.newPage();
    for (const path of pages) {
      await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(500);
      const m = await measure(p); const r = await inspect(p, mobile);
      const file = `${w}-${(tag + path).replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.jpg`;
      await p.evaluate(() => document.getElementById('no-clip')?.remove());
      await p.screenshot({ path: `${OUT}/${file}`, type: 'jpeg', quality: 55 });
      rows.push({ w, path: tag + path, over: m.scroll > m.client ? `${m.scroll}>${m.client}` : '', ...r, file });
    }
    await c.close();
  }
}
await audit(await loginState('ceo@dagym.test', 'owner-pass-1234'), PAGES, '');
await audit(null, PUBLIC, '');

const cell = (a) => (Array.isArray(a) ? (a.length ? a.join(', ') : '') : a || '');
let md = `# 화면 검수 (360/390/768/1280px) — 자동 점검\n\n생성: ${new Date().toISOString()} · 스크립트 tests/e2e/audit.mjs · 캡처 docs/screens/audit/\n\n`;
md += `기준: 좌우 넘침 · 글자 잘림(말줄임 아닌 숨김) · 입력칸 안내 문구 넘침 · 휴대폰 폭에서 32px 미만 터치 대상(44px 권장) · 고정 요소 겹침\n\n`;
md += `| 폭 | 화면 | 좌우 넘침 | 글자 잘림 | 안내 넘침 | 작은 터치(개) | 겹침 | 캡처 |\n|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.w} | ${r.path} | ${r.over} | ${cell(r.clip)} | ${cell(r.ph)} | ${r.w < 768 ? `${r.smallN}${r.small.length ? ' — ' + r.small.slice(0, 5).join(', ') : ''}` : '-'} | ${cell(r.overlap)} | audit/${r.file} |\n`;
writeFileSync('docs/screens/audit-report.md', md);
const issues = rows.filter((r) => r.over || r.clip.length || r.ph.length || r.overlap.length);
console.log(`화면 ${rows.length}개 · 문제 ${issues.length}개 · 작은 터치 합계 ${rows.reduce((a, r) => a + (r.w < 768 ? r.smallN : 0), 0)}`);
for (const r of issues) console.log(r.w, r.path, r.over, JSON.stringify({ clip: r.clip, ph: r.ph, overlap: r.overlap }));
for (const r of rows.filter((r) => r.w === 360 && r.smallN)) console.log('small', r.path, r.small.join(' | '));

if (process.env.LANDING === '1') {
  // 랜딩 캡처: 가입한 샘플 팀 공간(회사 실제 데이터 아님)
  const c = new Client('sample');
  const sg = await c.ok('POST', '/api/auth/signup', { email: 'sample@workin.test', password: 'sample-pass-1234', name: '김하늘', mode: 'team', company: '샘플상사', agree: { terms: true, age14: true, privacy: true } });
  await c.ok('POST', '/api/auth/verify', { token: sg.devLink.split('/').pop() });
  await c.ok('POST', '/api/onboarding', { title: '팀장', done: true });
  const me = await c.ok('GET', '/api/auth/me'); const unit = me.orgUnits[0].id;
  const ppl = [];
  for (const [n, e] of [['이서준', 'seojun'], ['박지우', 'jiwoo'], ['최민서', 'minseo']]) {
    const inv = await c.ok('POST', '/api/admin/users', { email: `${e}@workin.test`, name: n, role: 'staff', orgUnitIds: [unit], title: '매니저' });
    const x = new Client(e); await x.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'sample-pass-1234' });
    ppl.push((await x.ok('GET', '/api/auth/me')).user.id);
  }
  const T = [['신제품 소개 자료 최종본 정리', 0, 0, 'high'], ['거래처 미팅 준비 — 견적서 확인', 1, 0, 'urgent'], ['월간 매출 보고서 작성', 2, 1, 'normal'], ['홈페이지 이벤트 배너 교체', 0, 2, 'normal'],
    ['신규 입사자 교육 일정 잡기', 1, 3, 'normal'], ['사무실 비품 주문', 2, -1, 'low'], ['고객 문의 답변 정리', 0, 1, 'high'], ['분기 목표 회의 안건 정리', 1, 4, 'normal']];
  for (const [title, who, d, priority] of T) await c.ok('POST', '/api/tasks', { title, orgUnitId: unit, assigneeId: ppl[who], dueDate: addDays(today, d), priority });
  const cals = (await c.ok('GET', '/api/calendars')).calendars; const cc = cals.find((x) => x.type === 'company') ?? cals[0];
  for (const [title, d, h] of [['주간 팀 회의', 0, 10], ['거래처 미팅', 1, 14], ['신제품 리뷰', 2, 11], ['점심 세미나', 3, 12], ['월간 회고', 4, 16]]) await c.ok('POST', '/api/events', { calendarId: cc.id, title, start: `${addDays(today, d)}T${h}:00:00+09:00`, end: `${addDays(today, d)}T${h + 1}:00:00+09:00` });
  const st = await loginState('sample@workin.test', 'sample-pass-1234');
  const lc = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
  const p = await lc.newPage();
  for (const [path, file] of [['/', 'home'], ['/tasks', 'tasks'], ['/calendar?view=week', 'calendar']]) {
    await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(800);
    await p.screenshot({ path: `public/landing/${file}.png` });
  }
  console.log('랜딩 캡처 저장: public/landing/*.png');
}
await browser.close(); srv.proc.kill();
