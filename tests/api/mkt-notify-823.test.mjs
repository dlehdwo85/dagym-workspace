// 282차 #823(대표 10/31 "마케팅 관련 알람 너무 많이 옴 필요한 알림만 올 수 있도록"): 마케팅 알림 항목별 기본값 —
// 시안별 승인 요청은 알림함만(휴대폰 푸시 없음) · 주간 묶음·마감 임박·게시 실패·돈은 휴대폰 · '시안 제작 중'은 안 보냄 ·
// 설정 › 알림 › 마케팅 알림에서 항목별로 바꿈(휴대폰 알림·알림함만·안 받음, null = 기본값으로) · 영업 알림·다른 종류는 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, brand;
const pushes = async (entityId, userId) => (await sql`select n.id, n.read_at, (select count(*)::int from notification_deliveries d where d.notification_id = n.id) as p
  from notifications n where n.entity_id = ${entityId} and n.user_id = ${userId}`);
before(async () => {
  await resetDb(); srv = await startServer({ MAIL_DEV: '1', QUIET_DEFAULT: 'off' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-token-823-owner', platform: 'android' });
  brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '알림 줄이기 브랜드' })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('설정 표: 마케팅 알림 8항목 · 기본값(휴대폰 4·알림함만 3·안 받음 1)', async () => {
  const p = await ctx.owner.ok('GET', '/api/notifications/prefs');
  assert.deepEqual(p.mkt.map((x) => [x.kind, x.mode, x.own]), [['weekly', 'push', false], ['deadline', 'push', false], ['publish_fail', 'push', false], ['money', 'push', false],
    ['each', 'inbox', false], ['ai', 'inbox', false], ['result', 'inbox', false], ['drafting', 'off', false]]);
  assert.equal(p.mktModeLabels.inbox, '알림함만');
});

test('시안별 승인 요청: 알림함에는 있고 휴대폰 푸시는 없음 → 항목을 휴대폰 알림으로 바꾸면 푸시 · null 이면 기본값으로', async () => {
  const c1 = await ctx.staffA.client.ok('POST', '/api/marketing/contents', { title: '시안별 알림 1', channel: 'instagram', body: '캡션', mediaIds: [], brandId: brand });
  const [n1] = await pushes(c1.id, ctx.ownerId);
  assert.ok(n1, '알림함에는 있음'); assert.equal(n1.read_at, null); assert.equal(n1.p, 0, '휴대폰 푸시 없음');
  const [m] = await sql`select meta from notifications where id = ${n1.id}`; assert.equal(m.meta.mkt, 'each');
  await ctx.owner.ok('PUT', '/api/notifications/prefs', { mkt: [{ kind: 'each', mode: 'push' }] });
  assert.deepEqual((await ctx.owner.ok('GET', '/api/notifications/prefs')).mkt.find((x) => x.kind === 'each'), { kind: 'each', label: '시안별 승인 요청', desc: (await ctx.owner.ok('GET', '/api/notifications/prefs')).mkt.find((x) => x.kind === 'each').desc, def: 'inbox', mode: 'push', own: true });
  const c2 = await ctx.staffA.client.ok('POST', '/api/marketing/contents', { title: '시안별 알림 2', channel: 'instagram', body: '캡션', mediaIds: [], brandId: brand });
  assert.equal((await pushes(c2.id, ctx.ownerId))[0].p, 1, '휴대폰 알림으로 바꾸면 푸시');
  await ctx.owner.ok('PUT', '/api/notifications/prefs', { mkt: [{ kind: 'each', mode: 'off' }] });
  const c3 = await ctx.staffA.client.ok('POST', '/api/marketing/contents', { title: '시안별 알림 3', channel: 'instagram', body: '캡션', mediaIds: [], brandId: brand });
  const [n3] = await pushes(c3.id, ctx.ownerId);
  assert.ok(!n3 || (n3.read_at && n3.p === 0), '안 받음 = 알림함에도 안 쌓임');
  await ctx.owner.ok('PUT', '/api/notifications/prefs', { mkt: [{ kind: 'each', mode: null }] });
  assert.equal((await sql`select count(*)::int n from notification_prefs where user_id = ${ctx.ownerId} and type = 'mkt:each'`)[0].n, 0, 'null = 기본값으로');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/notifications/prefs', { mkt: [{ kind: 'nope', mode: 'push' }] })).status, 400);
});

test('제목 → 항목: 실제 마케팅 알림 제목들', async () => {
  const { mktKindOf } = await import('../../src/lib/mktNotifyKinds.ts');
  const cases = [
    ['시안 제작 중: 가을 운동 루틴', 'drafting'], ['다음 주 게시 12건을 한 번에 올렸습니다. 승인해 주세요', 'weekly'], ['게시 3일 안 남았는데 승인 안 된 글 4건', 'deadline'],
    ['게시 실패 — 인스타그램: 가을 이벤트', 'publish_fail'], ['게시물 삭제됨 — 페이스북: 공지', 'publish_fail'], ['충전 필요 — 메타 소진율 92%', 'money'], ['2026년 11월 광고 예산 계획', 'money'],
    ['월 광고비 상한 도달 — 워크인 광고 정지', 'money'], ['마케팅 자동 제작 멈춤(AI 한도)', 'money'],
    ['AI 마케터 고친 안 v3: 11월 캠페인', 'ai'], ['AI 마케터 운영 신호 2건: 클릭 감소', 'ai'], ['기획 담당: 오늘 주제 3개(브랜드 2)', 'ai'], ['경쟁 광고 주간 분석 (10/27) — 12건', 'ai'],
    ['게시 완료 — 블로그: 가을 운동', 'result'], ['2026-10 마케팅 월간 보고', 'result'],
    ['승인 요청: 가을 운동', 'each'], ['승인 대기: 가을 운동', 'each'], ['수정본 승인 요청(v2): 가을 운동', 'each'], ['승인 마감 6시간 전: 가을 운동', 'each'],
    ['승인 마감이 지나 다음 슬롯으로 미뤘습니다: 가을 운동', 'each'], ['품질 검사 미통과: 가을 운동', 'each'], ['사진 필요: 가을 운동', 'each'], ['시안을 다시 그렸습니다(v2): 가을', 'each'],
    ['새 리드 3건', null],
  ];
  for (const [t, k] of cases) assert.equal(mktKindOf(t), k, t);
});
