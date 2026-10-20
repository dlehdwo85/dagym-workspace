// S1-2(로컬 10/20 최우선): 공용 수집 데이터 진행 기록 쓰기 — 전환 전 409 · 입찰(상태 버튼 미검토~대상아님·메모·다음 연락일, 처음 메모 → 검토중) · 시설(미연락~대상아님) · 협력사(미등록~대상 아님) ·
// 화면(bids·hub)이 정식 표를 읽음 · [진행영업으로 넘기기](비슷한 리드 → similar, force → 리드 생성·연결·'진행영업 전환'·리드 상세 입찰 탭) · 제안·계약 등록 → 제안·계약 화면·리드 상세 · 남의 회사 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await put('global', 'procurement_notices', { id: 'N1', title: '성남시 체육시설 위탁운영', complex_name: '분당 스포츠센터', issuer: '성남시청', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T10:00:00`, current_status: '공고중', office_phone: '031-1' });
  await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지', households: 1200, region: '경기', status: '영업 전', first_seen_at: today });
  await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', households: 1500, facility_type: '아파트', region: '경기', office_phone: '031-2', first_seen_at: today });
  await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리(주)', category: '종합관리', first_seen_at: today });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('S1-2 진행 기록 쓰기', () => {
  test('전환 전(writes_open=false)에는 409, 없는 대상은 404', async () => {
    assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '검토중' })).status, 409);
    await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
    assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'bid', id: 'NOPE', status: '검토중' })).status, 404);
    assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '이상한상태' })).status, 400);
  });
  test('입찰: 처음 메모 → 미검토가 검토중으로, 상태 버튼·다음 연락일 저장, 화면(bids)이 정식 표를 읽음', async () => {
    const r1 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', memo: '현장 설명회 참석 예정' });
    assert.equal(r1.status, '검토중', '처음 메모 → 검토중');
    const r2 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '연락중', nextDate: addDays(today, 3) });
    assert.deepEqual([r2.status, r2.memo, r2.nextDate], ['연락중', '현장 설명회 참석 예정', addDays(today, 3)], '메모는 유지');
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working');
    const n = b.items.find((x) => x.id === 'N1');
    assert.ok(n, '진행 기록 있음 탭에 보임'); assert.deepEqual([n.work, n.workMemo, n.workNext], ['연락중', '현장 설명회 참석 예정', addDays(today, 3)]);
    assert.equal(b.readOnly, false);
    const [w] = await sql`select src_tbl, ref_id, status, data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work'`;
    assert.deepEqual([w.ref_id, w.status, w.data.notice_id, w.data.memo], ['N1', '연락중', 'N1', '현장 설명회 참석 예정'], '원본 칸 이름 그대로 저장');
    const r3 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '미참여' });
    assert.equal(r3.status, '미참여'); assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open')).items.some((x) => x.id === 'N1'), false, '미참여는 진행 중에서 빠짐');
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '연락중' });
  });
  test('시설(연락 상태)·협력사(등록 상태)·신규단지 — 허브 화면에 반영', async () => {
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'facility', id: 'F1', status: '연락중', memo: '소장 통화', nextDate: addDays(today, 2) });
    const f = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items.find((x) => x.id === 'F1');
    assert.deepEqual([f.contact, f.lastNote, f.next], ['연락중', '소장 통화', addDays(today, 2)]);
    assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'facility', id: 'F1', status: '검토중' })).status, 400, '시설 상태 목록 밖');
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'vendor', id: 'V1', status: '신청 준비', memo: '서류 준비' });
    const v = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=vendors')).items.find((x) => x.id === 'V1');
    assert.deepEqual([v.status, v.memo], ['신청 준비', '서류 준비']);
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'building', id: 'B1', status: '검토중', memo: '시행사 접촉' });
    const bd = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).items.find((x) => x.id === 'B1');
    assert.deepEqual([bd.work.status, bd.work.memo], ['검토중', '시행사 접촉']);
  });
  test('진행영업으로 넘기기: 비슷한 리드 → similar, force → 리드 생성·연결·전환됨·리드 상세 입찰 탭·더 못 고침', async () => {
    await ctx.owner.ok('POST', '/api/sales/leads', { name: '분당스포츠센터 관리단', region: '경기' });
    const s = await ctx.owner.ok('POST', '/api/sales/work/convert', { kind: 'bid', id: 'N1' });
    assert.ok(s.similar?.length === 1 && s.similar[0].name === '분당스포츠센터 관리단', '비슷한 이름 안내');
    const c = await ctx.owner.ok('POST', '/api/sales/work/convert', { kind: 'bid', id: 'N1', force: true });
    assert.ok(c.leadId);
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${c.leadId}`);
    assert.equal(d.lead.name, '분당 스포츠센터'); assert.equal(d.work.length, 1); assert.equal(d.work[0].status, '진행영업 전환');
    const n = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.find((x) => x.id === 'N1');
    assert.deepEqual([n.work, n.workLeadId], ['진행영업 전환', c.leadId]);
    assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '보류' })).status, 400, '넘긴 건은 리드에서');
    assert.equal((await ctx.owner.ok('POST', '/api/sales/work/convert', { kind: 'bid', id: 'N1' })).already, true);
    // 시설도 넘기기(비슷한 이름 없음 → 바로)
    const c2 = await ctx.owner.ok('POST', '/api/sales/work/convert', { kind: 'facility', id: 'F1' });
    assert.ok(c2.leadId); assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items.find((x) => x.id === 'F1').contact, '진행영업 전환');
  });
  test('제안·계약 등록 → 제안·계약 화면(리드 이름)·리드 상세 · 담당 아닌 직원 403 · 다른 회사 404', async () => {
    const lead = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((l) => l.name === '분당 스포츠센터');
    const p = await ctx.owner.ok('POST', `/api/sales/leads/${lead.id}/records`, { kind: 'proposals', title: '위탁운영 제안서 v1', amount: 385000000, date: today });
    assert.ok(p.id);
    await ctx.owner.ok('POST', `/api/sales/leads/${lead.id}/records`, { kind: 'contracts', title: '위탁운영 계약', amount: 360000000 });
    const deals = await ctx.owner.ok('GET', '/api/sales/src?view=deals');
    assert.deepEqual([deals.proposals[0].title, deals.proposals[0].lead_name, deals.contracts[0].title], ['위탁운영 제안서 v1', '분당 스포츠센터', '위탁운영 계약']);
    assert.ok(deals.leads.some((l) => l.id === lead.id), '등록 폼용 리드 목록');
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${lead.id}`);
    assert.deepEqual([d.proposals.length, d.contracts.length], [1, 1]);
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true, memberIds: [ctx.staffA.id] }).catch(() => {});
    const st = await ctx.staffA.client.req('POST', `/api/sales/leads/${lead.id}/records`, { kind: 'proposals', title: '남의 리드' });
    assert.ok([403, 404].includes(st.status), `담당 아닌 직원 ${st.status}`);
    assert.equal((await ctx.owner.req('POST', '/api/sales/leads/00000000-0000-0000-0000-000000000000/records', { kind: 'proposals', title: 'x' })).status, 404);
  });
});
