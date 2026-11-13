// 대표 11/14 #1047("기본 스토어 등록정보에서 휴대전화 스크린샷 내용 보면 우리 업무 관련된 내용들이 있는데 일반적인 업무들이 적혀 있을 수 있도록 해 달라"):
// 스토어 스크린샷 v5 — 업종과 무관한 일반 사무 예시(가상 회사 하늘솔루션 · sample-seed)로 다시 찍는다. 운영·심사 계정 자료는 건드리지 않는다(시험 서버 + 시험 DB).
//  · Play 7장 1080×1920(캡션은 지금 등록된 7장 그대로) → docs/handoff/store/v5-general/play-01..07.png
//  · 아이폰 6.9형 6장 1320×2868 · 6.1형 6장 1179×2556 · 아이패드 13형 6장 2048×2732(캡션은 ios-v4 그대로) → 같은 폴더 iphone-*.png · iphone61-*.png · ipad-*.png
// 조건 검사(하나라도 있으면 실패): ① 우리 업무·심사용 낱말(심사·체험·(가상)·영업관리·현장 미등록·피트니스·아파트·단지·관리사무소·회원·다짐·하이링크…) ② 금액·요금 글자(원·무료·요금 — 2.3.7) ③ 풀리지 않은 굵게 표시(**)
// 생성 AI 없음 — Playwright(크로미움)·sharp 만. AI 비서 화면은 저장해 둔 대화를 보여 줄 뿐 모델을 부르지 않는다.
// 실행: npm run build && node tests/e2e/store-shots-v5.mjs  (PostgreSQL 필요)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { bootstrap, resetDb, startServer, BASE, seoulToday, testDb } from '../helpers.mjs';
import { seedSample } from './sample-seed.mjs';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const OUT = 'docs/handoff/store/v5-general'; mkdirSync(`${OUT}/raw`, { recursive: true });
const GREEN = '#0F766E';
const W = 1320, H = 2868;          // 아이폰 6.9형 — 뷰포트 440×956 @3
const PW = 2048, PH = 2732;        // 아이패드 13형 — 뷰포트 1024×1366 @2
const AW = 1080, AH = 1920;        // Play 휴대폰 9:16 — 뷰포트 400×676 @3(1200×2028)을 가로 900 으로 줄여 넣음
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp/1.2.0';
const UA_PAD = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp/1.2.0';
const UA_AND = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 WorkInApp/1.2.0';
// 금액·요금 글자 0 — '회의'·'회사' 같은 낱말은 빼고 '숫자+회'만, '원' 뒤에 한글이 오면(직원·원인) 낱말이라 제외
const BAD = /\d[\d,]*\s*원(?![가-힣])|\d+\s*회(?![사의원])|가격|무료|체험|요금|크레딧/g;
// 우리 업무·심사용으로 보이는 낱말 + 풀리지 않은 굵게 표시
const OURS = /심사|\(가상\)|영업관리|현장 미등록|피트니스|헬스|아파트|단지|관리사무소|입주|회원|운동기구|샤워실|다짐|하이링크|\*\*/g;
const NO_ALARM = '[data-testid="page-alarms"]{display:none!important}'; // 업무 상세: 화면 위 '새 알림' 한 줄을 접어 체크리스트가 한 화면에 들어오게
const IOS = [
  { n: 1, path: '/', title: ['오늘 할 일,', '한눈에'], sub: '오늘 마감·이번 주 일정·새 알림을 홈에서 바로' },
  { n: 2, path: '/tasks', title: ['요청하고, 확인하고,', '끝내기'], sub: '담당자·마감·단계가 한 줄에 — 지연은 바로 표시' },
  { n: 3, path: '/calendar?view=week', title: ['업무와 일정이', '한 캘린더에'], sub: '회사·부서·내 일정과 업무 마감을 한 주로' },
  { n: 4, path: '/assistant?thread=THREAD', title: ['말로 물어보면', 'AI 가 정리'], sub: '내 업무·일정을 묻고, 알림·업무 요청은 확인 뒤 실행' },
  { n: 5, path: '/tasks/TASK', title: ['검토·승인까지', '업무 안에서'], sub: '단계·체크리스트·댓글·첨부가 한곳에', css: NO_ALARM },
  { n: 6, path: '/s/sales/leads', title: ['영업·마케팅도', '같은 앱에서'], sub: '리드·다음 연락·거래처를 팀과 함께' },
];
// Play 캡션은 2026-10-20 등록분 그대로(대표 #1047: 문구는 그대로, 화면 내용만 일반 업무로). 찍는 순서는 공간 머리 색이 화면과 맞도록 업무 → 영업 → 마케팅
const PLAY = [
  { n: 1, path: '/', title: '오늘 할 일, 한눈에', sub: '이번 주 일정과 업무를 홈에서' },
  { n: 2, path: '/tasks', title: '지시하고, 확인하고, 끝내기', sub: '담당·마감·단계가 한 줄에' },
  { n: 3, path: '/calendar?view=week', title: '업무와 일정이 한 캘린더에', sub: '미팅 일정도 바로 등록' },
  { n: 4, path: '/tasks/TASK', title: '검토·승인까지 업무 안에서', sub: '체크리스트와 진행률', css: NO_ALARM },
  { n: 7, path: '/assistant?thread=THREAD2', title: '말로 물어보면 AI가 정리', sub: '이번 주 마감, 다음 할 일까지' },
  { n: 5, path: '/s/sales/leads', title: '영업 리드와 거래처 관리', sub: '전화·문자·다음 연락을 바로', scrollTo: 'leads-strip' }, // 화면이 짧아 거르는 칸 아래 카드가 보이게 조금 내림
  { n: 6, path: '/s/marketing/approvals', title: '마케팅은 승인만 누르세요', sub: 'AI 시안 → 승인 → 게시 일정' }, // 승인함(시안 카드 + 승인 단추) — 마케팅 홈은 새 회사에 채널 연결 안내·목표 금액 칸이 먼저 나와 캡션과 덜 맞음
];
const HIDE = '[data-testid="trial-banner"],[data-testid="pwa-install"],[data-testid="push-ask"],[data-testid="daily-welcome"]{display:none!important}'; // 계정 상태 띠·설치 권유·알림 권한 묻기·아침 인사 말풍선(잠깐 떴다 사라짐)은 뺌
const pad2 = (n) => String(n).padStart(2, '0');

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
    await card.setContent(`<html><body style="margin:0;width:640px;height:640px;display:flex;flex-direction:column;justify-content:flex-end;padding:56px;box-sizing:border-box;font-family:Pretendard,'Noto Sans KR',system-ui,sans-serif;color:#fff;background:linear-gradient(150deg,rgb(${r},${g},${b}) 0%,rgb(${Math.round(r * 0.6)},${Math.round(g * 0.6)},${Math.round(b * 0.6)}) 100%)"><div style="font-size:26px;font-weight:600;opacity:.85">하늘솔루션</div><div style="font-size:60px;font-weight:800;line-height:1.15;margin-top:10px">${title}</div></body></html>`);
    return card.screenshot({ type: 'png' });
  };
  const seeded = await seedSample(sql, today, { image }); await card.close();
  const { c, staff } = seeded;
  const log = (what) => (e) => console.log(what, e.message);
  // 업무 상세: 담당자(박지우)가 체크리스트 1/3 을 끝내고 검토를 요청한 상태 — 대표 화면에 승인·반려가 보인다
  const tasks = (await c.ok('GET', '/api/tasks?status=open&limit=100')).tasks;
  const task = tasks.find((t) => /거래처 미팅 준비/.test(t.title)) ?? tasks[0];
  await c.ok('PATCH', `/api/tasks/${task.id}`, { description: '내일 14시 미팅 전에 견적서 단가·납기를 다시 확인합니다.' }).catch(log('patch'));
  for (const text of ['견적서 단가·납기 확인', '제안서 요약본 2장 준비', '참석자에게 장소·시간 공유']) await c.ok('POST', `/api/tasks/${task.id}/checklist`, { text }).catch(log('check'));
  const [first] = await sql`select id from task_checklist_items where task_id = ${task.id} order by sort limit 1`.catch(() => []);
  if (first) await staff[1].ok('PATCH', `/api/checklist/${first.id}`, { done: true }).catch(log('check-done'));
  await staff[1].ok('POST', `/api/tasks/${task.id}/comments`, { body: '견적서는 납기만 바꿔서 다시 올렸습니다. 요약본은 오늘 저녁까지 올릴게요. 검토 부탁드립니다.' }).catch(log('comment'));
  await staff[1].ok('PATCH', `/api/tasks/${task.id}`, { status: 'in_progress' }).catch(log('in_progress'));
  await staff[1].ok('PATCH', `/api/tasks/${task.id}`, { status: 'review' }).catch(log('review'));
  const [{ status: tstatus }] = await sql`select status from tasks where id = ${task.id}`;
  if (tstatus !== 'review') { console.log('업무 상태', tstatus, '→ review 로 맞춤'); await sql`update tasks set status = 'review' where id = ${task.id}`; }
  // AI 비서 대화(가상 — 모델 호출 없음, 저장된 대화만 보여 줌). 아이폰용(ios-v4 와 같은 글)·Play 용(캡션 '이번 주 마감, 다음 할 일까지') 2개
  const [me] = await sql`select id, tenant from users where email = 'sample@workin.test'`;
  const thread = async (title, msgs) => { const [th] = await sql`insert into ai_threads (tenant, user_id, title) values (${me.tenant}, ${me.id}, ${title}) returning id`; for (const [role, text] of msgs) await sql`insert into ai_messages (thread_id, role, text) values (${th.id}, ${role}, ${text})`; return th.id; };
  const th1 = await thread('오늘 남은 업무', [
    ['user', '오늘 내 업무 뭐 남았어?'],
    ['assistant', '오늘 마감인 업무가 2건 있어요.\n\n1. 신제품 소개 자료 최종본 정리 — 이서준 · 오늘 마감\n2. 고객 문의 답변 정리 — 이서준 · 내일 마감\n\n내일 14시 거래처 미팅 전에 "거래처 미팅 준비 — 견적서 확인" 업무도 검토 요청이 와 있습니다. 필요하면 담당자에게 알림을 보낼게요.'],
    ['user', '거래처 미팅 준비 담당자에게 알려 줘'],
    ['assistant', '박지우님에게 "거래처 미팅 준비 — 견적서 확인" 업무 알림을 보낼까요? [확인]을 누르면 바로 보냅니다.'],
  ]);
  const th2 = await thread('이번 주 마감 업무', [
    ['user', '이번 주 마감 업무 정리해 줘'],
    ['assistant', '이번 주 마감은 **6건**이에요.\n\n- 오늘: 신제품 소개 자료 · 거래처 미팅 준비\n- 내일: 월간 매출 보고서 · 고객 문의 답변\n- 이번 주 안: 배너 교체 · 신규 입사자 교육\n\n다음 할 일: 검토 요청이 온 **거래처 미팅 준비**부터 확인해 보세요.'],
  ]);
  // 금액 글자 0(2.3.7): 리드 예상 금액·결재 금액·알림·업무 제목의 'n원'
  await sql`update sales_leads set expected_revenue = null where tenant = ${me.tenant}`.catch(() => {});
  await sql`update approval_requests set amount = null, data = data - 'amount' where tenant = ${me.tenant}`.catch(() => {});
  await sql`update notifications set body = regexp_replace(body, '\\s*·?\\s*[0-9][0-9,]*\\s*원', '', 'g'), title = regexp_replace(title, '\\s*·?\\s*[0-9][0-9,]*\\s*원', '', 'g') where body ~ '[0-9]원' or title ~ '[0-9]원'`.catch(log('notif'));
  await sql`update tasks set title = regexp_replace(title, '\\s*·?\\s*[0-9][0-9,]*\\s*원', '', 'g') where title ~ '[0-9]원'`.catch(log('tasks'));
  // 로그인(PC 표시로) → 쿠키를 앱 표시 창들에 넘김
  const ctx0 = await browser.newContext(); const p0 = await ctx0.newPage();
  await p0.goto(BASE + '/login'); await p0.getByLabel('이메일', { exact: true }).fill('sample@workin.test'); await p0.getByLabel('비밀번호').fill('sample-pass-1234');
  await p0.getByRole('button', { name: '로그인' }).click(); await p0.waitForURL(BASE + '/');
  const st = await ctx0.storageState(); await ctx0.close();
  const fill = (path) => path.replace('THREAD2', th2).replace('THREAD', th1).replace('TASK', task.id);
  /** 한 묶음 찍기: 화면 글 검사 + raw 저장 */
  const capture = async (label, slides, ctxOpts, size, prefix) => {
    const cx = await browser.newContext({ ...ctxOpts, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: st });
    await cx.addInitScript(() => { try { localStorage.setItem('wos_connect_card', 'off'); localStorage.setItem('wos_status_tip', '3'); localStorage.setItem('wos_push_asked', '1'); localStorage.setItem('wos_sel_tip', '1'); } catch {} });
    await cx.clock.setFixedTime(new Date(`${today}T09:41:00+09:00`)); // 밤에 찍어도 캘린더·인사말이 오전 업무 시간(상태줄 9:41 과 같음)
    const p = await cx.newPage(); const raws = {};
    for (const s of slides) {
      const path = fill(s.path);
      await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1800);
      await p.addStyleTag({ content: HIDE + (s.css ?? '') }); await p.waitForTimeout(200);
      if (s.scrollTo) { await p.getByTestId(s.scrollTo).first().evaluate((el) => { const y = el.getBoundingClientRect().top + window.scrollY - 118; window.scrollTo(0, Math.max(0, y)); for (let e = el.parentElement; e; e = e.parentElement) { if (e.scrollHeight > e.clientHeight + 40 && getComputedStyle(e).overflowY !== 'visible') { e.scrollTop = Math.max(0, el.offsetTop - 12); } } }).catch(() => problems.push(`${label} ${s.n}: ${s.scrollTo} 없음`)); await p.waitForTimeout(400); }
      if (/assistant/.test(path)) await p.getByTestId('ai-answer').first().waitFor({ timeout: 15000 }).catch(() => problems.push(`${label} ${s.n}: AI 답 안 보임`));
      const text = await p.evaluate(() => document.body.innerText);
      const bad = [...new Set([...(text.match(BAD) ?? []), ...(text.match(OURS) ?? [])].map((x) => x.trim()))];
      if (bad.length) {
        const where = await p.evaluate((words) => {
          const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) { if (!words.some((x) => n.textContent.includes(x))) continue;
            const chain = []; for (let e = n.parentElement; e && chain.length < 5; e = e.parentElement) chain.push(e.dataset.testid ? `[${e.dataset.testid}]` : `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 2).join('.')}`);
            out.push(`${n.textContent.trim().slice(0, 60)} ← ${chain.join(' < ')}`); if (out.length >= 3) break; }
          return out; }, bad);
        problems.push(`${label} ${s.n} ${path}: 금지 글자 ${bad.join(' · ')} — ${where.join(' | ')}`);
      }
      const raw = `${OUT}/raw/${prefix}${pad2(s.n)}.png`;
      await p.screenshot({ path: raw }); raws[s.n] = raw;
      const meta = await sharp(raw).metadata(); if (meta.width !== size[0] || meta.height !== size[1]) problems.push(`${label} ${s.n}: 캡처 크기 ${meta.width}×${meta.height}`);
      console.log(label, '캡처', s.n, path, bad.length ? `⚠ ${bad.join(' · ')}` : '글자 OK');
    }
    await cx.close(); return raws;
  };
  const playRaws = await capture('Play', PLAY, { viewport: { width: 400, height: 676 }, deviceScaleFactor: 3, userAgent: UA_AND }, [1200, 2028], 'play-');
  const raws = await capture('아이폰', IOS, { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, userAgent: UA }, [W, H], 'iphone-');
  const padRaws = await capture('아이패드', IOS, { viewport: { width: 1024, height: 1366 }, deviceScaleFactor: 2, userAgent: UA_PAD }, [PW, PH], 'ipad-');

  // 합성 — 글꼴은 앱과 같은 Pretendard(저장소 node_modules, 외부 내려받기 없음)
  const font = readFileSync('node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2').toString('base64');
  const icon = readFileSync('docs/handoff/brand/workin-s3/icon-1024-rounded.png').toString('base64');
  const barOf = async (raw) => { const px = await sharp(raw).extract({ left: 12, top: 4, width: 4, height: 4 }).raw().toBuffer(); return { bar: `rgb(${px[0]},${px[1]},${px[2]})`, dark: (px[0] * 299 + px[1] * 587 + px[2] * 114) / 1000 < 128 }; };
  const ICONS = `<svg width="36" height="24" viewBox="0 0 36 24" fill="currentColor"><rect x="0" y="14" width="6" height="10" rx="1.5"/><rect x="10" y="10" width="6" height="14" rx="1.5"/><rect x="20" y="5" width="6" height="19" rx="1.5"/><rect x="30" y="0" width="6" height="24" rx="1.5"/></svg>
    <svg width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M2 8a20 20 0 0 1 28 0"/><path d="M8 14a12 12 0 0 1 16 0"/><circle cx="16" cy="20" r="2" fill="currentColor" stroke="none"/></svg>
    <svg width="54" height="26" viewBox="0 0 54 26" fill="none"><rect x="1" y="1" width="46" height="24" rx="7" stroke="currentColor" stroke-opacity=".4" stroke-width="2"/><rect x="5" y="5" width="38" height="16" rx="4" fill="currentColor"/><rect x="50" y="9" width="3" height="8" rx="1.5" fill="currentColor" fill-opacity=".4"/></svg>`;
  const face = `@font-face{font-family:P;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900}`;
  const render = async (page, html, out) => { await page.setContent(html); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(300); await page.screenshot({ path: out, type: 'png' }); console.log('합성', out); return out; };

  // Play 1080×1920: 청록 바탕 + 캡션(왼쪽 위) + 휴대폰 화면(기종 표시 없는 얇은 테두리, 아래는 화면 밖으로)
  const ap = await browser.newPage({ viewport: { width: AW, height: AH }, deviceScaleFactor: 1 });
  const plays = [];
  for (const s of [...PLAY].sort((a, b) => a.n - b.n)) {
    const raw = playRaws[s.n]; const { bar, dark } = await barOf(raw);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${face}
      body{margin:0;width:${AW}px;height:${AH}px;background:${GREEN};font-family:P,system-ui,sans-serif;color:#fff;overflow:hidden;position:relative}
      .c1{position:absolute;right:-300px;top:-260px;width:820px;height:820px;border-radius:50%;background:rgba(255,255,255,.07)}
      h1{position:absolute;left:84px;top:104px;margin:0;font-size:70px;line-height:1.15;font-weight:800;letter-spacing:-2px;white-space:nowrap}
      .sub{position:absolute;left:86px;top:204px;font-size:38px;font-weight:500;opacity:.92;white-space:nowrap}
      .phone{position:absolute;left:78px;top:326px;width:900px;padding:12px 12px 0;background:#0b1f1d;border-radius:66px 66px 0 0;box-shadow:0 40px 90px rgba(0,0,0,.35)}
      .screen{border-radius:54px 54px 0 0;overflow:hidden;background:${bar};position:relative}
      .status{height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 44px;font-size:26px;font-weight:600;color:${dark ? '#fff' : '#111'}}
      .hole{position:absolute;left:50%;top:17px;transform:translateX(-50%);width:26px;height:26px;border-radius:50%;background:#0b0b0c}
      .screen img{display:block;width:900px;height:auto}
      .ic{display:flex;align-items:center;gap:10px;transform:scale(.82);transform-origin:right center}
    </style></head><body><div class="c1"></div>
      <h1>${s.title}</h1><div class="sub">${s.sub}</div>
      <div class="phone"><div class="screen"><div class="hole"></div><div class="status"><span>9:41</span><span class="ic">${ICONS}</span></div>
        <img src="data:image/png;base64,${readFileSync(raw).toString('base64')}"></div></div>
    </body></html>`;
    plays.push(await render(ap, html, `${OUT}/play-${pad2(s.n)}.png`));
  }
  await ap.close();

  // 아이폰 6.9형 1320×2868(ios-v4 와 같은 틀)
  const cp = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const outs = [];
  for (const s of IOS) {
    const raw = raws[s.n]; const { bar, dark } = await barOf(raw);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${face}
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
      <div class="phone"><div class="screen"><div class="island"></div><div class="status"><span>9:41</span><span class="ic">${ICONS}</span></div>
        <img src="data:image/png;base64,${readFileSync(raw).toString('base64')}"></div></div>
    </body></html>`;
    outs.push(await render(cp, html, `${OUT}/iphone-${pad2(s.n)}.png`));
  }
  await cp.close();
  // 6.1형(1179×2556) — 6.9형 그림을 그대로 줄임(비율 같음)
  for (const [i, f] of outs.entries()) await sharp(f).resize(1179, 2556, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toFile(`${OUT}/iphone61-${pad2(i + 1)}.png`);

  // 아이패드 13형 2048×2732
  const tp = await browser.newPage({ viewport: { width: PW, height: PH }, deviceScaleFactor: 1 });
  const pads = [];
  for (const s of IOS) {
    const raw = padRaws[s.n]; const { bar, dark } = await barOf(raw);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${face}
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
      <div class="pad"><div class="screen"><div class="status"><span>9:41</span><span class="ic">${ICONS}</span></div>
        <img src="data:image/png;base64,${readFileSync(raw).toString('base64')}"></div></div>
    </body></html>`;
    pads.push(await render(tp, html, `${OUT}/ipad-${pad2(s.n)}.png`));
  }
  await tp.close();

  // 크기 확인 + 축소 시트(검토용): Play 7 · 아이폰 6 · 아이패드 6
  for (const [files, w, h, what] of [[plays, AW, AH, 'Play'], [outs, W, H, '아이폰'], [pads, PW, PH, '아이패드']]) for (const f of files) { const m = await sharp(f).metadata(); if (m.width !== w || m.height !== h) problems.push(`${what} ${f}: ${m.width}×${m.height}`); }
  const tw = 300, gap = 20; const rows = [[plays, AW, AH], [outs, W, H], [pads, PW, PH]]; const layers = []; let top = gap;
  for (const [files, w, h] of rows) { const th = Math.round(tw * h / w); for (let i = 0; i < files.length; i++) layers.push({ input: await sharp(files[i]).resize(tw, th).png().toBuffer(), top, left: gap + i * (tw + gap) }); top += th + gap; }
  await sharp({ create: { width: 7 * (tw + gap) + gap, height: top, channels: 3, background: '#e5e7eb' } }).composite(layers).jpeg({ quality: 86 }).toFile(`${OUT}/00_sheet.jpg`);
  console.log(problems.length ? `⚠ 확인 필요:\n- ${problems.join('\n- ')}` : '✔ 금지 글자 0 · Play 7장 1080×1920 · 아이폰 6.9형 6장 1320×2868 · 6.1형 6장 1179×2556 · 아이패드 13형 6장 2048×2732');
} finally { await browser.close(); srv.proc.kill(); await sql.end(); }
if (problems.length) process.exit(1);
