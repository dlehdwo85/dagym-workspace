// 351차 #947(로컬 11/04 03:3x · 대표 '아이폰 앱 정상 출시를 서둘러 달라'): App Store 6.9형 스크린샷 v4 — 1320×2868(뷰포트 440×956 · 배율 3 · 아이폰 WorkInApp 표시).
// 시험 서버 + 일반 B2B 샘플 회사(하늘솔루션, 가상 — 306차 sample-seed, 실제 회사·사람 데이터 0) 화면 6장을 찍고 WORKIN_STORE_LISTING.md '스크린샷 6장' 헤드라인(청록 #0F766E 위 흰 글씨 + 휴대폰 화면)으로 합성한다.
// 조건 검사: 화면 글에 원·회(횟수)·가격·무료·체험·요금 글자가 있으면 실패로 보고(2.3.7 거절 사유 재발 방지). 생성 AI 없음 — Playwright(크로미움)·sharp 만.
// 실행: npm run build && node tests/e2e/store-shots-ios-v4.mjs  (PostgreSQL 필요) → docs/handoff/store/ios-v4/iphone-01..06.png(6.9형 1320×2868) · iphone61-01..06.png(6.1형 1179×2556, 같은 그림 줄임) · ipad-01..06.png(아이패드 13형 2048×2732, 아이패드 화면 캡처) · raw/ · 00_sheet.jpg
// 로컬 11/04 04:0x: 앱이 아이패드도 지원(TARGETED_DEVICE_FAMILY 1,2)이라 아이패드 묶음은 필수 — 옛 v3 묶음(가격 표시)을 모두 새것으로 바꾸려고 6.1형·아이패드도 같이 만든다
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { bootstrap, resetDb, startServer, BASE, seoulToday, testDb } from '../helpers.mjs';
import { seedSample } from './sample-seed.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const OUT = 'docs/handoff/store/ios-v4'; mkdirSync(`${OUT}/raw`, { recursive: true });
const W = 1320, H = 2868, GREEN = '#0F766E';
const PW = 2048, PH = 2732; // 아이패드 13형(2048×2732) — 뷰포트 1024×1366 @2
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp/1.2.0';
const UA_PAD = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp/1.2.0';
// 2.3.7: 원·횟수·가격·무료·체험·요금 글자 0 — '회의'·'회사' 같은 낱말은 빼고 '숫자+회'만 본다
const BAD = /\d[\d,]*\s*원(?![가-힣])|\d+\s*회(?![사의원])|가격|무료|체험|요금|크레딧/g; // '원' 뒤에 한글이 오면(직원·원인 등) 낱말이라 제외
const SLIDES = [
  { n: 1, path: '/', title: ['오늘 할 일,', '한눈에'], sub: '오늘 마감·이번 주 일정·새 알림을 홈에서 바로' },
  { n: 2, path: '/tasks', title: ['요청하고, 확인하고,', '끝내기'], sub: '담당자·마감·단계가 한 줄에 — 지연은 바로 표시' },
  { n: 3, path: '/calendar?view=week', title: ['업무와 일정이', '한 캘린더에'], sub: '회사·부서·내 일정과 업무 마감을 한 주로' },
  { n: 4, path: '/assistant?thread=THREAD', title: ['말로 물어보면', 'AI 가 정리'], sub: '내 업무·일정을 묻고, 알림·업무 요청은 확인 뒤 실행' },
  { n: 5, path: '/tasks/TASK', title: ['검토·승인까지', '업무 안에서'], sub: '단계·체크리스트·댓글·첨부가 한곳에' },
  { n: 6, path: '/s/sales/leads', title: ['영업·마케팅도', '같은 앱에서'], sub: '리드·다음 연락·거래처를 팀과 함께' },
];

await resetDb();
const srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50', CAPTURE_BLOCK: '0' });
await bootstrap();
const sql = testDb();
const today = seoulToday();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
const problems = [];
try {
  const card = await browser.newPage({ viewport: { width: 640, height: 640 } });
  const image = async (_name, title, [r, g, b]) => {
    await card.setContent(`<html><body style="margin:0;width:640px;height:640px;display:flex;flex-direction:column;justify-content:flex-end;padding:56px;box-sizing:border-box;font-family:Pretendard,'Noto Sans KR',system-ui,sans-serif;color:#fff;background:linear-gradient(160deg,rgb(${r},${g},${b}),rgb(${Math.round(r * 0.6)},${Math.round(g * 0.6)},${Math.round(b * 0.6)}))"><div style="font-size:22px;opacity:.85">하늘솔루션</div><div style="font-size:44px;font-weight:800;line-height:1.2">${title}</div></body></html>`);
    return card.screenshot({ type: 'png' });
  };
  const seeded = await seedSample(sql, today, { image }); await card.close();
  const { c, ppl } = seeded;
  // 업무 상세용: 단계 '진행 중' + 체크리스트 + 댓글(가상 사람 이름만)
  const tasks = (await c.ok('GET', '/api/tasks?status=open&limit=100')).tasks;
  const task = tasks.find((t) => /거래처 미팅 준비/.test(t.title)) ?? tasks[0];
  await c.ok('PATCH', `/api/tasks/${task.id}`, { description: '내일 14시 거래처 미팅 전에 견적서 금액·납기를 다시 확인하고, 제안서 요약본을 같이 준비합니다.' }).catch((e) => console.log('patch', e.message));
  await sql`update tasks set status = 'in_progress' where id = ${task.id}`; // 상태는 담당자만 바꿀 수 있어 시드는 바로 적음
  for (const text of ['견적서 단가·납기 확인', '제안서 요약본 2장 준비', '참석자에게 장소·시간 공유']) await c.ok('POST', `/api/tasks/${task.id}/checklist`, { text }).catch((e) => console.log('check', e.message));
  await c.ok('POST', `/api/tasks/${task.id}/comments`, { body: '견적서는 어제 버전에서 납기만 바꾸면 됩니다. 요약본은 오늘 저녁까지 올릴게요.' }).catch((e) => console.log('comment', e.message));
  // AI 비서 대화(가상 — 모델 호출 없음, 저장된 대화만 보여 줌)
  const [me] = await sql`select id, tenant from users where email = 'sample@workin.test'`;
  const [th] = await sql`insert into ai_threads (tenant, user_id, title) values (${me.tenant}, ${me.id}, '오늘 남은 업무') returning id`;
  for (const [role, text] of [
    ['user', '오늘 내 업무 뭐 남았어?'],
    ['assistant', '오늘 마감인 업무가 2건 있어요.\n\n1. 신제품 소개 자료 최종본 정리 — 이서준 · 오늘 마감\n2. 고객 문의 답변 정리 — 이서준 · 내일 마감\n\n내일 14시 거래처 미팅 전에 "거래처 미팅 준비 — 견적서 확인" 업무도 진행 중입니다. 필요하면 담당자에게 알림을 보낼게요.'],
    ['user', '거래처 미팅 준비 담당자에게 알려 줘'],
    ['assistant', '이서준님에게 "거래처 미팅 준비 — 견적서 확인" 업무 알림을 보낼까요? [확인]을 누르면 바로 보냅니다.'],
  ]) await sql`insert into ai_messages (thread_id, role, text) values (${th.id}, ${role}, ${text})`;
  await sql`update sales_leads set expected_revenue = null where tenant = ${me.tenant}`.catch(() => {}); // 영업 리드 화면에 '예상 n원' 금액이 보이지 않게(2.3.7 — 금액 글자 0)
  await sql`update approval_requests set amount = null, data = data - 'amount' where tenant = ${me.tenant}`.catch(() => {}); // 결재 목록의 '320,000원'(화면 아래)도 금액 글자 0
  await sql`update notifications set body = regexp_replace(body, '\\s*·?\\s*[0-9][0-9,]*\\s*원', '', 'g'), title = regexp_replace(title, '\\s*·?\\s*[0-9][0-9,]*\\s*원', '', 'g') where body ~ '[0-9]원' or title ~ '[0-9]원'`.catch((e) => console.log('notif', e.message)); // 알림 글(결재 요청 금액)에도 금액 글자 0
  await sql`update tasks set title = regexp_replace(title, '\\s*·?\\s*[0-9][0-9,]*\\s*원', '', 'g') where title ~ '[0-9]원'`.catch((e) => console.log('tasks', e.message)); // tasks 에는 tenant 칸이 없음(시험 DB 전체) // 결재에서 생긴 업무 제목 '[구매] … 320,000원'
  void ppl;
  // 로그인(PC 표시로) → 쿠키를 아이폰 앱 표시 창에 넘김
  const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage();
  await p0.goto(BASE + '/login'); await p0.getByLabel('이메일', { exact: true }).fill('sample@workin.test'); await p0.getByLabel('비밀번호').fill('sample-pass-1234');
  await p0.getByRole('button', { name: '로그인' }).click(); await p0.waitForURL(BASE + '/');
  const st = await ctx0.storageState(); await ctx0.close();
  const mc = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: UA, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_connect_card', 'off'); localStorage.setItem('wos_status_tip', '3'); } catch {} }); // 홈 '연결하면 좋아요' 카드·'눌러서 상태 바꾸기' 말풍선은 스토어 그림에서 뺌
  const p = await mc.newPage();
  const raws = [];
  for (const s of SLIDES) {
    const path = s.path.replace('THREAD', th.id).replace('TASK', task.id);
    await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1800);
    await p.addStyleTag({ content: '[data-testid="trial-banner"],[data-testid="pwa-install"],[data-testid="push-ask"]{display:none!important}' }); await p.waitForTimeout(200);
    if (s.n === 4) await p.getByTestId('ai-budget').waitFor({ timeout: 15000 }).catch(() => problems.push(`${s.n}: AI 막대 안 보임`));
    const text = await p.evaluate(() => document.body.innerText);
    const bad = [...new Set((text.match(BAD) ?? []).map((x) => x.trim()))];
    if (bad.length) {
      // 어디에 있는지(요소의 testid·class 사슬) 같이 적어 두면 다음 사람이 바로 고칠 수 있다
      const where = await p.evaluate((words) => {
        const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = w.nextNode(); n; n = w.nextNode()) { if (!words.some((x) => n.textContent.includes(x))) continue;
          const chain = []; for (let e = n.parentElement; e && chain.length < 6; e = e.parentElement) chain.push(e.dataset.testid ? `[${e.dataset.testid}]` : `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')}`);
          out.push(`${n.textContent.trim().slice(0, 60)} ← ${chain.join(' < ')}`); if (out.length >= 3) break; }
        return out; }, bad);
      problems.push(`${s.n} ${path}: 금지 글자 ${bad.join(' · ')} — ${where.join(' | ')}`);
    }
    const raw = `${OUT}/raw/${String(s.n).padStart(2, '0')}.png`;
    await p.screenshot({ path: raw }); raws.push(raw);
    const meta = await sharp(raw).metadata(); if (meta.width !== W || meta.height !== H) problems.push(`${s.n}: 캡처 크기 ${meta.width}×${meta.height}`);
    console.log('캡처', s.n, path, bad.length ? `⚠ ${bad.join(' · ')}` : '글자 OK');
  }
  await mc.close();
  // 아이패드 13형: 1024×1366 @2 — 같은 화면 6장(가로폭이 넓어 PC 와 같은 틀이 보임)
  const pc = await browser.newContext({ viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA_PAD, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
  await pc.addInitScript(() => { try { localStorage.setItem('wos_connect_card', 'off'); localStorage.setItem('wos_status_tip', '3'); } catch {} });
  const pp = await pc.newPage(); const padRaws = [];
  for (const s of SLIDES) {
    const path = s.path.replace('THREAD', th.id).replace('TASK', task.id);
    await pp.goto(BASE + path); await pp.waitForLoadState('networkidle').catch(() => {}); await pp.waitForTimeout(1800);
    await pp.addStyleTag({ content: '[data-testid="trial-banner"],[data-testid="pwa-install"],[data-testid="push-ask"]{display:none!important}' }); await pp.waitForTimeout(200);
    const text = await pp.evaluate(() => document.body.innerText);
    const bad = [...new Set((text.match(BAD) ?? []).map((x) => x.trim()))];
    if (bad.length) problems.push(`아이패드 ${s.n} ${path}: 금지 글자 ${bad.join(' · ')}`);
    const raw = `${OUT}/raw/ipad-${String(s.n).padStart(2, '0')}.png`;
    await pp.screenshot({ path: raw }); padRaws.push(raw);
    const meta = await sharp(raw).metadata(); if (meta.width !== PW || meta.height !== PH) problems.push(`아이패드 ${s.n}: 캡처 크기 ${meta.width}×${meta.height}`);
    console.log('아이패드 캡처', s.n, path, bad.length ? `⚠ ${bad.join(' · ')}` : '글자 OK');
  }
  await pc.close();
  // 합성: 청록 배경 + 헤드라인(흰 글씨) + 휴대폰 틀 안 캡처 — 글꼴은 앱과 같은 Pretendard(저장소 node_modules, 외부 내려받기 없음)
  const font = readFileSync('node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2').toString('base64');
  const icon = readFileSync('docs/handoff/brand/workin-s3/icon-1024-rounded.png').toString('base64');
  const cp = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const outs = [];
  for (const s of SLIDES) {
    const raw = raws[s.n - 1];
    const px = await sharp(raw).extract({ left: 12, top: 4, width: 4, height: 4 }).raw().toBuffer();
    const bar = `rgb(${px[0]},${px[1]},${px[2]})`; const dark = (px[0] * 299 + px[1] * 587 + px[2] * 114) / 1000 < 128;
    const shot = readFileSync(raw).toString('base64');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face{font-family:P;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
      body{margin:0;width:${W}px;height:${H}px;background:${GREEN};font-family:P,system-ui,sans-serif;color:#fff;overflow:hidden;position:relative}
      .c1{position:absolute;right:-320px;top:-260px;width:960px;height:960px;border-radius:50%;background:rgba(255,255,255,.08)}
      .c2{position:absolute;left:-260px;bottom:-120px;width:760px;height:760px;border-radius:50%;background:rgba(255,255,255,.06)}
      .brand{position:absolute;left:96px;top:150px;display:flex;align-items:center;gap:22px;font-size:46px;font-weight:700;letter-spacing:-1px}
      .brand img{width:80px;height:80px;border-radius:22px}
      h1{position:absolute;left:96px;top:300px;margin:0;font-size:108px;line-height:1.14;font-weight:800;letter-spacing:-3px;width:1140px}
      .sub{position:absolute;left:96px;top:600px;font-size:44px;font-weight:500;line-height:1.35;opacity:.92;width:1140px}
      .accent{position:absolute;left:96px;top:700px;width:104px;height:12px;border-radius:6px;background:#F59E0B}
      .phone{position:absolute;left:150px;top:830px;width:1020px;padding:18px;background:linear-gradient(135deg,#3a3a3f,#18181b 50%,#3a3a3f);border-radius:150px;box-shadow:0 70px 140px rgba(0,0,0,.45)}
      .screen{border-radius:132px;overflow:hidden;background:${bar};position:relative}
      .status{height:76px;display:flex;align-items:center;justify-content:space-between;padding:0 64px 0 76px;font-size:32px;font-weight:600;color:${dark ? '#fff' : '#111'}}
      .island{position:absolute;left:50%;top:18px;transform:translateX(-50%);width:230px;height:66px;border-radius:34px;background:#000}
      .screen img{display:block;width:1020px;height:auto}
      .ic{display:flex;align-items:center;gap:12px}
    </style></head><body><div class="c1"></div><div class="c2"></div>
      <div class="brand"><img src="data:image/png;base64,${icon}">워크인</div>
      <h1>${s.title.join('<br>')}</h1><div class="sub">${s.sub}</div><div class="accent"></div>
      <div class="phone"><div class="screen"><div class="island"></div>
        <div class="status"><span>9:41</span><span class="ic">
          <svg width="36" height="24" viewBox="0 0 36 24" fill="currentColor"><rect x="0" y="14" width="6" height="10" rx="1.5"/><rect x="10" y="10" width="6" height="14" rx="1.5"/><rect x="20" y="5" width="6" height="19" rx="1.5"/><rect x="30" y="0" width="6" height="24" rx="1.5"/></svg>
          <svg width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M2 8a20 20 0 0 1 28 0"/><path d="M8 14a12 12 0 0 1 16 0"/><circle cx="16" cy="20" r="2" fill="currentColor" stroke="none"/></svg>
          <svg width="54" height="26" viewBox="0 0 54 26" fill="none"><rect x="1" y="1" width="46" height="24" rx="7" stroke="currentColor" stroke-opacity=".4" stroke-width="2"/><rect x="5" y="5" width="38" height="16" rx="4" fill="currentColor"/><rect x="50" y="9" width="3" height="8" rx="1.5" fill="currentColor" fill-opacity=".4"/></svg>
        </span></div>
        <img src="data:image/png;base64,${shot}"></div></div>
    </body></html>`;
    await cp.setContent(html); await cp.evaluate(() => document.fonts.ready); await cp.waitForTimeout(300);
    const out = `${OUT}/iphone-${String(s.n).padStart(2, '0')}.png`;
    await cp.screenshot({ path: out, type: 'png' }); outs.push(out); console.log('합성', out);
  }
  await cp.close();
  // 6.1형(1179×2556) — 6.9형 그림을 그대로 줄임(비율 같음 0.893). 옛 APP_IPHONE_61 묶음을 비우지 않고 새 그림으로 바꾸려고
  for (const [i, f] of outs.entries()) await sharp(f).resize(1179, 2556, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(`${OUT}/iphone61-${String(i + 1).padStart(2, '0')}.png`);
  // 아이패드 13형 합성: 2048×2732 — 헤드라인 위, 태블릿 틀(가로 1700) 아래
  const tp = await browser.newPage({ viewport: { width: PW, height: PH }, deviceScaleFactor: 1 });
  const pads = [];
  for (const s of SLIDES) {
    const raw = padRaws[s.n - 1];
    const px = await sharp(raw).extract({ left: 12, top: 4, width: 4, height: 4 }).raw().toBuffer();
    const bar = `rgb(${px[0]},${px[1]},${px[2]})`; const dark = (px[0] * 299 + px[1] * 587 + px[2] * 114) / 1000 < 128;
    const shot = readFileSync(raw).toString('base64');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face{font-family:P;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}
      body{margin:0;width:${PW}px;height:${PH}px;background:${GREEN};font-family:P,system-ui,sans-serif;color:#fff;overflow:hidden;position:relative}
      .c1{position:absolute;right:-420px;top:-360px;width:1200px;height:1200px;border-radius:50%;background:rgba(255,255,255,.08)}
      .c2{position:absolute;left:-320px;bottom:-200px;width:900px;height:900px;border-radius:50%;background:rgba(255,255,255,.06)}
      .brand{position:absolute;left:140px;top:120px;display:flex;align-items:center;gap:22px;font-size:46px;font-weight:700;letter-spacing:-1px}
      .brand img{width:80px;height:80px;border-radius:22px}
      h1{position:absolute;left:140px;top:250px;margin:0;font-size:104px;line-height:1.12;font-weight:800;letter-spacing:-3px;width:1768px;text-align:center}
      .sub{position:absolute;left:140px;top:520px;font-size:44px;font-weight:500;opacity:.92;width:1768px;text-align:center}
      .accent{position:absolute;left:${PW / 2 - 52}px;top:600px;width:104px;height:12px;border-radius:6px;background:#F59E0B}
      .pad{position:absolute;left:${(PW - 1720) / 2}px;top:700px;width:1680px;padding:20px;background:linear-gradient(135deg,#3a3a3f,#18181b 50%,#3a3a3f);border-radius:90px;box-shadow:0 70px 140px rgba(0,0,0,.45)}
      .screen{border-radius:72px;overflow:hidden;background:${bar};position:relative}
      .status{height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 56px;font-size:28px;font-weight:600;color:${dark ? '#fff' : '#111'}}
      .screen img{display:block;width:1680px;height:auto}
      .ic{display:flex;align-items:center;gap:12px}
    </style></head><body><div class="c1"></div><div class="c2"></div>
      <div class="brand"><img src="data:image/png;base64,${icon}">워크인</div>
      <h1>${s.title.join(' ')}</h1><div class="sub">${s.sub}</div><div class="accent"></div>
      <div class="pad"><div class="screen">
        <div class="status"><span>9:41</span><span class="ic">
          <svg width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M2 8a20 20 0 0 1 28 0"/><path d="M8 14a12 12 0 0 1 16 0"/><circle cx="16" cy="20" r="2" fill="currentColor" stroke="none"/></svg>
          <svg width="54" height="26" viewBox="0 0 54 26" fill="none"><rect x="1" y="1" width="46" height="24" rx="7" stroke="currentColor" stroke-opacity=".4" stroke-width="2"/><rect x="5" y="5" width="38" height="16" rx="4" fill="currentColor"/><rect x="50" y="9" width="3" height="8" rx="1.5" fill="currentColor" fill-opacity=".4"/></svg>
        </span></div>
        <img src="data:image/png;base64,${shot}"></div></div>
    </body></html>`;
    await tp.setContent(html); await tp.evaluate(() => document.fonts.ready); await tp.waitForTimeout(300);
    const out = `${OUT}/ipad-${String(s.n).padStart(2, '0')}.png`;
    await tp.screenshot({ path: out, type: 'png' }); pads.push(out); console.log('아이패드 합성', out);
  }
  await tp.close();
  // 축소 시트(검토용)
  const tw = 300, gap = 20, ih = Math.round(tw * H / W), ph = Math.round(tw * PH / PW);
  const layers = [];
  for (let i = 0; i < outs.length; i++) layers.push({ input: await sharp(outs[i]).resize(tw, ih).png().toBuffer(), top: gap, left: gap + i * (tw + gap) });
  for (let i = 0; i < pads.length; i++) layers.push({ input: await sharp(pads[i]).resize(tw, ph).png().toBuffer(), top: gap * 2 + ih, left: gap + i * (tw + gap) });
  await sharp({ create: { width: outs.length * (tw + gap) + gap, height: ih + ph + gap * 3, channels: 3, background: '#e5e7eb' } }).composite(layers).jpeg({ quality: 86 }).toFile(`${OUT}/00_sheet.jpg`);
  console.log(problems.length ? `⚠ 확인 필요:\n- ${problems.join('\n- ')}` : '✔ 금지 글자 0 · 아이폰 6.9형 6장 1320×2868 · 6.1형 6장 1179×2556 · 아이패드 13형 6장 2048×2732');
} finally { await browser.close(); srv.proc.kill(); await sql.end(); }
if (problems.length) process.exit(1);
