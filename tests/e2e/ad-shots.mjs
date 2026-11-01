// 316차 #886(로컬 11/01 메타 일시정지 초안 검수): 메타 광고용 그림 5장(1080×1350, 4:5 피드) — 소개 페이지마다 1장.
// 일반 B2B 샘플 회사(하늘솔루션, 가상)의 휴대폰 화면 + 큰 제목 + 워크인 로고 + '14일 무료 체험'. 캡처 방지 워터마크 없음(CAPTURE_BLOCK=0).
// 마케팅은 승인함(인스타그램·페이스북 시안만) — 다른 채널 단추가 보이는 화면은 쓰지 않음. 문구는 소개 페이지·광고 초안 문서(ADS_BY_PAGE_867)에 있는 운영 기능만.
// 실행: npm run build && node tests/e2e/ad-shots.mjs  (PostgreSQL 필요) → public/ads/meta-{페이지}-1080x1350.jpg
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { bootstrap, resetDb, startServer, BASE, seoulToday, testDb } from '../helpers.mjs';
import { seedSample } from './sample-seed.mjs';

const ADS = (room) => [
  { key: 'task-management', path: '/tasks', head: '업무를 한 줄로 등록하고<br>마감 전에 알림 받기', sub: '담당·마감·검토를 한 화면에서' },
  { key: 'e-approval', path: '/approvals', head: '휴가·지출 결재,<br>휴대폰에서 바로', sub: '알림에서 확인하고 바로 승인' },
  { key: 'collaboration', path: room ? `/messages?room=${room}` : '/messages', head: '메신저·공지·업무를<br>한 계정으로', sub: '대화에서 바로 업무 만들기' },
  { key: 'marketing-automation', path: '/s/marketing/approvals', head: '게시물 시안은 AI가,<br>대표는 승인만', sub: '인스타그램·페이스북 예약 게시' },
  { key: 'bid-collection', path: '/s/sales/bids', head: '입찰·지원사업 공고,<br>매일 아침 한 번에', sub: '고른 공고는 담당 업무로' },
];
const LOCKUP = 'docs/handoff/brand/workin-s3/lockup-horizontal-2400x720-dark.png'; // 대표 확정 S3 로고(어두운 바탕용)

await resetDb();
const srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50', CAPTURE_BLOCK: '0' });
await bootstrap();
const sql = testDb();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
try {
  const card = await browser.newPage({ viewport: { width: 640, height: 640 } }); // 샘플 회사 시안 그림(제목 카드 — 가상 회사 디자인)
  const image = async (_name, title, [r, g, b]) => {
    await card.setContent(`<html><body style="margin:0;width:640px;height:640px;display:flex;flex-direction:column;justify-content:flex-end;padding:56px;box-sizing:border-box;font-family:Pretendard,'Noto Sans KR',system-ui,sans-serif;color:#fff;background:linear-gradient(150deg,rgb(${r},${g},${b}) 0%,rgb(${Math.round(r * 0.55)},${Math.round(g * 0.55)},${Math.round(b * 0.55)}) 100%)"><div style="font-size:26px;font-weight:600;opacity:.85">하늘솔루션</div><div style="font-size:62px;font-weight:800;line-height:1.2;margin-top:12px;word-break:keep-all">${title}</div></body></html>`);
    return card.screenshot({ type: 'png' });
  };
  const { room } = await seedSample(sql, seoulToday(), { image });
  await card.close();
  const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage();
  await p0.goto(BASE + '/login'); await p0.getByLabel('이메일', { exact: true }).fill('sample@workin.test'); await p0.getByLabel('비밀번호').fill('sample-pass-1234');
  await p0.getByRole('button', { name: '로그인' }).click(); await p0.waitForURL(BASE + '/');
  const st = await ctx0.storageState(); await ctx0.close();
  // 휴대폰 화면(390×844, 2배) — 피드에서 글자가 읽히게 화면 위쪽만 크게 씀
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_capture_notice', '1'); localStorage.setItem('wos_status_tip', '3'); } catch {} }); // 첫 안내 말풍선 없이
  const mp = await mc.newPage();
  const shots = {};
  for (const ad of ADS(room)) {
    await mp.goto(BASE + ad.path); await mp.waitForLoadState('networkidle').catch(() => {}); await mp.waitForTimeout(1500);
    // 체험 D-n 띠(계정 상태)·이관 안내(우리 회사 자료 옮김)·다른 화면의 '결재할 것' 띠는 광고 그림에서 뺌
    await mp.addStyleTag({ content: `[data-testid="trial-banner"],[data-testid="sales-live"]${ad.key === 'e-approval' ? '' : ',[data-testid="approvals-todo-bar"]'}{display:none!important}` }); await mp.waitForTimeout(200);
    shots[ad.key] = (await mp.screenshot({ type: 'png' })).toString('base64');
  }
  await mc.close();
  const logo = (await readFile(LOCKUP)).toString('base64');
  const out = await browser.newContext({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1, locale: 'ko-KR' });
  const cp = await out.newPage();
  await mkdir('public/ads', { recursive: true });
  for (const ad of ADS(room)) {
    await cp.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box;margin:0}
      body{width:1080px;height:1350px;overflow:hidden;font-family:Pretendard,'Noto Sans KR','Noto Sans CJK KR',system-ui,sans-serif;background:linear-gradient(160deg,#13866F 0%,#0B5C4E 100%);color:#fff;position:relative}
      .logo{position:absolute;left:72px;top:64px;height:72px}
      h1{position:absolute;left:72px;right:72px;top:176px;font-size:76px;line-height:1.22;font-weight:800;letter-spacing:-1.5px;word-break:keep-all}
      .sub{position:absolute;left:72px;top:380px;font-size:38px;font-weight:600;opacity:.92}
      .pill{position:absolute;left:72px;top:446px;background:linear-gradient(90deg,#FBBF24,#F59E0B);color:#0F172A;font-size:34px;font-weight:800;padding:12px 30px;border-radius:999px}
      .phone{position:absolute;left:50%;transform:translateX(-50%);top:560px;width:600px;height:1300px;border-radius:64px;background:#0F172A;padding:18px;box-shadow:0 30px 80px rgba(0,0,0,.35)}
      .phone img{width:100%;border-radius:48px;display:block}
    </style></head><body>
      <img class="logo" src="data:image/png;base64,${logo}" alt="">
      <h1>${ad.head}</h1><div class="sub">${ad.sub}</div><div class="pill">14일 무료 체험</div>
      <div class="phone"><img src="data:image/png;base64,${shots[ad.key]}" alt=""></div>
    </body></html>`);
    await cp.waitForTimeout(300);
    await writeFile(`public/ads/meta-${ad.key}-1080x1350.jpg`, await cp.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: 1080, height: 1350 } }));
  }
  console.log('광고 그림 저장: public/ads/meta-*-1080x1350.jpg');
} finally { await browser.close(); srv.proc.kill(); await sql.end(); }
