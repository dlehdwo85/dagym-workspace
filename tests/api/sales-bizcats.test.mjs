// 대표 10/21 12:00 영업 재편 4): 회사 '관심 사업(카테고리)' — 코드에 회사 이름 없음. 첫 회사(default)는 마이그레이션 자료로 심김.
// 공고 사업 배지(businesses)·biz= 탭 필터·'none' 미분류 · 관리자만 PUT(이름·색·검색어 교체, 빠진 것은 끔) · 검색어 바꾸면 배지가 바로 바뀜
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await put('procurement_notices', { id: 'A', title: '구청 체육시설 위탁운영', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T10:00`, fit_business: 'dagym' });
  await put('procurement_notices', { id: 'B', title: '아파트 커뮤니티센터 운영 용역', related: true, first_seen_at: today, deadline_at: `${addDays(today, 6)}T10:00` });
  await put('procurement_notices', { id: 'C', title: '청사 인테리어 공사', related: true, first_seen_at: today, deadline_at: `${addDays(today, 7)}T10:00` });
  await put('procurement_notices', { id: 'D', title: '협력사 모집', related: true, first_seen_at: today, deadline_at: `${addDays(today, 8)}T10:00`, fit_business: 'both' });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('관심 사업(카테고리)', () => {
  test('첫 회사 기본값 2개(자료) · 공고 배지: 사업 칸 → 없으면 제목 검색어 · both 는 전부 · biz= 필터·none', async () => {
    const c = await ctx.owner.ok('GET', '/api/sales/business-categories');
    assert.deepEqual(c.items.map((x) => [x.key, x.name, x.active]), [['dagym', '다짐', true], ['hilink', '하이링크', true]]); assert.equal(c.canEdit, true);
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open');
    assert.deepEqual(b.categories.map((x) => x.key), ['dagym', 'hilink']);
    const by = Object.fromEntries(b.items.map((n) => [n.id, [n.business, n.businesses.map((x) => x.name)]]));
    assert.deepEqual(by.A, ['dagym', ['다짐']], '사업 칸'); assert.deepEqual(by.B, ['hilink', ['하이링크']], '제목 검색어(커뮤니티)'); assert.deepEqual(by.C, [null, []], '미분류'); assert.deepEqual(by.D, ['both', ['다짐', '하이링크']]);
    assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open&biz=hilink')).items.map((n) => n.id).sort(), ['B', 'D']);
    assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open&biz=none')).items.map((n) => n.id), ['C']);
  });
  test('관리자가 교체: 새 사업(검색어 인테리어) 추가·하나 끔 → 배지·탭 바로 반영 · 직원 403 · 이름 겹침 400', async () => {
    assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/business-categories', { items: [{ name: 'x', keywords: [] }] })).status, 403);
    assert.equal((await ctx.owner.req('PUT', '/api/sales/business-categories', { items: [{ name: '같음', keywords: [] }, { name: '같음', keywords: [] }] })).status, 400);
    const r = await ctx.owner.ok('PUT', '/api/sales/business-categories', { items: [{ key: 'hilink', name: '커뮤니티 운영', color: '#2563EB', keywords: ['커뮤니티', '위탁운영'] }, { name: '공간 인테리어', color: '#DC2626', keywords: ['인테리어', '리모델링'] }] });
    assert.deepEqual(Object.fromEntries(r.items.map((x) => [x.key, [x.name, x.active, x.sort]])), { hilink: ['커뮤니티 운영', true, 1], '공간-인테리어': ['공간 인테리어', true, 2], dagym: ['다짐', false, 1] }, '빠진 dagym 은 끔(지우지 않음)');
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open');
    assert.deepEqual(b.categories.map((x) => x.name), ['커뮤니티 운영', '공간 인테리어']);
    const by = Object.fromEntries(b.items.map((n) => [n.id, n.businesses.map((x) => x.name)]));
    assert.deepEqual(by.A, ['커뮤니티 운영'], '제목 "위탁운영" — 꺼진 사업(dagym 칸)은 무시'); assert.deepEqual(by.C, ['공간 인테리어']); assert.deepEqual(by.D, ['커뮤니티 운영', '공간 인테리어'], 'both = 켜진 전부');
    assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open&biz=공간-인테리어')).items.map((n) => n.id).sort(), ['C', 'D']);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/business-categories')).canEdit, false);
  });
});
