// 범용화 마지막 단계 '신규 가입 순회 검증' 1부 — 시험 서버에서 다른 업종 3곳이 가입해 처음 보는 화면·메일·알림 글을 돌며
// 운영사(기본 회사) 표현이 남아 있는지 본다. 운영 계정은 만들지 않는다(시험 DB 만).
//   가입자: 카페 3개 지점 사장(외식·카페) · 학원 원장(학원·교습) · 시설관리 용역사 팀장(시설관리·용역)
//   흐름(운영과 같은 승인제): 체험 신청 → 신청 메일 → 승인 대기 화면 → 슈퍼관리자 승인 → 환영 메일 → 온보딩 → 화면 순회(PC 1366 · 휴대폰 390)
//           → 직원 초대·업무 배정(알림 글) → 영업·마케팅 공간 켜기 → 입찰 켜고 검색어 넣기
//   보는 것: ① 운영사·브랜드 이름 ② 그 업종의 말(단지·입주민·관리사무소…) ③ 고객 화면에 나오면 안 되는 내부 낱말(모델·원가 등) — 본문 글 + 입력 칸 예시·말풍선
// 결과: docs/handoff/walk-1026/REPORT.md(걸린 곳 표) + <가입자>-sheet.jpg(화면 묶음) · 원본 PNG 는 raw/ (git 에 안 올림)
// 실행: npm run build && node tests/e2e/walk-1026.mjs   (PostgreSQL 필요)
import http from 'node:http';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { FORBIDDEN_WORDS, INTERNAL_NAMES } from '../customerWords.mjs';

const OUT = 'docs/handoff/walk-1026'; const RAW = `${OUT}/raw`;
mkdirSync(RAW, { recursive: true });
writeFileSync(`${OUT}/.gitignore`, 'raw/\n');
const MAIL_PORT = 3399;
const DOMAIN = /단지|입주민|입주자\s?대표|관리\s?사무소|세대수|회원 민원|헬스|피트니스|위탁\s?운영|주민\s?공동\s?시설|아파트|본사 관리자|현장 관리자|위탁운영 현장/g;
const CHECKS = [['brand', new RegExp(INTERNAL_NAMES.source, 'gi')], ['domain', DOMAIN], ['internal', new RegExp(FORBIDDEN_WORDS.source, 'gi')]];
const PERSONAS = [
  { key: 'cafe', who: '카페 3개 지점 사장', name: '김사장', company: '모퉁이커피', industry: '외식·카페', staff: '박매니저', task: '주말 원두 발주 확인', word: '급식' },
  { key: 'academy', who: '학원 원장', name: '박원장', company: '새싹수학학원', industry: '학원·교습', staff: '이강사', task: '중간고사 보강 일정 안내', word: '교육' },
  { key: 'fm', who: '시설관리 용역사 팀장', name: '이팀장', company: '든든시설관리', industry: '시설관리·용역', staff: '최반장', task: '3층 누수 점검 보고', word: '청소' },
];
/** 가입자마다 도는 화면 — [이름, 주소]. 없는 화면·권한 없는 화면은 '안 열림'으로 적고 넘어감 */
const PAGES = [
  ['홈', '/'], ['업무', '/tasks'], ['캘린더', '/calendar'], ['알림', '/notifications'], ['메시지', '/messages'], ['자료실', '/library'], ['연락처', '/contacts'], ['공지', '/notices'],
  ['AI 비서', '/assistant'], ['도움말', '/help'], ['신고 QR', '/forms'], ['결재', '/approvals'], ['템플릿', '/templates'], ['프로젝트', '/projects'], ['팀', '/teams'], ['업무량', '/workload'],
  ['주간 보고', '/reports'], ['통계', '/insights'], ['자동화', '/automations'], ['견적서', '/quotes'], ['전자계약', '/contracts'], ['설정', '/settings'], ['요금제', '/plan'],
  ['관리·사용자', '/admin/users'], ['관리·회사 정보', '/admin/company'], ['관리·조직', '/admin/org'], ['관리·결재 양식', '/admin/approval-forms'], ['관리·결재 설정', '/admin/approval-settings'],
  ['관리·출퇴근', '/admin/attendance'], ['관리·휴일', '/admin/holidays'], ['관리·이용 현황', '/admin/usage'], ['관리·감사 기록', '/admin/audit'],
];
const SALES_PAGES = [['영업 홈', '/s/sales'], ['영업기회 허브', '/s/sales/hub'], ['영업 진행', '/s/sales/leads'], ['제안·계약', '/s/sales/deals'], ['지원사업', '/s/sales/support'], ['영업 데이터 설정', '/s/sales/sources']];
const MKT_PAGES = [['마케팅 홈', '/s/marketing'], ['마케팅 캘린더', '/s/marketing/calendar'], ['마케팅 승인함', '/s/marketing/approvals'], ['마케팅 채널 연결', '/s/marketing/connections']];
const MOBILE = [['홈', '/'], ['업무', '/tasks'], ['캘린더', '/calendar'], ['알림', '/notifications'], ['도움말', '/help'], ['영업 홈', '/s/sales'], ['영업기회 허브', '/s/sales/hub']];

/** 걸려도 되는 것(이름 그 자체) — 보고서에 '허용'으로 따로 적는다 */
const ALLOW = [[/운동·피트니스/, '업종 이름'], [/산업단지|공동주택 단지|새로 생기는 단지|공동주택\(|청약홈|신규 분양 단지/, '수집 자료 이름'], [/아파트·커뮤니티·체육시설 위탁 운영, 시설 관리/, '영업 용어 묶음 설명(고르는 칸)']];
const findings = []; const allowed = []; const visited = []; const mails = [];
function scan(persona, where, kind, text) {
  for (const [cat, re] of CHECKS) {
    re.lastIndex = 0; let m; const seen = new Set();
    while ((m = re.exec(text))) {
      const ctx = text.slice(Math.max(0, m.index - 26), m.index + m[0].length + 26).replace(/\s+/g, ' ').trim();
      const k = `${m[0]}|${ctx}`; if (seen.has(k)) continue; seen.add(k);
      const ok = ALLOW.find(([re2]) => re2.test(ctx));
      if (ok) { allowed.push({ persona, where, word: m[0], why: ok[1] }); continue; }
      findings.push({ persona, where, kind, cat, word: m[0], ctx });
      if (seen.size >= 6) break;
    }
  }
}
const pageText = (p) => p.evaluate(() => ({
  body: document.body.innerText,
  attrs: [...document.querySelectorAll('[placeholder],[title],[aria-label]')].map((e) => [e.getAttribute('placeholder'), e.getAttribute('title'), e.getAttribute('aria-label')].filter(Boolean).join(' / ')).join('\n'),
}));

/** 화면 묶음 사진: 작은 그림을 6칸씩, 왼쪽 위에 번호(보고서의 '화면 번호'와 같음) */
async function sheet(out, files, cols = 6, w = 420) {
  const th = Math.round(w * 0.66), gap = 10, rows = Math.ceil(files.length / cols);
  const tiles = await Promise.all(files.map((f) => sharp(f).resize({ width: w, height: th, fit: 'cover', position: 'top' }).png().toBuffer()));
  const W = cols * (w + gap) + gap, H = rows * (th + gap) + gap;
  const at = (i) => ({ left: gap + (i % cols) * (w + gap), top: gap + Math.floor(i / cols) * (th + gap) });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${files.map((_, i) => { const { left, top } = at(i); return `<rect x="${left}" y="${top}" width="40" height="24" fill="#111827"/><text x="${left + 20}" y="${top + 18}" font-family="monospace" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">${i + 1}</text>`; }).join('')}</svg>`;
  await sharp({ create: { width: W, height: H, channels: 3, background: '#e5e7eb' } }).composite([...tiles.map((input, i) => ({ input, ...at(i) })), { input: Buffer.from(svg), left: 0, top: 0 }]).jpeg({ quality: 78 }).toFile(out);
}
const mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch { /* 무시 */ } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${mails.length}` })); }); }).listen(MAIL_PORT);
await resetDb();
const srv = await startServer({ SIGNUP_APPROVAL: '1', PUBLIC_SIGNUP: '1', SIGNUP_IP_PER_DAY: '50', SIGNUP_IP_PER_HOUR: '50', CAPTURE_BLOCK: '0',
  RESEND_API_KEY: 're_walk_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${MAIL_PORT}` });
const sql = testDb(); const ctx = await bootstrap();
await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const mailOf = (to, re) => mails.filter((m) => [].concat(m.to).some((x) => String(x).toLowerCase() === to) && (!re || re.test(m.subject))).at(-1);

async function visit(p, persona, tag, name, path, n) {
  const file = `${RAW}/${persona.key}-${tag}-${String(n).padStart(2, '0')}.png`;
  try {
    const r = await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(500);
    await p.addStyleTag({ content: '[data-testid="daily-welcome"]{display:none!important}' }).catch(() => {});
    const t = await pageText(p);
    const closed = /찾을 수 없|페이지가 없|권한이 없|404/.test(t.body.slice(0, 300)) && t.body.length < 600;
    visited.push({ persona: persona.key, tag, name, path, status: r?.status() ?? 0, closed, file: closed ? null : file });
    if (closed) return;
    scan(persona.key, `${name} (${path})`, tag === 'm' ? '화면(휴대폰)' : '화면', t.body);
    scan(persona.key, `${name} (${path})`, '입력 예시·말풍선', t.attrs);
    await p.screenshot({ path: file });
  } catch (e) { visited.push({ persona: persona.key, tag, name, path, status: -1, closed: true, file: null, error: String(e.message ?? e).split('\n')[0].slice(0, 120) }); }
}

for (const P of PERSONAS) {
  const email = `owner@${P.key}-walk.test`, pw = 'walk-pass-1234';
  console.log(`\n■ ${P.who} — ${P.company}(${P.industry})`);
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await c.newPage(); let n = 0;
  const snap = async (name) => { const t = await pageText(p); scan(P.key, name, '화면', t.body); scan(P.key, name, '입력 예시·말풍선', t.attrs); const file = `${RAW}/${P.key}-pc-${String(++n).padStart(2, '0')}.png`; await p.screenshot({ path: file }); visited.push({ persona: P.key, tag: 'pc', name, path: new URL(p.url()).pathname, status: 200, closed: false, file }); };
  try {
    // 1) 체험 신청(승인제): 계정 → 회사 정보·업종·연락처
    await sql`delete from signup_attempts`;
    await p.goto(BASE + '/signup');
    await p.getByLabel('이름').fill(P.name); await p.getByLabel('이메일').fill(email);
    await p.locator('input[type="password"]').first().fill(pw);
    for (const k of ['terms', 'privacy', 'age14']) await p.getByTestId(`agree-${k}`).check();
    await snap('가입 1단계(계정)');
    await p.getByTestId('signup-next').click();
    await p.getByTestId('mode-team').click();
    await p.getByTestId('signup-step-company').locator('input').first().fill(P.company);
    await p.getByTestId('signup-industry').selectOption(P.industry);
    await p.getByTestId('signup-contact').fill('010-0000-0000').catch(async () => { await p.getByLabel(/연락받을 전화번호/).fill('010-0000-0000'); });
    await snap('가입 2단계(회사 정보·업종)');
    await p.waitForTimeout(2700); // 가입 화면을 연 뒤 2.5초 안 제출은 자동 가입으로 봄
    await p.getByTestId('signup-submit').click();
    await p.getByTestId('signup-done').waitFor({ timeout: 20000 });
    await snap('가입 신청 끝(안내)');
    // 2) 신청 메일의 확인 링크 → 승인 대기 화면
    const ack = mailOf(email, /체험 신청|이메일 확인/);
    const token = String(ack?.text ?? '').match(/\/verify\/([\w-]+)/)?.[1];
    if (!token) throw new Error('신청 메일에서 확인 링크를 못 찾음');
    await p.goto(`${BASE}/verify/${token}`); await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    if (await p.getByTestId('signup-pending').count() === 0) { await p.goto(BASE + '/'); await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); }
    await p.getByTestId('signup-pending').waitFor({ timeout: 15000 });
    await p.locator('#wos-intro').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {}); // 실행 애니메이션(로고) 덮개가 걷힌 뒤에 찍음
    await snap('승인 대기 화면');
    // 3) 슈퍼관리자 승인 → 환영 메일 → 다시 들어가면 온보딩
    const [{ tenant }] = await sql`select tenant from users where email = ${email}`;
    await ctx.owner.ok('POST', `/api/platform/signups/${tenant}/approve`, {});
    await p.goto(BASE + '/'); await p.getByTestId('onboarding').waitFor({ timeout: 20000 });
    await p.locator('#wos-intro').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
    await p.getByTestId('ob-mail').waitFor(); await snap('온보딩 ① 연락 채널');
    await p.getByTestId('onboarding-next').click(); await p.getByTestId('ob-invite-send').waitFor(); await snap('온보딩 ② 동료 초대');
    await p.getByTestId('onboarding-next').click(); await p.getByTestId('onboarding-push').waitFor(); await snap('온보딩 ③ 알림');
    await p.getByTestId('onboarding-done').click(); await p.getByTestId('onboarding').waitFor({ state: 'detached' });
    const tour = p.getByTestId('tour');
    if (await tour.waitFor({ timeout: 4000 }).then(() => true, () => false)) { await snap('처음 사용 안내'); await tour.getByRole('button', { name: '건너뛰기' }).click(); await p.getByTestId('tour-overlay').waitFor({ state: 'detached' }).catch(() => {}); }
    // 4) 직원 초대·업무 배정(알림·메일 글) — 서버 요청으로
    const api = new Client(P.key); await api.ok('POST', '/api/auth/login', { email, password: pw });
    const me = await api.ok('GET', '/api/auth/me'); const unit = me.orgUnits?.[0]?.id;
    const inv = await api.ok('POST', '/api/admin/users', { email: `staff@${P.key}-walk.test`, name: P.staff, role: 'staff', orgUnitIds: [unit] });
    const st = new Client(`${P.key}-staff`); await st.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: pw });
    const sid = (await st.ok('GET', '/api/auth/me')).user.id;
    await api.ok('POST', '/api/tasks', { title: P.task, orgUnitId: unit, assigneeId: sid });
    // 5) 화면 순회(PC)
    let k = 20; for (const [name, path] of PAGES) await visit(p, P, 'pc', name, path, ++k);
    // 새 업무 창(입력 예시)
    await p.goto(BASE + '/tasks'); await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    if (await p.getByRole('button', { name: /만들기/ }).first().click({ timeout: 4000 }).then(() => true, () => false)) { await p.waitForTimeout(700); n = k; await snap('새로 만들기 창'); k = n; await p.keyboard.press('Escape'); }
    // 6) 영업·마케팅 공간 켜기 → 순회 → 입찰 켜고 검색어 넣기
    for (const s of ['sales', 'marketing']) await api.ok('PUT', '/api/admin/spaces', { space: s, on: true });
    for (const [name, path] of [...SALES_PAGES, ...MKT_PAGES]) await visit(p, P, 'pc', name, path, ++k);
    await api.ok('PUT', '/api/sales/options', { bids: true });
    await visit(p, P, 'pc', '입찰 목록(검색어 넣기 전)', '/s/sales/hub?tab=bids&bt=all', ++k);
    await api.ok('PUT', '/api/sales/digest/prefs', { keywords: [P.word] });
    await visit(p, P, 'pc', `입찰 목록(검색어 '${P.word}')`, '/s/sales/hub?tab=bids&bt=all', ++k);
    // 7) 휴대폰 폭
    const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await c.storageState() });
    const m = await mc.newPage(); let j = 0; for (const [name, path] of MOBILE) await visit(m, P, 'm', name, path, ++j); await mc.close();
    // 8) 알림 글(대표·직원)
    for (const [who, cl] of [['대표', api], ['직원', st]]) {
      const items = (await cl.ok('GET', '/api/notifications')).items ?? [];
      scan(P.key, `알림(${who}) ${items.length}건`, '알림', items.map((x) => `${x.title}\n${x.body ?? ''}`).join('\n'));
    }
  } catch (e) {
    findings.push({ persona: P.key, where: '순회 중단', kind: '오류', cat: 'error', word: '-', ctx: String(e.message ?? e).split('\n')[0].slice(0, 200) });
    console.log('  ✖ 중단:', String(e.message ?? e).split('\n')[0]);
    await p.screenshot({ path: `${RAW}/${P.key}-pc-99-error.png` }).catch(() => {});
  }
  await c.close();
  // 메일 글(이 가입자에게 간 것 + 슈퍼관리자에게 간 신청 알림)
  for (const m of mails.filter((x) => !x.__seen)) { m.__seen = true; scan(P.key, `메일 "${m.subject}" → ${[].concat(m.to).join(', ')}`, '메일', `${m.subject}\n${m.text ?? ''}\n${String(m.html ?? '').replace(/<[^>]+>/g, ' ')}`); }
  const shots = visited.filter((v) => v.persona === P.key && v.file && existsSync(v.file));
  shots.forEach((v, i) => { v.no = i + 1; });
  if (shots.length) await sheet(`${OUT}/${P.key}-sheet.jpg`, shots.map((v) => v.file)).catch((e) => console.log('  묶음 사진 실패:', String(e.message ?? e).split('\n')[0]));
  console.log(`  화면 ${visited.filter((v) => v.persona === P.key && !v.closed).length}개 · 안 열린 화면 ${visited.filter((v) => v.persona === P.key && v.closed).length}개 · 걸린 곳 ${findings.filter((f) => f.persona === P.key).length}건`);
}
await browser.close(); srv.proc.kill(); mailSrv.close(); await sql.end();

// 보고서
const label = { brand: '운영사·브랜드 이름', domain: '업종 말', internal: '내부 낱말(모델·원가 등)', error: '오류' };
const esc = (s) => String(s).replace(/\|/g, '\\|');
const lines = ['# 신규 가입 순회 검증 1부 — 시험 서버 자동 순회', '',
  `만든 때: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · 승인제 가입 · 운영 계정은 만들지 않음(시험 DB)`, '',
  '| 가입자 | 회사·업종 | 본 화면 | 안 열린 화면 | 메일 | 걸린 곳 |', '|---|---|---|---|---|---|',
  ...PERSONAS.map((P) => `| ${P.who} | ${P.company} · ${P.industry} | ${visited.filter((v) => v.persona === P.key && !v.closed).length} | ${visited.filter((v) => v.persona === P.key && v.closed).length} | ${mails.filter((m) => [].concat(m.to).some((x) => String(x).includes(`${P.key}-walk`))).length} | ${findings.filter((f) => f.persona === P.key).length} |`), '',
  '## 걸린 곳', '', findings.length ? '| 가입자 | 어디 | 종류 | 갈래 | 낱말 | 앞뒤 글 |' : '없음 — 0건', ...(findings.length ? ['|---|---|---|---|---|---|', ...findings.map((f) => `| ${f.persona} | ${esc(f.where)} | ${f.kind} | ${label[f.cat] ?? f.cat} | ${esc(f.word)} | ${esc(f.ctx)} |`)] : []), '',
  '## 화면 번호(묶음 사진 <가입자>-sheet.jpg 의 번호)', '', ...PERSONAS.flatMap((P) => [`- ${P.who}(${P.key}-sheet.jpg): ${visited.filter((v) => v.persona === P.key && v.no).map((v) => `${v.no} ${v.name}${v.tag === 'm' ? '(휴대폰)' : ''}`).join(' · ')}`]), '',
  '## 허용한 것(이름 그 자체라 그대로 둠)', '', ...[...new Set(allowed.map((a) => `- ${a.why}: '${a.word}' — ${a.where}`))].sort(), '',
  '## 안 열린 화면(없는 주소·권한 없음·요금제 밖)', '', ...[...new Set(visited.filter((v) => v.closed).map((v) => `- ${v.name} (${v.path})${v.error ? ` — ${v.error}` : ''}`))], '',
  '## 받은 메일 제목', '', ...[...new Set(mails.map((m) => `- ${m.subject}`))], ''];
writeFileSync(`${OUT}/REPORT.md`, lines.join('\n'));
console.log(`\n보고서: ${OUT}/REPORT.md · 걸린 곳 ${findings.length}건 · 화면 ${visited.filter((v) => !v.closed).length}개 · 메일 ${mails.length}통`);
