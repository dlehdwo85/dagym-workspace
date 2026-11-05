// 372차 #995 ④(로컬 21라인 대조: '래미안'·공고 번호로 찾으면 영업실 목록에 안 나옴): 검색은 지금 탭 안만 보고, 관련 아님 공고는 목록에 읽히지도 않았다
// → 검색어가 있으면 탭 밖(대상 아님·취소된 공고·다른 탭)·관련 아님 공고도 찾아 '어디 있는지·왜 안 보이는지' 한 줄
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (id, o) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', current_status: '공고중', notice_kind: 'new',
  posted_date: today, deadline_at: `${addDays(today, 8)}T10:00:00+09:00`, first_seen_at: new Date().toISOString(), issuer: '시험995 발주처', ...o })})`;
const A = '00000000-0000-4000-8000-000000995001', B = '00000000-0000-4000-8000-000000995002', C = '00000000-0000-4000-8000-000000995003';
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`; // 진행 기록 = 정식 표
  await put(A, { source_external_id: 'R26BK995001-000', title: '시험995 용인시 국민체육센터 위탁운영', related: true, fit_business: '다짐' });
  await put(B, { source_external_id: 'R26BK995002-000', title: '시험995 래미안시험파크 주민공동시설 위탁운영', related: true, fit_business: '다짐' });
  await put(C, { source_external_id: 'R26BK995003-000', title: '시험995 상상놀이터 관리위탁 운영자 모집', related: false, bid_category: '기타' });
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, data) values ('default', 'opportunity_work', ${`w:bid:${B}`}, ${B}, '대상아님', ${sql.json({ skip_reason: '참가자격 미달' })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('검색어: 목록에 보이는 것 + 탭 밖(대상 아님·까닭)·관련 아님 공고를 어디 있는지와 함께 · 공고 번호로도', async () => {
  const r = await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('시험995')}`);
  assert.deepEqual(r.items.map((x) => x.noticeNo), ['R26BK995001-000'], '목록에는 보이는 것만');
  const o = Object.fromEntries(r.outside.map((x) => [x.noticeNo, x]));
  assert.equal(o['R26BK995002-000']?.where, '대상 아님 탭', JSON.stringify(r.outside));
  assert.match(o['R26BK995002-000'].why ?? '', /참가자격 미달/);
  assert.equal(o['R26BK995003-000']?.where, '관련 아님(우리 사업 낱말 없음)');
  assert.ok(!o['R26BK995001-000'], '목록에 보이는 공고는 다시 안 적음');
  const byNo = await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${encodeURIComponent('R26BK995003')}`);
  assert.deepEqual(byNo.outside.map((x) => x.noticeNo), ['R26BK995003-000'], '공고 번호로 찾기');
  const none = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all');
  assert.deepEqual(none.outside, [], '검색어가 없으면 안 찾음');
});
