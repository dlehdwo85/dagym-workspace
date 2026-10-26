// 메신저 2차(대표 10/20 카톡 수준, docs/handoff/MESSENGER_KAKAO_LEVEL_2026-10-20.md B8~B11):
// 사진 묶음(안 읽은 수 1·알림 1)·영상 바로 재생·스티커·반응 16개/자주 쓰는 반응·투표·일정 잡기·@전체·답장 원문 이동(around/after)·처음 열 때 안 읽은 만큼
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
const ALL = '00000000-0000-0000-0000-000000000000';
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  P.g = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '2차 시험방', userIds: [ctx.staffA.id, ctx.staffB.id] })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
/** 대화방 파일 올리기(로컬 저장소) → 메시지에 붙일 file */
const up = async (c, room, name, mime, data = 'x') => {
  const t = await c.ok('POST', `/api/chat/rooms/${room}/files`, { fileName: name, mime, size: data.length });
  await fetch(BASE + t.upload.url, { method: 'PUT', headers: t.upload.headers, body: Buffer.from(data) });
  return { key: t.key, name, mime, size: data.length };
};
const lastChatNotif = async (userId, room) => (await sql`select body from notifications where user_id = ${userId} and type = 'chat' and entity_id = ${room} order by created_at desc, id desc limit 1`)[0]?.body;

describe('메신저 2차', () => {
  test('B8 사진 묶음: 같은 batch 3장 = 한 묶음, 받는 사람 안 읽은 수 1·알림 1번 "사진 3장" / 영상은 대화창에서 바로 재생(inline)', async () => {
    const batch = crypto.randomUUID();
    const ids = [];
    for (const n of ['a.jpg', 'b.jpg', 'c.png']) {
      const f = await up(ctx.owner, P.g, n, n.endsWith('png') ? 'image/png' : 'image/jpeg');
      ids.push((await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '', file: f, batch, batchSize: 3 })).id);
    }
    const d = await ctx.staffA.client.ok('GET', `/api/chat/rooms/${P.g}`);
    assert.deepEqual(d.messages.filter((m) => ids.includes(m.id)).map((m) => m.batch_id), [batch, batch, batch]);
    const row = (await ctx.staffA.client.ok('GET', '/api/chat/rooms')).rooms.find((r) => r.id === P.g);
    assert.deepEqual([row.unread, row.last_mime, row.last_kind], [1, 'image/png', 'text'], '묶음은 안 읽은 수 1');
    assert.equal((await ctx.staffA.client.ok('GET', '/api/chat/unread')).unread, 1, '앱 배지 숫자도 1');
    const n = await sql`select body from notifications where user_id = ${ctx.staffA.id} and type = 'chat' and entity_id = ${P.g}`;
    assert.equal(n.length, 1, '알림 1번'); assert.match(n[0].body, /^김대표: 📷 사진 3장$/);
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${P.g}/messages`, { body: '글만', batch })).status, 400, '묶음은 사진·영상만');
    const v = await up(ctx.owner, P.g, '현장.mp4', 'video/mp4');
    const vm = (await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '', file: v })).id;
    assert.equal(await lastChatNotif(ctx.staffA.id, P.g), '김대표: 🎬 동영상');
    const res = await fetch(`${BASE}/api/chat/messages/${vm}/file?inline=1`, { headers: { cookie: ctx.staffA.client.cookie }, redirect: 'manual' });
    assert.equal(res.status, 302); assert.match(res.headers.get('location'), /inline=1/, '영상도 바로 재생');
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/read`, {});
  });

  test('답장 인용 라벨(로컬 10/25 사소 ②): 사진 묶음에 답장하면 reply.mime·n(장 수) — 화면은 파일 이름 대신 "📷 사진 3장" · 글에 답장은 n 1', async () => {
    const batch = crypto.randomUUID(); const ids = [];
    for (const n of ['x.jpg', 'y.jpg', 'z.jpg']) {
      const f = await up(ctx.owner, P.g, n, 'image/jpeg');
      ids.push((await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '', file: f, batch, batchSize: 3 })).id);
    }
    const r = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '사진 잘 봤어요', replyTo: ids[0] });
    const m = (await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((x) => x.id === r.id);
    assert.deepEqual([m.reply.file, m.reply.mime, m.reply.n], ['x.jpg', 'image/jpeg', 3]);
    const t = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '글 답장', replyTo: r.id });
    const m2 = (await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((x) => x.id === t.id);
    assert.deepEqual([m2.reply.body, m2.reply.file, m2.reply.n], ['사진 잘 봤어요', null, 1]);
  });

  test('B10 스티커: 코드 → kind sticker·body 글·목록 미리보기·알림 "(스티커)", 없는 코드·파일과 같이·고치기 400 / 반응 16개·자주 쓰는 반응 6개(많이 쓴 순)', async () => {
    const s = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/messages`, { sticker: 'thanks' });
    const m = (await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((x) => x.id === s.id);
    assert.deepEqual([m.kind, m.sticker, m.body], ['sticker', 'thanks', '감사합니다']);
    const row = (await ctx.owner.ok('GET', '/api/chat/rooms')).rooms.find((r) => r.id === P.g);
    assert.deepEqual([row.last_kind, row.last_body], ['sticker', '감사합니다']);
    assert.equal(await lastChatNotif(ctx.ownerId, P.g), '이직원: (스티커) 감사합니다');
    assert.equal((await ctx.staffA.client.req('POST', `/api/chat/rooms/${P.g}/messages`, { sticker: 'nope' })).status, 400);
    const f = await up(ctx.staffA.client, P.g, 'd.png', 'image/png');
    assert.equal((await ctx.staffA.client.req('POST', `/api/chat/rooms/${P.g}/messages`, { sticker: 'ok', file: f })).status, 400);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/chat/messages/${s.id}`, { body: '고침' })).status, 400, '스티커는 고칠 수 없음');
    // 반응: 새로 쓸 수 있는 🔥 2번·👏 1번 → 자주 쓰는 반응 앞으로, 목록에 없는 이모지 400
    const t1 = (await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '반응 1' })).id;
    const t2 = (await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '반응 2' })).id;
    await ctx.owner.ok('POST', `/api/chat/messages/${t1}/react`, { emoji: '🔥' });
    await ctx.owner.ok('POST', `/api/chat/messages/${t2}/react`, { emoji: '🔥' });
    await ctx.owner.ok('POST', `/api/chat/messages/${t2}/react`, { emoji: '👏' });
    assert.equal((await ctx.owner.req('POST', `/api/chat/messages/${t1}/react`, { emoji: '🍕' })).status, 400);
    const q = (await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).quickReactions;
    assert.deepEqual(q, ['🔥', '👏', '👍', '❤️', '😂', '😮']);
    assert.deepEqual((await ctx.staffB.client.ok('GET', `/api/chat/rooms/${P.g}`)).quickReactions, ['👍', '❤️', '😂', '😮', '🙏', '✅'], '처음 쓰는 사람은 기본 6개');
  });

  test('B9 투표: 보기 1개·같은 보기·지난 마감 400 → 하나만 선택(바꾸기·둘 400·없는 보기 400·취소) → 실시간 전달 → 마감(만든 사람만·시스템 메시지·마감 뒤 400)·전달 400 / 여러 개·익명·마감 시각 지나면 자동 마감', async () => {
    const base = { question: '점심' };
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${P.g}/messages`, { poll: { ...base, options: ['짜장'] } })).status, 400);
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${P.g}/messages`, { poll: { ...base, options: ['짜장', ' 짜장'] } })).status, 400, '같은 보기');
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${P.g}/messages`, { poll: { ...base, options: ['짜장', '짬뽕'], closesAt: new Date(Date.now() - 60000).toISOString() } })).status, 400, '지난 마감');
    const p = await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { poll: { question: '회식 날짜', options: ['금요일', '다음 주 화요일', '다음 주 목요일'] } });
    const poll = async (c = ctx.owner) => (await c.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((x) => x.id === p.id);
    let x = await poll();
    assert.deepEqual([x.kind, x.body], ['poll', '회식 날짜']);
    assert.deepEqual([x.poll.options.length, x.poll.counts, x.poll.mine, x.poll.voters, x.poll.closed, x.poll.multi, x.poll.anonymous], [3, [0, 0, 0], [], 0, false, false, false]);
    assert.equal(await lastChatNotif(ctx.staffA.id, P.g), '김대표: 📊 투표: 회식 날짜');
    await ctx.staffA.client.ok('POST', `/api/chat/messages/${p.id}/poll`, { vote: [0] });
    await ctx.staffB.client.ok('POST', `/api/chat/messages/${p.id}/poll`, { vote: [0] });
    await ctx.staffB.client.ok('POST', `/api/chat/messages/${p.id}/poll`, { vote: [2] }); // 바꾸기
    assert.equal((await ctx.staffA.client.req('POST', `/api/chat/messages/${p.id}/poll`, { vote: [0, 1] })).status, 400, '하나만 고를 수 있음');
    assert.equal((await ctx.staffA.client.req('POST', `/api/chat/messages/${p.id}/poll`, { vote: [5] })).status, 400, '없는 보기');
    x = (await poll(ctx.staffA.client)).poll;
    assert.deepEqual([x.counts, x.mine, x.voters, x.names], [[1, 0, 1], [0], 2, { 0: ['이직원'], 2: ['박직원'] }]);
    const t0 = Date.now() - 1500;
    await ctx.staffA.client.ok('POST', `/api/chat/messages/${p.id}/poll`, { vote: [] }); // 취소
    const live = await ctx.owner.ok('GET', `/api/chat/poll?since=${p.id}&t=${t0}`);
    assert.deepEqual(live.messages.find((m) => m.id === p.id)?.poll.counts, [0, 0, 1], '바뀐 표 수가 실시간으로');
    assert.equal((await ctx.staffA.client.req('POST', `/api/chat/messages/${p.id}/poll`, { close: true })).status, 403, '만든 사람·방장만 마감');
    await ctx.owner.ok('POST', `/api/chat/messages/${p.id}/poll`, { close: true });
    assert.equal((await poll()).poll.closed, true);
    assert.equal((await ctx.staffB.client.req('POST', `/api/chat/messages/${p.id}/poll`, { vote: [1] })).status, 400, '마감 뒤 투표 안 됨');
    assert.ok((await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).messages.some((m) => m.kind === 'system' && m.body === '김대표님이 투표를 마감했습니다: 회식 날짜'));
    assert.equal((await ctx.owner.req('POST', `/api/chat/messages/${p.id}/forward`, { roomIds: [P.g] })).status, 400, '투표는 전달 안 됨');
    // 여러 개 + 익명 + 마감 시각
    const q = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/messages`, { poll: { question: '필요한 간식', options: ['커피', '과일', '빵'], multi: true, anonymous: true, closesAt: new Date(Date.now() + 864e5).toISOString() } });
    await ctx.owner.ok('POST', `/api/chat/messages/${q.id}/poll`, { vote: [2, 0] });
    const y = (await ctx.staffB.client.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((m) => m.id === q.id).poll;
    assert.deepEqual([y.counts, y.mine, y.voters, y.names, y.multi, y.anonymous, !!y.closes_at, y.closed], [[1, 0, 1], [], 1, null, true, true, true, false], '익명은 이름 없음');
    await sql`update chat_polls set closes_at = now() - interval '1 minute' where message_id = ${q.id}::bigint`;
    assert.equal((await ctx.owner.req('POST', `/api/chat/messages/${q.id}/poll`, { vote: [1] })).status, 400, '마감 시각이 지나면 자동 마감');
    assert.equal((await ctx.owner.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((m) => m.id === q.id).poll.closed, true);
  });

  test('B9 일정 잡기: 내 개인 캘린더에 일정(참석자 = 방 참여자·고르기·글 붙임) + 방에 일정 카드, 참석 → 카드 참석 수, 방에 없는 사람 400, 대화 알림 대신 일정 초대 알림, 종일', async () => {
    // 모레 오후 3시(KST) 고정 — '지금+2일 정각'이면 시험이 밤 11시(KST)에 돌 때 23:00~00:00 이 이틀에 걸쳐 카드 문구가 달라짐(188차 CI 1489·1490)
    const start = new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 2 * 864e5))}T15:00:00+09:00`);
    const end = new Date(start.getTime() + 3600e3);
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${P.g}/event`, { title: '외부인', start: start.toISOString(), end: end.toISOString(), attendeeIds: [ctx.managerA.id] })).status, 400, '방에 없는 사람');
    const m0 = (await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: '모레 오후 3시 현장 점검 같이 가요' })).id;
    const r = await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/event`, { title: '현장 점검', start: start.toISOString(), end: end.toISOString(), location: '강남점', fromMessage: m0 });
    assert.equal(r.invited, 2);
    const [ev] = await sql`select e.title, e.location, e.description, c.type, c.owner_user_id from events e join calendars c on c.id = e.calendar_id where e.id = ${r.eventId}`;
    assert.deepEqual([ev.title, ev.location, ev.type, ev.owner_user_id], ['현장 점검', '강남점', 'personal', ctx.ownerId]);
    assert.match(ev.description, /메시지: 모레 오후 3시 현장 점검 같이 가요/); assert.match(ev.description, /메신저 "2차 시험방"에서 잡은 일정/);
    const att = await sql`select user_id, response from event_attendees where event_id = ${r.eventId}`;
    assert.equal(att.length, 3); assert.equal(att.find((a) => a.user_id === ctx.ownerId).response, 'accepted');
    const card = async (c, id = r.id) => (await c.ok('GET', `/api/chat/rooms/${P.g}`)).messages.find((x) => x.id === id);
    let c = await card(ctx.staffA.client);
    assert.deepEqual([c.kind, c.event.title, c.event.going, c.event.invited, c.event.response, c.event.location, c.event.cancelled], ['event', '현장 점검', 1, 3, 'needsAction', '강남점', false]);
    assert.match(c.body, /^📅 현장 점검 · \d+월 \d+일 \(.\) 오[전후] \d+:00~오[전후] \d+:00$/);
    const t0 = Date.now() - 1500;
    await ctx.staffA.client.ok('POST', `/api/events/${r.eventId}/respond`, { response: 'accepted' });
    c = await card(ctx.staffA.client); assert.deepEqual([c.event.going, c.event.response], [2, 'accepted']);
    assert.equal((await ctx.owner.ok('GET', `/api/chat/poll?since=${r.id}&t=${t0}`)).messages.find((m) => m.id === r.id)?.event.going, 2, '참석 수가 실시간으로');
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffB.id} and type = 'event_changed' and entity_id = ${r.eventId}`).length, '일정 초대 알림');
    assert.equal((await sql`select count(*)::int n from notifications where type = 'chat' and dedupe_key = ${'chat:' + r.id}`)[0].n, 0, '대화 알림은 따로 안 보냄');
    // 참석자 고르기(박직원만) + 종일
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 3 * 864e5));
    const next = new Date(Date.parse(`${day}T00:00:00+09:00`) + 864e5).toISOString();
    const r2 = await ctx.owner.ok('POST', `/api/chat/rooms/${P.g}/event`, { title: '종일 교육', start: `${day}T00:00:00+09:00`, end: next, allDay: true, attendeeIds: [ctx.staffB.id] });
    assert.equal(r2.invited, 1);
    const c2 = await card(ctx.owner, r2.id);
    assert.deepEqual([c2.event.all_day, c2.event.invited], [true, 2]); assert.match(c2.body, / 종일$/);
    assert.equal((await card(ctx.staffA.client, r2.id)).event.response, null, '초대 안 된 사람은 응답 버튼 없음');
  });

  test('B11 @전체: 그룹방은 모두 멘션(알림 끈 사람에게도), 회사 전체방은 직원이 쓰면 글자만·대표는 모두, 1:1 은 안 됨', async () => {
    await ctx.staffB.client.ok('PATCH', `/api/chat/rooms/${P.g}`, { muted: true });
    const m = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.g}/messages`, { body: `@[전체](${ALL}) 내일 9시 회의입니다` });
    const [row] = await sql`select mentions from chat_messages where id = ${m.id}::bigint`;
    assert.deepEqual([...row.mentions].sort(), [ctx.ownerId, ctx.staffB.id].sort());
    assert.ok(m.notified.includes(ctx.staffB.id), '알림 끈 사람에게도');
    assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${P.g}`)).room.canMentionAll, true);
    const company = (await ctx.staffA.client.ok('GET', '/api/chat/rooms')).rooms.find((r) => r.kind === 'company').id;
    assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${company}`)).room.canMentionAll, false);
    const s = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${company}/messages`, { body: `@[전체](${ALL}) 공지` });
    const [r2] = await sql`select mentions, body from chat_messages where id = ${s.id}::bigint`;
    assert.deepEqual([r2.mentions.length, r2.body], [0, '@전체 공지'], '직원은 회사 전체방 @전체 = 글자만');
    const o = await ctx.owner.ok('POST', `/api/chat/rooms/${company}/messages`, { body: `@[전체](${ALL}) 대표 공지` });
    assert.equal((await sql`select cardinality(mentions) n from chat_messages where id = ${o.id}::bigint`)[0].n, 3, '대표는 회사 전체 모두');
    const dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    assert.equal((await ctx.owner.ok('GET', `/api/chat/rooms/${dm}`)).room.canMentionAll, false);
    await ctx.staffB.client.ok('PATCH', `/api/chat/rooms/${P.g}`, { muted: false });
  });

  test('B11 답장 원문 이동(around 앞 30·뒤 40)·이어 불러오기(after 60)·처음 열 때 안 읽은 것이 많으면 그만큼(+10, 최대 300)·lastRead·초대 전은 around 로도 안 보임', async () => {
    const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '긴 방', userIds: [ctx.staffA.id] })).id;
    const rows = await sql`insert into chat_messages (room_id, author_id, body) select ${room}, ${ctx.ownerId}, '메시지 ' || g from generate_series(1, 100) g returning id::text`;
    const ids = rows.map((x) => x.id).sort((a, b) => Number(a) - Number(b));
    const d = await ctx.staffA.client.ok('GET', `/api/chat/rooms/${room}`);
    assert.deepEqual([d.messages.length, d.hasOlder, d.lastRead], [101, false, '0'], '안 읽은 101개(안내 1 + 100) 모두');
    await sql`update chat_members set last_read_id = ${ids[59]}::bigint where room_id = ${room} and user_id = ${ctx.ownerId}`;
    const o = await ctx.owner.ok('GET', `/api/chat/rooms/${room}`);
    assert.deepEqual([o.messages.length, o.hasOlder, o.lastRead], [60, true, ids[59]], '안 읽은 것이 적으면 60개');
    const a = await ctx.owner.ok('GET', `/api/chat/rooms/${room}?around=${ids[9]}`);
    assert.ok(a.messages.some((m) => m.id === ids[9]));
    assert.deepEqual([a.messages.length, a.hasOlder, a.hasNewer], [50, false, true], '앞 10(안내 포함)·뒤 40');
    const nx = await ctx.owner.ok('GET', `/api/chat/rooms/${room}?after=${a.messages.at(-1).id}`);
    assert.deepEqual([nx.messages[0].id, nx.messages.length, nx.hasNewer], [ids[49], 51, false]);
    await ctx.owner.ok('POST', `/api/chat/rooms/${room}/members`, { userIds: [ctx.staffB.id] });
    assert.ok(!(await ctx.staffB.client.ok('GET', `/api/chat/rooms/${room}?around=${ids[9]}`)).messages.some((m) => m.id === ids[9]), '초대 전 메시지는 안 보임');
    assert.equal((await ctx.owner.req('GET', `/api/chat/rooms/${room}?around=abc`)).status, 200, '잘못된 값은 처음 열기로');
  });
});
