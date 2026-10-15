// V28-5 스토어용 휴대폰 스크린샷 6장(1080×1920, 9:16) — 홈·업무·캘린더·음성 등록·AI 비서·메신저
// 사용: SHOT_BASE=https://dagym-workspace.vercel.app SHOT_EMAIL=심사용계정 SHOT_PASSWORD=비밀번호 node scripts/store-screenshots.mjs
//  - 예시 데이터가 있는 "심사용 체험 계정"(데모 조직)으로 찍는다. 비밀번호는 환경변수로만(저장소·로그에 남기지 않음)
//  - 결과: store-screenshots/01-home.png … 06-messages.png (저장소에 올리지 않음 — .gitignore)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = (process.env.SHOT_BASE ?? 'http://localhost:3000').replace(/\/$/, '');
const EMAIL = process.env.SHOT_EMAIL, PASSWORD = process.env.SHOT_PASSWORD;
const OUT = process.env.SHOT_OUT ?? 'store-screenshots';
if (!EMAIL || !PASSWORD) { console.error('SHOT_EMAIL·SHOT_PASSWORD 환경변수가 필요합니다(심사용 체험 계정)'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
// 360×640 CSS px × 3 = 1080×1920 (Play 휴대폰 스크린샷 9:16, App Store 는 별도 크기 필요 시 SHOT_W/SHOT_H)
const w = Number(process.env.SHOT_W ?? 360), h = Number(process.env.SHOT_H ?? 640);
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
  userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
const r = await page.request.post(`${BASE}/api/auth/login`, { data: { email: EMAIL, password: PASSWORD, client: 'web' }, headers: { origin: BASE } });
if (!r.ok()) { console.error('로그인 실패', r.status(), await r.text()); process.exit(1); }
// 첫 실행 안내·알림 권한 묻기 닫아 둠
await page.addInitScript(() => { try { localStorage.setItem('wos_push_asked', '1'); localStorage.setItem('wos_sel_tip', '1'); } catch {} });

const settle = async () => { await page.waitForLoadState('networkidle').catch(() => {}); await page.waitForTimeout(800); };
const shot = async (name) => { await page.screenshot({ path: `${OUT}/${name}.png` }); console.log('✔', `${OUT}/${name}.png`); };

await page.goto(`${BASE}/`); await settle(); await shot('01-home');
await page.goto(`${BASE}/tasks`); await settle(); await shot('02-tasks');
await page.goto(`${BASE}/calendar`); await settle(); await shot('03-calendar');
await page.goto(`${BASE}/tasks`); await settle();
await page.getByTestId('fab').click().catch(() => {});
await page.getByTestId('fab-voice').click().catch(() => {}); await page.waitForTimeout(800); await shot('04-voice');
await page.goto(`${BASE}/assistant`); await settle(); await shot('05-assistant');
await page.goto(`${BASE}/messages`); await settle(); await shot('06-messages');
await browser.close();
