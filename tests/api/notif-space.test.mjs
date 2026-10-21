// 대표 10/20 16:00 (#104) 마케팅·영업 알림 담당자만: ① 역할 담당(브랜드 규칙)에게 바로, 승인자는 승인 요청만 ② 담당 아닌 '모두 받기'는 1시간 묶음 1건 · 담당 미지정은 관리자 1명 하루 묶음
// ④ [시험] 브랜드는 올린 사람에게만 ⑤ 설정 › 공간별 방식(담당인 것만 기본·회사 기본값은 관리자만) ③ server_error 종류는 플랫폼 운영자에게만 보임
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
const forceDigest = async () => (await fetch(`${BASE}/api/cron/tick?reason=test&digest=force`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } })).json();
before(async () => {
  await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['marketing'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const who = async (entityId, type = 'review_requested') => (await sql`select user_id, space from notifications where entity_id = ${entityId} and type = ${type} order by user_id`);

test('⑤ 설정: 공간별 방식 기본 = 담당인 것만(회사 기본값) · 본인 설정 · 회사 기본값은 관리자만 · server_error 종류는 플랫폼 운영자에게만 보임', async () => {
  const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
  const mk = p.spaces.find((s) => s.space === 'marketing');
  assert.deepEqual([mk.mode, mk.own, mk.companyDefault, p.canSetCompany], ['mine', false, 'mine', false]);
  assert.ok(p.spaces.some((s) => s.space === 'sales'), '켠 공간만');
  assert.ok(!p.types.some((t) => t.type === 'server_error'), '서버 오류 종류는 직원 설정 표에 없음');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/notifications/prefs', { companySpaces: { marketing: 'all' } })).status, 403, '회사 기본값은 관리자만');
  await ctx.owner.ok('PUT', '/api/notifications/prefs', { companySpaces: { marketing: 'all' } });
  const p2 = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
  assert.deepEqual([p2.spaces.find((s) => s.space === 'marketing').mode, p2.spaces.find((s) => s.space === 'marketing').own], ['all', false], '회사 기본값을 따름');
  await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { spaces: { marketing: 'mine' } });
  assert.deepEqual([(await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).spaces.find((s) => s.space === 'marketing').mode, (await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).spaces.find((s) => s.space === 'marketing').own], ['mine', true]);
  await ctx.owner.ok('PUT', '/api/notifications/prefs', { companySpaces: { marketing: 'mine' } });
  await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { spaces: { marketing: null } });
  assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).spaces.find((s) => s.space === 'marketing').own, false, 'null = 회사 기본값으로');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'notify_defaults.set'`)[0].n, 2);
});

test('① 승인 요청: 승인자(대표) + 브랜드 담당(규칙)에게 바로, 올린 사람 제외, space=marketing · 공간 필터', async () => {
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '담당 브랜드' })).id;
  await ctx.owner.ok('PUT', '/api/admin/assignees', { kind: 'marketing_brand', ref: P.brand, primaryUserId: ctx.staffA.id });
  const c = await ctx.staffB.client.ok('POST', '/api/marketing/contents', { title: '담당자 라우팅 글', channel: 'instagram', body: '캡션', mediaIds: [], brandId: P.brand });
  const w = await who(c.id);
  assert.deepEqual(w.map((x) => x.user_id).sort(), [ctx.ownerId, ctx.staffA.id].sort(), `승인자 + 브랜드 담당: ${JSON.stringify(w)}`);
  assert.ok(w.every((x) => x.space === 'marketing'));
  assert.ok((await ctx.staffA.client.ok('GET', '/api/notifications?space=marketing')).items.some((n) => n.entity_id === c.id));
  assert.ok(!(await ctx.staffA.client.ok('GET', '/api/notifications?space=sales')).items.some((n) => n.entity_id === c.id), '공간 필터');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((n) => n.entity_id === c.id).space, 'marketing');
});

test('④ 시험 브랜드([시험]·is_test): 올린 사람에게만', async () => {
  const { brand: t } = await ctx.owner.ok('POST', '/api/marketing/auto/brands', { name: '[시험] 알림 브랜드', testMode: true });
  const c = await ctx.staffB.client.ok('POST', '/api/marketing/contents', { title: '시험 글', channel: 'instagram', body: '캡션', mediaIds: [], brandId: t.id });
  assert.deepEqual((await who(c.id)).map((x) => x.user_id), [ctx.staffB.id], '실행자만');
});

test('받지 않음: 브랜드 담당이어도 승인 아닌 건은 안 받고, 승인 요청은 승인자가 받음', async () => {
  await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { spaces: { marketing: 'off' } });
  const c = await ctx.staffB.client.ok('POST', '/api/marketing/contents', { title: '받지 않음 글', channel: 'instagram', body: '캡션', mediaIds: [], brandId: P.brand });
  assert.deepEqual((await who(c.id)).map((x) => x.user_id), [ctx.ownerId], '담당(A)은 받지 않음, 승인자(대표)만');
  await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { spaces: { marketing: null } });
});

test('①② 담당 미지정 + 승인 아님(주제 필요) → 바로 알림 없음, 관리자 1명 하루 묶음 · 모두 받기(B)는 1시간 묶음 — 묶음마다 알림 1건, 두 번 보내지 않음', async () => {
  await ctx.staffB.client.ok('PUT', '/api/notifications/prefs', { spaces: { marketing: 'all' } });
  const { brand: b2 } = await ctx.owner.ok('POST', '/api/marketing/auto/brands', { name: '미지정 브랜드' });
  await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: b2.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:30' });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.needsTopic), JSON.stringify(run));
  const ids = run.produced.filter((p) => p.needsTopic).map((p) => p.id);
  assert.equal((await sql`select count(*)::int n from notifications where entity_id = any(${ids}::uuid[]) and type = 'review_requested'`)[0].n, 0, '담당 미지정은 바로 알림 없음');
  const items = await sql`select user_id, cadence from notification_digest_items where entity_id = any(${ids}::text[]) and flushed_at is null`;
  assert.ok(items.some((i) => i.user_id === ctx.ownerId && i.cadence === 'day'), `대표 하루 묶음: ${JSON.stringify(items)}`);
  assert.ok(items.some((i) => i.user_id === ctx.staffB.id && i.cadence === 'hour'), '모두 받기 B 는 1시간 묶음');
  assert.ok(!items.some((i) => i.user_id === ctx.staffA.id), '담당인 것만(A) 은 묶음도 없음');
  const r = await forceDigest();
  assert.ok(r.detail.notifDigest.hour >= 1 && r.detail.notifDigest.day >= 1, JSON.stringify(r.detail.notifDigest));
  const dOwner = await sql`select title, link, meta, space from notifications where user_id = ${ctx.ownerId} and type = 'digest'`;
  assert.equal(dOwner.length, 1, '하루 묶음 1건'); assert.match(dOwner[0].title, /^마케팅 알림 \d+건 \(하루 묶음\)/); assert.equal(dOwner[0].link, '/notifications?space=marketing'); assert.ok(dOwner[0].meta.items.length >= 1); assert.equal(dOwner[0].space, 'marketing');
  const dB = await sql`select title, meta from notifications where user_id = ${ctx.staffB.id} and type = 'digest'`;
  assert.equal(dB.length, 1, '1시간 묶음 1건'); assert.match(dB[0].title, /지난 1시간 묶음/); assert.ok(dB[0].meta.items.some((i) => /주제 필요/.test(i.title)));
  assert.equal((await sql`select count(*)::int n from notification_digest_items where flushed_at is null`)[0].n, 0, '모두 보냄');
  await forceDigest();
  assert.equal((await sql`select count(*)::int n from notifications where type = 'digest'`)[0].n, 2, '다시 돌려도 새 묶음 없음');
  await ctx.staffB.client.ok('PUT', '/api/notifications/prefs', { spaces: { marketing: null } });
});
