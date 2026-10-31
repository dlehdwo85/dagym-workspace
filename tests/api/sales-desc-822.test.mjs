// 281차 #822(대표 10/31 "업무 넘어올 때 현설 및 세대수 준공년월 내용 같이 올 수 있도록"): 입찰 업무 설명에 현장설명(필수·일시·장소 / 없음) ·
// 단지 세대수·준공(사용승인)년월 — 단지 정보는 K-apt 단지 목록(이름 같은 단지, 여럿이면 지역)에서 · 웹 문의 업무 표에도 '단지 정보(K-apt)' 한 줄 · 못 찾으면 줄 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json(row)})`;
const code = (c, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'kapt_complex_codes', ${c}, ${sql.json(row)}, 'workin')`;
const handoff = (id, assigneeIds) => ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id, assigneeIds });
const descOf = async (id) => (await sql`select description from tasks where sales_ref->>'id' = ${id} and deleted_at is null`)[0]?.description ?? '';

before(async () => {
  await resetDb(); srv = await startServer({ KAPT_SERVICE_KEY: '', DATA_GO_KR_SERVICE_KEY: '' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await code('A10000001', { code: 'A10000001', name: '시험푸르지오 레이크', sido: '경기도', sigungu: '용인시', usedate: '2019-03-15', households: 812 });
  await code('A20000001', { code: 'A20000001', name: '시험센트럴자이', sido: '서울특별시' });
  await code('A20000002', { code: 'A20000002', name: '시험센트럴자이', sido: '부산광역시' });
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'operating_facility_prospects', 'P1', ${sql.json({ id: 'P1', facility_code: 'A20000002', completion_date: '2024-11-30', household_count: 1500 })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('입찰 업무 설명: 현장설명 필수·일시·장소 · 단지 세대수·준공년월(K-apt 단지 목록)', async () => {
  await put({ id: 'D1', source_type: 'kapt_bid', title: '[경기] 시험푸르지오레이크 주민운동시설 위탁 운영', facility_name: '시험푸르지오 레이크', issuer: '시험푸르지오 레이크', region: '경기',
    deadline_at: `${addDays(today, 9)}T09:00:00+09:00`, posted_date: today, related: true, first_seen_at: today,
    site_briefing_kind: '필수', site_briefing_at: `${addDays(today, 3)}T10:00:00+09:00`, site_briefing_place: '관리사무소 회의실' });
  await handoff('D1', [ctx.staffA.id]);
  const d = await descOf('D1');
  assert.match(d, /^현장설명: 필수 \d{1,2}\/\d{1,2}\(.\) 10:00 · 관리사무소 회의실$/m);
  assert.match(d, /^단지: 세대수 812세대 · 준공 2019년 3월\(사용승인\)$/m);
});

test('현장설명 없음(KG2B) · 이름이 여럿이면 지역으로 하나 · 준공·입주 시설 줄의 준공일 · 공고 세대수가 먼저', async () => {
  await put({ id: 'D2', source_type: 'kapt_bid', title: '[부산] 시험센트럴자이 커뮤니티 위탁', facility_name: '시험센트럴자이', region: '부산', household_count: 1490,
    deadline_at: `${addDays(today, 9)}T09:00:00+09:00`, posted_date: today, related: true, first_seen_at: today, site_briefing_kind: '공고문 참조', kg2b_briefing_kind: '없음' });
  await handoff('D2', [ctx.staffA.id]);
  const d = await descOf('D2');
  assert.match(d, /^현장설명: 없음$/m);
  assert.match(d, /^단지: 세대수 1,490세대 · 준공 2024년 11월\(사용승인\)$/m);
});

test('단지를 못 찾으면(지역도 안 맞음) 단지 줄 없음 · 현장설명 정보 없으면 줄 없음', async () => {
  await put({ id: 'D3', source_type: 'g2b', title: '체육센터 위탁 운영 용역', issuer: '시험시청', facility_name: '시험센트럴자이', region: '대구',
    deadline_at: `${addDays(today, 9)}T09:00:00+09:00`, posted_date: today, related: true, first_seen_at: today });
  await handoff('D3', [ctx.staffA.id]);
  const d = await descOf('D3');
  assert.doesNotMatch(d, /^단지:/m); assert.doesNotMatch(d, /^현장설명:/m);
});

test('웹 문의 업무: 단지명이 K-apt 단지와 맞으면 단지 정보(K-apt) 줄', async () => {
  const { token } = await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'hilink' });
  const r = await fetch(`${BASE}/api/integrations/inquiries`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ lead_id: 'HL-822-1', inquiry_type: 'HILINK 플랫폼', organization: '시험푸르지오레이크', region: '경기', name: '홍길동', phone: '010-0000-0000', message: '문의' }) });
  assert.equal(r.status, 200, await r.clone().text());
  const [t] = await sql`select t.description from inquiries i join tasks t on t.id = i.task_id where i.lead_id = 'HL-822-1'`;
  assert.match(t.description, /\| 단지 정보\(K-apt\) \| 812세대 · 준공 2019년 3월 \|/);
});
