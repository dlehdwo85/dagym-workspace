// #1181-1(대표 11/26 "그 회사만을 위한 개발이 최대한 들어가지 않도록 상업화를 위한 개발을 마쳐 두라. 전체 업무·영업·마케팅을 검수하라"):
// 새 고객사(빈 회사, 업종 IT·소프트웨어) 기준 전체 흐름 시험 — 시험 서버·시험 DB 만(운영 계정·운영 DB 는 건드리지 않음).
//   A 가입·승인·첫 화면 → B 직원 합류(이메일 초대 · 회사 초대 링크) → C 업무(만들기·배정·결재·일정·자료실·메신저·보고)
//   → D 영업·마케팅 잠금 → 상담 신청 → 운영자가 열기 → E 영업(회사 프로필 → 공고 맞춤 → 업무로 → 미참여 → 지원사업 신청 준비)
//   → F 마케팅(브랜드 키트 → 시안 → 승인 → 게시 예약)
// 화면마다: 서버 오류(5xx)·화면 오류·다른 회사(운영사) 이름·업종(시설관리) 가정 말·내부 낱말을 본문과 입력 예시에서 찾고, 빈 상태 화면을 찍어 둠.
// 결과: docs/screens/commercial-check-2026-11-26/REPORT.md(단계별 통과/실패 · 걸린 곳 · 고칠 목록) + NN-화면.jpg
// 실행: npm run build && node tests/e2e/commercial-1181.mjs   (PostgreSQL 필요)
import http from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { FORBIDDEN_WORDS, INTERNAL_NAMES } from '../customerWords.mjs';

const OUT = 'docs/screens/commercial-check-2026-11-26';
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/\.(jpg|png)$/.test(f)) rmSync(`${OUT}/${f}`);
const MAIL_PORT = 3398;
/** 업종(시설관리·아파트 위탁운영) 가정 말 — IT 회사 화면에 나오면 의심 */
const DOMAIN = /단지|입주민|입주자\s?대표|관리\s?사무소|세대수|헬스장|피트니스|위탁\s?운영|아파트|주민\s?공동\s?시설|커뮤니티\s?시설|체육\s?시설|시설\s?관리|현장\s?관리자|위탁운영 현장|본사 관리자/g;
const CHECKS = [['brand', new RegExp(INTERNAL_NAMES.source, 'gi')], ['domain', DOMAIN], ['internal', new RegExp(FORBIDDEN_WORDS.source, 'gi')]];
/** 이름 그 자체(모든 회사가 같은 목록을 보는 자료 이름·업종 이름) — 걸려도 '허용'으로 따로 */
const ALLOW = [[/운동·피트니스|시설관리·용역|건설·시설관리|시설관리·위탁운영/, '업종·분류 이름'],
  [/산업단지|공동주택 단지|새로 생기는 단지|공동주택\(|청약홈|신규 분양 단지|직접 제안할 단지 목록|관리사무소·입주자대표회의|단지 규모·세대수|큰 단지부터|입주 예정·신규 분양|체력단련장\(헬스장\)|위탁 운영 대상|위탁·관리 대상|위탁급식/, '공공데이터 자료 이름·설명'],
  [/AI 회사\(Anthropic·OpenAI\)|Anthropic\(미국\)·OpenAI\(미국\)|OpenAI\(미국\)로 전송/, 'AI 처리 국외 이전 고지(법적 고지 — 받는 회사 이름을 밝혀야 함)']];
const P = { name: '한누리', company: '누리소프트', industry: 'IT·소프트웨어', email: 'ceo@nuri-1181.test', pw: 'nuri-pass-1234', staff: '오개발', staffEmail: 'dev@nuri-1181.test', joiner: '윤기획', joinEmail: 'plan@nuri-1181.test' };

const steps = []; const findings = []; const allowed = []; const shots = []; const mails = []; let shotNo = 0; let area = '';
const errs = []; // 화면을 여는 동안 생긴 5xx·화면 오류
function scan(where, kind, text) {
  for (const [cat, re] of CHECKS) {
    re.lastIndex = 0; let m; const seen = new Set(); let found = 0;
    while ((m = re.exec(text))) {
      const ctx = text.slice(Math.max(0, m.index - 28), m.index + m[0].length + 28).replace(/\s+/g, ' ').trim();
      const k = `${m[0]}|${ctx}`; if (seen.has(k)) continue; seen.add(k);
      const ok = ALLOW.find(([re2]) => re2.test(ctx));
      if (ok) { allowed.push({ where, word: m[0], why: ok[1] }); continue; }
      findings.push({ area, where, kind, cat, word: m[0], ctx });
      if (++found >= 6) break;
    }
  }
}
const pageText = (p) => p.evaluate(() => ({
  body: document.body.innerText,
  attrs: [...document.querySelectorAll('[placeholder],[title],[aria-label]')].map((e) => [e.getAttribute('placeholder'), e.getAttribute('title'), e.getAttribute('aria-label')].filter(Boolean).join(' / ')).join('\n'),
}));
/** 화면 열기 → 글 검사 → 찍기. 반환: 본문 글 */
async function look(p, name, path, { wait, full = false } = {}) {
  const before = errs.length;
  if (path) { await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
  await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (wait) await p.getByTestId(wait).first().waitFor({ timeout: 15000 });
  await p.waitForTimeout(400);
  await p.addStyleTag({ content: '[data-testid="daily-welcome"]{display:none!important}' }).catch(() => {});
  const t = await pageText(p);
  scan(`${name}${path ? ` (${path})` : ''}`, '화면', t.body); scan(`${name}${path ? ` (${path})` : ''}`, '입력 예시·말풍선', t.attrs);
  const file = `${OUT}/${String(++shotNo).padStart(2, '0')}-${name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)}.jpg`;
  await p.screenshot({ path: file, type: 'jpeg', quality: 70, fullPage: full });
  shots.push({ no: shotNo, area, name, path: path ?? new URL(p.url()).pathname, file: file.split('/').pop(), errors: errs.slice(before) });
  if (/문제가 생겼습니다|Application error|Unhandled Runtime Error/.test(t.body.slice(0, 800))) throw new Error(`화면 오류: ${name}`);
  return t.body;
}
async function step(name, fn) {
  const t0 = Date.now(); const before = errs.length;
  try { const note = await fn(); const e5 = errs.slice(before).filter((x) => x.startsWith('5'));
    steps.push({ area, name, ok: !e5.length, note: [note, e5.length ? `서버 오류 ${e5.join(', ')}` : ''].filter(Boolean).join(' · '), ms: Date.now() - t0 });
    console.log(`${e5.length ? '✖' : '✔'} [${area}] ${name}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    const msg = String(e?.message ?? e).split('\n')[0].slice(0, 220);
    steps.push({ area, name, ok: false, note: msg, ms: Date.now() - t0 }); console.log(`✖ [${area}] ${name} — ${msg}`);
  }
}
const mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch { /* 무시 */ } res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `m${mails.length}` })); }); });
await new Promise((r) => mailSrv.listen(MAIL_PORT, r));
const mailOf = (to, re) => mails.filter((m) => [].concat(m.to).some((x) => String(x).toLowerCase() === to) && (!re || re.test(m.subject))).at(-1);

await resetDb();
const srv = await startServer({ SIGNUP_APPROVAL: '1', PUBLIC_SIGNUP: '1', SIGNUP_IP_PER_DAY: '50', SIGNUP_IP_PER_HOUR: '50', CAPTURE_BLOCK: '0',
  RESEND_API_KEY: 're_walk_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${MAIL_PORT}` });
const sql = testDb(); const ctx = await bootstrap();
await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; // 운영자(슈퍼관리자) = 시험 기본 회사 대표
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const p = await c.newPage();
p.on('response', (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
p.on('pageerror', (e) => errs.push(`화면오류 ${String(e.message).slice(0, 80)}`));
const S = {}; // 단계 사이에 넘기는 값

// ---------------- A 가입·승인·첫 화면 ----------------
area = 'A 가입·승인·첫 화면';
await step('공개 가입(승인제) → 신청 메일 → 승인 대기 화면', async () => {
  await sql`delete from signup_attempts`;
  await p.goto(BASE + '/signup');
  await p.getByLabel('이름').fill(P.name); await p.getByLabel('이메일').fill(P.email);
  await p.locator('input[type="password"]').first().fill(P.pw);
  for (const k of ['terms', 'privacy', 'age14', 'ai']) await p.getByTestId(`agree-${k}`).check();
  await look(p, '가입 1단계');
  await p.getByTestId('signup-next').click();
  await p.getByTestId('mode-team').click();
  await p.getByTestId('signup-step-company').locator('input').first().fill(P.company);
  await p.getByTestId('signup-industry').selectOption(P.industry);
  await p.getByTestId('signup-contact').fill('010-0000-0000').catch(async () => { await p.getByLabel(/연락받을 전화번호/).fill('010-0000-0000'); });
  await look(p, '가입 2단계 회사 정보');
  await p.waitForTimeout(2700);
  await p.getByTestId('signup-submit').click();
  await p.getByTestId('signup-done').waitFor({ timeout: 20000 });
  await look(p, '가입 신청 끝');
  const ack = mailOf(P.email, /체험 신청|이메일 확인/);
  const token = String(ack?.text ?? '').match(/\/verify\/([\w-]+)/)?.[1];
  if (!token) throw new Error('신청 메일에서 확인 링크를 못 찾음');
  await p.goto(`${BASE}/verify/${token}`); await p.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  if (await p.getByTestId('signup-pending').count() === 0) await p.goto(BASE + '/');
  await p.getByTestId('signup-pending').waitFor({ timeout: 15000 });
  await p.locator('#wos-intro').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await look(p, '승인 대기 화면');
  return `메일 ${mails.filter((m) => [].concat(m.to).includes(P.email)).length}통`;
});
await step('운영자 승인 → 환영 메일 → 온보딩 → 첫 화면(빈 회사)', async () => {
  const [{ tenant }] = await sql`select tenant from users where email = ${P.email}`; S.tenant = tenant;
  await ctx.owner.ok('POST', `/api/platform/signups/${tenant}/approve`, {});
  if (!mailOf(P.email, /환영|승인/)) throw new Error('환영 메일 없음');
  await p.goto(BASE + '/'); await p.getByTestId('onboarding').waitFor({ timeout: 20000 });
  await p.locator('#wos-intro').waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {});
  await look(p, '온보딩 1 연락 채널');
  await p.getByTestId('onboarding-next').click(); await p.getByTestId('ob-invite-send').waitFor(); await look(p, '온보딩 2 동료 초대');
  await p.getByTestId('onboarding-next').click(); await p.getByTestId('onboarding-push').waitFor(); await look(p, '온보딩 3 알림');
  await p.getByTestId('onboarding-done').click(); await p.getByTestId('onboarding').waitFor({ state: 'detached' });
  const tour = p.getByTestId('tour');
  if (await tour.waitFor({ timeout: 4000 }).then(() => true, () => false)) { await look(p, '처음 사용 안내'); await tour.getByRole('button', { name: '건너뛰기' }).click(); await p.getByTestId('tour-overlay').waitFor({ state: 'detached' }).catch(() => {}); }
  await look(p, '첫 화면 홈(빈 회사)', '/');
  S.api = new Client('nuri'); await S.api.ok('POST', '/api/auth/login', { email: P.email, password: P.pw });
  S.me = await S.api.ok('GET', '/api/auth/me'); S.unit = S.me.orgUnits?.[0]?.id;
  return `회사 ${tenant}`;
});
await step('빈 상태 화면(자료 0건) 둘러보기', async () => {
  for (const [n, path] of [['업무 목록 빈 상태', '/tasks'], ['캘린더 빈 상태', '/calendar'], ['자료실 빈 상태', '/library'], ['메신저 빈 상태', '/messages'], ['결재 빈 상태', '/approvals'],
    ['보고 빈 상태', '/reports'], ['프로젝트 빈 상태', '/projects'], ['알림 빈 상태', '/notifications'], ['연락처 빈 상태', '/contacts'], ['점검 빈 상태', '/check'], ['메모 빈 상태', '/memos'],
    ['공지 빈 상태', '/notices'], ['AI 비서', '/assistant'], ['요금제', '/plan'], ['사용자 관리', '/admin/users'], ['설정', '/settings']]) await look(p, n, path);
});

// (B~F 는 아래에 이어 붙임)
//@@STEPS@@

area = 'G 메일·알림 글';
for (const m of mails) scan(`메일 "${m.subject}" → ${[].concat(m.to).join(', ')}`, '메일', `${m.subject}\n${m.text ?? ''}\n${String(m.html ?? '').replace(/<[^>]+>/g, ' ')}`);
if (S.api) { const items = (await S.api.ok('GET', '/api/notifications').catch(() => ({ items: [] }))).items ?? []; scan(`알림(대표) ${items.length}건`, '알림', items.map((x) => `${x.title}\n${x.body ?? ''}`).join('\n')); }
await browser.close(); srv.proc.kill(); mailSrv.close(); await sql.end();

// ---------------- 보고서 ----------------
const label = { brand: '운영사·브랜드 이름', domain: '업종(시설관리) 가정 말', internal: '내부 낱말(모델·원가 등)' };
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const areas = [...new Set(steps.map((s) => s.area))];
const lines = ['# 새 고객사 기준 전체 흐름 시험 (#1181-1)', '',
  `만든 때: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · 시험 서버·시험 DB(운영 계정 안 씀) · 새 회사 '${P.company}'(업종 ${P.industry}) · 화면 PC 1366`, '',
  `단계 ${steps.length}개 중 통과 ${steps.filter((s) => s.ok).length} · 실패 ${steps.filter((s) => !s.ok).length} · 화면 ${shots.length}장 · 걸린 글 ${findings.length}건 · 메일 ${mails.length}통`, '',
  '## 단계별 결과', '', '| 묶음 | 단계 | 결과 | 메모 |', '|---|---|---|---|',
  ...steps.map((s) => `| ${s.area} | ${esc(s.name)} | ${s.ok ? '통과' : '**실패**'} | ${esc(s.note)} |`), '',
  '## 걸린 글(다른 회사 이름·업종 가정·내부 낱말)', '', findings.length ? '| 묶음 | 어디 | 종류 | 갈래 | 낱말 | 앞뒤 글 |' : '없음 — 0건',
  ...(findings.length ? ['|---|---|---|---|---|---|', ...findings.map((f) => `| ${f.area} | ${esc(f.where)} | ${f.kind} | ${label[f.cat] ?? f.cat} | ${esc(f.word)} | ${esc(f.ctx)} |`)] : []), '',
  '## 화면(번호-이름.jpg)', '', ...areas.map((a) => `- ${a}: ${shots.filter((s) => s.area === a).map((s) => `${s.no} ${s.name}${s.errors.length ? `(오류 ${s.errors.join(', ')})` : ''}`).join(' · ')}`), '',
  '## 허용한 것(모든 회사가 같은 목록을 보는 이름)', '', ...[...new Set(allowed.map((a) => `- ${a.why}: '${a.word}' — ${a.where}`))].sort(), '',
  '## 받은 메일 제목', '', ...[...new Set(mails.map((m) => `- ${m.subject} → ${[].concat(m.to).join(', ')}`))], ''];
writeFileSync(`${OUT}/REPORT.md`, lines.join('\n'));
writeFileSync(`${OUT}/result.json`, JSON.stringify({ steps, findings, shots }, null, 1));
console.log(`\n보고서: ${OUT}/REPORT.md · 단계 ${steps.filter((s) => s.ok).length}/${steps.length} 통과 · 걸린 글 ${findings.length}건 · 화면 ${shots.length}장`);
process.exit(0);
