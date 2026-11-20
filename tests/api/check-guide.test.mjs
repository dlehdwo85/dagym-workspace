// 점검 1단계 — 점검 가이드(분야 · 공간 유형 · 공간 · 점검 항목 · 개정 이력 · 직원 공유)
// 대표 11/19 "점검 개발 시작" (docs/check-feature-design.md · docs/reference/prompt-b-check-feature.md)
//  · 권한: 가이드 편집 = 대표·관리자, 보기 = 현장 관리자, 직원은 가이드가 없는 것처럼(404) — 직원은 '직원 공유' 표시된 양호 기준만
//  · 회사 분리: 다른 회사의 분야·공간·항목은 목록에 없고 주소를 알아도 404, 내 항목에 남의 분야·조직을 걸 수도 없음
//  · 개정 이력: 내용을 고치면 판이 오르고 까닭과 함께 남음(사용 여부만 바꾼 것은 개정이 아님)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, other;
const S = {}; // 시험 사이에 넘기는 id
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@check-guide.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@check-guide.test', password: 'signup-pass-1234', name: '김사장', mode: 'team', company: '모퉁이커피', industry: '외식·카페', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  other = { c, tenant: me.user.tenant, unit: me.orgUnits[0].id };
  assert.ok(other.tenant && other.tenant !== 'default');
  // 이 파일은 손으로 만든 자료만 본다 — 템플릿(가입 때·처음 열 때 자동 설치)은 check-templates.test.mjs 에서.
  // 기본 회사는 '이미 설치함'으로 표시해 자동 설치를 건너뛰고, 가입한 회사는 설치된 템플릿 자료를 비워 빈 상태에서 시작
  await sql`insert into chk_installs (tenant, tpl) values ('default', 'common') on conflict do nothing`;
  await sql`delete from chk_items where tenant = ${other.tenant}`; await sql`delete from chk_place_types where tenant = ${other.tenant}`; await sql`delete from chk_categories where tenant = ${other.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('권한: 직원은 가이드가 없는 것처럼(404) · 현장 관리자는 보기만(만들기 403) · 대표는 편집', async () => {
  for (const p of ['/api/check/categories', '/api/check/place-types', '/api/check/places', '/api/check/items']) {
    assert.equal((await ctx.staffA.client.req('GET', p)).status, 404, `직원 ${p}`);
    assert.equal((await ctx.managerA.client.req('GET', p)).status, 200, `현장 관리자 ${p}`);
  }
  assert.equal((await ctx.managerA.client.req('POST', '/api/check/categories', { name: '청결' })).status, 403, '현장 관리자는 보기만');
  assert.equal((await ctx.staffA.client.req('POST', '/api/check/items', { title: '출입구 바닥' })).status, 404);
  S.cat = (await ctx.owner.ok('POST', '/api/check/categories', { name: '청결', sort: 1 })).id;
  assert.ok(S.cat);
});

test('분야 2단계 · 공간 유형 · 지점별 공간', async () => {
  S.sub = (await ctx.owner.ok('POST', '/api/check/categories', { name: '바닥', parentId: S.cat })).id;
  assert.equal((await ctx.owner.req('POST', '/api/check/categories', { name: '모서리', parentId: S.sub })).status, 400, '3단계는 안 됨');
  assert.equal((await ctx.owner.req('PATCH', `/api/check/categories/${S.cat}`, { name: '청결', parentId: S.sub })).status, 400, '아래 분야 밑으로 옮길 수 없음');
  await ctx.owner.ok('PATCH', `/api/check/categories/${S.sub}`, { name: '바닥·매트' });
  const cats = (await ctx.owner.ok('GET', '/api/check/categories')).categories;
  assert.deepEqual(cats.map((c) => [c.name, c.parent_id]), [['청결', null], ['바닥·매트', S.cat]]);
  S.ptDoor = (await ctx.owner.ok('POST', '/api/check/place-types', { name: '출입구·로비', sort: 1 })).id;
  S.ptToilet = (await ctx.owner.ok('POST', '/api/check/place-types', { name: '화장실', sort: 2 })).id;
  assert.deepEqual((await ctx.owner.ok('GET', '/api/check/place-types')).placeTypes.map((p) => p.name), ['출입구·로비', '화장실']);
  S.placeA = (await ctx.owner.ok('POST', '/api/check/places', { name: '1층 출입구', orgUnitId: ctx.siteA, placeTypeId: S.ptDoor })).id;
  await ctx.owner.ok('POST', '/api/check/places', { name: '남자 화장실', orgUnitId: ctx.siteB, placeTypeId: S.ptToilet });
  assert.equal((await ctx.owner.ok('GET', '/api/check/places')).places.length, 2);
  assert.deepEqual((await ctx.owner.ok('GET', `/api/check/places?unit=${ctx.siteA}`)).places.map((p) => [p.name, p.place_type_name]), [['1층 출입구', '출입구·로비']]);
  // 현장 관리자는 자기가 볼 수 있는 조직의 공간만
  assert.deepEqual((await ctx.managerA.client.ok('GET', '/api/check/places')).places.map((p) => p.name), ['1층 출입구']);
});

test('점검 항목: 등록 · 거름 · 고치면 판이 오르고 개정 이력에 까닭 · 사용 여부만 바꾸면 개정 아님', async () => {
  assert.equal((await ctx.owner.req('GET', '/api/check/items?category=abc&placeType=abc&unit=abc')).status, 200, '주소에 모양이 틀린 값이 와도 서버 오류가 아님(그 값으로는 거르지 않음)');
  const door = await ctx.owner.ok('POST', '/api/check/items', { title: '출입구 바닥', categoryId: S.sub, placeTypeIds: [S.ptDoor], method: 'look', passCriteria: '먼지·물기·이물 없음',
    blindSpots: ['매트 아래', '모서리'], fixAction: { note: '즉시 청소', dueDays: 0 }, cycle: 'daily', shareStaff: true, basisNote: '대표 현장 메모' });
  assert.equal(door.version, 1); S.door = door.id;
  S.toilet = (await ctx.owner.ok('POST', '/api/check/items', { title: '화장실', categoryId: S.cat, placeTypeIds: [S.ptToilet], passCriteria: '바닥 물기·냄새 없음, 휴지·비누 채워짐', unitScope: 'some', orgUnitIds: [ctx.siteB] })).id;
  assert.equal((await ctx.owner.req('POST', '/api/check/items', { title: '적용 지점 없음', unitScope: 'some' })).status, 400, "일부 지점인데 고른 곳이 없으면 400");
  const names = async (qs = '') => (await ctx.owner.ok('GET', `/api/check/items${qs}`)).items.map((i) => i.title).sort();
  assert.deepEqual(await names(), ['출입구 바닥', '화장실']);
  assert.deepEqual(await names(`?category=${S.cat}`), ['출입구 바닥', '화장실'], '위 분야로 거르면 아래 분야 항목도');
  assert.deepEqual(await names(`?category=${S.sub}`), ['출입구 바닥']);
  assert.deepEqual(await names(`?placeType=${S.ptToilet}`), ['화장실']);
  assert.deepEqual(await names(`?unit=${ctx.siteA}`), ['출입구 바닥'], "지점으로 거르면 '모든 지점' 항목 + 그 지점 항목");
  assert.deepEqual(await names(`?q=${encodeURIComponent('비누')}`), ['화장실'], '양호 기준 글로도 찾음');
  // 고치기 → 2판
  const up = await ctx.owner.ok('PATCH', `/api/check/items/${S.door}`, { passCriteria: '먼지·물기·이물 없음, 매트 반듯함', reason: '매트 기준 추가' });
  assert.deepEqual([up.version, up.revised], [2, true]);
  const d = await ctx.owner.ok('GET', `/api/check/items/${S.door}`);
  assert.deepEqual([d.item.version, d.item.pass_criteria, d.item.category_name], [2, '먼지·물기·이물 없음, 매트 반듯함', '바닥·매트']);
  assert.deepEqual(d.versions.map((v) => [v.version, v.reason, v.snapshot.passCriteria, v.by_name]), [[2, '매트 기준 추가', '먼지·물기·이물 없음, 매트 반듯함', '김대표'], [1, '처음 등록', '먼지·물기·이물 없음', '김대표']]);
  // 사용 여부만 → 판 그대로, 목록에서는 빠지고 all=1 로는 보임
  const off = await ctx.owner.ok('PATCH', `/api/check/items/${S.toilet}`, { active: false });
  assert.deepEqual([off.version, off.revised], [1, false]);
  assert.deepEqual(await names(), ['출입구 바닥']); assert.deepEqual(await names('?all=1'), ['출입구 바닥', '화장실']);
  await ctx.owner.ok('PATCH', `/api/check/items/${S.toilet}`, { active: true });
  // 분야 지우기: 쓰는 항목이 있으면 지우지 않고 '안 씀'
  const rm = await ctx.owner.ok('DELETE', `/api/check/categories/${S.cat}`);
  assert.deepEqual([rm.removed, rm.deactivated, rm.items], [false, true, 2]);
  assert.ok((await ctx.owner.ok('GET', '/api/check/categories')).categories.every((c) => !c.active));
  const empty = (await ctx.owner.ok('POST', '/api/check/categories', { name: '빈 분야' })).id;
  assert.equal((await ctx.owner.ok('DELETE', `/api/check/categories/${empty}`)).removed, true);
});

test('직원 공유: 가이드 권한이 없는 직원도 공유 표시 항목의 양호 기준만 봄(근거 메모·조치·판 정보 없음) · 자기 지점 밖 항목은 안 보임', async () => {
  const r = await ctx.staffA.client.ok('GET', '/api/check/shared');
  assert.deepEqual(r.items.map((i) => [i.title, i.pass_criteria, i.blind_spots]), [['출입구 바닥', '먼지·물기·이물 없음, 매트 반듯함', ['매트 아래', '모서리']]]);
  assert.ok(!('basis_note' in r.items[0]) && !('fix_action' in r.items[0]) && !('version' in r.items[0]), JSON.stringify(Object.keys(r.items[0])));
  await ctx.owner.ok('PATCH', `/api/check/items/${S.toilet}`, { shareStaff: true });
  assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/check/shared')).items.map((i) => i.title), ['출입구 바닥'], '다른 지점(siteB)에만 적용되는 항목은 siteA 직원에게 안 보임');
  assert.deepEqual((await ctx.staffB.client.ok('GET', '/api/check/shared')).items.map((i) => i.title).sort(), ['출입구 바닥', '화장실']);
});

test('회사 분리: 다른 회사는 목록이 비고, 주소를 알아도 404 · 남의 분야·공간 유형·조직을 내 것에 걸 수 없음 · 기본 회사 것은 그대로', async () => {
  for (const [p, k] of [['/api/check/categories', 'categories'], ['/api/check/place-types', 'placeTypes'], ['/api/check/places', 'places'], ['/api/check/items', 'items']]) {
    assert.deepEqual((await other.c.ok('GET', p))[k], [], `다른 회사 ${p} 는 빈 목록`);
  }
  assert.deepEqual((await other.c.ok('GET', '/api/check/shared')).items, []);
  assert.equal((await other.c.req('GET', `/api/check/items/${S.door}`)).status, 404);
  assert.equal((await other.c.req('PATCH', `/api/check/items/${S.door}`, { title: '남의 것 고치기' })).status, 404);
  assert.equal((await other.c.req('PATCH', `/api/check/categories/${S.cat}`, { name: '남의 분야' })).status, 404);
  assert.equal((await other.c.req('DELETE', `/api/check/categories/${S.cat}`)).status, 404);
  assert.equal((await other.c.req('PATCH', `/api/check/place-types/${S.ptDoor}`, { name: '남의 유형' })).status, 404);
  assert.equal((await other.c.req('PATCH', `/api/check/places/${S.placeA}`, { name: '남의 공간', orgUnitId: other.unit })).status, 404);
  // 내 항목에 남의 것을 걸기
  assert.equal((await other.c.req('POST', '/api/check/items', { title: '우리 항목', categoryId: S.cat })).status, 404, '남의 분야');
  assert.equal((await other.c.req('POST', '/api/check/items', { title: '우리 항목', placeTypeIds: [S.ptDoor] })).status, 404, '남의 공간 유형');
  assert.equal((await other.c.req('POST', '/api/check/items', { title: '우리 항목', unitScope: 'some', orgUnitIds: [ctx.siteA] })).status, 404, '남의 조직');
  assert.equal((await other.c.req('POST', '/api/check/places', { name: '우리 공간', orgUnitId: ctx.siteA })).status, 404, '남의 조직에 공간');
  assert.equal((await other.c.req('POST', '/api/check/categories', { name: '아래', parentId: S.cat })).status, 404, '남의 분야 아래');
  // 자기 회사 것은 만들고 봄
  const mine = (await other.c.ok('POST', '/api/check/items', { title: '홀 테이블', passCriteria: '얼룩 없음' })).id;
  assert.deepEqual((await other.c.ok('GET', '/api/check/items')).items.map((i) => i.title), ['홀 테이블']);
  assert.equal((await ctx.owner.req('GET', `/api/check/items/${mine}`)).status, 404, '기본 회사도 다른 회사 항목은 404');
  // 기본 회사 것은 그대로
  assert.deepEqual((await ctx.owner.ok('GET', '/api/check/items')).items.map((i) => i.title).sort(), ['출입구 바닥', '화장실']);
  const rows = await sql`select tenant, count(*)::int n from chk_items group by tenant order by tenant`;
  assert.deepEqual(rows.map((r) => [r.tenant === 'default' ? 'default' : 'other', r.n]).sort(), [['default', 2], ['other', 1]]);
});
