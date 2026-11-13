// 소개 사이트 그림(대표 10/20 16:45 · 306차 #877 '보편적인 회사 툴로 보이게'): 일반 B2B 샘플 회사(실제 데이터 아님)로 홈·업무·캘린더·영업 홈·마케팅 홈 + OG 그림을 public/landing/ 에 만든다.
// 실행: npm run build && node tests/e2e/landing-shots.mjs  (PostgreSQL 필요)
import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, BASE, seoulToday, testDb } from '../helpers.mjs';
import { seedSample } from './sample-seed.mjs';

await resetDb();
const srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50', CAPTURE_BLOCK: '0' }); // 316차 #886: 캡처 방지 워터마크(시연 계정 이름·날짜 사선) 없이
await bootstrap();
const sql = testDb();
const today = seoulToday();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
try {
  const card = await browser.newPage({ viewport: { width: 640, height: 640 } }); // 316차: 샘플 회사 시안 그림(제목 카드)
  const image = async (_name, title, [r, g, b]) => {
    await card.setContent(`<html><body style="margin:0;width:640px;height:640px;display:flex;flex-direction:column;justify-content:flex-end;padding:56px;box-sizing:border-box;font-family:Pretendard,'Noto Sans KR',system-ui,sans-serif;color:#fff;background:linear-gradient(150deg,rgb(${r},${g},${b}) 0%,rgb(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)}) 100%)"><div style="font-size:26px;font-weight:600;opacity:.85">하늘솔루션</div><div style="font-size:62px;font-weight:800;line-height:1.2;margin-top:12px;word-break:keep-all">${title}</div></body></html>`);
    return card.screenshot({ type: 'png' });
  };
  await seedSample(sql, today, { image }); await card.close();
  // 로그인 → 캡처
  const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage();
  await p0.goto(BASE + '/login'); await p0.getByLabel('이메일', { exact: true }).fill('sample@workin.test'); await p0.getByLabel('비밀번호').fill('sample-pass-1234');
  await p0.getByRole('button', { name: '로그인' }).click(); await p0.waitForURL(BASE + '/');
  const st = await ctx0.storageState(); await ctx0.close();
  const lc = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
  await lc.clock.setFixedTime(new Date(`${today}T09:41:00+09:00`)); // 밤에 찍어도 캘린더·인사말이 오전 업무 시간으로(#1047)
  const p = await lc.newPage();
  // 대표 11/14 #1047 · 범용화 G-13: 소개 그림에 우리 업무·이전 문구가 찍히면 안 된다 — 있으면 알림
  const OURS = /심사|\(가상\)|영업관리|현장 미등록|피트니스|헬스|아파트|단지|관리사무소|입주|회원|운동기구|다짐|하이링크/g; const found = [];
  for (const [path, file] of [['/', 'home'], ['/tasks', 'tasks'], ['/calendar?view=week', 'calendar'], ['/s/sales', 'sales'], ['/s/marketing/approvals', 'marketing']]) { // 316차 #886: 마케팅 그림 = 승인함(인스타그램·페이스북 시안만) — 마케팅 홈은 다른 채널 단추가 보여 자동 게시처럼 읽힘
    await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1200);
    await p.addStyleTag({ content: '[data-testid="trial-banner"],[data-testid="daily-welcome"]{display:none!important}' }); await p.waitForTimeout(150); // 316차: 체험 D-n 띠(계정 상태)는 소개 그림에서 뺌
    const hit = [...new Set(((await p.evaluate(() => document.body.innerText)).match(OURS) ?? []))]; if (hit.length) found.push(`${file}: ${hit.join(' · ')}`);
    await p.screenshot({ path: `public/landing/${file}.png` });
  }
  // OG 그림 1200×630
  const og = await lc.newPage(); await og.setViewportSize({ width: 1200, height: 630 });
  await og.setContent(`<html><body style="margin:0;font-family:Pretendard,system-ui,sans-serif;background:linear-gradient(135deg,#0F766E 0%,#2563EB 55%,#7C3AED 100%);color:#fff;width:1200px;height:630px;display:flex;flex-direction:column;justify-content:center;padding:0 80px;box-sizing:border-box">
    <div style="font-size:28px;font-weight:600;opacity:.9">워크인</div><div style="font-size:72px;font-weight:800;line-height:1.15;margin-top:12px">업무도, 영업도,<br>마케팅도 한 화면에서</div>
    <div style="font-size:30px;margin-top:28px;opacity:.95">14일 무료 체험 · 웹 · Android · iOS</div></body></html>`);
  await og.screenshot({ path: '/tmp/landing-og-preview.png' }); // 로고 S3 확정: public/landing/og.png 는 docs/handoff/brand/workin-s3/og-1200x630.png 고정본(덮어쓰지 않음)
  if (found.length) { console.log(`⚠ 소개 그림에 우리 업무·이전 문구:\n- ${found.join('\n- ')}`); process.exitCode = 1; }
  console.log('랜딩 그림 저장: public/landing/{home,tasks,calendar,sales,marketing,approvals,og}.png');
} finally { await browser.close(); srv.proc.kill(); await sql.end(); }
