// 메신저 3차(대표 10/20 카톡 수준, docs/handoff/MESSENGER_KAKAO_LEVEL_2026-10-20.md C12·D14·D15):
// 방별 알림(전체·멘션만·끄기)·안 읽은 수와 앱 배지 기준·푸시에서 바로 답장/읽음·푸시 배지 숫자(배지를 맞추는 앱만)·방장만 관리·방장 넘기기·방 사진·방 안 검색
// 가짜 FCM 으로 본 구조 시험 — 실제 휴대폰 버튼·아이콘 배지는 로컬이 실기기에서 확인(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const P = {};
const ALL = '00000000-0000-0000-0000-000000000000';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
before(async () => {
  fake = await startFakeGoogle(); await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  P.g = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '3차 시험방', userIds: [ctx.staffA.id, ctx.staffB.id] })).id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });
const send = (c, body, room = P.g) => c.ok('POST', `/api/chat/rooms/${room}/messages`, { body });
const level = async (c, room = P.g) => (await c.ok('GET', `/api/chat/rooms/${room}`)).room.notify;
const badge = async (c) => (await c.ok('GET', '/api/chat/unread')).unread;
const rowOf = async (c, room = P.g) => (await c.ok('GET', '/api/chat/rooms')).rooms.find((r) => r.id === room);
const at = (u, name) => `@[${name}](${u.id})`;
const notifOf = async (userId, mid) => (await sql`select id::text, meta from notifications where user_id = ${userId} and type = 'chat' and dedupe_key = ${`chat:${mid}`}`)[0];
const systemMsgs = async (room) => (await sql`select body from chat_messages where room_id = ${room} and kind = 'system' order by id`).map((x) => x.body);
/** 대화방 파일 올리기(로컬 저장소) */
const up = async (c, room, name, mime, data = 'x') => {
  const t = await c.ok('POST', `/api/chat/rooms/${room}/files`, { fileName: name, mime, size: data.length });
  await fetch(BASE + t.upload.url, { method: 'PUT', headers: t.upload.headers, body: Buffer.isBuffer(data) ? data : Buffer.from(data) });
  return t.key;
};
const state = () => fetch(`${FAKE}/__state`).then((r) => r.json());
async function fcmTo(token, nid) {
  for (let i = 0; i < 30; i++) {
    const m = (await state()).fcm.find((x) => x.token === token && x.data?.notificationId === nid);
    if (m) return m;
    await tick(); await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`FCM 이 오지 않음: ${token} ${nid}`);
}

describe('메신저 3차', () => {
  test('C12 방별 알림 3단계: 전체·멘션만·끄기 — 알림 대상·@전체·안 읽은 수(방 줄은 그대로, 합계·앱 배지는 단계대로)·옛 muted 호환', async () => {
    assert.equal(await level(ctx.staffA.client), 'all', '처음은 전체');
    await ctx.staffA.client.ok('PATCH', `/api/chat/rooms/${P.g}`, { notify: 'mention' });
    await ctx.staffB.client.ok('PATCH', `/api/chat/rooms/${P.g}`, { notify: 'off' });
    const [ma] = await sql`select notify, muted from chat_members where room_id = ${P.g} and user_id = ${ctx.staffA.id}`;
    assert.deepEqual([ma.notify, ma.muted], ['mention', true], 'muted 도 같이 맞춤(옛 화면·옛 앱)');
    assert.deepEqual((await send(ctx.owner, '그냥 공지')).notified, [], '멘션만·끄기 = 일반 메시지 알림 없음');
    assert.deepEqual((await send(ctx.owner, `${at(ctx.staffA, '이직원')} ${at(ctx.staffB, '박직원')} 확인 부탁`)).notified, [ctx.staffA.id], '멘션만 = 부르면 옴 · 끄기 = 불러도 안 옴');
    assert.deepEqual((await send(ctx.owner, `@[전체](${ALL}) 내일 회의`)).notified, [ctx.staffA.id], '@전체도 끄기는 빼고');
    const ra = await rowOf(ctx.staffA.client);
    assert.deepEqual([ra.notify, ra.unread, ra.mention_unread], ['mention', 3, 2], '방 줄의 안 읽은 수는 그대로');
    assert.equal((await ctx.staffA.client.ok('GET', '/api/chat/rooms')).unread, 2, '합계 = 나를 부른 것만');
    assert.equal(await badge(ctx.staffA.client), 2, '앱 배지도 같은 기준');
    assert.deepEqual([(await rowOf(ctx.staffB.client)).unread, await badge(ctx.staffB.client)], [3, 0], '끄기 = 배지에서 빠짐');
    // 옛 화면·옛 앱의 muted: false = 전체, true = 멘션만(예전처럼 나를 부르면 옴)
    await ctx.staffB.client.ok('PATCH', `/api/chat/rooms/${P.g}`, { muted: false });
    assert.deepEqual([await level(ctx.staffB.client), await badge(ctx.staffB.client)], ['all', 3]);
    await ctx.staffB.client.ok('PATCH', `/api/chat/rooms/${P.g}`, { muted: true });
    assert.deepEqual([await level(ctx.staffB.client), await badge(ctx.staffB.client)], ['mention', 2]);
    const d = await ctx.staffB.client.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.deepEqual([d.room.notify, d.room.muted], ['mention', true]);
    assert.equal((await ctx.staffB.client.req('PATCH', `/api/chat/rooms/${P.g}`, { notify: 'loud' })).status, 400);
    for (const c of [ctx.staffA.client, ctx.staffB.client]) { await c.ok('PATCH', `/api/chat/rooms/${P.g}`, { notify: 'all' }); await c.ok('POST', `/api/chat/rooms/${P.g}/read`, {}); }
    assert.deepEqual([await badge(ctx.staffA.client), await badge(ctx.staffB.client)], [0, 0]);
  });

  test('C12 푸시에서 바로 답장·읽음: [읽음] = 알림 온 메시지까지 · [답장] = 그 방에 메시지 + 방 읽음 · 방을 떠나면 404', async () => {
    const m1 = await send(ctx.owner, '첫 번째 질문');
    const m2 = await send(ctx.owner, '두 번째 질문');
    const n1 = await notifOf(ctx.staffA.id, m1.id);
    assert.equal(n1.meta.messageId, m1.id, '알림에 메시지 id');
    assert.equal((await ctx.staffA.client.ok('POST', `/api/notifications/${n1.id}/action`, { action: 'ack' })).label, '읽음');
    const [ma] = await sql`select last_read_id::text from chat_members where room_id = ${P.g} and user_id = ${ctx.staffA.id}`;
    assert.equal(ma.last_read_id, m1.id, '알림 온 메시지까지만 — 뒤 메시지는 그대로 안 읽음');
    assert.equal(await badge(ctx.staffA.client), 1);
    const n2 = await notifOf(ctx.staffB.id, m2.id);
    assert.equal((await ctx.staffB.client.req('POST', `/api/notifications/${n2.id}/action`, { action: 'reply' })).status, 400, '답장 글 없으면 400');
    assert.equal((await ctx.staffB.client.ok('POST', `/api/notifications/${n2.id}/action`, { action: 'reply', text: '네 확인했습니다' })).label, '답장함');
    const d = await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`);
    const last = d.messages[d.messages.length - 1];
    assert.deepEqual([last.author_id, last.body], [ctx.staffB.id, '네 확인했습니다'], '그 방에 내 메시지로');
    assert.equal(await badge(ctx.staffB.client), 0, '답장하면 방은 읽음');
    assert.ok(await notifOf(ctx.ownerId, last.id), '답장도 보통 메시지처럼 방 사람에게 알림');
    assert.equal((await ctx.staffA.client.req('POST', `/api/notifications/${n2.id}/action`, { action: 'ack' })).status, 404, '남의 알림 404');
    // 방을 떠난 뒤 남은 알림의 [답장] → 404(방이 안 보임)
    const m3 = await send(ctx.owner, '세 번째');
    const n3 = await notifOf(ctx.staffB.id, m3.id);
    await ctx.staffB.client.ok('DELETE', `/api/chat/rooms/${P.g}`);
    assert.equal((await ctx.staffB.client.req('POST', `/api/notifications/${n3.id}/action`, { action: 'reply', text: '나간 뒤' })).status, 404);
    await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/members`, { userIds: [ctx.staffB.id] });
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/read`, {});
  });

  test('C12 푸시 내용: [답장][읽음] 버튼·iOS 버튼 묶음 wn.reply.ack·방마다 한 묶음 · 배지 숫자는 배지를 맞추는 앱(app-badge-1)에만 = 안 읽은 알림 + 안 읽은 메시지', async () => {
    await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-chat-badge-staffA', platform: 'ios', caps: ['app-badge-1'] });
    await ctx.staffB.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-chat-1.1.3-staffB', platform: 'android', caps: ['android-actions-1'] });
    const m = await send(ctx.owner, '배지 시험 메시지');
    const a = await fcmTo('fcm-chat-badge-staffA', (await notifOf(ctx.staffA.id, m.id)).id);
    assert.deepEqual(JSON.parse(a.data.actions).map((x) => [x.id, x.label]), [['reply', '답장'], ['ack', '읽음']]);
    assert.equal(a.apns.payload.aps.category, 'wn.reply.ack', '앱이 등록한 [답글][확인] 묶음');
    assert.deepEqual([a.data.group, a.apns.payload.aps['thread-id']], [`chat:${P.g}`, `chat:${P.g}`], '방마다 한 묶음');
    const [{ n }] = await sql`select count(*)::int n from notifications where user_id = ${ctx.staffA.id} and read_at is null and type <> 'chat'`;
    const want = n + await badge(ctx.staffA.client);
    assert.ok(want >= 1);
    assert.deepEqual([a.apns.payload.aps.badge, a.data.badge], [want, String(want)]);
    const b = await fcmTo('fcm-chat-1.1.3-staffB', (await notifOf(ctx.staffB.id, m.id)).id);
    assert.deepEqual([b.data.wn, b.data.badge, b.apns.payload.aps.badge], ['1', undefined, undefined], '배지를 맞출 줄 모르는 앱은 숫자를 안 보냄(iOS 숫자가 그대로 남지 않게)');
    assert.deepEqual(JSON.parse(b.data.actions).map((x) => x.id), ['reply', 'ack']);
    for (const c of [ctx.staffA.client, ctx.staffB.client]) await c.ok('POST', `/api/chat/rooms/${P.g}/read`, {});
  });

  test('D14 방장만 관리: 켜면 방장·대표·관리자만 이름·사진·초대·공지 / 끄면 누구나 · 켜고 끄기는 방장만 · 안내 메시지', async () => {
    P.g2 = (await ctx.staffA.client.ok('POST', '/api/chat/rooms', { kind: 'group', name: '방장 시험방', userIds: [ctx.staffB.id, ctx.ownerId] })).id;
    const B = ctx.staffB.client;
    await B.ok('PATCH', `/api/chat/rooms/${P.g2}`, { name: '박직원이 바꾼 이름' });
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { ownerOnly: true })).status, 403, '방장이 아니면 못 켬');
    await ctx.staffA.client.ok('PATCH', `/api/chat/rooms/${P.g2}`, { ownerOnly: true });
    let d = await B.ok('GET', `/api/chat/rooms/${P.g2}`);
    assert.deepEqual([d.room.ownerOnly, d.room.canEdit, d.room.canRename, d.room.canPhoto, d.room.canManage], [true, false, false, false, false]);
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { name: '또 바꾸기' })).status, 403, '이름');
    assert.equal((await B.req('POST', `/api/chat/rooms/${P.g2}/members`, { userIds: [ctx.managerA.id] })).status, 403, '초대');
    const msg = await send(B, '공지로 올릴 글', P.g2);
    assert.equal((await B.req('POST', `/api/chat/messages/${msg.id}/pin`, { pin: true })).status, 403, '공지');
    const key = await up(B, P.g2, '사진.png', 'image/png');
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: key })).status, 403, '사진');
    // 방장(만든 사람)·대표는 그대로
    await ctx.staffA.client.ok('POST', `/api/chat/messages/${msg.id}/pin`, { pin: true });
    await ctx.owner.ok('PATCH', `/api/chat/rooms/${P.g2}`, { name: '대표가 바꾼 이름' });
    assert.equal((await ctx.owner.ok('GET', `/api/chat/rooms/${P.g2}`)).room.canEdit, true, '대표·관리자는 방장 아니어도');
    await ctx.staffA.client.ok('PATCH', `/api/chat/rooms/${P.g2}`, { ownerOnly: false });
    await B.ok('PATCH', `/api/chat/rooms/${P.g2}`, { name: '다시 누구나' });
    d = await B.ok('GET', `/api/chat/rooms/${P.g2}`);
    assert.deepEqual([d.room.ownerOnly, d.room.canEdit, d.room.name], [false, true, '다시 누구나']);
    const sys = await systemMsgs(P.g2);
    assert.ok(sys.includes('이직원님이 방 이름·사진·초대·공지를 방장만 바꿀 수 있게 했습니다'), JSON.stringify(sys));
    assert.ok(sys.includes('이직원님이 방 이름·사진·초대·공지를 누구나 바꿀 수 있게 했습니다'));
    const dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    assert.equal((await ctx.owner.req('PATCH', `/api/chat/rooms/${dm}`, { ownerOnly: true })).status, 400, '1:1 은 없음');
  });

  test('D14 방장 넘기기: 이 방 사람에게만 · 새 방장이 관리, 예전 방장(직원)은 못 함 · 안내 메시지·감사 기록', async () => {
    const A = ctx.staffA.client, B = ctx.staffB.client;
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { ownerId: ctx.staffB.id })).status, 403, '방장이 아니면 못 넘김');
    assert.equal((await A.req('PATCH', `/api/chat/rooms/${P.g2}`, { ownerId: ctx.managerA.id })).status, 400, '방에 없는 사람');
    await A.ok('PATCH', `/api/chat/rooms/${P.g2}`, { ownerId: ctx.staffB.id });
    const d = await B.ok('GET', `/api/chat/rooms/${P.g2}`);
    assert.deepEqual([d.room.ownerId, d.room.canManage, d.members[0].id, d.members[0].is_owner], [ctx.staffB.id, true, ctx.staffB.id, true], '방장이 참여자 맨 위');
    assert.equal((await A.ok('GET', `/api/chat/rooms/${P.g2}`)).room.canManage, false);
    assert.equal((await A.req('PATCH', `/api/chat/rooms/${P.g2}`, { ownerOnly: true })).status, 403, '예전 방장은 못 함');
    assert.ok((await systemMsgs(P.g2)).includes('이직원님이 박직원님에게 방장을 넘겼습니다'));
    const [log] = await sql`select detail from audit_logs where action = 'chat.owner_transferred' and target_id = ${P.g2}`;
    assert.deepEqual([log.detail.from, log.detail.to], [ctx.staffA.id, ctx.staffB.id]);
    await B.ok('PATCH', `/api/chat/rooms/${P.g2}`, { ownerId: ctx.staffB.id }); // 이미 방장 = 그대로(안내 없음)
    assert.equal((await systemMsgs(P.g2)).filter((x) => x.includes('방장을 넘겼습니다')).length, 1);
  });

  test('D14 방 사진: 이 방에 올린 사진만 · 방 사람만 보기 · 목록·방 정보에 사진 · 지우기 · 회사 전체방은 대표·관리자만', async () => {
    const B = ctx.staffB.client;
    const key = await up(B, P.g2, '방사진.png', 'image/png', PNG);
    await B.ok('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: key });
    const d = await ctx.staffA.client.ok('GET', `/api/chat/rooms/${P.g2}`);
    assert.match(d.room.photo, new RegExp(`^/api/chat/rooms/${P.g2}/photo\\?v=[0-9a-f]{8}$`));
    assert.match((await rowOf(ctx.staffA.client, P.g2)).photo_v, /^[0-9a-f]{8}$/, '목록 줄에도');
    const r = await ctx.staffA.client.req('GET', `/api/chat/rooms/${P.g2}/photo`);
    assert.equal(r.status, 302); assert.match(r.headers.get('location') ?? '', /\/api\/files\/local\?key=/);
    assert.equal((await ctx.managerA.client.req('GET', `/api/chat/rooms/${P.g2}/photo`)).status, 404, '방 사람이 아니면 404');
    assert.ok((await systemMsgs(P.g2)).includes('박직원님이 방 사진을 바꿨습니다'));
    const txt = await up(B, P.g2, '메모.txt', 'text/plain');
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: txt })).status, 400, '사진만');
    const fake = await up(B, P.g2, '가짜.png', 'image/png', '<html>사진 아님</html>');
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: fake })).status, 400, '이름만 .png 인 파일은 안 됨(앞머리 검사)');
    const other = await up(ctx.owner, P.g, '다른방.png', 'image/png', PNG);
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: other })).status, 400, '다른 방에 올린 파일');
    assert.equal((await B.req('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: `chat/default/${P.g2}/없는파일/x.png` })).status, 400, '올리지 않은 파일');
    await B.ok('PATCH', `/api/chat/rooms/${P.g2}`, { photoKey: null });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${P.g2}`)).room.photo, null);
    assert.equal((await ctx.staffA.client.req('GET', `/api/chat/rooms/${P.g2}/photo`)).status, 404);
    // 회사 전체방: 직원은 못 바꾸고 대표는 바꿈 · 1:1 은 사진 없음
    const company = (await ctx.staffA.client.ok('GET', '/api/chat/rooms')).rooms.find((x) => x.kind === 'company').id;
    const ck = await up(ctx.staffA.client, company, '회사.png', 'image/png', PNG);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/chat/rooms/${company}`, { photoKey: ck })).status, 403);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${company}`)).room.canPhoto, false);
    await ctx.owner.ok('PATCH', `/api/chat/rooms/${company}`, { photoKey: ck });
    assert.ok((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${company}`)).room.photo);
    const dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    assert.equal((await ctx.owner.req('PATCH', `/api/chat/rooms/${dm}`, { photoKey: null })).status, 400, '1:1 은 상대 사진');
  });

  test('D15 방 안 검색: 찾는 말이 든 메시지 id(최신 순) · 멘션 이름·파일 이름도 · 지운 것·안내·초대 전은 빼고 · 방 사람만', async () => {
    const g3 = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '검색 시험방', userIds: [ctx.staffA.id] })).id;
    const s1 = await send(ctx.owner, '주간 회의록 공유합니다', g3);
    const s2 = await send(ctx.staffA.client, '내일 회의 9시 맞나요?', g3);
    const gone = await send(ctx.owner, '지울 회의 메모', g3);
    await ctx.owner.ok('DELETE', `/api/chat/messages/${gone.id}`);
    const s3 = await send(ctx.owner, `${at(ctx.staffA, '이직원')} 자료 확인 부탁`, g3);
    const f = await up(ctx.owner, g3, '회의 자료.pdf', 'application/pdf');
    const s4 = await ctx.owner.ok('POST', `/api/chat/rooms/${g3}/messages`, { body: '', file: { key: f, name: '회의 자료.pdf', mime: 'application/pdf', size: 1 } });
    const find = (c, q) => c.ok('GET', `/api/chat/rooms/${g3}/search?q=${encodeURIComponent(q)}`);
    assert.deepEqual((await find(ctx.staffA.client, '회의')).ids, [s4.id, s2.id, s1.id], '최신 순 · 지운 메시지 빼고 · 파일 이름도');
    assert.deepEqual((await find(ctx.staffA.client, '@이직원')).ids, [s3.id], '멘션은 보이는 글자(@이름)로');
    assert.deepEqual((await find(ctx.staffA.client, '이직원')).ids, [s3.id], '안내 메시지(초대했습니다)는 빼고');
    assert.deepEqual((await find(ctx.staffA.client, 'ab%_')).ids, [], '% _ 는 글자 그대로');
    assert.deepEqual((await find(ctx.staffA.client, '회의')).more, false);
    assert.equal((await ctx.staffA.client.req('GET', `/api/chat/rooms/${g3}/search?q=`)).status, 400);
    assert.equal((await ctx.staffB.client.req('GET', `/api/chat/rooms/${g3}/search?q=${encodeURIComponent('회의')}`)).status, 404, '방 사람만');
    await ctx.owner.ok('POST', `/api/chat/rooms/${g3}/members`, { userIds: [ctx.staffB.id] });
    assert.deepEqual((await find(ctx.staffB.client, '회의')).ids, [], '초대 전 대화는 검색에도 안 나옴');
    // 전체 검색 결과의 id 로 그 방 앞뒤를 불러오면(around) 그 메시지가 들어 있음 — 화면은 그 메시지로 옮겨 가 강조
    const hit = (await ctx.staffA.client.ok('GET', `/api/chat/search?q=${encodeURIComponent('회의록')}`)).results.find((m) => m.room_id === g3);
    assert.equal(hit.id, s1.id);
    assert.ok((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${g3}?around=${hit.id}`)).messages.some((m) => m.id === s1.id));
  });
});
