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
  // S1-3(로컬 10/20): 감사에 적힌 원본 실제 칸 이름으로 심음 — source_type(9값)·fit_business·household_count·notice_type·winner_amount
  await put('global', 'procurement_notices', { id: 11, title: '체육시설 위탁운영', issuer: '성남시', related: true, first_seen_at: today, created_at: today, deadline_at: `${plus(5)}T10:00:00`, current_status: '공고중', fit_score: 82, source_type: 'g2b_bid', fit_business: 'dagym', household_count: 500, notice_type: '용역' });
  // 영업관리 기준(10/19): 신규 판단은 first_seen_at — 공고일·created_at 이 오늘이어도 first_seen 이 30일 전이면 '최근 7일 새 공고'가 아님
  // #476 b(로컬 10/23): '오늘' 탭 = 공고일 오늘 OR 처음 본 날 오늘 → 공고일이 오늘이 된 옛 공고(정정·재공고)는 '공고일 오늘·M/D 처음 수집' 배지로 오늘 탭에
  await put('global', 'procurement_notices', { id: 14, title: '예전 공고(first_seen 30일 전)', related: true, first_seen_at: `${plus(-30)}T01:00:00+09:00`, notice_date: today, created_at: today, deadline_at: `${plus(3)}T10:00:00`, current_status: '공고중' });
  await put('global', 'procurement_notices', { id: 13, title: '낙찰된 공고', related: true, first_seen_at: plus(-30), deadline_at: `${plus(-10)}T10:00:00`, current_status: '낙찰', source_type: 'kapt_bid', winner_name: '좋은업체', winner_amount: 123000000 });
  await put('global', 'procurement_notices', { id: 19, title: '협력사 모집 공고', related: true, first_seen_at: plus(-1), deadline_at: `${plus(12)}T10:00:00`, current_status: '공고중', source_type: 'vendor_recruit', fit_business: 'both', posted_checked: true });
  // #476 후속(로컬 10/23): 수집기가 게시판 날짜로 확인하지 않은 협력사 줄(예전 방식·안내문 조각·메뉴)은 목록·오늘 탭에서 빠짐
  await put('global', 'procurement_notices', { id: 20, title: '[대방건설] 개요 CEO 인사말 연혁 조직도 오시는길 협력업체등록', related: true, first_seen_at: today, posted_date: today, deadline_at: `${plus(12)}T10:00:00`, current_status: '공고중', source_type: 'vendor_recruit', classification: '즉시 검토' });
  await put('global', 'procurement_notices', { id: 12, title: '관계없는 공고', related: false, posted_at: today });
  // 운영 10/19: 진행 중 탭 0건(현황은 31) — 원본 상태 문구가 '공고중'이 아닌 진행 공고, 미참여로 정리한 공고, 사전규격
  await put('global', 'procurement_notices', { id: 15, title: '상태 문구 다른 진행 공고', related: true, first_seen_at: plus(-2), deadline_at: `${plus(8)}T10:00:00`, current_status: '입찰진행' });
  await put('global', 'procurement_notices', { id: 16, title: '미참여로 정리한 공고', related: true, first_seen_at: plus(-2), deadline_at: `${plus(9)}T10:00:00`, current_status: '공고중' });
  await put('default', 'opportunity_work', { id: 'W2', notice_id: '16', status: '미참여' });
  await put('global', 'procurement_notices', { id: 18, title: '오늘 이미 지난 마감', related: true, first_seen_at: plus(-2), deadline_at: `${today} 00:01`, current_status: '공고중' });
  await put('global', 'procurement_notices', { id: 17, title: '사전규격 공고', related: true, source: 'g2b_pre', first_seen_at: plus(-2), deadline_at: `${plus(10)}T10:00:00` });
  await put('default', 'procurement_notices__progress', { id: 11, classification: '적합' });
  await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지', household_count: 1200, address: '경기 성남', current_stage: '착공', sales_priority: '높음', source_url: 'https://example.com/approval/1', attachment_urls: ['https://www.g2b.go.kr/files/b1.pdf'], is_estimated: true });
  await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', score: 88, household_count: 900, facility_scale: 1500, facility_scale_unit: '㎡', completion_date: '2024-05-13', move_in_date: plus(-10), etl_suggested_next_action: '관리사무소 전화' });
  await put('default', 'operating_facility_prospects__progress', { id: 'F1', contact_status: '연락함', notes: '통화 완료', next_action: '견적 보내기' });
  await put('global', 'operating_facility_prospects', { id: 'F2', name: '수집기 제안만 있는 시설', score: 10, household_count: 100, completion_date: plus(-3), etl_suggested_next_action: '관리사무소 전화' });
  await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리', rank: 3, recruit_visibility: '회원 공개', recruit_timing: '연중', cert_required: '필요', register_url: 'https://example.com/register', recruit_url: 'https://example.com/recruit' });
  await sql`insert into sales_user_map (tenant, src_user_id, user_id, name, matched) values ('default', 'P1', ${ctx.ownerId}, '대표', true)`;
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('영업 공간 화면', async () => {
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=summary')).status, 404, '영업 공간 꺼짐');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const s = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
  assert.equal(s.readOnly, true); assert.equal(s.imported, true);
  assert.deepEqual([s.kpi.leads, s.kpi.dueSoon, s.kpi.overdue, s.kpi.bidsWorking, s.kpi.relatedNotices, s.kpi.newNotices7d], [4, 1, 1, 1, 8, 1], JSON.stringify(s.kpi));
  assert.equal(s.today.newNotices, 2, '오늘 새 공고 = 오늘 탭과 같은 기준(처음 본 날 오늘 + 공고일 오늘)');
  assert.equal(s.today.date, today); assert.equal(s.bidsOn, true);
  const todayTab = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=today')).items;
  assert.deepEqual(todayTab.map((n) => [n.title, n.todayLabel]), [['체육시설 위탁운영', null], ['예전 공고(first_seen 30일 전)', `공고일 오늘·${Number(plus(-30).slice(5, 7))}/${Number(plus(-30).slice(8, 10))} 처음 수집`]]);
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
  assert.deepEqual(b.items.map((n) => n.title), ['예전 공고(first_seen 30일 전)', '체육시설 위탁운영', '상태 문구 다른 진행 공고', '협력사 모집 공고'], '마감 임박순 · 낙찰·미참여·사전규격 제외 · 상태 문구 달라도 진행');
  // S1-3: 원본 칸 이름 그대로 읽힘 — 출처 라벨(source_type)·사업 배지(fit_business)·세대(household_count)·업종(notice_type)·낙찰 금액(winner_amount)·협력사 모집 배지/탭
  assert.deepEqual([b.items[1].sourceLabel, b.items[1].business, b.items[1].households, b.items[1].industry, b.items[1].vendorRecruit], ['나라장터', 'dagym', 500, '용역', false]);
  assert.deepEqual([b.items[3].sourceLabel, b.items[3].business, b.items[3].vendorRecruit], ['협력사 모집', 'both', true]);
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=recruit')).items.map((n) => n.title), ['협력사 모집 공고']);
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
  const all = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all');
  assert.equal(all.items.length, 8);
  assert.deepEqual([all.items.find((n) => n.title === '낙찰된 공고').sourceLabel, all.items.find((n) => n.title === '낙찰된 공고').winner, all.items.find((n) => n.title === '낙찰된 공고').awardAmount], ['K-apt', '좋은업체', 123000000]);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.length, 2);
  // S1-3: 신규단지 current_stage·sales_priority·household_count·source_url·첨부·추정치, 시설 facility_scale(+unit)·completion_date·__progress.next_action/notes·etl_suggested_next_action·경과일, 협력사 recruit_visibility/timing·cert_required·register_url·recruit_url
  const bd = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).items[0];
  assert.deepEqual([bd.households, bd.status, bd.priority, bd.url, bd.attachments, bd.estimated, bd.dates.find(([k]) => k === '세대수')[1]], [1200, '착공', '높음', 'https://example.com/approval/1', ['https://www.g2b.go.kr/files/b1.pdf'], true, 1200]);
  const fc = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items;
  const f1 = fc.find((x) => x.name === '수원 아파트 커뮤니티'), f2 = fc.find((x) => x.name === '수집기 제안만 있는 시설');
  assert.deepEqual([f1.contact, f1.households, f1.scale, f1.date, f1.lastNote, f1.nextAction, f1.nextActionFrom, f1.elapsedDays], ['연락함', 900, '1500㎡', '2024-05-13', '통화 완료', '견적 보내기', '진행 기록', 10], '회사 진행 기록이 수집기 제안보다 먼저');
  assert.deepEqual([f2.nextAction, f2.nextActionFrom, f2.elapsedDays], ['관리사무소 전화', '수집기 제안', 3]);
  const vd = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=vendors')).items[0];
  assert.deepEqual([vd.rank, vd.open, vd.period, vd.cert, vd.applyUrl, vd.url], [3, '회원 공개', '연중', '필요', 'https://example.com/register', 'https://example.com/recruit']);
  const r = await ctx.owner.ok('GET', '/api/sales/src?view=regions');
  assert.deepEqual(r.regions.map((x) => x.region), ['경기', '서울', '부산', '지역 미정'].filter(Boolean).sort((a, b) => (a === '지역 미정' ? 1 : b === '지역 미정' ? -1 : 0)), JSON.stringify(r.regions));
  assert.equal((await ctx.staffA.client.req('GET', '/api/sales/src?view=leads')).status, 404, '공간 미배정 직원');
  // 입찰·공고 선택 기능: 끄면 화면 404·현황 카드 숨김 표시, 직원은 못 바꿈, null = 기본(켜짐)
  const opt = await ctx.owner.ok('GET', '/api/sales/options');
  assert.deepEqual([opt.bids, opt.bidsAuto, opt.canEdit, opt.template.code], [true, true, true, 'facility'], '#408 첫 회사는 시드로 시설 템플릿');
  await ctx.owner.ok('PUT', '/api/sales/options', { bids: false });
  assert.equal((await ctx.owner.req('GET', '/api/sales/src?view=bids')).status, 404);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=summary')).bidsOn, false);
  await ctx.owner.ok('PUT', '/api/sales/options', { bids: null });
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=summary')).bidsOn, true);
});
test('#605~#613(대표 10/25) 허브 정렬·필터(지역·세대수·기간)·회사가 켠 탭 · 입찰 정렬·오늘 새 공고 건수', async () => {
  const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  await put('global', 'operating_facility_prospects', { id: 'F3', name: '정렬 시험 시설', household_count: 2000, completion_date: plus(-60), move_in_date: plus(-45), region: '서울', first_seen_at: plus(-50) });
  const h = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities');
  assert.deepEqual(h.items.map((x) => x.id), ['F3', 'F1', 'F2'], '기본 = 세대수 많은 순');
  assert.deepEqual([h.box, h.sort, h.archiveCount, h.regions], ['open', null, 0, ['서울']]);
  assert.ok(['buildings', 'facilities', 'vendors', 'prospects', 'regions'].every((k) => h.tabs.includes(k)), JSON.stringify(h.tabs));
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities&sort=completion')).items.map((x) => x.id), ['F1', 'F3', 'F2'], '준공일순(?sort=)');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities&sort=elapsed')).items.map((x) => x.id), ['F3', 'F1', 'F2'], '경과일 긴 순');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities&hh=1000')).items.map((x) => x.id), ['F3'], '세대수 1,000 이상');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities&region=서울')).items.map((x) => x.id), ['F3'], '지역');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities&period=1')).items.map((x) => x.id), ['F1', 'F2'], '기간 = 오늘 앞뒤 1개월(준공·입주·DB 등록)');
  const bd = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings&region=성남&sort=households');
  assert.deepEqual(bd.items.map((x) => x.id), ['B1'], '지역 필터는 주소에도'); assert.equal(bd.sort, 'households');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings&hh=2000')).items, [], '세대수 미달');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=vendors&sort=rank')).items.map((x) => x.id), ['V1']);
  // 입찰: 정렬 메뉴(마감 D-day·공고일·예산) + '오늘 새 공고 n' 칩 건수(= 오늘 탭, 검색어 무관)
  const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&sort=amount');
  assert.equal(b.sort, 'amount'); assert.equal(b.todayCount, 2, '오늘 새 공고 건수 = 오늘 탭');
  const amounts = b.items.map((n) => Number(n.amount) || 0); assert.deepEqual(amounts, [...amounts].sort((x, y) => y - x), '예산 큰 순');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all&sort=notice')).sort, 'notice');
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all&sort=weird')).sort, null, '모르는 정렬은 기본');
  // #611 허브 탭 = 회사가 켠 수집 DB 종류: 시설 수집기를 모두 끄면 '준공·입주 시설' 탭이 빠지고, 하나라도 켜면 다시 보임
  const FAC = ['kicox_industrial_complexes', 'public_sports_facilities', 'tourist_hotels_localdata', 'reb_recent_complexes', 'operating_from_kapt', 'kapt_sa_sun'];
  for (const slug of FAC) await ctx.owner.ok('PUT', '/api/sales/collectors', { slug, enabled: false });
  assert.ok(!(await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).tabs.includes('facilities'), '시설 수집기 전부 끄면 탭 숨김');
  await ctx.owner.ok('PUT', '/api/sales/collectors', { slug: 'reb_recent_complexes', enabled: true });
  assert.ok((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).tabs.includes('facilities'), '하나라도 켜면 보임');
  for (const slug of FAC) await ctx.owner.ok('PUT', '/api/sales/collectors', { slug, enabled: true });
  // 공공데이터: 원천을 골랐다가 전부 끄면 숨김(고른 적 없으면 안내용으로 보임)
  const [ds] = await sql`select code from data_sources order by code limit 1`;
  if (ds) {
    await sql`insert into tenant_data_sources (tenant, source_code, enabled) values ('default', ${ds.code}, false) on conflict (tenant, source_code) do update set enabled = false`;
    assert.ok(!(await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).tabs.includes('prospects'), '공공데이터 원천 전부 끄면 탭 숨김');
    await sql`delete from tenant_data_sources where tenant = 'default' and source_code = ${ds.code}`;
  }
  assert.ok((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).tabs.includes('prospects'));
  await sql`delete from sales_src_rows where src_id = 'F3'`;
});
