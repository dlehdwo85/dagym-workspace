// 점검 1단계 — 템플릿 설치 · 기준 사진 · 저장공간 (대표 11/19 "점검 개발 시작", docs/check-feature-design.md 3-7·9절)
//  · 가입 때: 공통 기본(분야 8 · 공간 유형 6 · 항목 20) + 고른 업종의 템플릿만. 카페로 가입한 회사에 다른 업종 낱말이 하나도 없음(1단계 완료 기준)
//  · 예전부터 있던 회사: 가이드를 처음 열 때 한 번 설치. 다시 열어도 늘지 않고, 안 쓰게 한 항목이 되살아나지 않음
//  · 업종 템플릿 더 넣기: 편집 권한만, 한 번만
//  · 기준 사진: 편집 권한만 올림 · 가이드를 보는 사람과 (공유 항목이면) 직원이 봄 · 다른 회사 404 · 6장까지 · 회사 저장공간에 셈
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, cafe, academy, jpg;
const S = {};
async function join(email, company, industry) {
  const c = new Client(email);
  const r = await c.ok('POST', '/api/auth/signup', { email, password: 'signup-pass-1234', name: '김사장', mode: 'team', company, industry, agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false } /* #1087 AI 동의 필수 */ });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  return { c, tenant: (await c.ok('GET', '/api/auth/me')).user.tenant };
}
const items = async (c, qs = '?all=1') => (await c.ok('GET', `/api/check/items${qs}`)).items;
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  cafe = await join('ceo@check-cafe.test', '모퉁이커피', '외식·카페');
  academy = await join('ceo@check-academy.test', '새싹학원', '학원·교습');
  jpg = (await sharp({ create: { width: 64, height: 48, channels: 3, background: '#4a7' } }).jpeg().toBuffer()).toString('base64');
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('가입 때: 카페는 공통 기본 + 카페 템플릿, 학원은 공통 기본만 — 다른 업종 낱말이 없음', async () => {
  const ci = await items(cafe.c);
  assert.equal(ci.length, 24, '공통 20 + 카페 4');
  assert.equal((await cafe.c.ok('GET', '/api/check/categories')).categories.length, 8);
  assert.deepEqual((await cafe.c.ok('GET', '/api/check/place-types')).placeTypes.map((p) => p.name), ['출입구·로비', '화장실', '고객 이용 공간', '직원 공간', '창고', '안내 데스크', '바(제조 공간)', '홀']);
  assert.ok(ci.some((i) => i.title === '홀 테이블·의자' && i.category_name === '청결'), '업종 항목도 공통 분야를 씀');
  const door = ci.find((i) => i.title === '출입구 바닥');
  assert.deepEqual([door.category_name, door.method, door.pass_criteria, door.blind_spots, door.fix_action, door.cycle, door.share_staff, door.version],
    ['청결', 'look', '먼지·물기·이물 없음', ['매트 아래', '모서리'], { note: '즉시 청소', dueDays: 0 }, 'daily', true, 1]);
  assert.equal(ci.find((i) => i.title === '바닥·벽 파손').fix_action.external, true, '건물 관리처 연락이 필요한 항목 표시');
  // 1단계 완료 기준: 카페 계정에 다른 업종·특정 회사 낱말이 없음
  const all = JSON.stringify([ci, (await cafe.c.ok('GET', '/api/check/categories')).categories, (await cafe.c.ok('GET', '/api/check/place-types')).placeTypes]);
  assert.ok(!/러닝머신|웨이트|골프|독서실|사우나|탈의실|다짐|하이링크|단지|입주민/.test(all), '카페 회사에 다른 업종·기본 회사 낱말 없음');
  assert.deepEqual((await cafe.c.ok('GET', '/api/check/templates')).templates.map((t) => [t.key, t.installed]), [['common', true], ['fitness', false], ['community', false], ['cafe', true]]);
  // 학원: 맞는 업종 템플릿이 없으면 공통 기본만
  assert.equal((await items(academy.c)).length, 20);
  assert.equal((await academy.c.ok('GET', '/api/check/place-types')).placeTypes.length, 6);
  // 개정 이력 1판 = 템플릿에서 설치
  const d = await cafe.c.ok('GET', `/api/check/items/${door.id}`);
  assert.deepEqual(d.versions.map((v) => [v.version, v.reason]), [[1, '템플릿(공통 기본)에서 설치']]);
});

test('예전부터 있던 회사: 가이드를 처음 열 때 공통 기본 + 회사 업종 템플릿이 한 번 설치 · 다시 열어도 늘지 않음 · 안 쓰게 한 항목이 되살아나지 않음 · 회사끼리 섞이지 않음', async () => {
  assert.equal((await sql`select count(*)::int n from chk_items where tenant = 'default'`)[0].n, 0, '열기 전에는 없음');
  await sql`update tenants set industry = '운동·피트니스', industries = array['운동·피트니스', 'IT·소프트웨어'] where id = 'default'`; // 가입 때 템플릿을 못 받은 예전 회사 — 회사 정보의 업종으로 고름
  const first = await items(ctx.owner);
  assert.equal(first.length, 27, '공통 20 + 운동시설 7(맞는 템플릿이 없는 업종은 건너뜀)');
  assert.deepEqual((await sql`select tpl from chk_installs where tenant = 'default' order by tpl`).map((r) => r.tpl), ['common', 'fitness']);
  const lamp = first.find((i) => i.title === '조명');
  await ctx.owner.ok('PATCH', `/api/check/items/${lamp.id}`, { active: false });
  assert.equal((await items(ctx.owner)).length, 27, '다시 열어도 그대로');
  assert.equal((await items(ctx.owner, '')).length, 26, '안 쓰는 항목은 기본 목록에서 빠짐');
  await sql`delete from chk_items where id = ${first.find((i) => i.title === '구급함').id}`; // 자료에서 아예 없앤 것도 다시 넣지 않음(한 번 설치한 템플릿)
  assert.equal((await items(ctx.owner)).length, 26);
  const per = await sql`select tenant, count(*)::int n from chk_items group by tenant`;
  assert.deepEqual(per.map((r) => r.n).sort((a, b) => a - b), [20, 24, 26]);
  assert.equal((await cafe.c.req('GET', `/api/check/items/${lamp.id}`)).status, 404, '다른 회사 항목은 404');
});

test('업종 템플릿 더 넣기: 편집 권한만 · 한 번만 · 없는 템플릿 400 · 분야는 늘지 않음', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/check/templates')).status, 404, '직원은 없는 것처럼');
  assert.equal((await ctx.managerA.client.req('POST', '/api/check/templates', { key: 'community' })).status, 403, '보기 권한은 못 넣음');
  assert.equal((await ctx.owner.req('POST', '/api/check/templates', { key: 'nope' })).status, 400);
  const r = await ctx.owner.ok('POST', '/api/check/templates', { key: 'community' });
  assert.deepEqual([r.installed, r.items], [true, 7]);
  for (const key of ['community', 'fitness']) { // 이미 넣은 것(방금 넣은 것 · 처음 열 때 들어온 것)
    const again = await ctx.owner.ok('POST', '/api/check/templates', { key });
    assert.deepEqual([again.installed, again.items], [false, 0], `${key}: 두 번째는 아무것도 안 넣음`);
  }
  const all = await items(ctx.owner);
  assert.equal(all.length, 33, '26 + 7');
  assert.equal(all.find((i) => i.title === '러닝머신').category_name, '장비·기기');
  assert.equal(all.find((i) => i.title === '고객 자격 확인 절차').place_type_ids.length, 1, '업종 항목이 공통 공간 유형(안내 데스크)을 씀');
  assert.equal((await ctx.owner.ok('GET', '/api/check/categories')).categories.length, 8, '분야는 공통 8개 그대로');
  assert.equal((await ctx.owner.ok('GET', '/api/check/place-types')).placeTypes.length, 16, '공간 유형 6 + 4 + 6');
});

test('기준 사진: 편집 권한만 올림 · 상세·목록에 보임 · 공유 항목 사진은 직원도 봄 · 다른 회사 404 · 6장까지 · 사진 아님 거절 · 저장공간에 셈', async () => {
  const all = await items(ctx.owner);
  const shared = all.find((i) => i.title === '출입구 바닥'); const hidden = all.find((i) => i.title === '냉난방');
  assert.ok(shared.share_staff && !hidden.share_staff);
  const photo = { fileName: '바닥.jpg', mimeType: 'image/jpeg', data: jpg };
  const before0 = (await ctx.owner.ok('GET', '/api/usage')).usage.storageBytes;
  assert.equal((await ctx.staffA.client.req('POST', `/api/check/items/${shared.id}/photos`, photo)).status, 404);
  assert.equal((await ctx.managerA.client.req('POST', `/api/check/items/${shared.id}/photos`, photo)).status, 403);
  assert.equal((await cafe.c.req('POST', `/api/check/items/${shared.id}/photos`, photo)).status, 404, '다른 회사 항목에는 못 올림');
  assert.equal((await ctx.owner.req('POST', `/api/check/items/${shared.id}/photos`, { ...photo, mimeType: 'application/pdf' })).status, 400, '사진만');
  const p1 = await ctx.owner.ok('POST', `/api/check/items/${shared.id}/photos`, photo);
  const p2 = await ctx.owner.ok('POST', `/api/check/items/${hidden.id}/photos`, { ...photo, data: `data:image/jpeg;base64,${jpg}` });
  assert.ok(p1.id && p1.sizeBytes > 100);
  assert.deepEqual((await ctx.owner.ok('GET', `/api/check/items/${shared.id}`)).photos.map((p) => [p.id, p.fileName]), [[p1.id, '바닥.jpg']]);
  assert.equal((await items(ctx.owner)).find((i) => i.id === shared.id).photos, 1, '목록에는 장수');
  assert.equal((await ctx.owner.ok('GET', '/api/usage')).usage.storageBytes, before0 + p1.sizeBytes + p2.sizeBytes, '점검 사진도 회사 저장공간에 셈');
  // 열기
  const open = async (c, id) => (await c.req('GET', `/api/check/photos/${id}`)).status;
  assert.equal(await open(ctx.owner, p1.id), 302); assert.equal(await open(ctx.managerA.client, p2.id), 302, '가이드를 보는 사람은 모두');
  assert.equal(await open(ctx.staffA.client, p1.id), 302, '공유 항목의 기준 사진은 직원도');
  assert.equal(await open(ctx.staffA.client, p2.id), 404, '공유하지 않은 항목의 사진은 직원에게 없는 것처럼');
  assert.equal(await open(cafe.c, p1.id), 404, '다른 회사');
  const st = (await ctx.staffA.client.ok('GET', '/api/check/shared')).items.find((i) => i.id === shared.id);
  assert.deepEqual(st.photos.map((p) => p.id), [p1.id], '직원 공유 목록에 기준 사진');
  // 6장까지
  for (let i = 0; i < 5; i++) await ctx.owner.ok('POST', `/api/check/items/${shared.id}/photos`, photo);
  const seventh = await ctx.owner.req('POST', `/api/check/items/${shared.id}/photos`, photo);
  assert.equal(seventh.status, 400); assert.match(seventh.body.error.message, /6장까지/);
  // 지우기
  assert.equal((await ctx.staffA.client.req('DELETE', `/api/check/photos/${p1.id}`)).status, 404);
  assert.equal((await cafe.c.req('DELETE', `/api/check/photos/${p1.id}`)).status, 404);
  await ctx.owner.ok('DELETE', `/api/check/photos/${p1.id}`);
  assert.equal(await open(ctx.owner, p1.id), 404);
  assert.equal((await ctx.owner.ok('GET', `/api/check/items/${shared.id}`)).photos.length, 5);
});
