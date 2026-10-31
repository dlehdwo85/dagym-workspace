// 271차 설계 → 273차 #811 1) 앱 화면 녹화(대표 10/29 'AI 영상 비용 최소화'): 녹화 대본(json)대로 휴대폰 화면을 움직이며 녹화 → 1080×1920 mp4 → (선택) 우리 회사 자료실 '마케팅/화면 녹화'에 올림.
// 로컬 PC 에서 돌린다(클라우드에는 계정이 없음). 생성 비용 0.
//
// 사용(PowerShell 이면 $env:REC_EMAIL='…' 처럼):
//   REC_BASE=https://dagym-workspace.vercel.app REC_EMAIL=데모계정 REC_PASSWORD=비밀번호 \
//   UPLOAD_EMAIL=우리회사관리자 UPLOAD_PASSWORD=비밀번호 \
//   node scripts/marketing/record-screen.mjs scripts/marketing/screens/workin-tasks.json
//  - 녹화는 데모 회사(가상 이름·가상 업무) 계정으로만. 실제 고객·직원 정보가 보이는 화면은 녹화하지 않는다.
//  - 비밀번호는 환경변수로만(저장소·로그에 남기지 않음). UPLOAD_* 가 없으면 파일만 만든다(REC_OUT, 기본 screen-records/ — 저장소에 올리지 않음).
//  - 대본의 lines 는 자료실 파일 설명에 한 줄씩 들어가고, 서버가 영상을 만들 때 자막으로 쓴다.
// 대본 꼴: { "brand": "워크인", "title": "…", "login": true, "viewport": [390, 844], "lines": ["자막 1", …],
//           "steps": [{ "goto": "/tasks" }, { "wait": 1200 }, { "click": "testid:fab" }, { "type": { "to": "testid:quick-title", "text": "…" } }, { "scroll": 500 }] }
//   click·type 의 to: 'testid:이름' = data-testid · 'text:글' = 그 글이 보이는 곳 · 그 밖 = CSS 선택자. 못 찾으면 건너뛰고 계속 녹화.
import { chromium, request as pwRequest } from 'playwright';
import { mkdirSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

const planPath = process.argv[2];
if (!planPath) { console.error('녹화 대본(json) 경로를 주세요 — 예: node scripts/marketing/record-screen.mjs scripts/marketing/screens/workin-tasks.json'); process.exit(1); }
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const BASE = (process.env.REC_BASE ?? plan.base ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT = process.env.REC_OUT ?? 'screen-records';
const [VW, VH] = plan.viewport ?? [390, 844];
const FF = process.env.FFMPEG_PATH || join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
mkdirSync(OUT, { recursive: true });

async function login(ctxReq, email, password) {
  const r = await ctxReq.post(`${BASE}/api/auth/login`, { data: { email, password, client: 'web' }, headers: { origin: BASE } });
  if (!r.ok()) throw new Error(`로그인 실패 ${r.status()} ${(await r.text()).slice(0, 200)}`);
}
const loc = (page, to) => to.startsWith('testid:') ? page.getByTestId(to.slice(7)).first() : to.startsWith('text:') ? page.getByText(to.slice(5)).first() : page.locator(to).first();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tmp = join(tmpdir(), `rec-${Date.now()}`); mkdirSync(tmp, { recursive: true });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
if (plan.login !== false) {
  if (!process.env.REC_EMAIL || !process.env.REC_PASSWORD) { console.error('REC_EMAIL·REC_PASSWORD(데모 회사 계정) 환경변수가 필요합니다 — 로그인 없는 대본은 "login": false'); process.exit(1); }
  await login(page.request, process.env.REC_EMAIL, process.env.REC_PASSWORD);
}
await page.addInitScript(() => { try { localStorage.setItem('wos_push_asked', '1'); localStorage.setItem('wos_sel_tip', '1'); } catch { /* 저장 못 함 */ } });
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500); };
// 녹화: 크롬 화면 전송(screencast) — 기기 화소(3배) 그대로 JPEG 장면을 받아 시각과 함께 저장(Playwright 기본 녹화는 화면 크기(390px)라 흐림)
const cdp = await ctx.newCDPSession(page);
const frames = []; // { file, at(초) } — 화면이 바뀔 때만 옴
cdp.on('Page.screencastFrame', (f) => {
  const file = `f${String(frames.length).padStart(5, '0')}.jpg`; writeFileSync(join(tmp, file), Buffer.from(f.data, 'base64')); frames.push({ file, at: Date.now() / 1000 });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VW * 3, maxHeight: VH * 3, everyNthFrame: 1 });
let startAt = null; // 첫 화면이 다 뜬 때부터 씀(빈 화면·불러오는 중 빼기)
for (const s of plan.steps ?? []) {
  try {
    if (s.goto) { await page.goto(/^[a-z]+:/i.test(s.goto) ? s.goto : `${BASE}${s.goto}`); await settle(); }
    if (s.click) { await loc(page, s.click).click({ timeout: 4000 }); await page.waitForTimeout(400); }
    if (s.type) { const el = loc(page, s.type.to); await el.click({ timeout: 4000 }); await el.pressSequentially(String(s.type.text), { delay: s.type.delay ?? 70 }); }
    if (s.scroll) { const n = Math.max(1, Math.round(Math.abs(s.scroll) / 40)); for (let k = 0; k < n; k++) { await page.mouse.wheel(0, Math.sign(s.scroll) * 40); await page.waitForTimeout(25); } }
    if (s.wait) await page.waitForTimeout(s.wait);
  } catch (e) { console.warn('건너뜀:', JSON.stringify(s), String(e?.message ?? e).split('\n')[0]); }
  startAt ??= Date.now() / 1000;
}
await page.waitForTimeout(600);
const endAt = Date.now() / 1000;
await cdp.send('Page.stopScreencast').catch(() => {});
await ctx.close(); await browser.close();
// 시작 전 장면은 마지막 한 장만 남기고, 장면마다 다음 장면까지 걸린 시간만큼 보여 줌(ffmpeg concat)
const first = Math.max(0, frames.findLastIndex((x) => x.at <= (startAt ?? 0)));
const use = frames.slice(first);
if (!use.length) { console.error('녹화된 화면이 없습니다'); process.exit(1); }
const list = use.map((x, k) => `file '${join(tmp, x.file).replace(/'/g, "'\\''")}'\nduration ${Math.max(1 / 30, (k + 1 < use.length ? use[k + 1].at : endAt) - Math.max(x.at, startAt ?? x.at)).toFixed(3)}`).join('\n')
  + `\nfile '${join(tmp, use.at(-1).file).replace(/'/g, "'\\''")}'\n`;
writeFileSync(join(tmp, 'list.txt'), list);
// 1080×1920: 높이를 1920 에 맞추고 좌우는 옅은 바탕으로 채움(앱 화면이 잘리지 않게)
const name = `${plan.brand ?? '브랜드'}_${basename(planPath, '.json')}_${new Date().toISOString().slice(0, 10)}.mp4`.replace(/[\\/:*?"<>|\s]+/g, '_');
const mp4 = join(OUT, name);
const ff = spawnSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(tmp, 'list.txt'),
  '-vf', `scale=-2:1920:flags=lanczos,pad=1080:1920:(ow-iw)/2:0:color=0x${(plan.padColor ?? 'F4F6FA').replace('#', '')},setsar=1,fps=30,format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-an', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
rmSync(tmp, { recursive: true, force: true });
if (ff.status !== 0) { console.error('ffmpeg 변환 실패'); process.exit(1); }
const size = statSync(mp4).size;
console.log('✔ 녹화', mp4, `${(size / 1048576).toFixed(1)}MB`);

// 우리 회사 자료실에 올리기(UPLOAD_EMAIL·UPLOAD_PASSWORD = 우리 회사 관리자) — 폴더 '마케팅/화면 녹화', 태그 = 브랜드·화면 녹화, 설명 = 자막 줄
if (process.env.UPLOAD_EMAIL && process.env.UPLOAD_PASSWORD) {
  const api = await pwRequest.newContext({ baseURL: BASE });
  await login(api, process.env.UPLOAD_EMAIL, process.env.UPLOAD_PASSWORD);
  const data = readFileSync(mp4);
  const lf = await api.post('/api/library', { data: { fileName: name, mimeType: 'video/mp4', size, title: plan.title ?? name, folder: '마케팅/화면 녹화', space: 'marketing',
    tags: [plan.brand, '화면 녹화'].filter(Boolean), description: (plan.lines ?? []).join('\n').slice(0, 2000), allowDuplicate: true } });
  if (!lf.ok()) { console.error('자료실 올리기 실패', lf.status(), (await lf.text()).slice(0, 300)); process.exit(1); }
  const f = await lf.json();
  const url = /^https?:/.test(f.upload.url) ? f.upload.url : `${BASE}${f.upload.url}`;
  const put = await fetch(url, { method: 'PUT', headers: f.upload.headers ?? { 'content-type': 'video/mp4' }, body: data });
  if (!put.ok) { console.error('파일 보내기 실패', put.status); process.exit(1); }
  const done = await api.post(`/api/library/${f.id}/complete`, { data: {} });
  if (!done.ok()) { console.error('올리기 마무리 실패', done.status()); process.exit(1); }
  console.log('✔ 자료실', `마케팅/화면 녹화 · ${f.id}`);
  await api.dispose();
}
