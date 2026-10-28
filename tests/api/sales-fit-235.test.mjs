// 235차(234차 K-apt 결과 목록을 고친 뒤 실제 결과 제목으로 판정 점검 — 공개 화면 '헬스'·'커뮤니티'·'골프' 결과 247건): 다짐은 운영·위탁만 —
// '헬스장 인테리어업체'·'샤워실 시설 환경개선'·'골프연습장 환경개선'·'빔프로젝터 공급업체'는 다짐 아님 · '커뮤니티 시스템 에어컨 교체'는 하이링크 아님(냉난방기)
// 진짜 위탁운영·위탁관리(다짐)와 출입관리시스템 설치·출입시스템 렌탈(하이링크)은 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
// [제목, 지금 규칙 판정, 예전 규칙이 저장한 판정(234차 전 운영과 같은 값)]
const T = {
  '20261028235001': ['커뮤니티 헬스장 인테리어업체 선정 입찰 공고', null, '다짐'],
  '20261028235002': ['커뮤니티 시스템 에어컨 교체설치 공사업체 선정', null, '하이링크'],
  '20261028235003': ['커뮤니티 시스템에어컨 교체공사', null, '하이링크'],
  '20261028235004': ['커뮤니티 샤워실 시설 환경개선 사업자 선정 입찰공고', null, '다짐'],
  '20261028235005': ['골프연습장 환경개선 사업자 선정 입찰공고', null, '다짐'],
  '20261028235006': ['골프연습장 빔프로젝터 공급업체 선정', null, '다짐'],
  '20261028235007': ['주민공동시설(커뮤니티센터)위탁운영업체 선정공고', '다짐', '다짐'],
  '20261028235008': ['단지 내 헬스클럽 위탁관리 업체 선정 입찰공고', '다짐', '다짐'],
  '20261028235009': ['커뮤니티 입주민카페 위탁운영업체 선정 입찰공고', '다짐', '다짐'],
  '20261028235010': ['커뮤니티 지문 출입관리시스템 설치공사 업체선정 재공고', '하이링크', '하이링크'],
  '20261028235011': ['커뮤니티 출입시스템 렌탈 서비스 업체 선정 입찰', '하이링크', '하이링크'],
};
before(async () => {
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: 'http://127.0.0.1:9' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  for (const [no, [title, , stored]] of Object.entries(T)) {
    const id = randomUUID();
    await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'kapt_bid', source_external_id: no, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${no}`, title, current_status: '낙찰', winner_name: '시험(주)', related: true, fit_business: stored })}, 'workin')`;
  }
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('지금 규칙(플랫폼 조회): K-apt 결과 실제 제목 — 인테리어·환경개선·공급·시스템 에어컨은 관련 아님, 위탁운영·위탁관리·출입시스템은 그대로', async () => {
  for (const [no, [title, want]] of Object.entries(T)) {
    const r = (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}`)).items[0].nowRule;
    assert.equal(r.fit, want, `${title} → ${JSON.stringify(r)}`);
  }
  const why = async (no) => (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}`)).items[0].nowRule.dropped[0];
  assert.deepEqual(Object.values(await why('20261028235001')), ['다짐', "제목에 '인테리어' — 다짐은 운영·위탁만"]);
  assert.deepEqual(Object.values(await why('20261028235002')), ['하이링크', "'시스템 에어컨'은 냉난방기 — 하이링크 시스템 아님"]);
});

test('다시 판정: 예전 규칙이 저장한 다짐 4건·하이링크 2건(시스템 에어컨)을 내리고(까닭 기록) 진짜 운영·출입시스템 공고는 그대로 · 두 번 돌려도 그대로', async () => {
  const rf = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.deepEqual([rf.lowered, rf.changed, rf.raised], [6, 0, 0], JSON.stringify(rf));
  const rows = await sql`select row from sales_src_rows where tbl = 'procurement_notices'`;
  for (const { row } of rows) assert.equal(row.fit_business ?? null, T[row.source_external_id][1], row.title);
  const again = await ctx.owner.ok('POST', '/api/platform/sales-notices', { refit: true });
  assert.deepEqual([again.lowered, again.changed, again.raised], [0, 0, 0]);
});
