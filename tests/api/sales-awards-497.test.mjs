// 226차 #497 R21-4(21라인 '낙찰 결과·낙찰가·경쟁업체 분석'): 관련 공고 낙찰 결과를 업체별로 — 법인 표시 빼고 같은 업체 · 금액 합·평균 낙찰률·참가 수·지역·최근 · 우리 회사(사업자번호) · 유찰 · 기간 · 맞춤 조건 · 권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const ID = (n) => `00000000-0000-4000-8000-000000497${String(n).padStart(3, '0')}`;
const res = (n, title, ago, extra = {}) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), source_type: 'kapt_bid',
  source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=E2E497-${n}`, title, notice_kind: 'new', current_status: '낙찰', award_date: addDays(today, -ago), related: true, ...extra })}, 'workin')`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into company_profiles (tenant, key, name, biz_no, is_default) values ('default', 'awardtest', '다짐테스트(주)', '123-45-67890', true)`;
  await res(1, '[경기] 가나아파트 헬스장 위탁운영 사업자 선정', 5, { winner_name: '(주)가나스포츠', winner_amount: 120000000, winner_rate: 87.5, bidders: 4, region: '경기' });
  await res(2, '[서울] 다라아파트 피트니스센터 위탁운영', 20, { winner_name: '가나스포츠 주식회사', winner_amount: 80000000, winner_rate: 90.5, bidders: 6, region: '서울' });
  await res(3, '[경기] 마바아파트 헬스장 운영 위탁', 40, { winner_name: '㈜가나스포츠' });
  await res(4, '[인천] 사아아파트 헬스장 위탁운영', 10, { winner_name: '사아운영', winner_amount: 50000000 });
  await res(5, '[경기] 자차아파트 헬스장 위탁운영', 3, { winner_name: '다짐테스트', winner_biz_no: '1234567890' });
  await res(6, '[경기] 카타아파트 헬스장 위탁운영', 8, { current_status: '유찰' });
  await res(7, '[경기] 오래된아파트 헬스장 위탁운영', 200, { winner_name: '(주)가나스포츠', winner_amount: 30000000 });
  await res(8, '[경기] 하파아파트 승강기 교체 공사', 2, { winner_name: '엘리베이터(주)', winner_amount: 900000000, related: false });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('업체별 묶음(법인 표시 빼고) · 금액 합·평균 낙찰률·참가 수·주 지역·최근 · 우리 회사 · 유찰 · 업종 무관 공고는 뺌', async () => {
  const d = await ctx.staffA.client.ok('GET', '/api/sales/award-stats');
  assert.deepEqual([d.days, d.total, d.awarded, d.failed, d.companies, d.ours, d.top5Share], [90, 6, 5, 1, 3, 1, 100], JSON.stringify({ ...d, items: undefined }));
  assert.deepEqual(d.items.map((x) => [x.rank, x.name, x.wins, x.ours]), [[1, '(주)가나스포츠', 3, false], [2, '사아운영', 1, false], [3, '다짐테스트', 1, true]], '건수 → 금액 순 · 이름은 같은 횟수면 최근 이름');
  const a = d.items[0];
  assert.deepEqual([a.amount, a.rate, a.bidders, a.regions, a.last], [200000000, 89, 5, ['경기', '서울'], addDays(today, -5)], '금액·낙찰률·참가 수는 있는 것만 평균');
  assert.deepEqual(a.recent.map((r) => r.id), [ID(1), ID(2), ID(3)], '최근 순');
  assert.match(a.recent[0].url, /bidNum=E2E497-1$/);
  assert.ok(!JSON.stringify(d).includes('엘리베이터'), '업종 무관 공고(승강기)는 뺌');
});

test('기간(1년이면 오래된 결과 포함) · 맞춤 조건 제외어 반영 · 이상한 기간은 90일', async () => {
  const y = await ctx.owner.ok('GET', '/api/sales/award-stats?days=365');
  assert.deepEqual([y.days, y.items[0].wins, y.items[0].amount], [365, 4, 230000000]);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/award-stats?days=7')).days, 90);
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { excludes: ['피트니스'] });
  const e = await ctx.owner.ok('GET', '/api/sales/award-stats');
  assert.deepEqual([e.total, e.items[0].wins, e.items[0].regions], [5, 2, ['경기']], '제외어에 걸린 결과는 뺌');
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { excludes: [] });
});

test('227차 우리 회사(로컬 10/28 \'하이링크 낙찰 0\'): 사업자번호 없는 회사 프로필은 이름으로 · 맞춤 조건 밖 낙찰도 셈 · 이름이 같아도 사업자번호가 다르면 남의 회사 · 기준 안내', async () => {
  await sql`insert into company_profiles (tenant, key, name, is_default) values ('default', 'awardtest2', '(주)하이링크테스트', false)`;
  await res(9, '[부산] 차카아파트 외벽 도색', 4, { winner_name: '하이링크테스트 주식회사', winner_biz_no: '555-55-55555' }); // 업종 무관 제목 · 모르는 사업자번호
  await res(10, '[경기] 파하아파트 헬스장 위탁운영', 6, { winner_name: '다짐테스트(주)', winner_biz_no: '9999999999' }); // 우리와 같은 이름 · 다른 사업자번호
  try {
    const d = await ctx.owner.ok('GET', '/api/sales/award-stats');
    assert.deepEqual([d.total, d.awarded, d.companies, d.ours], [8, 7, 5, 2], JSON.stringify({ ...d, items: undefined }));
    assert.deepEqual(d.items.filter((x) => x.ours).map((x) => [x.name, x.wins]).sort(), [['다짐테스트', 1], ['하이링크테스트 주식회사', 1]], '사업자번호 없는 회사 프로필 = 이름으로 · 업종 무관 제목이어도 우리 낙찰은 셈');
    const other = d.items.find((x) => !x.ours && x.name === '다짐테스트(주)'); assert.equal(other?.wins, 1, '같은 이름 · 다른 사업자번호 = 남의 회사(우리 줄과 따로)');
    assert.deepEqual([d.me.biz, d.me.noBiz], [1, ['(주)하이링크테스트']]);
    assert.ok(['다짐테스트(주)', '(주)하이링크테스트'].every((n) => d.me.names.includes(n)), JSON.stringify(d.me));
    assert.ok(!JSON.stringify(d.me).includes('1234567890'), '사업자번호 값은 안 보냄');
    await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { regions: ['서울'] });
    const r = await ctx.owner.ok('GET', '/api/sales/award-stats');
    assert.deepEqual([r.ours, r.items.filter((x) => x.ours).length], [2, 2], '지역 조건(서울) 밖 우리 낙찰도 셈');
  } finally {
    await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { regions: [] });
    await sql`delete from sales_src_rows where src_id = any(${[ID(9), ID(10)]})`; await sql`delete from company_profiles where key = 'awardtest2'`;
  }
});

test('229차 플랫폼 공고 조회에 낙찰 칸(낙찰자·금액·낙찰률·참가 수) — 메일 결과 줄과 대조용', async () => {
  const it = (await ctx.owner.ok('GET', `/api/platform/sales-notices?q=${encodeURIComponent('가나아파트')}`)).items[0];
  assert.deepEqual([it.award?.winner, it.award?.amount, it.award?.rate, it.award?.bidders], ['(주)가나스포츠', 120000000, 87.5, 4]);
  assert.equal((await ctx.owner.ok('GET', `/api/platform/sales-notices?q=${encodeURIComponent('카타아파트')}`)).items[0].award, null, '낙찰자 없는 유찰 줄은 비움');
});

test('232차(로컬 10/28 15:40) 공고 조회: 결과 칸(보완 시각·상세 읽은 때·참여업체 수·사유) · 마지막 고친 때는 award 밖 · 이 회사 지난 14일 메일에 나간 구역·결과 문장', async () => {
  await sql`update sales_src_rows set row = row || ${sql.json({ result_filled_at: '2026-10-28T08:50:00+09:00', kapt_detail_at: '2026-10-28T07:05:00+09:00', participants: [{ name: '(주)가나스포츠', won: true }, { name: '다른곳', won: false }], result_note: '최저가' })}::jsonb where src_id = ${ID(1)}`;
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified) values ('default', ${today}, ${sql.json([{ id: ID(1), section: 'result', badges: ['낙찰'], result: '낙찰 (주)가나스포츠 · 낙찰금액 1.2억원', title: 'x' }, { id: 'other', section: 'now', title: 'y' }])}, '{}', 1, 1)`;
  try {
    const it = (await ctx.owner.ok('GET', `/api/platform/sales-notices?q=${encodeURIComponent('가나아파트')}`)).items[0];
    assert.deepEqual([it.award.resultFilledAt, it.award.detailAt, it.award.participants, it.award.note], ['2026-10-28T08:50:00+09:00', '2026-10-28T07:05:00+09:00', 2, '최저가']);
    assert.ok('updatedAt' in it && !('updatedAt' in it.award), JSON.stringify(Object.keys(it)));
    assert.deepEqual(it.award.participantRows, [{ name: '(주)가나스포츠', won: true, invalid: false, docs: null, site: null, hidden: false, amount: null, score: null },
      { name: '다른곳', won: false, invalid: false, docs: null, site: null, hidden: false, amount: null, score: null }], '237차 참여업체 줄(서류·현장설명은 읽은 판부터)');
    assert.deepEqual(it.mailed, [{ day: today, section: 'result', badges: ['낙찰'], result: '낙찰 (주)가나스포츠 · 낙찰금액 1.2억원' }]);
    assert.deepEqual((await ctx.owner.ok('GET', `/api/platform/sales-notices?q=${encodeURIComponent('다라아파트')}`)).items[0].mailed, []);
  } finally { await sql`delete from sales_digests where tenant = 'default' and day = ${today}`; }
});

test('권한: 영업 공간 밖 404 · 입찰을 쓰지 않는 회사 403', async () => {
  assert.equal((await ctx.staffB.client.req('GET', '/api/sales/award-stats')).status, 404);
  await sql`update tenants set sales_bids = false where id = 'default'`;
  try { assert.equal((await ctx.owner.req('GET', '/api/sales/award-stats')).status, 403); } finally { await sql`update tenants set sales_bids = null where id = 'default'`; }
});
