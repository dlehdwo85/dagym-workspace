// 대표 10/24 추가 ②(로컬 #574): 입찰 같은 제목 — 운영 관련 공고 300건 중 4쌍을 그대로 본뜸
// (가) 나라장터 취소 공고(같은 번호·다음 차수)가 원 공고와 따로 나와 원 공고가 '진행중' → 원 공고 카드 한 장에 '취소'·'M/D 취소 공고'
// (나) 원 공고 '마감' + 취소 공고 → '취소' · (다) K-apt 같은 공고 두 번 게시(번호 다름, 제목·단지·마감 같음) → 한 장 '2회 게시(…)', 앞 게시가 취소면 그 날짜에 '취소'
// (라) 날짜까지 같은 완전 중복(둘 다 이미 대상아님)인데 전체 탭에 나옴 → 하나만, 대상 아님은 모든 목록·숫자·당일 메일에서 빠지고 [대상 아님] 탭(누가·언제·사유)·[되돌리기]
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const d = (n) => addDays(today, n);
const at = (day, hm = '09:00') => `${day}T${hm}:00+09:00`;
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${row.id}, ${sql.json({ related: true, fit_business: '다짐', notice_kind: 'new', current_status: '진행중', ...row })})`;
const g2b = (id, ext, o) => put({ id, source_type: 'g2b_bid', source_external_id: ext, source_url: `https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=${ext.split('-')[0]}&bidPbancOrd=${ext.split('-')[1]}`, ...o });
const kapt = (id, o) => put({ id, source_type: 'kapt_bid', source_external_id: id, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${id}`, ...o });
const bids = async (tab, c = ctx.owner) => c.ok('GET', `/api/sales/src?view=bids&tab=${tab}`);
const md = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const SCREEN = '근로자종합복지관 스크린골프 장비구입 및 설치';
  await g2b('G1', 'R26BK0001-000', { title: SCREEN, issuer: '시험시 근로자종합복지관', posted_date: d(-3), first_seen_at: at(d(-3)), deadline_at: at(d(5), '10:00'), attachment_urls: ['https://www.g2b.go.kr/files/a.hwp'] });
  await g2b('G2', 'R26BK0001-001', { title: `[취소공고] ${SCREEN}`, issuer: '시험시 근로자종합복지관', posted_date: d(-1), first_seen_at: at(d(-1)), deadline_at: at(d(5), '10:00'), notice_kind: 'cancel', current_status: '취소', attachment_urls: ['https://www.g2b.go.kr/files/c.pdf'] });
  const POOL = '학생체육관 강서분관 수영장 노후배관 개선 전기공';
  await g2b('H1', 'R26BK0002-000', { title: POOL, issuer: '시험교육청', posted_date: d(-9), first_seen_at: at(d(-9)), deadline_at: at(d(-1), '10:00'), current_status: '마감' });
  await g2b('H2', 'R26BK0002-001', { title: POOL, issuer: '시험교육청', posted_date: d(-2), first_seen_at: at(d(-2)), deadline_at: at(d(-1), '10:00'), notice_kind: 'cancel', current_status: '취소' });
  const CMTY = '[충남] 커뮤니티센터 통합관리시스템 시공 및 유지관리 업체 선정';
  await kapt('K-A', { title: CMTY, issuer: '시험 아파트', posted_date: d(-4), first_seen_at: at(d(-4)), deadline_at: at(d(10), '17:00') });
  await kapt('K-B', { title: CMTY, issuer: '시험 아파트', posted_date: d(-2), first_seen_at: at(d(-2)), deadline_at: at(d(10), '17:00') });
  // 같은 게시가 두 줄(원본 복사 + 워크인 수집 — 같은 원천 번호) → 게시 횟수는 그대로 2회
  await put({ id: 'K-B-copy', source_type: 'kapt_bid', source_external_id: 'K-B', source_url: 'https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=K-B', title: CMTY, issuer: '시험 아파트', posted_date: d(-2), first_seen_at: at(d(-2), '08:00'), deadline_at: at(d(10), '17:00') });
  const GYM = '[경기] 주민운동시설 위탁운영 사업자 선정';
  await kapt('K-C', { title: GYM, issuer: '시험 단지', posted_date: d(-6), first_seen_at: at(d(-6)), deadline_at: at(d(8), '17:00'), current_status: '취소' });
  await kapt('K-D', { title: `${GYM} 재공고`, issuer: '시험 단지', posted_date: d(-3), first_seen_at: at(d(-3)), deadline_at: at(d(8), '17:00') });
  const HW = '화원 복합커뮤니티센터 공간 디자인 용역';
  await g2b('W1', 'R26BK0009-000', { title: HW, issuer: '시험군', posted_date: d(-2), first_seen_at: at(d(-2)), deadline_at: at(d(6), '10:00') });
  await g2b('W2', 'R26BK0010-000', { title: HW, issuer: '시험군', posted_date: d(-2), first_seen_at: at(d(-2), '10:00'), deadline_at: at(d(6), '10:00') });
  await g2b('X1', 'R26BK0011-000', { title: '시험구 체육센터 헬스장 위탁운영', issuer: '시험구', posted_date: d(-1), first_seen_at: at(d(-1)), deadline_at: at(d(7), '10:00') });
  // (라) 둘 다 이미 대상아님 — 하나는 이번 기능 전에 넘긴 기록(사유·넘긴 사람 칸 없음)
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'W1', status: '대상아님' });
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data, updated_at) values ('default', 'opportunity_work', 'w:bid:W2', 'W2', '대상아님', ${sql.json({ status: '대상아님', notice_id: 'W2', updated_by: ctx.staffA.id })}, now() - interval '1 day')`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('같은 공고 한 장: 취소 공고는 원 공고에 · 재게시 묶음 · 완전 중복 하나 · 대상 아님 숨김', async () => {
  const all = await bids('all');
  const of = (re) => all.items.filter((n) => re.test(n.title));
  // 278차 #830: 취소된 공고는 전체 탭에서도 빠지고 '취소된 공고' 탭에만
  const can = await bids('canceled'); const ofC = (re) => can.items.filter((n) => re.test(n.title));
  assert.deepEqual([of(/스크린골프/).length, of(/수영장 노후배관/).length], [0, 0], '취소 공고는 전체 탭에서 빠짐');
  const screen = ofC(/스크린골프/);
  assert.equal(screen.length, 1, '(가) 취소 공고는 따로 카드로 안 냄');
  assert.deepEqual([screen[0].id, screen[0].status, screen[0].history.cancelDay, screen[0].history.cancelNotice], ['G1', '취소', d(-1), true], '원 공고 카드에 취소 · 취소 공고 날짜');
  assert.equal(screen[0].attachments.length, 2, '첨부는 묶음 전체');
  const pool = ofC(/수영장 노후배관/);
  assert.deepEqual(pool.map((n) => [n.id, n.status]), [['H1', '취소']], '(나) 원 공고 마감 + 취소 공고 → 취소');
  const cmty = of(/커뮤니티센터 통합관리/);
  assert.equal(cmty.length, 1, '(다) K-apt 재게시 한 장');
  assert.deepEqual([cmty[0].id, cmty[0].history.posts.map((p) => p.day), cmty[0].status], ['K-B', [d(-4), d(-2)], '진행중'], '진행 기록이 없으면 가장 최근 게시가 카드');
  const gym = of(/주민운동시설 위탁운영/);
  assert.deepEqual(gym.map((n) => [n.id, n.status, n.history.posts.map((p) => p.cancelled)]), [['K-D', '진행중', [true, false]]], '앞 게시가 취소, 재공고(제목 끝 표시 무시)는 진행');
  assert.equal(of(/화원 복합커뮤니티센터/).length, 0, '(라) 대상 아님은 전체 탭에서도 빠짐');
  assert.ok(of(/시험구 체육센터/).every((n) => !n.history), '묶음 아닌 공고는 그대로');
  assert.equal(all.skipCount, 1, '완전 중복 두 줄 = 대상 아님 1건');
  // [대상 아님] 탭: 한 장 · 넘긴 사람·시각(이번 기능 전 기록은 마지막으로 고친 사람·시각)
  const sk = await bids('skip');
  assert.deepEqual(sk.items.map((n) => n.title), ['화원 복합커뮤니티센터 공간 디자인 용역']);
  const [{ name: ownerName }] = await sql`select name from users where id = ${ctx.ownerId}`;
  assert.equal(sk.items[0].skip.by, ownerName, '가장 최근에 고친 진행 기록(대표가 방금 넘김)이 카드');
  assert.ok(sk.items[0].skip.at);
  for (const tab of ['open', 'today', 'prep', 'working']) assert.ok(!(await bids(tab)).items.some((n) => /화원/.test(n.title)), `${tab} 탭에도 없음`);
});

test("[대상 아님] 넘기기(사유) → 모든 목록·숫자에서 빠짐 → [되돌리기] = 넘기기 전 상태 · 감사 기록", async () => {
  const s0 = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'X1', status: '검토중' });
  const r = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'X1', status: '대상아님', reason: '우리 업종 아님' });
  assert.equal(r.status, '대상아님');
  const all = await bids('all');
  assert.ok(!all.items.some((n) => n.id === 'X1'), '전체 탭에서 빠짐'); assert.equal(all.skipCount, 2);
  const s1 = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.equal(s1.kpi.relatedNotices, s0.kpi.relatedNotices - 1, '영업 홈 관련 공고 수에서도 빠짐');
  const x = (await bids('skip')).items.find((n) => n.id === 'X1');
  assert.deepEqual([x.skip.reason, x.work], ['우리 업종 아님', '대상아님']);
  // 메모만 고쳐도 넘긴 사람·사유 그대로
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'X1', memo: '확인함' });
  assert.equal((await bids('skip')).items.find((n) => n.id === 'X1').skip.reason, '우리 업종 아님');
  // 되돌리기: 넘기기 전 상태(검토중)로 · 대상 아님이 아니면 400
  const back = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'X1', restore: true });
  assert.equal(back.status, '검토중');
  assert.ok((await bids('all')).items.some((n) => n.id === 'X1' && n.work === '검토중'), '다시 목록에');
  assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'bid', id: 'X1', restore: true })).status, 400);
  const [w] = await sql`select data from sales_work_records where tenant = 'default' and ref_id = 'X1'`;
  assert.ok(!('skip_by' in w.data) && !('skip_reason' in w.data), '되돌리면 넘김 기록 칸은 지움');
  const logs = (await sql`select action, detail from audit_logs where action like 'sales_work.%' and target_id = 'X1' order by id`).map((l) => [l.action, l.detail.reason ?? null]);
  assert.deepEqual(logs, [['sales_work.skip', '우리 업종 아님'], ['sales_work.unskip', null]], '누가·언제는 감사 기록에도');
  // 사유 없이 넘기고 되돌리면 첫 상태(미검토)
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'G1', status: '대상아님' });
  assert.equal((await bids('skip')).items.find((n) => n.id === 'G1').skip.reason, null);
  assert.equal((await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'G1', restore: true })).status, '미검토');
});

test('진행 기록이 걸린 게시가 카드(옛 게시에 기록 → 그 줄 id·기록, 상태·마감은 최근 게시)', async () => {
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'K-A', status: '검토중', memo: '현장 확인' });
  const c = (await bids('all')).items.filter((n) => /커뮤니티센터 통합관리/.test(n.title));
  assert.deepEqual(c.map((n) => [n.id, n.work, n.status, n.history.posts.length]), [['K-A', '검토중', '진행중', 2]]);
  assert.ok((await bids('working')).items.some((n) => n.id === 'K-A'));
});

test('당일 메일: 대상 아님 공고와 그 취소 공고(같은 번호)는 빠짐 · 먼저 게시된 같은 공고가 있으면 \'재게시\'', async () => {
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${d(-1)}, '[]', '{}', 1, 1, ${new Date(at(d(-1), '08:00'))})`;
  await g2b('S1', 'R26BK0020-000', { title: '시험동 국민체육센터 헬스장 위탁운영', issuer: '시험동', posted_date: today, first_seen_at: ago(3), updated_at: ago(3), deadline_at: at(d(9), '10:00') });
  await g2b('S2', 'R26BK0020-001', { title: '[취소] 시험동 국민체육센터 헬스장 위탁운영', issuer: '시험동', posted_date: today, first_seen_at: ago(1), updated_at: ago(1), deadline_at: at(d(9), '10:00'), notice_kind: 'cancel', current_status: '취소' });
  await kapt('K-M0', { title: '[서울] 시험 커뮤니티 피트니스 위탁운영 사업자 선정', issuer: '시험 래미안', posted_date: d(-3), first_seen_at: at(d(-3)), updated_at: at(d(-3)), deadline_at: at(d(9), '17:00') });
  await kapt('K-M1', { title: '[서울] 시험 커뮤니티 피트니스 위탁운영 사업자 선정', issuer: '시험 래미안', posted_date: today, first_seen_at: ago(2), updated_at: ago(2), deadline_at: at(d(9), '17:00') });
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'S1', status: '대상아님', reason: '시험' });
  const g = await ctx.owner.ok('GET', '/api/sales/digest');
  assert.ok(!g.items.some((i) => /시험동 국민체육센터/.test(i.title)), JSON.stringify(g.items.map((i) => i.title)));
  assert.equal(g.counts.skipped['대상 아님'], 2, '대상 아님 + 그 취소 공고');
  const m1 = g.items.find((i) => i.id === 'K-M1');
  assert.ok(m1, JSON.stringify(g.items.map((i) => i.id)));
  assert.ok(m1.badges.includes('재게시'), JSON.stringify(m1.badges));
  // 화면도 같은 공고 한 장: 2회 게시
  const c = (await bids('all')).items.filter((n) => /시험 커뮤니티 피트니스/.test(n.title));
  assert.deepEqual(c.map((n) => [n.id, n.history.posts.map((p) => p.day)]), [['K-M1', [d(-3), today]]]);
  assert.ok(!(await bids('all')).items.some((n) => /시험동 국민체육센터/.test(n.title)), '대상 아님 묶음(취소 공고 포함)은 목록에서도 빠짐');
  const pv = (await ctx.owner.req('GET', '/api/sales/digest?preview=text')).body;
  assert.match(pv, /\[재게시\] \[서울\] 시험 커뮤니티 피트니스/);
});
