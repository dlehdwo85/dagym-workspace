// 413차(범용화 — 영업 자료 노출 막기): 옛 영업관리에서 옮겨 온 '신규 현장'(building_sales_pipeline)·'협력사 등록'(vendor_registrations)은
// 기본 회사(다짐)가 직접 모은 자료다. 공용 표(scope='global')에 들어 있어 다른 회사가 영업 공간을 켜면 그대로 보였다.
// → 다른 회사: 탭 목록·목록·영업 홈 숫자·지역별 표·진행 기록 저장·리드로 넘기기 어디에도 나오지 않는다(없는 것처럼 404·빈 목록)
// → 수집기가 채우는 공용 자료(준공·입주 시설)는 그대로 보인다
// → 기본 회사는 탭·목록·숫자·진행 기록이 예전과 같다
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, ctx, sql, other;
const today = seoulToday();
const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
const SECRET = ['판교 새단지', '좋은관리(주)'];
const clean = (label, body) => { for (const w of SECRET) assert.ok(!JSON.stringify(body).includes(w), `${label}: "${w}" 가 응답에 있음`); };

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지', households: 1200, region: '경기', status: '영업 전', first_seen_at: today });
  await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리(주)', category: '종합관리', region: '서울', first_seen_at: today });
  await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', households: 1500, facility_type: '아파트', region: '경기', office_phone: '031-2', first_seen_at: today });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  // 다른 회사(공개 가입) — 영업 공간을 켠다
  const c = new Client('ceo@moved-1026.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@moved-1026.test', password: 'signup-pass-1234', name: '새대표', mode: 'team', company: '든든시설', industry: '시설관리·용역', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  assert.ok(me.user.tenant && me.user.tenant !== 'default');
  await c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  other = { c, tenant: me.user.tenant, id: me.user.id };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('413차 옮겨 온 신규 현장·협력사 등록은 기본 회사만', () => {
  test('다른 회사: 탭 목록에 없고, 주소를 직접 넣어도 빈 목록 — 이름이 어디에도 없다', async () => {
    const b = await other.c.ok('GET', '/api/sales/src?view=hub&tab=buildings');
    assert.deepEqual([b.items.length, b.total, b.archiveCount], [0, 0, 0]);
    assert.ok(!b.tabs.includes('buildings') && !b.tabs.includes('vendors'), b.tabs.join(','));
    assert.ok(b.tabs.includes('facilities') && b.tabs.includes('regions'), '공용 자료 탭은 그대로');
    clean('신규 현장 탭', b);
    const v = await other.c.ok('GET', '/api/sales/src?view=hub&tab=vendors');
    assert.deepEqual([v.items.length, v.total], [0, 0]); clean('협력사 등록 탭', v);
    // 찾기(검색어)·보관함·그날 새 자료로도 안 나온다
    for (const qs of ['tab=buildings&q=판교', 'tab=buildings&box=archive', 'tab=buildings&day=today', 'tab=vendors&q=좋은관리', 'tab=vendors&day=today']) {
      const r = await other.c.ok('GET', `/api/sales/src?view=hub&${qs}`);
      assert.equal(r.items.length, 0, qs); clean(qs, r);
      assert.ok((r.days ?? []).every((d) => d.n === 0), `${qs}: 날짜별 건수도 0`);
    }
    // 수집기가 채우는 공용 자료(준공·입주 시설)는 그대로 보인다
    const f = await other.c.ok('GET', '/api/sales/src?view=hub&tab=facilities');
    assert.ok(f.items.some((x) => x.id === 'F1'), '시설은 보임');
  });

  test('다른 회사: 영업 홈 숫자·진행 현황표·지역별 표에도 없다', async () => {
    const s = await other.c.ok('GET', '/api/sales/src?view=summary');
    assert.deepEqual([s.tiles.buildings, s.tiles.vendors], [0, 0]);
    assert.equal(s.tiles.facilities, 1, '시설 수는 그대로');
    assert.deepEqual(s.today.newDb, { buildings: 0, facilities: 1, vendors: 0 });
    assert.equal(s.progress.length, 2, '진행 현황표는 입찰·시설 두 줄');
    assert.deepEqual(s.todo.vendors, []); clean('영업 홈', s);
    const rg = await other.c.ok('GET', '/api/sales/src?view=regions');
    assert.ok(rg.matrix.every((r) => r.buildings === 0), JSON.stringify(rg.matrix));
    assert.ok(rg.matrix.some((r) => r.region === '경기' && r.facilities === 1), '시설 지역 수는 그대로');
    clean('지역별', rg);
  });

  test('다른 회사: 진행 기록 저장·한꺼번에 저장·리드로 넘기기·영업 담당에게 넘기기 모두 404(없는 것처럼), 기록도 안 남는다', async () => {
    for (const [kind, id] of [['building', 'B1'], ['vendor', 'V1']]) {
      const st = kind === 'building' ? '검토중' : '신청 준비';
      assert.equal((await other.c.req('POST', '/api/sales/work', { kind, id, status: st, memo: '메모' })).status, 404, `${kind} 저장`);
      assert.equal((await other.c.req('POST', '/api/sales/work/convert', { kind, id, force: true })).status, 404, `${kind} 리드로`);
      assert.equal((await other.c.req('POST', '/api/sales/work/handoff', { kind, id, assigneeIds: [other.id] })).status, 404, `${kind} 넘기기`);
      const bulk = await other.c.req('POST', '/api/sales/work/bulk', { kind, ids: [id], status: st });
      if (bulk.status === 200) assert.ok(bulk.body.results.every((x) => !x.ok), `${kind} 한꺼번에 저장`); else assert.ok([400, 404].includes(bulk.status));
    }
    const [n] = await sql`select count(*)::int as n from sales_work_records where tenant = ${other.tenant}`;
    assert.equal(n.n, 0, '진행 기록 없음');
    const [l] = await sql`select count(*)::int as n from sales_leads where tenant = ${other.tenant}`;
    assert.equal(l.n, 0, '리드 없음');
    // 공용 자료(시설)는 다른 회사도 예전처럼 진행 기록을 남길 수 있다
    const ok = await other.c.ok('POST', '/api/sales/work', { kind: 'facility', id: 'F1', status: '연락중', memo: '통화함' });
    assert.equal(ok.status, '연락중');
  });

  test('기본 회사(다짐)는 그대로: 탭 7개·목록·영업 홈 숫자·진행 현황표 네 줄·지역별 표·진행 기록 저장', async () => {
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings');
    assert.ok(b.tabs.includes('buildings') && b.tabs.includes('vendors'), b.tabs.join(','));
    const b1 = b.items.find((x) => x.id === 'B1');
    assert.deepEqual([b1.name, b.total], ['판교 새단지', 1]);
    const v = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=vendors');
    assert.deepEqual([v.items.find((x) => x.id === 'V1').name, v.total], ['좋은관리(주)', 1]);
    const s = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
    assert.deepEqual([s.tiles.buildings, s.tiles.facilities, s.tiles.vendors], [1, 1, 1]);
    assert.deepEqual(s.today.newDb, { buildings: 1, facilities: 1, vendors: 1 });
    assert.equal(s.progress.length, 4, '진행 현황표 네 줄');
    const rg = await ctx.owner.ok('GET', '/api/sales/src?view=regions');
    assert.ok(rg.matrix.some((r) => r.region === '경기' && r.buildings === 1 && r.facilities === 1), JSON.stringify(rg.matrix));
    const w = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'building', id: 'B1', status: '검토중', memo: '분양 일정 확인' });
    assert.equal(w.status, '검토중');
    const w2 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'vendor', id: 'V1', status: '신청 준비' });
    assert.equal(w2.status, '신청 준비');
    const after = await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings');
    const b1b = after.items.find((x) => x.id === 'B1');
    assert.deepEqual([b1b.work.status, b1b.work.memo, b1b.status], ['검토중', '분양 일정 확인', '영업 전'], '목록에 진행 상태 반영(원본 단계 칸은 그대로)');
    // 다짐이 남긴 진행 기록은 다른 회사 화면에 여전히 없다
    clean('다른 회사 신규 현장 탭(다짐 기록 뒤)', await other.c.ok('GET', '/api/sales/src?view=hub&tab=buildings'));
    clean('다른 회사 영업 홈(다짐 기록 뒤)', await other.c.ok('GET', '/api/sales/src?view=summary'));
  });
});
