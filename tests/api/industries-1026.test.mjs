// 범용화 3단계 '가입 업종·시작 템플릿'(대표 11/13 승인 — docs/generalization-audit.md G-09·G-10·G-35):
// G-09 가입 업종에 '외식·카페'·'학원·교습'·'시설관리·용역' 추가 + 업종별 시작 템플릿
// G-10 영업 용어 묶음 자동 판정: '건설·시설관리'·'시설관리·용역' 회사가 아파트 위탁 운영 용어(단지명·관리사무소)를 받지 않는다
// G-35 추가 업종의 시작 템플릿도 함께(같은 이름은 한 번만)
// 기본 회사(다짐)는 업종 목록 12개·영업 용어 판정이 예전과 같아야 한다
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
const NEW3 = ['외식·카페', '학원·교습', '시설관리·용역'];
async function join(email, company, industry, industries = []) {
  await sql`delete from signup_attempts`; // 한 주소에서 연달아 가입하면 막히는 보호 장치 — 시험에서는 매번 비운다
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name: '새대표', mode: 'team', company, industry, industries, agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  assert.ok(me.user.tenant && me.user.tenant !== 'default');
  return { c, tenant: me.user.tenant };
}
const tplNames = async (tenant) => (await sql`select name from templates where tenant = ${tenant} order by created_at, name`).map((x) => x.name);
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('범용화 3단계 가입 업종·시작 템플릿', () => {
  test('G-09 새 업종 3개로 가입: 업종이 저장되고 업종별 시작 템플릿이 생긴다 · 목록에 없는 업종은 400', async () => {
    const cafe = await join('ceo@cafe-1026.test', '모퉁이카페', '외식·카페');
    assert.deepEqual(new Set(await tplNames(cafe.tenant)), new Set(['오픈 준비', '식자재 발주', '위생 점검']));
    const school = await join('ceo@school-1026.test', '새싹학원', '학원·교습');
    assert.deepEqual(new Set(await tplNames(school.tenant)), new Set(['신규 수강 상담', '결석·보강 안내', '월 수강료 안내']));
    const fm = await join('ceo@fm-1026.test', '든든시설', '시설관리·용역');
    assert.deepEqual(new Set(await tplNames(fm.tenant)), new Set(['정기 순회 점검', '수리·민원 접수', '월간 용역 보고']));
    const [t] = await sql`select industry, industries from tenants where id = ${cafe.tenant}`;
    assert.deepEqual([t.industry, t.industries], ['외식·카페', ['외식·카페']]);
    // 시작 템플릿 내용: 체크리스트가 들어 있고 회사 공용(개인 아님)
    const [p] = await sql`select payload, personal from templates where tenant = ${cafe.tenant} and name = '식자재 발주'`;
    assert.equal(p.personal, false); assert.deepEqual(p.payload.checklist, ['재고 세기', '발주 품목·수량 정하기', '거래처에 발주', '입고 확인·유통기한 표시']); assert.equal(p.payload.dueInDays, 2);
    // 새 회사의 회사 정보 화면: 고를 수 있는 업종에 3개가 있고 저장도 된다
    const prof = await cafe.c.ok('GET', '/api/org/ai-profile');
    for (const x of NEW3) assert.ok(prof.industryOptions.includes(x), x);
    assert.equal(prof.industryOptions.at(-1), '기타', "'기타'는 맨 끝");
    const saved = await cafe.c.ok('PUT', '/api/org/ai-profile', { industries: ['외식·카페', '학원·교습'] });
    assert.deepEqual(saved.industries, ['외식·카페', '학원·교습']);
    assert.equal((await cafe.c.req('PUT', '/api/org/ai-profile', { industries: ['없는업종'] })).status, 400);
  });

  test('G-35 추가 업종의 시작 템플릿도 생긴다(주 업종 먼저, 같은 이름은 한 번만)', async () => {
    const both = await join('ceo@both-1026.test', '카페학원', '외식·카페', ['학원·교습', '외식·카페']);
    const names = await tplNames(both.tenant);
    assert.equal(names.length, 6, names.join(','));
    assert.deepEqual(new Set(names), new Set(['오픈 준비', '식자재 발주', '위생 점검', '신규 수강 상담', '결석·보강 안내', '월 수강료 안내']));
    // '기타'만 고르면 0개(예전과 같음)
    const etc = await join('ceo@etc-1026.test', '그밖의회사', '기타');
    assert.deepEqual(await tplNames(etc.tenant), []);
  });

  test('G-10 영업 용어 묶음 자동 판정: 건설·시설관리 = 건설 묶음, 시설관리·용역·외식·학원 = 일반(단지·관리사무소 없음), 운동·피트니스 = 시설 묶음 그대로', async () => {
    const pick = async (email, company, industry, industries = []) => { const x = await join(email, company, industry, industries); await x.c.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true }); return (await x.c.ok('GET', '/api/sales/options')); };
    const con = await pick('ceo@con-1026.test', '튼튼건설', '건설·시설관리');
    assert.deepEqual([con.template.code, con.template.auto, con.terms.kind.building], ['construction', true, '신규 현장']);
    assert.equal(con.terms.unitName, '현장명'); assert.notEqual(con.terms.office, '관리사무소'); // 아파트 위탁 운영 묶음(단지명·관리사무소)이 아님
    for (const [i, ind] of NEW3.entries()) {
      const o = await pick(`ceo@gen${i}-1026.test`, `일반회사${i}`, ind);
      assert.deepEqual([o.template.code, o.template.auto], ['general', true], ind);
      assert.ok(!JSON.stringify(o.terms).includes('관리사무소') && !JSON.stringify(o.terms).includes('단지'), ind);
    }
    const gym = await pick('ceo@gym-1026.test', '튼튼짐', '운동·피트니스', ['건설·시설관리']);
    assert.equal(gym.template.code, 'facility', '주 업종(앞에 적힌 것)이 먼저');
    const it = await pick('ceo@it-1026.test', '코드공방', 'IT·소프트웨어', ['운동·피트니스']);
    assert.equal(it.template.code, 'it');
  });

  test('다짐(기본 회사)은 그대로: 회사 정보 화면의 업종 목록 12개(새 3개 없음) · 영업 용어 판정은 예전 순서', async () => {
    const prof = await ctx.owner.ok('GET', '/api/org/ai-profile');
    assert.equal(prof.industryOptions.length, 12, prof.industryOptions.join(','));
    for (const x of NEW3) assert.ok(!prof.industryOptions.includes(x), x);
    assert.equal(prof.industryOptions.at(-1), '기타');
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
    // 시드 = 'facility' 고정(자동 아님)
    let o = await ctx.owner.ok('GET', '/api/sales/options');
    assert.deepEqual([o.template.code, o.template.auto, o.terms.unitName, o.terms.office], ['facility', false, '단지명', '관리사무소']);
    // 자동 판정으로 돌려도 예전 순서 그대로: '건설·시설관리'는 예전처럼 시설 묶음(시설·관리 낱말이 먼저 걸림)
    const before = await sql`select industry, industries, sales_template from tenants where id = 'default'`;
    try {
      await sql`update tenants set industries = array['건설·시설관리'] where id = 'default'`;
      o = await ctx.owner.ok('PUT', '/api/sales/options', { template: null });
      assert.deepEqual([o.template.code, o.template.auto], ['facility', true]);
    } finally {
      await sql`update tenants set industry = ${before[0].industry}, industries = ${before[0].industries}, sales_template = ${before[0].sales_template} where id = 'default'`;
    }
    o = await ctx.owner.ok('GET', '/api/sales/options');
    assert.deepEqual([o.template.code, o.template.auto], ['facility', false]);
  });
});
