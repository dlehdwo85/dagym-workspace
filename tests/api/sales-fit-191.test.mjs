// 191차(대표 10/27 정정 · 로컬 10/27 01:00·01:10): ① 다짐 = 운영·위탁만(제목에 설치·시공·렌탈·장비·시스템·구축 → 다짐 아님) · 시스템 구축 = 하이링크만
// ② 다시 판정이 잘못 올린 공고·원본 복사 줄의 예전 판정 내리기(올리기만 하는 원칙의 예외) ③ 관련 줄이 입찰 목록에서 빠지던 읽기 상한(모든 공고 최신 2만 줄)
// ④ 다시 판정이 관련 아님 줄을 2만 줄까지만 보던 것 ⑤ 플랫폼 조회 listCheck(목록에 들어가는지·빠진 단계)·아파트장터 A 번호
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
let srv, ctx, sql;
const put = async (ext, title, o = {}, origin = 'src') => {
  const id = o.id ?? randomUUID();
  const row = { id, source_type: 'kapt_bid', source_external_id: ext, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '시험 단지', bid_category: '사업자 - 공사 - 일반공사',
    current_status: '진행중', notice_kind: 'new', posted_date: plus(-3), deadline_at: `${plus(6)}T17:00:00+09:00`, first_seen_at: ago(3), related: false, fit_business: null, matched_keywords: [], ...o };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json(row)}, ${origin})`; return id;
};
const rowOf = async (id) => (await sql`select row from sales_src_rows where src_id = ${id}`)[0].row;
const listed = async (q) => (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent(q)}`)).items.map((i) => i.title);
const R = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 운영 조회(로컬 10/27 01:00)와 같은 모양 — 골프 3건은 원본 복사 줄이 '다짐'으로 관련, 하나는 185차 다시 판정이 올린 줄(refit_at·다시 찾은 공고)
  R.g1 = await put('20261023183942531', '[인천] 스크린골프 렌탈 및 시공', { bid_category: '사업자 - 용역 - 기타', task_scope: '주민공동시설 골프연습장 스크린골프 장비 렌탈 및 시공', related: true, fit_business: '다짐', matched_keywords: ['스크린골프'], classification: '즉시 검토', refit_at: ago(1), refound_at: ago(1) });
  R.g2 = await put('20261023103647191', '[부산] 스크린골프 GDR PLUS 설치', { task_scope: '주민공동시설 골프연습장 GDR PLUS 설치', related: true, fit_business: '다짐', matched_keywords: ['스크린골프'], classification: '즉시 검토' });
  R.g3 = await put('20261023163607068', '[대구] 골프연습장 시설개선 및 기계장비 설치', { bid_category: '사업자 - 공사 - 장기수선', task_scope: '골프연습장 기계장비 교체 및 시설개선', related: true, fit_business: '다짐', matched_keywords: ['골프연습장'], classification: '중장기 영업리드' });
  R.c1 = await put('20261026153718356', '[서울] 커뮤니티센터 통합관리시스템 구축 사업자 선정', { bid_category: '사업자 - 공사 - 장기수선', task_scope: '커뮤니티센터 회원·시설 통합관리시스템 구축', classification: '참고(비관련)' });
  R.c2 = await put('20261023114158368', '[서울] 출입통제장치 및 주차차단기 공사업체 선정', { task_scope: '지하주차장 출입구 주차관제 차단기와 공동현관 출입통제장치를 교체합니다.', classification: '참고(비관련)' });
  R.c3 = await put('X-CMTY', '[충남] 커뮤니티센터 통합관리시스템 시공 및 유지관리 업체 선정', { related: true, fit_business: '다짐·하이링크', matched_keywords: ['커뮤니티', '통합관리시스템'], classification: '중장기 영업리드' });
  R.k1 = await put('X-OPS', '[경기] 주민운동시설 위탁운영 사업자 선정', { bid_category: '사업자 - 용역 - 주민운동시설의 위탁', related: true, fit_business: '다짐', matched_keywords: ['주민운동', '위탁운영'], classification: '즉시 검토' });
  R.k2 = await put('X-ORIG', '[서울] 단지 시설 운영 지원 용역', { related: true, fit_business: '다짐', matched_keywords: [], classification: '중장기 영업리드' }); // 원본 판정(지금 규칙의 낱말 없음) — 내리지 않음
  R.a2p = await put('A20261023133052575', '[경기] 출입통제(홈오토)시스템 교체공사(재공고)', { related: true, fit_business: '하이링크', matched_keywords: ['출입통제'], classification: '즉시 검토' });
  // 로컬 01:10: 관련으로 저장된 원본 복사 줄인데 목록·검색에 안 나오던 줄 — 그 뒤에 관련 아님 공고(K-apt 전체)가 2만 줄 넘게 쌓인 상황
  R.card = await put('20261023140627810', '[서울] 공동현관 출입카드리더기 모듈교체공사입찰공고', { task_scope: '지하주차장 엘리베이터홀 공동현관 카드리더기 모듈 교체', related: true, fit_business: '하이링크', matched_keywords: ['카드리더'], classification: '중장기 영업리드', first_seen_at: ago(10) });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('① 판정 규칙: 다짐 = 운영·위탁만 · 시스템 구축 = 하이링크만 (플랫폼 조회 지금 규칙)', async () => {
  const now = async (no) => (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}`)).items[0].nowRule;
  for (const no of ['20261023183942531', '20261023103647191', '20261023163607068']) {
    const r = await now(no);
    assert.equal(r.fit, null, no); assert.equal(r.dropped[0].business, '다짐'); assert.match(r.dropped[0].why, /운영·위탁만/);
  }
  assert.equal((await now('20261026153718356')).fit, '하이링크', '커뮤니티센터 통합관리시스템 구축 = 하이링크만');
  assert.equal((await now('20261023114158368')).fit, '하이링크', '출입통제장치·주차차단기 공사 = 하이링크만(다짐은 공사 안 함)');
  assert.equal((await now('X-CMTY')).fit, '하이링크');
  assert.equal((await now('X-OPS')).fit, '다짐', '위탁운영은 그대로 다짐');
  assert.equal((await now('20261023133052575')).fit, '하이링크', 'A 를 빼고 넣어도 아파트장터 번호를 찾음');
});

test('② 다시 판정: 잘못 올라간 다짐 줄 내리기·사업 바꾸기·올리기 · 진행 기록 줄은 목록에 남음 · 감사 · 두 번 돌려도 그대로', async () => {
  // 골프 설치 공고 하나에 이 회사 진행 기록(검토중) — 내려도 목록에서 사라지지 않음
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: R.g2, status: '검토중' });
  const before = await listed('스크린골프');
  assert.equal(before.length, 2, `내리기 전엔 골프 공고가 목록에: ${JSON.stringify(before)}`);
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/sales-notices', { refit: true })).status, 404);
  const rf = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.deepEqual([rf.lowered, rf.changed, rf.raised, rf.linked], [3, 1, 2, 1], JSON.stringify(rf));
  for (const id of [R.g1, R.g2, R.g3]) {
    const r = await rowOf(id);
    assert.deepEqual([r.related, r.fit_business, r.classification, r.refound_at, r.refit_at], [false, null, '참고(비관련)', undefined, undefined], r.title);
    assert.ok(r.refit_lowered_at && r.judged_at); assert.match(r.refit_lowered_why, /다짐 아님 — 제목에 '(렌탈|설치|시설개선)' — 다짐은 운영·위탁만/);
  }
  const c3 = await rowOf(R.c3);
  assert.deepEqual([c3.related, c3.fit_business, c3.matched_keywords], [true, '하이링크', ['통합관리시스템']], '다짐·하이링크 → 하이링크만');
  for (const id of [R.c1, R.c2]) { const r = await rowOf(id); assert.deepEqual([r.related, r.fit_business], [true, '하이링크'], r.title); assert.ok(r.refound_at, '마감 전 → 다시 찾은 공고'); }
  assert.deepEqual([(await rowOf(R.k1)).fit_business, (await rowOf(R.k2)).related], ['다짐', true], '위탁운영·원본 판정 줄은 그대로');
  // 목록: 진행 기록 걸린 골프 공고만 남고, 나머지 골프 공고는 없음 · 하이링크 공고는 보임
  assert.deepEqual(await listed('스크린골프'), ['[부산] 스크린골프 GDR PLUS 설치']);
  assert.deepEqual(await listed('골프연습장 시설개선'), []);
  assert.equal((await listed('커뮤니티센터 통합관리시스템 구축')).length, 1);
  // 오늘 새 공고·당일 메일: 내린 골프 공고는 '다시 찾은 공고'로 나오지 않음
  const td = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today');
  assert.ok(!td.items.some((i) => /스크린골프 렌탈/.test(i.title)), JSON.stringify(td.items.map((i) => i.title)));
  assert.ok(td.items.some((i) => /커뮤니티센터 통합관리시스템 구축/.test(i.title) && /^다시 찾은 공고/.test(i.todayLabel)));
  const mail = JSON.stringify(await ctx.owner.ok('GET', '/api/sales/digest?preview=text'));
  assert.ok(!/스크린골프 렌탈/.test(mail)); assert.match(mail, /커뮤니티센터 통합관리시스템 구축/);
  const [a] = await sql`select detail from audit_logs where action = 'platform.sales_notices.refit' order by created_at desc limit 1`;
  assert.deepEqual([a.detail.lowered, a.detail.changed, a.detail.raised], [3, 1, 2]);
  // 다시 돌려도 바뀌는 것 없음(내린 줄은 지금 규칙으로 관련이 아니라 다시 올라가지 않음)
  const again = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.deepEqual([again.lowered, again.changed, again.raised], [0, 0, 0], JSON.stringify(again));
  // 조회: 내린 까닭 · 목록 쪽 실제 결과
  const g1 = (await ctx.owner.ok('GET', '/api/platform/sales-notices?no=20261023183942531')).items[0];
  assert.match(g1.reasons.join(' '), /다시 판정이 '관련 아님'으로 내림/); assert.deepEqual([g1.listCheck.listed, g1.listCheck.step], [false, 'read']);
  const g2 = (await ctx.owner.ok('GET', '/api/platform/sales-notices?no=20261023103647191')).items[0];
  assert.equal(g2.listCheck.listed, true, '진행 기록 줄은 목록에 보임');
});

test('③④⑤ 관련 아님 공고가 2만 줄 넘게 쌓여도: 관련 원본 복사 줄이 목록·검색에 나옴 · 다시 판정이 끝까지 봄 · 조회 listCheck·대상 아님 단계', async () => {
  // K-apt 전체 공고처럼 관련 아님 줄 20,005개 — 모두 위 줄들보다 나중에 처음 봄
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin)
    select 'global', 'procurement_notices', 'bulk-' || lpad(g::text, 6, '0'), jsonb_build_object('id', 'bulk-' || lpad(g::text, 6, '0'), 'source_type', 'kapt_bid', 'source_external_id', 'B' || g,
      'title', '[서울] 옥상 방수 공사 ' || g, 'related', false, 'current_status', '진행중', 'first_seen_at', ${new Date().toISOString()}::text), 'workin' from generate_series(1, 20005) g`;
  assert.deepEqual(await listed('출입카드리더기'), ['[서울] 공동현관 출입카드리더기 모듈교체공사입찰공고'], '로컬 01:10 ① 버그 — 관련 줄이 읽기 상한 밖으로 밀려 안 보였다');
  assert.deepEqual(await listed('출입통제(홈오토)'), ['[경기] 출입통제(홈오토)시스템 교체공사(재공고)']);
  const look = (await ctx.owner.ok('GET', '/api/platform/sales-notices?no=20261023140627810')).items[0];
  assert.deepEqual([look.listCheck.listed, look.listCheck.step], [true, 'listed']);
  // 다시 판정 올리기도 2만 줄 뒤의 관련 아님 줄까지(src_id 'zz…' 는 끝 쪽)
  const late = await put('ZZ-LATE', '[서울] 출입보안 시스템 구축 공사 업체 선정', { id: 'zz-late-row', classification: '참고(비관련)' });
  const rf = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.equal(rf.raised, 1, JSON.stringify(rf)); assert.equal((await rowOf(late)).fit_business, '하이링크');
  // 이 회사가 [대상 아님]으로 넘긴 줄 → listCheck 'skip'
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: R.card, status: '대상아님', reason: '시험' });
  const sk = (await ctx.owner.ok('GET', '/api/platform/sales-notices?no=20261023140627810')).items[0];
  assert.deepEqual([sk.listCheck.listed, sk.listCheck.step], [false, 'skip']); assert.match(sk.listCheck.why, /대상 아님/);
});
