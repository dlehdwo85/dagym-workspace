// 182차 ②(로컬 10/26 15:45) 워크인 마케팅용 화면 캡처: 운영 화면은 실제 고객 이름·연락처가 보여 마케팅 소재로 못 씀 →
// 시험 서버에 만든 가짜 회사(이름·브랜드·전화·공고 모두 지어낸 값, 전화 010-0000-xxxx)로 PC 1440×900 5장 · 휴대폰 390×844 5장 → docs/screens/marketing/
// 시안 그림도 이 스크립트가 도형·글자로 그린 것(남의 사진·로고 없음). 자동 시험 아님(CI 에서 안 돎).
// 실행: npm run build && node tests/e2e/marketing-shots.mjs  (PostgreSQL 필요 — 시험 DB 를 초기화함)
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, BASE, Client, addDays, seoulToday, testDb } from '../helpers.mjs';

const OUT = 'docs/screens/marketing'; mkdirSync(OUT, { recursive: true });
const PW = 'sample-pass-1234';
const today = seoulToday();
const month0 = today.slice(0, 8) + '01';
const at = (d, hm) => `${d}T${hm}:00+09:00`;
const kst = (d, hm) => new Date(at(d, hm));
// 대화는 직전 평일 오후(실제로 지난 시각 — 안 읽은 수·읽음 표시가 서버 시각과 어긋나지 않게), 화면 시계는 오늘 10:20(캡처 시각과 무관하게 같은 그림)
let chatDay = addDays(today, -1); while ([0, 6].includes(new Date(chatDay + 'T00:00:00Z').getUTCDay())) chatDay = addDays(chatDay, -1);
const SCENE = kst(today, '10:20');

await resetDb();
const srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '50', CAPTURE_BLOCK: '0' });
await bootstrap();
const sql = testDb();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }).catch(() => chromium.launch());
try {
  // ── 가짜 회사 '윤슬공간'(인테리어·공간 디자인) + 직원 5명 ─────────────────────────
  const owner = new Client('owner');
  const sg = await owner.ok('POST', '/api/auth/signup', { email: 'seoyeon@example.com', password: PW, name: '박서연', mode: 'team', company: '윤슬공간', agree: { terms: true, age14: true, privacy: true } });
  await owner.ok('POST', '/api/auth/verify', { token: sg.devLink.split('/').pop() });
  await owner.ok('POST', '/api/onboarding', { title: '대표', done: true });
  const me = await owner.ok('GET', '/api/auth/me'); const unit = me.orgUnits[0].id; const ownerId = me.user.id;
  const tenant = (await sql`select tenant from users where id = ${ownerId}`)[0].tenant;
  // 마케팅 소재에 '무료 체험 D-14' 띠가 찍히지 않게 유료 회사처럼(시험 DB 안에서만)
  await sql`update tenant_subscriptions set status = 'active', plan_code = 'w_standard', trial_ends_at = null where tenant = ${tenant}`;
  const P = {};
  for (const [key, name, title, n] of [['woojin', '정우진', '실장', 1101], ['serin', '오세린', '디자이너', 1102], ['haneul', '장하늘', '현장 매니저', 1103], ['junho', '서준호', '영업 매니저', 1104], ['dain', '류다인', '마케팅 매니저', 1105]]) {
    const inv = await owner.ok('POST', '/api/admin/users', { email: `${key}@example.com`, name, role: 'staff', orgUnitIds: [unit], title });
    const c = new Client(key); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: PW });
    P[key] = { id: (await c.ok('GET', '/api/auth/me')).user.id, c, name };
    await sql`update users set phone = ${`010-0000-${n}`} where id = ${P[key].id}`.catch(() => {});
  }
  P.owner = { id: ownerId, c: owner, name: '박서연' };

  // ── 업무 14건(보드 4칸에 고르게) ─────────────────────────────────────────
  const T = [
    ['송도 32평 아파트 실측·현장 사진 정리', 'haneul', 0, 'high', 'in_progress'],
    ['판교 카페 3D 시안 2차 수정', 'serin', 1, 'urgent', 'in_progress'],
    ['마포 사무실 견적서 발송', 'junho', 0, 'high', 'todo'],
    ['자재 발주 — 원목 마루·타일 샘플', 'woojin', 2, 'normal', 'in_progress'],
    ['분당 주택 욕실 공정표 공유', 'haneul', 3, 'normal', 'todo'],
    ['11월 인스타 카드뉴스 4편 기획', 'dain', 4, 'normal', 'in_progress'],
    ['블로그 시공 후기 — 성수 오피스', 'dain', 1, 'normal', 'review'],
    ['공공도서관 리모델링 입찰 서류 준비', 'junho', 5, 'high', 'in_progress'],
    ['협력 시공팀 11월 일정 확정', 'woojin', 2, 'normal', 'review'],
    ['포트폴리오 사진 보정', 'serin', 3, 'normal', 'todo'],
    ['쇼룸 조명 교체 업체 섭외', 'woojin', 6, 'low', 'on_hold'],
    ['월간 매출 보고서 정리', 'owner', 0, 'normal', 'todo'],
    ['마포 사무실 견적 최종 확인', 'owner', 1, 'high', 'todo'],
    ['10월 고객 상담 기록 정리', 'junho', -1, 'low', 'done'],
    ['현장 안전 점검표 작성', 'haneul', -2, 'normal', 'done'],
    ['판교 카페 자재 샘플 수령', 'serin', -1, 'normal', 'done'],
  ];
  for (const [title, who, d, priority, status] of T) {
    const t = await owner.ok('POST', '/api/tasks', { title, orgUnitId: unit, assigneeId: P[who].id, dueDate: addDays(today, d), priority });
    if (status === 'done') await sql`update tasks set status = 'done', completed_at = ${kst(addDays(today, d), '17:30')}, assignee_done_at = ${kst(addDays(today, d), '17:30')}, approved_at = ${kst(addDays(today, d), '18:00')}, approved_by = ${ownerId} where id = ${t.id}`;
    else if (status !== 'todo') await P[who].c.ok('PATCH', `/api/tasks/${t.id}`, { status }).catch((e) => console.log('status', title, e.message));
  }

  // ── 일정(이번 달 전체에 흩어서 — 월 보기·휴대폰 주 보기) ───────────────────────────
  const cals = (await owner.ok('GET', '/api/calendars')).calendars; const cal = (cals.find((x) => x.type === 'company') ?? cals[0]).id;
  const ev = (title, d, s, e) => owner.ok('POST', '/api/events', { calendarId: cal, title, start: at(d, s), end: at(d, e) }).catch((x) => console.log('event', title, x.message));
  for (let i = 0; i < 42; i++) { const d = addDays(month0, i); if (new Date(d + 'T00:00:00Z').getUTCDay() === 1) await ev('주간 회의', d, '09:30', '10:30'); }
  for (const [title, off, s, e] of [['고객 상담 — 송도 32평', 2, '14:00', '15:00'], ['자재 업체 미팅', 6, '11:00', '12:00'], ['판교 카페 시안 리뷰', 8, '15:00', '16:30'], ['쇼룸 촬영', 9, '10:00', '12:00'],
    ['분당 주택 현장 점검', 13, '13:00', '14:30'], ['마포 사무실 착공 미팅', 15, '10:00', '11:00'], ['협력 시공팀 회의', 17, '16:00', '17:00'], ['고객 상담 — 성수 오피스', 20, '11:00', '12:00'],
    ['인스타 촬영 — 시공 사례', 22, '14:00', '16:00'], ['월말 결산', 29, '16:00', '17:30'], ['공공도서관 현장 설명회', 34, '10:00', '11:30'],
    ['지난달 실적 회의', -2, '10:00', '11:00'], ['이번 달 목표 회의', 0, '10:00', '11:00'], ['자재 견적 비교', 1, '14:00', '15:00'], ['판교 카페 착공', 12, '09:00', '10:00'],
    ['송도 고객 미팅', 14, '16:00', '17:00'], ['디자인 리뷰', 21, '15:00', '16:00'], ['견적 검토 회의', 27, '11:00', '12:00'], ['분당 주택 준공 점검', 35, '10:00', '11:30'], ['성수 오피스 사후 점검', 36, '14:00', '15:00']]) await ev(title, addDays(month0, off), s, e);
  await ev('송도 32평 현장 미팅', addDays(today, 2), '14:00', '15:00');
  await ev('판교 카페 시안 공유', today, '15:00', '16:00');
  await ev('마포 사무실 견적 상담', addDays(today, 1), '10:30', '11:30');

  // ── 영업: 공간 켜기 + 지어낸 기관 이름의 입찰 공고 7건 ─────────────────────────────
  await owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values (${tenant}, true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json(row)})`;
  const B = [
    ['N1', '가람시립도서관 열람실 실내 리모델링 공사', '가람시청', '경기', 248000000, 6],
    ['N2', '누리구 행정복지센터 민원실 인테리어 개선', '누리구청', '서울', 96000000, 2],
    ['N3', '한울교육지원청 학교 도서관 공간 혁신 설계', '한울교육지원청', '인천', 54000000, 9],
    ['N4', '솔빛도시공사 사옥 회의실 리뉴얼 공사', '솔빛도시공사', '경기', 132000000, 12],
    ['N5', '다온 청소년수련관 카페 공간 조성', '다온 청소년수련관', '경기', 77000000, 5],
    ['N6', '가람시 보건소 대기 공간 개선', '가람시청', '경기', 41000000, 1],
    ['N7', '누리구 구민회관 로비 인테리어 개선', '누리구청', '서울', 118000000, 8],
  ];
  for (const [id, title, issuer, region, budget, close] of B) await put({ id, title, issuer, region, related: true, first_seen_at: `${today}T07:30:00+09:00`, notice_date: today, deadline_at: `${addDays(today, close)}T10:00:00+09:00`, current_status: '공고중', status: '공고중', budget: String(budget), source: 'g2b', classification: '즉시 검토', matched_keywords: ['인테리어', '리모델링'] });
  await owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '검토중', nextDate: addDays(today, 1) }).catch((e) => console.log('work', e.message));

  // ── 마케팅: 브랜드 2개 + 승인 대기 글 5건(시안 그림은 아래에서 직접 그림) ─────────────────
  await owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brandA = await owner.ok('POST', '/api/marketing/brands', { name: '윤슬공간' });
  const brandB = await owner.ok('POST', '/api/marketing/brands', { name: '윤슬 리빙' });
  const font = (f) => readFileSync(`node_modules/pretendard/dist/web/static/woff2/Pretendard-${f}.woff2`).toString('base64');
  const FONTS = ['Regular', 'Bold', 'ExtraBold'].map((f, i) => `@font-face{font-family:P;font-weight:${[400, 700, 800][i]};src:url(data:font/woff2;base64,${font(f)}) format('woff2')}`).join('');
  const art = await browser.newPage();
  const draw = async (html, w = 1080, h = 1350) => {
    await art.setViewportSize({ width: w, height: h });
    await art.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}*{box-sizing:border-box;margin:0}body{position:relative;width:${w}px;height:${h}px;font-family:P,sans-serif;overflow:hidden}.a{position:absolute}</style></head><body>${html}</body></html>`);
    await art.evaluate(() => document.fonts.ready);
    return art.screenshot({ type: 'jpeg', quality: 88 });
  };
  const A = { bg: '#12504C', fg: '#FFFFFF', sand: '#EFE6D8', acc: '#E39B5B', ink: '#1E2A28' }, Bc = { bg: '#A85A6E', fg: '#FFFFFF', sand: '#F7EFE9', acc: '#4A6B5C', ink: '#3A2830' };
  const lamp = (x, c) => `<div class="a" style="left:${x}px;top:0;width:4px;height:330px;background:${c.fg};opacity:.8"></div><div class="a" style="left:${x - 108}px;top:320px;width:220px;height:110px;border-radius:110px 110px 0 0;background:${c.sand}"></div><div class="a" style="left:${x - 250}px;top:330px;width:504px;height:504px;border-radius:50%;background:radial-gradient(circle,${c.acc}66,transparent 65%)"></div>`;
  const cover = (c, brand, title, sub, n, of) => draw(`<div class="a" style="inset:0;background:${c.bg}"></div>${lamp(760, c)}
    <div class="a" style="left:90px;top:90px;font-size:30px;font-weight:700;letter-spacing:.06em;color:${c.fg};opacity:.85">${brand}</div>
    <div class="a" style="left:90px;right:120px;bottom:260px;font-size:88px;line-height:1.2;font-weight:800;color:${c.fg}">${title}</div>
    <div class="a" style="left:90px;bottom:170px;font-size:36px;color:${c.fg};opacity:.85">${sub}</div>
    <div class="a" style="right:90px;bottom:90px;font-size:28px;color:${c.fg};opacity:.7">${n} / ${of}</div>`);
  const tip = (c, brand, no, title, body, n, of) => draw(`<div class="a" style="inset:0;background:${c.sand}"></div>
    <div class="a" style="left:90px;top:90px;font-size:30px;font-weight:700;color:${c.bg}">${brand}</div>
    <div class="a" style="left:90px;top:220px;font-size:140px;font-weight:800;color:${c.acc}">${no}</div>
    <div class="a" style="left:90px;right:90px;top:420px;font-size:66px;line-height:1.25;font-weight:800;color:${c.ink}">${title}</div>
    <div class="a" style="left:90px;right:120px;top:640px;font-size:38px;line-height:1.6;color:${c.ink};opacity:.8">${body}</div>
    <div class="a" style="left:90px;right:90px;bottom:150px;height:200px;border-radius:28px;background:${c.bg};opacity:.92"></div>
    <div class="a" style="left:150px;bottom:210px;width:300px;height:90px;border-radius:24px;background:${c.sand}"></div>
    <div class="a" style="left:520px;bottom:210px;width:90px;height:150px;border-radius:12px;background:${c.acc}"></div>
    <div class="a" style="right:90px;bottom:90px;font-size:28px;color:${c.ink};opacity:.6">${n} / ${of}</div>`);
  const offer = (c, brand, title, when, cta) => draw(`<div class="a" style="inset:0;background:linear-gradient(160deg,${c.bg},${c.ink})"></div>
    <div class="a" style="left:90px;top:90px;font-size:30px;font-weight:700;color:${c.fg};opacity:.85">${brand}</div>
    <div class="a" style="left:90px;top:300px;padding:10px 26px;border-radius:999px;background:${c.acc};font-size:32px;font-weight:700;color:#fff">${when}</div>
    <div class="a" style="left:90px;right:90px;top:420px;font-size:100px;line-height:1.15;font-weight:800;color:${c.fg}">${title}</div>
    <div class="a" style="left:90px;right:90px;bottom:160px;padding:34px 0;border-radius:24px;background:${c.fg};text-align:center;font-size:40px;font-weight:700;color:${c.bg}">${cta}</div>`);
  const room = (c, label, dim = false) => draw(`<div class="a" style="inset:0;background:${dim ? '#D9D6D0' : c.sand}"></div>
    <div class="a" style="left:0;right:0;bottom:0;height:300px;background:repeating-linear-gradient(90deg,${dim ? '#B9B2A6' : '#C99E74'} 0 118px,${dim ? '#A9A296' : '#B98C62'} 118px 120px)"></div>
    <div class="a" style="left:120px;top:140px;width:380px;height:420px;border:16px solid #fff;background:linear-gradient(180deg,#CFE6F2,#EAF4F8)"></div>
    <div class="a" style="left:560px;top:430px;width:520px;height:220px;border-radius:40px 40px 18px 18px;background:${dim ? '#8E8A84' : c.bg}"></div>
    <div class="a" style="left:600px;top:380px;width:200px;height:120px;border-radius:30px;background:${dim ? '#A5A19B' : c.bg};filter:brightness(1.15)"></div>
    <div class="a" style="left:840px;top:380px;width:200px;height:120px;border-radius:30px;background:${dim ? '#A5A19B' : c.bg};filter:brightness(1.15)"></div>
    <div class="a" style="left:960px;top:60px;width:4px;height:200px;background:#333"></div><div class="a" style="left:900px;top:250px;width:124px;height:62px;border-radius:62px 62px 0 0;background:${dim ? '#999' : c.acc}"></div>
    <div class="a" style="left:40px;top:470px;width:120px;height:200px;border-radius:60px 60px 20px 20px;background:${dim ? '#7C8A80' : '#4E7D5B'}"></div>
    <div class="a" style="left:40px;bottom:40px;padding:12px 26px;border-radius:12px;background:rgba(0,0,0,.55);font-size:34px;font-weight:700;color:#fff">${label}</div>`, 1200, 900);
  const up = async (buf, name) => {
    const lf = await owner.ok('POST', '/api/library', { fileName: name, mimeType: 'image/jpeg', size: buf.length, folder: '마케팅/시안' });
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: { ...lf.upload.headers, 'content-length': String(buf.length) }, body: buf });
    await owner.ok('POST', `/api/library/${lf.id}/complete`); return lf.id;
  };
  const posts = [
    { brand: brandA.id, channel: 'instagram', title: '작은 거실이 넓어 보이는 조명 배치 4가지', d: 1, h: '10:00', why: { purpose: '저장 늘리기', metric: '저장 수', message: '작은 공간도 넓어 보이게', why: '11월 이사철 — 소형 평수 리모델링 문의가 늘어나는 때' },
      body: '작은 거실, 조명만 바꿔도 훨씬 넓어 보여요.\n천장 간접 조명부터 플로어 스탠드까지, 바로 따라 할 수 있는 배치 4가지를 정리했습니다.\n저장해 두고 집 꾸밀 때 꺼내 보세요.\n\n#거실인테리어 #조명인테리어 #소형평수',
      imgs: async () => [await cover(A, '윤슬공간', '작은 거실이<br>넓어 보이는<br>조명 배치 4가지', '천장·벽·바닥 조명 고르는 법', 1, 4), await tip(A, '윤슬공간', '01', '천장은 간접 조명으로', '천장 가장자리에 빛을 숨기면<br>천장이 높아 보입니다.', 2, 4),
        await tip(A, '윤슬공간', '02', '벽 조명은 눈높이보다 위', '시선이 위로 가면<br>공간이 한결 넓어 보여요.', 3, 4), await tip(A, '윤슬공간', '03', '구석에는 스탠드 하나', '어두운 구석을 밝히면<br>방 전체가 커 보입니다.', 4, 4)] },
    { brand: brandA.id, channel: 'blog', title: '성수동 오피스 리모델링 시공 후기 — 12평을 회의실 2개로', d: 2, h: '12:00', why: { purpose: '상담 문의', metric: '블로그 문의 클릭', message: '작은 사무실도 회의 공간을 만들 수 있다', why: '사무실 이전 시즌 — 오피스 문의 키워드 검색이 느는 때' },
      body: '성수동 12평 사무실을 회의실 2개와 업무 공간으로 나눈 시공 후기입니다.\n가벽 대신 유리 파티션을 써서 빛은 살리고 소리는 줄였어요.\n공사 기간 2주, 자재 선택 이유와 비용 구성까지 정리했습니다.',
      imgs: async () => [await room(A, '성수 오피스 — 시공 후'), await room(A, '회의실 A'), await room(A, '업무 공간')] },
    { brand: brandA.id, channel: 'instagram', title: '11월 무료 실측 상담 안내', d: 3, h: '18:00', why: { purpose: '상담 예약', metric: '상담 신청 수', message: '실측부터 견적까지 한 번에', why: '연말 공사 일정을 미리 잡으려는 고객이 많은 때' },
      body: '11월 한 달, 서울·경기 지역 실측 상담을 무료로 진행합니다.\n실측 후 3일 안에 도면과 견적을 함께 보내 드려요.\n상담 문의 010-0000-2580',
      imgs: async () => [await offer(A, '윤슬공간', '실측부터<br>견적까지<br>한 번에', '11월 무료 실측 상담', '상담 문의 010-0000-2580'), await tip(A, '윤슬공간', '01', '실측 · 상담', '현장을 직접 재고<br>원하는 분위기를 들어요.', 2, 3), await tip(A, '윤슬공간', '02', '도면 · 견적', '3일 안에 도면과 견적을<br>함께 보내 드립니다.', 3, 3)] },
    { brand: brandA.id, channel: 'facebook', title: '시공 전후 비교 — 분당 주택 욕실', d: 4, h: '12:00', why: { purpose: '신뢰 쌓기', metric: '공유 수', message: '좁은 욕실도 밝고 넓게', why: '욕실 리모델링 비교 글의 반응이 꾸준히 좋은 주제' },
      body: '분당 주택 욕실, 시공 전과 후를 나란히 놓아 봤어요.\n밝은 타일과 숨은 수납장으로 같은 크기인데도 훨씬 넓어 보입니다.',
      imgs: async () => [await room(A, '시공 전', true), await room(A, '시공 후')] },
    { brand: brandB.id, channel: 'instagram', title: '가을 신상 패브릭 포스터 3종', d: 2, h: '18:00', why: { purpose: '신상품 알리기', metric: '프로필 방문', message: '벽 하나로 바꾸는 가을 분위기', why: '계절 소품 교체 수요가 늘어나는 10~11월' },
      body: '벽 하나로 바꾸는 가을 분위기.\n따뜻한 색감의 패브릭 포스터 3종이 새로 나왔어요.',
      imgs: async () => [await cover(Bc, '윤슬 리빙', '벽 하나로<br>바꾸는<br>가을 분위기', '패브릭 포스터 3종', 1, 3), await tip(Bc, '윤슬 리빙', '01', '테라코타 포스터', '따뜻한 흙빛으로<br>거실에 온기를 더해요.', 2, 3), await tip(Bc, '윤슬 리빙', '02', '세이지 포스터', '차분한 초록으로<br>침실을 편안하게.', 3, 3)] },
  ];
  for (const p of posts) {
    const imgs = await p.imgs(); const ids = [];
    for (const [i, b] of imgs.entries()) ids.push(await up(b, `${p.title.slice(0, 20)} ${i + 1}.jpg`));
    await owner.ok('POST', '/api/marketing/contents', { title: p.title, channel: p.channel, brandId: p.brand, body: p.body, mediaIds: ids, scheduledAt: at(addDays(today, p.d), p.h), rationale: p.why }).catch((e) => console.log('content', p.title, e.message));
  }
  await art.close();

  // ── 메신저: 방 4개(맨 위가 현장 방) ─────────────────────────────────────────
  const say = async (room, who, body) => P[who].c.ok('POST', `/api/chat/rooms/${room}/messages`, { body });
  const r1 = (await owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '디자인팀', userIds: [P.serin.id, P.woojin.id] })).id;
  await say(r1, 'serin', '판교 카페 무드보드 공유드려요. 원목 톤 두 가지 중에 골라 주세요.'); await say(r1, 'woojin', '저는 밝은 오크 쪽이 좋아 보여요.');
  const r2 = (await owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '영업·마케팅', userIds: [P.junho.id, P.dain.id] })).id;
  await say(r2, 'junho', '가람시립도서관 입찰 공고 올라왔습니다. 서류 준비 시작할게요.'); await say(r2, 'dain', '시공 사례 카드뉴스는 승인함에 올려 두었습니다.');
  const r3 = (await owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: P.dain.id })).id;
  await say(r3, 'dain', '대표님, 11월 광고 예산안 내일 오전에 보고드릴게요.');
  const r4 = (await owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '송도 32평 현장', userIds: [P.haneul.id, P.woojin.id, P.junho.id, P.serin.id] })).id;
  for (const [who, body] of [['haneul', '송도 32평 실측 끝났습니다. 거실 창 쪽 바닥 단차가 생각보다 커서 사진 올려 둘게요.'], ['woojin', '확인했어요. 마루 깔기 전에 수평 작업으로 잡으면 됩니다. 자재 수량 다시 계산할게요.'],
    ['owner', '고객님께는 내일 오전에 일정 안내드릴게요. 견적이 바뀌면 오늘 중으로 알려 주세요.'], ['junho', '견적 차이는 5% 안쪽입니다. 수정본은 업무에 첨부했습니다.'], ['serin', '3D 시안도 단차 반영해서 금요일까지 다시 올리겠습니다.'],
    ['haneul', '현장 미팅은 목요일 오후 2시로 잡았어요. 캘린더에 넣어 두었습니다.'], ['owner', '좋아요. 다들 수고 많았어요!']]) await say(r4, who, body);

  await owner.ok('GET', '/api/chat/rooms'); // 회사 전체 방은 메신저를 처음 열 때 생김
  const all = (await sql`select id from chat_rooms where tenant = ${tenant} and kind = 'company' limit 1`)[0]?.id;
  if (!all) throw new Error('회사 전체 방 없음');
  if (all) { await say(all, 'owner', '이번 주 금요일 오후 5시에 사무실 정리 시간이 있습니다. 개인 자리 정리 부탁드려요.'); await say(all, 'woojin', '네, 확인했습니다.'); }
  const backdate = async (room, hm, step) => {
    let t = kst(chatDay, hm).getTime();
    for (const m of await sql`select id from chat_messages where room_id = ${room} order by created_at, id`) { await sql`update chat_messages set created_at = ${new Date(t)} where id = ${m.id}`; t += step * 60000; }
    await sql`update chat_members set joined_at = ${new Date(kst(chatDay, hm).getTime() - 60000)} where room_id = ${room}`;
    await sql`update chat_rooms set created_at = ${new Date(kst(chatDay, hm).getTime() - 60000)}, last_message_at = (select max(created_at) from chat_messages where room_id = ${room}) where id = ${room}`;
  };
  for (const [room, hm, step] of [[all, '09:05', 6], [r1, '11:10', 6], [r2, '14:20', 12], [r3, '15:40', 1], [r4, '16:05', 4]]) if (room) await backdate(room, hm, step);
  // 홈 출퇴근 칸: 대표 오늘 08:52 출근
  await sql`insert into attendance (tenant, user_id, day, in_at) values (${tenant}, ${ownerId}, ${today}, ${kst(today, '08:52')}) on conflict do nothing`;

  // ── 캡처 ────────────────────────────────────────────────────────────────
  const [cn, cv] = owner.cookie.split(';')[0].split('=');
  const hideBars = () => { const s = document.createElement('style'); s.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important}*{scrollbar-width:none!important}'; document.addEventListener('DOMContentLoaded', () => document.head.appendChild(s)); };
  const shoot = async (opts, list) => {
    const ctx = await browser.newContext({ ...opts, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await ctx.clock.setFixedTime(SCENE);
    await ctx.addCookies([{ name: cn, value: decodeURIComponent(cv), url: BASE }]); await ctx.addInitScript(hideBars);
    await ctx.addInitScript(() => { try { localStorage.setItem('wos_connect_card', 'off'); localStorage.setItem('wos_status_tip', '3'); } catch {} });
    const p = await ctx.newPage();
    await p.goto(BASE + '/'); await p.waitForTimeout(2500); // 하루 첫 진입 환영 문구(0.8초)가 지나가게
    for (const [file, path, wait] of list) {
      await p.goto(BASE + path); await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(1500);
      if (wait) await wait(p);
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      await p.screenshot({ path: `${OUT}/${file}.png` }); console.log(file, path, over > 0 ? `넘침 ${over}px` : '');
    }
    await ctx.close();
  };
  await shoot({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, [
    ['pc-1-task-board', '/tasks?mode=board'], ['pc-2-calendar-month', '/calendar?view=dayGridMonth'], ['pc-5-messenger', `/messages?room=${r4}`],
    ['pc-3-sales-hub', '/s/sales/hub?tab=bids&bt=open'], ['pc-4-marketing-approvals', '/s/marketing/approvals']]);
  await shoot({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, [
    ['phone-1-home', '/'], ['phone-2-tasks', '/tasks'], ['phone-3-calendar', '/calendar'], ['phone-4-messenger', `/messages?room=${r4}`], ['phone-5-approvals', '/s/marketing/approvals']]);
  console.log(`저장: ${OUT}/ (PC 2880×1800 · 휴대폰 780×1688 — 화면 1440×900 · 390×844 의 2배 해상도)`);
} finally { await browser.close(); srv.proc.kill(); await sql.end(); }
