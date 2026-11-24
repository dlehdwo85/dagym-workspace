// D-08(대표 11/23 승인): 배포 직후 운영 화면 확인 — '검수용 시험 회사' 계정으로 (가짜 자료만, 다짐과 분리)
//   PROD_QA_EMAIL / PROD_QA_PASSWORD (깃허브 비밀값) · BASE(기본 https://www.work-in.dev) · EXPECT_SHA(이 커밋이 운영에 뜰 때까지 기다림, 최대 8분)
// 공개 저장소라 실행 기록도 공개 — 이메일·이름·화면 사진을 찍지 않고 단계 이름과 통과/실패만 남긴다.
// 만들고 지우는 것: 업무 1건(만들기→완료→지우기) · 계약 1건 + 계약서 파일 6MB(저장소 직접 올리기 = R2 CORS 확인) → 보관 → 완전 삭제 · 메모(가짜 값) → 휴지통
// 하지 않는 것: AI 기능·메일·알림톡·결제·초대(돈·밖으로 나가는 일 없음)
import { chromium } from 'playwright';

const BASE = (process.env.BASE ?? 'https://www.work-in.dev').replace(/\/$/, '');
const EMAIL = process.env.PROD_QA_EMAIL, PASSWORD = process.env.PROD_QA_PASSWORD;
const SHA = (process.env.EXPECT_SHA ?? '').slice(0, 7);
if (!EMAIL || !PASSWORD) { console.log('검수용 계정 비밀값(PROD_QA_EMAIL·PROD_QA_PASSWORD)이 없어 건너뜀 — 대표가 깃허브 비밀값을 넣으면 돕니다'); process.exit(0); }

const results = [];
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); results.push([name, true]); console.log(`✔ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { results.push([name, false]); console.log(`✖ ${name} — ${String(e?.message ?? e).replace(EMAIL, '<계정>').slice(0, 300)}`); }
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (SHA) await step(`운영에 ${SHA} 반영될 때까지 기다림`, async () => {
  for (let i = 0; i < 48; i++) {
    const h = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch(() => ({}));
    if (h.commit === SHA) return;
    await sleep(10_000);
  }
  throw new Error('8분 안에 새 커밋이 운영에 뜨지 않음');
});
else await step('지금 운영에 떠 있는 커밋 확인(수동 실행)', async () => {
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json());
  ok(typeof h.commit === 'string' && h.commit.length >= 7, '운영 상태 응답에 커밋 없음');
  console.log(`  운영 커밋 ${h.commit}`);
});

let cookie = '';
await step('검수용 계정 로그인', async () => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }), redirect: 'manual' });
  ok(r.status === 200, `로그인 HTTP ${r.status}`);
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith('wos_session=')) ?? '';
  ok(cookie, '세션 쿠키 없음');
});
if (!cookie) { report(); process.exit(1); }
const api = async (method, path, body) => {
  const r = await fetch(BASE + path, { method, headers: { cookie, origin: BASE, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(j?.error ?? j).slice(0, 160)}`);
  return j;
};

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })); // 깃허브는 설치한 것, 클라우드 시험 기계는 미리 깔린 것
const ctx = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: 'wos_session', value: cookie.split('=').slice(1).join('='), url: BASE }]);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));

// 필수 AI 동의 화면이 뜨면(검수 계정이 아직 동의 전) 한 번 동의 — 동의는 계정 설정일 뿐 AI 를 쓰지 않음
const passGate = async () => { const g = page.getByTestId('ai-consent-required-agree'); if (await g.isVisible().catch(() => false)) { await g.click(); await sleep(500); } };
const visit = async (path, testid) => {
  const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  ok(r && r.status() < 400, `HTTP ${r?.status()}`);
  await passGate();
  if (testid) await page.getByTestId(testid).first().waitFor({ timeout: 20_000 });
};
const noOverflow = async (w) => ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `가로 넘침(${w})`);

await step('홈', () => visit('/', 'home-todo'));
await step('내 업무', () => visit('/tasks', null));
await step('캘린더', () => visit('/calendar', null));
await step('메신저', () => visit('/messages', null));
await step('결재', () => visit('/approvals', null));
await step('자료실', () => visit('/library', null));
await step('설정', () => visit('/settings', null));
for (const [w, h] of [[390, 844], [1440, 900]]) {
  await step(`홈·내 업무 가로 넘침 없음(${w})`, async () => {
    await page.setViewportSize({ width: w, height: h });
    for (const p of ['/', '/tasks']) { await page.goto(BASE + p, { waitUntil: 'networkidle' }).catch(() => {}); await passGate(); await noOverflow(w); }
  });
}

let me = null;
await step('업무 만들기 → 완료 → 지우기', async () => {
  me = (await api('GET', '/api/auth/me')).user;
  const t = await api('POST', '/api/tasks', { title: `[검수] 배포 확인 ${SHA || new Date().toISOString().slice(0, 16)}`, assigneeId: me.id, approvalRequired: false });
  await api('PATCH', `/api/tasks/${t.id}`, { status: 'done' });
  await api('DELETE', `/api/tasks/${t.id}`);
});

await step('파일 저장소 직접 올리기(6MB — R2 허용 주소 확인)', async () => {
  // 로컬 11/24: 일시적인 네트워크 끊김(fetch failed)으로 거짓 실패가 나서 한 번만 5초 쉬고 다시 시도(두 번째도 실패면 진짜 실패)
  try { await uploadOnce(); } catch (e) { console.log(`  (한 번 더 시도 — ${String(e?.message ?? e).slice(0, 120)})`); await sleep(5000); await uploadOnce(); }
});
async function uploadOnce() {
  const a = await api('POST', '/api/agreements', { title: `[검수] 파일 올리기 ${SHA}`, counterparty: '검수', endDate: '2099-12-31' });
  try {
    const f = await api('POST', `/api/agreements/${a.id}/files`, { fileName: 'prod-check.pdf', mimeType: 'application/pdf', size: 6 * 1024 * 1024 });
    // 브라우저가 실제로 보내는 길(운영 주소에서 저장소로 바로 — CORS)을 그대로: 페이지 안에서 PUT
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const st = await page.evaluate(async ({ url, headers }) => {
      const body = new Uint8Array(6 * 1024 * 1024);
      try { const r = await fetch(url, { method: 'PUT', headers, body }); return r.status; } catch (e) { return `막힘: ${e.message}`; }
    }, { url: f.upload.url, headers: f.upload.headers ?? {} });
    ok(st === 200, `저장소 응답 ${st} — 저장소 허용 주소(CORS)에 ${BASE} 가 없을 수 있음`);
    await api('POST', `/api/agreements/files/${f.id}`, {});
    await api('DELETE', `/api/agreements/files/${f.id}`);
  } finally {
    await api('DELETE', `/api/agreements/${a.id}`).catch(() => {});
    await api('DELETE', `/api/agreements/${a.id}?purge=1`).catch(() => {}); // 검수 계정이 대표(owner)면 완전 삭제
  }
}

// #1135 메모: 일반 메모 만들기 → 내 목록 → 휴지통 · 주요 메모(운영 키가 있을 때만): 본인 확인 전 [보기] 막힘 → 확인 → 그 칸만 → 잠그기 → 휴지통
await step('메모·주요 메모(본인 확인 전 막힘 → 확인 뒤 보기)', async () => {
  const st = await api('GET', '/api/memos/status');
  const n = await api('POST', '/api/memos', { kind: 'note', title: `[검수] 메모 ${SHA}`, body: '가짜 내용' });
  ok((await api('GET', '/api/memos')).memos.some((m) => m.id === n.id), '만든 메모가 목록에 없음');
  await api('DELETE', `/api/memos/${n.id}`);
  if (!st.secretReady) { console.log('  (주요 메모 키 없음 — 주요 메모 단계는 건너뜀)'); return; }
  const s = await api('POST', '/api/memos', { kind: 'secret', title: `[검수] 주요 메모 ${SHA}`, username: 'qa-fake', password: 'qa-fake-pass' });
  try {
    await api('DELETE', '/api/memos/unlock');
    const locked = await fetch(`${BASE}/api/memos/${s.id}/reveal`, { method: 'POST', headers: { cookie, origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ fields: ['password'] }) });
    ok(locked.status === 403, `본인 확인 전 [보기]가 막히지 않음(${locked.status})`);
    ok(st.method === 'password', `검수 계정 본인 확인 방식이 비밀번호가 아님(${st.method}) — 2단계 인증을 끄세요`);
    await api('POST', '/api/memos/unlock', { password: PASSWORD });
    const r = await api('POST', `/api/memos/${s.id}/reveal`, { fields: ['password'] });
    ok(r.values?.password === 'qa-fake-pass' && r.values.username === undefined, '고른 칸만 돌아오지 않음');
  } finally {
    await api('DELETE', '/api/memos/unlock').catch(() => {});
    await api('DELETE', `/api/memos/${s.id}`).catch(() => {});
  }
});

// #1139 잠긴 공간(로컬 11/24 요청 — 검수용 시험 회사는 업무만 켜져 있음): 사이드바 자물쇠 '상담 후 사용' → 안내 화면 → [상담 신청] 단추까지만(보내면 운영자 메일이 가므로 누르지 않음) → 잠긴 공간 API 는 서버가 막음(404)
await step('잠긴 공간(자물쇠 → 안내 → 상담 신청 단추 · 서버 404)', async () => {
  const v = await api('GET', '/api/spaces/consult');
  if (!v.locked.length) { console.log('  (검수 회사에 영업·마케팅이 모두 켜져 있어 건너뜀)'); return; }
  const sp = v.locked.includes('sales') ? 'sales' : v.locked[0];
  await visit('/', 'home-todo');
  const lock = page.getByTestId(`space-locked-${sp}`).first();
  await lock.waitFor({ timeout: 20_000 });
  ok(/상담 후 사용/.test(`${await lock.getAttribute('title')} ${await lock.innerText()}`), '자물쇠 칸에 "상담 후 사용" 없음');
  await lock.click();
  await page.waitForURL(/\/spaces\/locked/, { timeout: 20_000 });
  await page.getByTestId('space-locked-page').waitFor({ timeout: 20_000 });
  await page.getByTestId(v.canRequest ? 'space-consult-send' : 'space-consult-staff').waitFor({ timeout: 10_000 });
  const path = sp === 'sales' ? '/api/sales/award-stats' : '/api/marketing/plan';
  const r = await fetch(BASE + path, { headers: { cookie, origin: BASE } });
  ok(r.status === 404, `잠긴 공간 API(${path})가 막히지 않음(${r.status})`);
});

await step('화면 오류(자바스크립트) 없음', async () => ok(errors.length === 0, `${errors.length}건: ${errors.slice(0, 3).join(' | ')}`));
await browser.close();
report();
process.exit(results.every(([, k]) => k) ? 0 : 1);

function report() {
  const bad = results.filter(([, k]) => !k);
  console.log(`\n운영 화면 확인 ${results.length - bad.length}/${results.length} 통과 — ${BASE}`);
}
