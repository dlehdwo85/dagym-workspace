// 메신저 카톡 수준 1차(대표 10/20, docs/handoff/MESSENGER_KAKAO_LEVEL_2026-10-20.md A1~3 + B5·6·7):
// 그룹 자동 이름·방장·시스템 메시지, 초대 이후 메시지만(방장 '이전 대화 공개'), 내보내기 권한, 나가기 방장 넘김, 전달(여러 방), 안 읽은 수·이름, 사진/파일/링크 모아보기
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('메신저 1차', () => {
  test('A1 그룹 만들기: 이름 비우면 "A, B, C 외 n" 자동, 만든 사람이 방장, 초대 시스템 메시지(글쓴이 없음·알림 없음)', async () => {
    const r = await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', userIds: [ctx.staffA.id, ctx.staffB.id] });
    P.g = r.id;
    assert.equal(r.name, '김대표, 박직원, 이직원', '만든 사람 먼저, 나머지는 이름순');
    const d = await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.deepEqual([d.room.ownerId, d.room.canManage, d.room.historyVisible], [ctx.ownerId, true, false]);
    assert.equal(d.messages.length, 1); assert.equal(d.messages[0].kind, 'system'); assert.equal(d.messages[0].author_id, null);
    assert.match(d.messages[0].body, /김대표님이 .*님을 초대했습니다/);
    assert.ok(d.members.find((m) => m.id === ctx.ownerId).is_owner && d.members[0].id === ctx.ownerId, '방장 먼저');
    assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${P.g}`)).room.canManage, false, '직원은 관리 불가');
    assert.equal((await sql`select count(*)::int n from notifications where type = 'chat' and entity_id = ${P.g}`)[0].n, 0, '시스템 메시지는 알림 없음');
    const named = await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: ' 직접 이름 ', userIds: [ctx.staffA.id] });
    assert.equal(named.name, '직접 이름');
  });

  test('A3 초대: 초대 시점 이후 메시지만 보임(목록 안 읽은 수·검색도), 이미 있는 사람은 건너뜀, 시스템 메시지 / 방장 "이전 대화 공개" → 처음부터', async () => {
    P.m1 = (await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '초대 전 비밀 이야기' })).id;
    P.m2 = (await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '초대 전 두 번째' })).id;
    const r = await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/members`, { userIds: [ctx.managerA.id, ctx.staffA.id] });
    assert.equal(r.added, 1, '이미 있는 이직원은 건너뜀');
    const d = await ctx.managerA.client.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.ok(!d.messages.some((m) => m.id === P.m1 || m.id === P.m2), '초대 전 메시지는 안 보임');
    assert.ok(d.messages.some((m) => m.kind === 'system' && /최매니저님을 초대했습니다/.test(m.body)), '초대 시스템 메시지는 보임');
    assert.equal(d.room.joinedAfter, P.m2);
    const list = (await ctx.managerA.client.ok('GET', '/api/chat/rooms')).rooms.find((x) => x.id === P.g);
    assert.equal(list.unread, 0, '초대 전 메시지는 안 읽은 수에 안 들어감');
    assert.equal((await ctx.managerA.client.ok('GET', '/api/chat/search?q=' + encodeURIComponent('비밀 이야기'))).results.length, 0, '검색도 초대 이후만');
    P.m3 = (await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '초대 뒤 이야기' })).id;
    assert.equal((await ctx.managerA.client.ok('GET', '/api/chat/rooms')).rooms.find((x) => x.id === P.g).unread, 1);
    // 방장 아닌 사람은 이전 대화 공개 불가 → 방장이 켜면 처음부터
    assert.equal((await ctx.staffA.client.patch(`/api/chat/rooms/${P.g}`, { historyVisible: true })).status, 403);
    await ctx.owner.ok('PATCH', `/api/chat/rooms/${P.g}`, { historyVisible: true });
    const d2 = await ctx.managerA.client.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.ok(d2.messages.some((m) => m.id === P.m1) && d2.room.historyVisible, '공개 뒤 처음부터');
    await ctx.owner.ok('PATCH', `/api/chat/rooms/${P.g}`, { historyVisible: false });
  });

  test('A2 내보내기: 방장·관리자만(직원 403), 본인은 나가기로(400), 시스템 메시지 / 나가기: 방장이 나가면 가장 오래된 사람에게 방장', async () => {
    assert.equal((await ctx.staffA.client.req('DELETE', `/api/chat/rooms/${P.g}/members`, { userId: ctx.staffB.id })).status, 403);
    assert.equal((await ctx.owner.req('DELETE', `/api/chat/rooms/${P.g}/members`, { userId: ctx.ownerId })).status, 400);
    await ctx.owner.ok('DELETE', `/api/chat/rooms/${P.g}/members`, { userId: ctx.staffB.id });
    assert.equal((await ctx.staffB.client.get(`/api/chat/rooms/${P.g}`)).status, 404, '내보내진 사람은 못 봄');
    const d = await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.ok(d.messages.some((m) => m.kind === 'system' && /박직원님을 내보냈습니다/.test(m.body)));
    assert.ok((await sql`select 1 from audit_logs where action = 'chat.member_removed'`).length);
    await ctx.owner.ok('DELETE', `/api/chat/rooms/${P.g}`); // 방장 나가기
    const d2 = await ctx.staffA.client.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.ok(d2.messages.some((m) => m.kind === 'system' && /김대표님이 나갔습니다/.test(m.body)));
    assert.equal(d2.room.ownerId, ctx.staffA.id, '가장 오래된 참여자가 새 방장'); assert.equal(d2.room.canManage, true);
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/members`, { userIds: [ctx.ownerId] });
  });

  test('B5 전달: 여러 방에 한 번에(kind forward·원본 id·파일 같은 키), 내가 없는 방 404, 시스템/삭제 메시지 400, 받는 쪽 알림 "(전달)"', async () => {
    P.dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffB.id })).id;
    const g2 = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '전달 받는 방', userIds: [ctx.managerA.id] })).id;
    const r = await ctx.owner.ok('POST', `/api/chat/messages/${P.m3}/forward`, { roomIds: [P.dm, g2] });
    assert.equal(r.sent.length, 2);
    const inDm = (await ctx.staffB.client.ok('GET', `/api/chat/rooms/${P.dm}`)).messages.find((m) => m.id === r.sent[0]);
    assert.deepEqual([inDm.kind, inDm.forward_of, inDm.body], ['forward', P.m3, '초대 뒤 이야기']);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffB.id} and type = 'chat' and body like '%(전달)%'`).length, '받는 쪽 알림');
    const other = (await ctx.staffA.client.ok('POST', '/api/chat/rooms', { kind: 'group', name: '대표 없는 방', userIds: [ctx.staffB.id] })).id;
    assert.equal((await ctx.owner.req('POST', `/api/chat/messages/${P.m3}/forward`, { roomIds: [other] })).status, 404, '내가 없는 방으로는 못 보냄');
    const sysId = (await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((m) => m.kind === 'system').id;
    assert.equal((await ctx.owner.req('POST', `/api/chat/messages/${sysId}/forward`, { roomIds: [P.dm] })).status, 400);
  });

  test('B7 안 읽은 수: 메시지마다 unread(초대 이후 사람만) → 읽으면 줄고, 안 읽은 사람 이름', async () => {
    const m = await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '누가 읽었나' });
    const row = () => ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`).then((d) => d.messages.find((x) => x.id === m.id));
    assert.equal((await row()).unread, 2, '이직원·최매니저');
    assert.deepEqual((await ctx.owner.ok('GET', `/api/chat/messages/${m.id}/unread`)).names, ['이직원', '최매니저']);
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/read`, {});
    assert.equal((await row()).unread, 1);
    assert.deepEqual((await ctx.owner.ok('GET', `/api/chat/messages/${m.id}/unread`)).names, ['최매니저']);
  });

  test('A2 사진·파일·링크 모아보기(초대 이후만)', async () => {
    await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '자료 https://example.com/a 와 https://example.com/b' });
    const [f] = await sql`insert into chat_messages (room_id, author_id, body, file_key, file_name, file_mime, file_size) values (${P.g}, ${ctx.ownerId}, '', 'chat/x.png', '사진.png', 'image/png', 10) returning id::text`;
    await sql`insert into chat_messages (room_id, author_id, body, file_key, file_name, file_mime, file_size) values (${P.g}, ${ctx.ownerId}, '', 'chat/y.pdf', '안내.pdf', 'application/pdf', 20)`;
    const m = await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}/media`);
    assert.deepEqual([m.images.map((x) => x.id), m.files.map((x) => x.file_name), m.links.map((x) => x.url)], [[f.id], ['안내.pdf'], ['https://example.com/a', 'https://example.com/b']]);
    assert.equal((await ctx.staffB.client.get(`/api/chat/rooms/${P.g}/media`)).status, 404, '내보내진 사람');
  });
});
