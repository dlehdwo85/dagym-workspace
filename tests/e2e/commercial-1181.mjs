// #1181-1(대표 11/26 "그 회사만을 위한 개발이 최대한 들어가지 않도록 상업화를 위한 개발을 마쳐 두라. 전체 업무·영업·마케팅을 검수하라"):
// 새 고객사(빈 회사, 업종 IT·소프트웨어) 기준 전체 흐름 시험 — 시험 서버·시험 DB 만(운영 계정·운영 DB 는 건드리지 않음).
//   A 가입·승인·첫 화면 → B 직원 합류(이메일 초대 · 회사 초대 링크) → C 업무(만들기·배정·결재·일정·자료실·메신저·보고)
//   → D 영업·마케팅 잠금 → 상담 신청 → 운영자가 열기 → E 영업(회사 프로필 → 공고 맞춤 → 업무로 → 미참여 → 지원사업 신청 준비)
//   → F 마케팅(브랜드 키트 → 시안 → 승인 → 게시 예약)
// 화면마다: 서버 오류(5xx)·화면 오류·다른 회사(운영사) 이름·업종(시설관리) 가정 말·내부 낱말을 본문과 입력 예시에서 찾고, 빈 상태 화면을 찍어 둠.
// 결과: docs/screens/commercial-check-2026-11-26/REPORT.md(단계별 통과/실패 · 걸린 곳 · 고칠 목록) + NN-화면.jpg
// 실행: npm run build && node tests/e2e/commercial-1181.mjs   (PostgreSQL 필요)
import http from 'node:http';
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
  [/공공체육시설\(문체부\)|생활_수영장업|생활_종합체육시설업|생활_체력단련장업|자원환경_건물위생관리/, '공공데이터 목록 이름(모든 회사 같은 목록 — 업종별 정렬·숨김은 고칠 목록)'],
  [/아파트·커뮤니티·체육시설 위탁 운영, 시설 관리/, '영업 업종 틀 이름 목록(고르는 칸)'],
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
  SPACES_SELF_SERVE: '0', RESEND_API_KEY: 're_walk_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${MAIL_PORT}` });
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

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const dayAdd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
async function upload(cl, fileName, mimeType, buf, folder) {
  const r = await cl.ok('POST', '/api/library', { fileName, mimeType, size: buf.length, ...(folder ? { folder } : {}) });
  const put = await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body: buf });
  if (!put.ok) throw new Error(`파일 올리기 ${put.status}`);
  await cl.ok('POST', `/api/library/${r.id}/complete`);
  return r.id;
}
// 1×1 PNG(마케팅 시안 자리)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

// ---------------- B 직원 합류 ----------------
area = 'B 직원 합류';
await step('이메일 초대 → 직원 수락 → 사용자 관리', async () => {
  const inv = await S.api.ok('POST', '/api/admin/users', { email: P.staffEmail, name: P.staff, role: 'staff', orgUnitIds: [S.unit] });
  S.st = new Client('nuri-staff'); await S.st.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: P.pw, ai: true });
  S.staffId = (await S.st.ok('GET', '/api/auth/me')).user.id;
  if (!mailOf(P.staffEmail, /초대/)) throw new Error('초대 메일 없음');
  await look(p, '사용자 관리 직원 1명', '/admin/users');
});
await step('회사 초대 링크 → 링크로 합류 신청(화면) → 확인 메일 → 관리자 승인(화면) → 로그인', async () => {
  const mk = await S.api.ok('POST', '/api/admin/join', { action: 'link', days: 30, maxUses: 10 });
  const anon = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }); const q = await anon.newPage();
  await q.goto(mk.url.replace(/^https?:\/\/[^/]+/, BASE)); await q.getByTestId('join-form').waitFor({ timeout: 15000 });
  await q.getByTestId('join-name').fill(P.joiner); await q.getByTestId('join-email').fill(P.joinEmail);
  await q.locator('input[type="password"]').first().fill(P.pw);
  for (const box of await q.getByTestId('join-form').locator('input[type="checkbox"]').all()) await box.check().catch(() => {});
  await look(q, '초대 링크 합류 신청 화면');
  await q.getByTestId('join-submit').click(); await q.getByTestId('join-done').waitFor({ timeout: 15000 });
  await look(q, '합류 신청 끝');
  const m = mailOf(P.joinEmail); const t = String(m?.text ?? m?.html ?? '').match(/\/api\/join\/verify\?t=([\w-]+)/)?.[1];
  if (!t) throw new Error('합류 확인 메일에서 링크를 못 찾음');
  await q.goto(`${BASE}/api/join/verify?t=${t}`); await q.waitForLoadState('networkidle').catch(() => {});
  await look(q, '합류 신청 확인됨'); await anon.close();
  await p.goto(BASE + '/admin/users?r=join#join'); const row = p.getByTestId(`join-req-${P.joinEmail}`); await row.waitFor({ timeout: 15000 });
  await look(p, '관리자 합류 신청 1건');
  await row.getByTestId('join-req-open').click(); await p.getByTestId('join-approve-go').waitFor();
  await look(p, '합류 승인 창');
  await p.getByTestId('join-approve-go').click();
  for (let i = 0; i < 40; i++) { if ((await sql`select status from join_requests where email = ${P.joinEmail}`)[0]?.status === 'approved') break; await p.waitForTimeout(250); }
  const j = new Client('nuri-join'); const r = await j.req('POST', '/api/auth/login', { email: P.joinEmail, password: P.pw });
  if (r.status !== 200) throw new Error(`승인 뒤 로그인 ${r.status}`);
  return '신청한 비밀번호로 로그인됨';
});

// ---------------- C 업무 ----------------
area = 'C 업무';
await step('업무 만들기·배정 → 직원 업무 목록', async () => {
  const tk = await S.api.ok('POST', '/api/tasks', { title: '신규 고객 온보딩 자료 정리', orgUnitId: S.unit, assigneeId: S.staffId, dueDate: dayAdd(3) });
  S.taskId = tk.id ?? tk.task?.id;
  await look(p, '업무 1건 배정', '/tasks');
  const mine = await S.st.ok('GET', '/api/tasks?view=mine').catch(() => null);
  return mine ? `직원 업무 ${(mine.tasks ?? mine.items ?? []).length}건` : '';
});
await step('결재: 결재선 만들기 → 직원 결재 올림 → 대표 승인', async () => {
  const empty = await S.st.req('POST', '/api/approvals/requests', { kind: 'general', data: { subject: '모니터 구매', body: '27인치 2대', amount: 600000 } });
  const note = empty.status === 400 ? `결재선 없을 때 안내: ${empty.body?.error?.message}` : `결재선 없이도 ${empty.status}`;
  await S.api.ok('POST', '/api/approval-lines', { name: '기본 결재선', steps: [{ label: '대표', type: 'user', userId: S.me.user.id }] });
  const rq = await S.st.ok('POST', '/api/approvals/requests', { kind: 'general', data: { subject: '모니터 구매', body: '27인치 2대', amount: 600000 } });
  await look(p, '결재 대기 1건', '/approvals');
  await S.api.ok('POST', `/api/tasks/${rq.taskId}/approval`, { decision: 'approve' });
  const [a] = await sql`select status from approval_requests where id = ${rq.id}`;
  if (a?.status !== 'approved') throw new Error(`결재 상태 ${a?.status}`);
  await look(p, '결재 승인됨', '/approvals');
  return note;
});
await step('일정 만들기 → 캘린더', async () => {
  const me = S.me.user.id; const cal = (await S.api.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal' && c.owner_user_id === me);
  if (!cal) throw new Error('개인 캘린더 없음');
  await S.api.ok('POST', '/api/events', { calendarId: cal.id, title: '고객사 킥오프 회의', start: `${dayAdd(1)}T15:00:00+09:00`, end: `${dayAdd(1)}T16:00:00+09:00` });
  await look(p, '캘린더 일정 1건', `/calendar?date=${dayAdd(1)}`);
});
await step('자료실 올리기', async () => {
  await upload(S.api, '회사소개서.txt', 'text/plain', Buffer.from('누리소프트 회사 소개'));
  await look(p, '자료실 파일 1개', '/library');
});
await step('메신저: 단체방 만들기 → 메시지', async () => {
  const room = await S.api.ok('POST', '/api/chat/rooms', { kind: 'group', name: '개발팀', userIds: [S.staffId] });
  await S.api.ok('POST', `/api/chat/rooms/${room.id}/messages`, { body: '이번 주 배포 일정 공유드립니다.' });
  await S.st.ok('POST', `/api/chat/rooms/${room.id}/messages`, { body: '확인했습니다.' });
  await look(p, '메신저 단체방', `/messages?room=${room.id}`);
});
await step('보고: 직원 주간 보고 제출 → 회사 주간 요약', async () => {
  const d = await S.st.ok('POST', '/api/reports/mine', {});
  await S.st.ok('PUT', '/api/reports/mine', { body: `${d.report.body}\n특이사항 없음`, submit: true });
  await S.api.ok('POST', '/api/reports', { weekStart: today }).catch((e) => { throw new Error(`회사 주간 요약 만들기: ${String(e.message).slice(0, 80)}`); });
  await look(p, '회사 주간 요약', '/reports');
  await look(p, '내 주간 보고(대표)', '/reports/mine');
});

// ---------------- D 영업·마케팅 잠금 → 상담 신청 → 운영자가 열기 ----------------
area = 'D 잠금·상담·열기';
await step('잠김 표시 → 상담 신청(화면) → 운영자가 열기 → 열림 알림', async () => {
  const st = await S.api.ok('GET', '/api/spaces/consult');
  if (!(st.locked ?? []).includes('sales')) throw new Error(`영업이 잠겨 있지 않음: ${JSON.stringify(st).slice(0, 120)}`);
  const self = await S.api.req('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await p.goto(BASE + '/'); const row = p.getByTestId('space-locked-sales'); await row.waitFor({ timeout: 15000 });
  await row.click(); await p.getByTestId('space-locked-page').waitFor();
  await look(p, '영업 잠김 안내');
  const form = p.getByTestId('space-consult-form'); await form.waitFor();
  for (const sp of ['sales', 'marketing']) { const b = form.getByTestId(`space-consult-pick-${sp}`); if (await b.count() && !(await b.isChecked())) await b.check(); }
  await form.getByTestId('space-consult-phone').fill('010-0000-1181');
  await form.getByTestId('space-consult-send').click(); await p.getByTestId('space-consult-pending-sales').waitFor({ timeout: 15000 });
  await look(p, '상담 신청 보냄');
  const det = await ctx.owner.ok('GET', `/api/platform/tenants/${S.tenant}/detail`);
  if (det.consults?.[0]?.status !== 'requested') throw new Error('운영자 화면에 상담 신청 없음');
  await ctx.owner.ok('PUT', `/api/platform/tenants/${S.tenant}/spaces`, { spaces: ['sales', 'marketing'] });
  await S.api.ok('PUT', '/api/admin/spaces/members', { userId: S.staffId, spaces: ['sales', 'marketing'] });
  await look(p, '영업 열린 뒤 홈', '/');
  const n = (await S.api.ok('GET', '/api/notifications')).items ?? [];
  return `스스로 켜기 ${self.status}(막힘이 정상) · 열림 알림 ${n.filter((x) => /열었습니다/.test(x.title)).length}건`;
});

// ---------------- E 영업 ----------------
area = 'E 영업';
await step('영업 첫 화면(빈 상태)', async () => {
  for (const [n, path] of [['영업 홈', '/s/sales'], ['영업기회 허브', '/s/sales/hub'], ['영업 진행', '/s/sales/leads'], ['제안·계약', '/s/sales/deals'], ['지원사업 빈 상태', '/s/sales/support'], ['영업 데이터 설정', '/s/sales/sources']]) await look(p, n, path);
});
await step('회사 프로필(업종·지역) · 입찰 켜기 · 검색어', async () => {
  const opt = await S.api.ok('GET', '/api/sales/options');
  await S.api.ok('PUT', '/api/sales/options', { bids: true });
  await look(p, '입찰 켠 뒤 검색어 없음', '/s/sales/hub?tab=bids&bt=all');
  await S.api.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '성남시', founded: '2021-03-02', size: '소기업', employees: 8, industries: ['소프트웨어'], keywords: ['소프트웨어'], certs: [], brands: [], interests: [] });
  await S.api.ok('PUT', '/api/sales/digest/prefs', { keywords: ['소프트웨어', '유지보수'], excludes: ['청소'], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });
  return `업종 틀 ${opt.template?.code ?? '?'} · 입찰 기본 ${opt.bids ? '켜짐' : '꺼짐'}`;
});
await step('공고 맞춤(검색어가 든 공고만) → 업무로 넘기기 → 미참여', async () => {
  const nowIso = new Date().toISOString();
  const mk = (id, title) => ({ scope: 'global', tbl: 'procurement_notices', src_id: id, origin: 'workin', row: sql.json({ id, title, source_type: 'g2b_bid', source_external_id: id, source_url: 'https://example.test/' + id, issuer: '시험시청', region: '경기',
    first_seen_at: nowIso, created_at: nowIso, updated_at: nowIso, posted_date: today, deadline_at: `${dayAdd(7)}T10:00:00+09:00`, current_status: '공고중', notice_kind: 'new', related: false, classification: '참고(비관련)' }) });
  await sql`delete from sales_src_rows where src_id like 'C1181%'`;
  await sql`insert into sales_src_rows ${sql([mk('C1181A01-000', '시청 홈페이지 유지보수 용역'), mk('C1181B02-000', '민원 접수 소프트웨어 구축'), mk('C1181C03-000', '청사 청소 용역 입찰'), mk('C1181D04-000', '아파트 헬스장 위탁운영 입찰')])}`;
  const list = await S.api.ok('GET', '/api/sales/src?view=bids&tab=all');
  const titles = (list.rows ?? list.items ?? []).map((r) => r.title ?? r.row?.title).filter(Boolean);
  const hit = titles.filter((x) => /C1181|유지보수|소프트웨어|청소|헬스장/.test(x));
  await look(p, '입찰 공고 맞춤', '/s/sales/hub?tab=bids&bt=all');
  const body = await p.evaluate(() => document.body.innerText);
  if (!body.includes('시청 홈페이지 유지보수 용역') || !body.includes('민원 접수 소프트웨어 구축')) throw new Error('검색어 맞는 공고가 안 보임');
  if (body.includes('청사 청소 용역') || body.includes('헬스장 위탁운영')) throw new Error('검색어 밖·제외어 공고가 보임');
  await S.api.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'C1181A01-000', assigneeIds: [S.staffId] });
  await look(p, '공고를 업무로 넘긴 뒤 업무 목록', '/tasks');
  await S.api.ok('POST', '/api/sales/work', { kind: 'bid', id: 'C1181B02-000', status: '미참여', reason: '일정이 맞지 않음' });
  await look(p, '미참여 공고', '/s/sales/hub?tab=bids&bt=noentry');
  return `API 공고 ${hit.length}건(맞는 것만)`;
});
await step('지원사업 → 신청 준비(체크리스트 업무)', async () => {
  const [pg] = await sql`insert into support_programs ${sql({ source: 'kstartup', source_id: 'C1181SP1', title: '초기창업패키지 소프트웨어 분야 모집', regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), apply_end: dayAdd(20), target: '창업기업', agency: '창업진흥원' })} returning id`;
  await look(p, '지원사업 1건', '/s/sales/support');
  await S.api.ok('POST', `/api/sales/support/${pg.id}/work`, { status: 'preparing', ownerId: S.staffId });
  const [w] = await sql`select task_id from support_work where program_id = ${pg.id}`.catch(() => [{}]);
  await look(p, '지원사업 신청 준비', '/s/sales/support');
  return w?.task_id ? '신청 준비 업무 만들어짐' : '업무 연결 확인 못함';
});

// ---------------- F 마케팅 ----------------
area = 'F 마케팅';
await step('마케팅 첫 화면(빈 상태)', async () => {
  for (const [n, path] of [['마케팅 홈', '/s/marketing'], ['마케팅 승인함 빈 상태', '/s/marketing/approvals'], ['콘텐츠 캘린더 빈 상태', '/s/marketing/calendar'], ['연결 계정', '/s/marketing/connections'], ['자동 제작', '/s/marketing/automation']]) await look(p, n, path);
});
await step('브랜드 키트 저장', async () => {
  S.brand = (await S.api.ok('POST', '/api/marketing/brands', { name: '누리소프트' })).id;
  await S.api.ok('PATCH', `/api/marketing/auto/brands/${S.brand}`, { tone: '차분한 존댓말', intro: '중소기업용 업무 소프트웨어를 만듭니다', products: '업무 관리 앱 월 구독', bannedWords: ['최고', '1위'] });
  await look(p, '브랜드 키트', '/s/marketing/automation?view=all');
});
await step('시안 만들기(인스타 그림 + 광고 문구 글) → 승인 → 게시 예약', async () => {
  const img = await upload(S.api, 'card.png', 'image/png', PNG, '마케팅');
  const at = new Date(Date.now() + 3 * 864e5); at.setUTCHours(1, 0, 0, 0);
  const ig = await S.api.ok('POST', '/api/marketing/contents', { title: '업무 관리 앱 소개 카드', channel: 'instagram', brandId: S.brand, scheduledAt: at.toISOString(), body: '흩어진 업무, 한 화면에서 보세요.\n14일 무료 체험.', mediaIds: [img] });
  const ad = await S.api.ok('POST', '/api/marketing/contents', { title: '검색 광고 문구', channel: 'other', mode: 'ad', brandId: S.brand, scheduledAt: at.toISOString(), body: '중소기업 업무 관리 앱\n14일 무료 체험', mediaIds: [] });
  await look(p, '승인함 시안 2건', '/s/marketing/approvals');
  for (const id of [ig.id, ad.id]) await S.api.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' });
  await look(p, '콘텐츠 캘린더 승인됨', '/s/marketing/calendar');
  const pub = await S.api.req('POST', `/api/marketing/contents/${ig.id}/publish/server`, { atSchedule: true });
  const [c] = await sql`select status, scheduled_at from mkt_contents where id = ${ig.id}`;
  return `승인 ${c.status} · 예약 ${c.scheduled_at ? '시각 있음' : '없음'} · 서버 예약 게시 ${pub.status}${pub.status === 409 ? '(채널 연결 전 — 안내 문구: ' + String(pub.body?.error?.message ?? '').slice(0, 60) + ')' : ''}`;
});
await step('휴대폰 390 주요 화면', async () => {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await c.storageState() });
  const m = await mc.newPage(); m.on('response', (r) => { if (r.status() >= 500 && r.url().startsWith(BASE)) errs.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const wide = [];
  for (const [n, path] of [['휴대폰 홈', '/'], ['휴대폰 업무', '/tasks'], ['휴대폰 영업 허브', '/s/sales/hub'], ['휴대폰 마케팅 승인함', '/s/marketing/approvals']]) {
    await look(m, n, path);
    if (!(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) wide.push(n);
  }
  await mc.close();
  if (wide.length) throw new Error(`가로 넘침: ${wide.join(', ')}`);
});

area = 'G 메일·알림 글';
for (const m of mails.filter((x) => [].concat(x.to).some((t) => String(t).includes('nuri-1181')))) scan(`메일 "${m.subject}" → ${[].concat(m.to).join(', ')}`, '메일', `${m.subject}\n${m.text ?? ''}\n${String(m.html ?? '').replace(/<[^>]+>/g, ' ')}`);
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
