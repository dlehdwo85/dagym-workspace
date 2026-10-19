// V41 단계 2 영업 공간 화면: 옮긴 원본(sales_src_rows)으로 영업 현황·리드(상세 = 상담·시점·입찰)·파이프라인·제안/계약·입찰(관련·진행 중·회사 분류)·허브(신규단지·시설·협력사)·지역별, 공간 밖 404·다른 회사 자료 안 보임
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  await put('default', 'leads', { id: 'L1', name: '판교 피트니스', sales_status: '미팅예정', priority: 'high', region: '경기', next_contact_date: plus(2), owner_id: 'P1', updated_at: today });
  await put('default', 'leads', { id: 'L2', name: '강남 커뮤니티', sales_status: '제안서발송완료', region: '서울', next_contact_date: plus(-1), owner_id: 'P2' });
  await put('default', 'leads', { id: 'L3', name: '부산 수영장', sales_status: '미팅예정', region: '부산' });
  await put('default', 'leads', { id: 'L4', name: '종결 리드', sales_status: '실패', region: '천안용곡 두산위브', next_contact_date: plus(-3) });
  await put('other', 'leads', { id: 'X1', name: '다른 회사 리드', status: '상담' });
  await put('default', 'sales_activities', { id: 'A1', lead_id: 'L1', kind: '전화', memo: '견적 요청' });
  await put('default', 'opportunity_work', { id: 'W1', notice_id: '11', status: '검토 중', lead_id: 'L1' });
  await put('global', 'procurement_notices', { id: 11, title: '체육시설 위탁운영', issuer: '성남시', related: true, first_seen_at: today, created_at: today, deadline_at: `${plus(5)}T10:00:00`, current_status: '공고중', fit_score: 82 });
  // 영업관리 기준(10/19): 신규 판단은 first_seen_at 하나만 — 공고일·created_at 이 오늘이어도 first_seen 이 30일 전이면 새 공고 아님
  await put('global', 'procurement_notices', { id: 14, title: '예전 공고(first_seen 30일 전)', related: true, first_seen_at: `${plus(-30)}T01:00:00+09:00`, notice_date: today, created_at: today, deadline_at: `${plus(3)}T10:00:00`, current_status: '공고중' });
  await put('global', 'procurement_notices', { id: 13, title: '낙찰된 공고', related: true, first_seen_at: plus(-30), deadline_at: `${plus(-10)}T10:00:00`, current_status: '낙찰' });
  await put('global', 'procurement_notices', { id: 12, title: '관계없는 공고', related: false, posted_at: today });
  // 운영 10/19: 진행 중 탭 0건(현황은 31) — 원본 상태 문구가 '공고중'이 아닌 진행 공고, 미참여로 정리한 공고, 사전규격
  await put('global', 'procurement_notices', { id: 15, title: '상태 문구 다른 진행 공고', related: true, first_seen_at: plus(-2), deadline_at: `${plus(8)}T10:00:00`, current_status: '입찰진행' });
  await put('global', 'procurement_notices', { id: 16, title: '미참여로 정리한 공고', related: true, first_seen_at: plus(-2), deadline_at: `${plus(9)}T10:00:00`, current_status: '공고중' });
  await put('default', 'opportunity_work', { id: 'W2', notice_id: '16', status: '미참여' });
  await put('global', 'procurement_notices', { id: 18, title: '오늘 이미 지난 마감', related: true, first_seen_at: plus(-2), deadline_at: `${today} 00:01`, current_status: '공고중' });
  await put('global', 'procurement_notices', { id: 17, title: '사전규격 공고', related: true, source: 'g2b_pre', first_seen_at: plus(-2), deadline_at: `${plus(10)}T10:00:00` });
  await put('default', 'procurement_notices__progress', { id: 11, classification: '적합' });
  await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지', households: 1200, address: '경기 성남' });
  await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', score: 88 });
  await put('default', 'operating_facility_prospects__progress', { id: 'F1', contact_status: '연락함' });
  await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리', rank: 3 });
  await sql`insert into sales_user_map (tenant, src_user_id, user_id, name, matched) values ('default', 'P1', ${ctx.ownerId}, '대표', true)`;
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('영업 공간 화면', async () => {
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=summary')).status, 404, '영업 공간 꺼짐');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const s = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.equal(s.readOnly, true); assert.equal(s.imported, true);
  assert.deepEqual([s.kpi.leads, s.kpi.dueSoon, s.kpi.overdue, s.kpi.bidsWorking, s.kpi.relatedNotices, s.kpi.newNotices7d], [4, 1, 1, 1, 7, 1], JSON.stringify(s.kpi));
  assert.equal(s.today.newNotices, 1, '오늘 새 공고 = first_seen_at 이 오늘(KST)');
  assert.equal(s.today.date, today); assert.equal(s.bidsOn, true);
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today')).items.map((n) => n.title), ['체육시설 위탁운영']);
  assert.deepEqual(s.due.map((l) => l.name), ['판교 피트니스'], '다가오는 연락 = 오늘~7일');
  assert.deepEqual(s.overdueList.map((l) => l.name), ['강남 커뮤니티'], '지남 = 종결 제외');
  assert.equal(s.statuses[0][0], '미팅예정', '11단계 순서');
  const leads = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads;
  assert.equal(leads.length, 4, '다른 회사 리드 안 보임');
  assert.equal(leads.find((l) => l.id === 'L1').priority, '높음');
  assert.equal(leads.find((l) => l.id === 'L1').owner, (await sql`select name from users where id = ${ctx.ownerId}`)[0].name, '담당자 = 연결된 워크인 사용자');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=leads&status=제안서발송완료')).leads.map((l) => l.name), ['강남 커뮤니티']);
  const d = await ctx.owner.ok('GET', '/api/sales/src?view=lead&id=L1');
  assert.equal(d.activities[0].memo, '견적 요청'); assert.equal(d.work.length, 1);
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=lead&id=X1')).status, 404, '다른 회사 리드 404');
  const p = await ctx.owner.ok('GET', '/api/sales/src?view=pipeline');
  assert.equal(p.columns[0].status, '신규리드'); assert.equal(p.columns.find((c) => c.status === '미팅예정').items.length, 2);
  const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids');
  assert.deepEqual(b.items.find((n) => n.title === '체육시설 위탁운영') && [b.items[1].work, b.items[1].agency, b.items[1].fit], ['검토 중', '성남시', 82], '기본 = 진행 중(낙찰 제외)');
  assert.deepEqual(b.items.map((n) => n.title), ['예전 공고(first_seen 30일 전)', '체육시설 위탁운영', '상태 문구 다른 진행 공고'], '마감 임박순 · 낙찰·미참여·사전규격 제외 · 상태 문구 달라도 진행');
  assert.equal(s.kpi.bidsOpen, b.items.length, '현황 진행 중 입찰 = 진행 중 탭 건수');
  assert.ok(!b.items.some((n) => n.title === '오늘 이미 지난 마감'), '오늘이라도 마감 시각이 지났으면 진행 중 아님');
  // 대표 확정(10/19): 홈·캘린더 영업 주요 일정 — 리드 다음 연락·작업 중 입찰 마감만(공고 하나하나·미참여 공고는 없음)
  const ag = await ctx.owner.ok('GET', `/api/spaces/agenda?from=${today}&to=${plus(7)}`);
  const titles = ag.items.map((x) => x.title);
  assert.ok(titles.some((t) => /판교 피트니스/.test(t)), JSON.stringify(titles));
  assert.ok(titles.includes('입찰 마감 · 체육시설 위탁운영'), JSON.stringify(titles));
  assert.ok(!titles.some((t) => /미참여로 정리한 공고|상태 문구 다른/.test(t)), '작업 안 하는 공고는 안 넣음');
  assert.ok(ag.items.every((x) => x.space === 'sales'));
  assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/spaces/agenda')).items, [], '공간 없는 직원은 빈 목록');
  assert.deepEqual(b.items[1].classification, '적합');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.length, 7);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.length, 2);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).items[0].households, 1200);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items[0].contact, '연락함');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=vendors')).items[0].rank, 3);
  const r = await ctx.owner.ok('GET', '/api/sales/src?view=regions');
  assert.deepEqual(r.regions.map((x) => x.region), ['경기', '서울', '부산', '지역 미정'].filter(Boolean).sort((a, b) => (a === '지역 미정' ? 1 : b === '지역 미정' ? -1 : 0)), JSON.stringify(r.regions));
  assert.equal((await ctx.staffA.client.req('GET', '/api/sales/src?view=leads')).status, 404, '공간 미배정 직원');
  // 입찰·공고 선택 기능: 끄면 화면 404·현황 카드 숨김 표시, 직원은 못 바꿈, null = 기본(켜짐)
  assert.deepEqual(await ctx.owner.ok('GET', '/api/sales/options'), { bids: true, bidsAuto: true, canEdit: true });
  await ctx.owner.ok('PUT', '/api/sales/options', { bids: false });
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=bids')).status, 404);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=summary')).bidsOn, false);
  await ctx.owner.ok('PUT', '/api/sales/options', { bids: null });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=summary')).bidsOn, true);
});
