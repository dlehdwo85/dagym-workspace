// V30 ⑥ (#74) 녹음 → 회의록 AI 요약: 녹음 파일(자료실) → STT(가짜 OpenAI) → 요약·결정·할 일(가짜 Anthropic) → event_minutes 저장·사용량 stt/minutes·녹음 파일 삭제
// → 할 일 후보를 후속 업무로 → 월 녹음 한도(무료 30분) 429 → 참석자 아닌 사람 403
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const AUDIO = Buffer.alloc(12000, 1);
async function upLib(c, name, mime, data) {
  const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder: '회의 녹음', tags: ['회의 녹음'], purpose: 'ai_attach' });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  await c.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}
const P = {};
before(async () => {
  await resetDb(); await ensureTls();
  fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  // 시험 회사는 internal 요금제(600분) — 요금제 limits.minutesPerMonth 로 월 한도를 정할 수 있음을 함께 확인(30분)
  await sql`update plans set limits = coalesce(limits, '{}'::jsonb) || '{"minutesPerMonth": 30}'::jsonb where code = 'internal'`;
  const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
  const cal = cals.find((c) => c.type === 'company') ?? cals[0];
  const d = addDays(seoulToday(), 1);
  P.ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: '강남점 운영 회의', start: `${d}T14:00:00+09:00`, end: `${d}T15:00:00+09:00`, attendeeIds: [ctx.staffA.id] })).id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('#74 녹음 → 회의록', () => {
  test('GET: 회의록 없음 · 무료 월 30분 · 분당 원가 · STT 준비됨', async () => {
    const r = await ctx.staffA.client.ok('GET', `/api/events/${P.ev}/minutes`);
    assert.deepEqual([r.items, r.quota, r.sttReady, r.canWork], [[], { capMin: 30, usedMin: 0 }, true, true]);
    assert.ok(r.perMinKrw >= 1); assert.equal(r.maxSec, 3600);
  });
  test('참석자가 녹음 파일 → 받아쓰기 → 요약·결정·할 일 JSON → 저장, 사용량 stt+minutes, 녹음 파일은 지움, 카드 원가(원)', async () => {
    const audio = await upLib(ctx.staffA.client, '회의 녹음.webm', 'audio/webm', AUDIO);
    await queue([say(JSON.stringify({ summary: '강남점 간판 교체와 전단지 일정을 논의했습니다.', decisions: ['간판은 다음 주 수요일까지 견적 2곳을 받는다', '전단지 초안은 금요일 대표 확인'],
      todos: [{ title: '강남점 간판 교체 견적', assignee: '이직원', due: addDays(seoulToday(), 7), detail: '견적 2곳' }, { title: '전단지 초안 검토', assignee: null, due: null, detail: '금요일 대표 확인' }] }))]);
    const n0 = (await fakeState()).openai.length;
    const r = await ctx.staffA.client.ok('POST', `/api/events/${P.ev}/minutes`, { audioFileId: audio, duration: 600 });
    assert.equal(r.ok, true);
    assert.match(r.minutes.transcript, /간판 교체 견적/); assert.match(r.minutes.summary, /간판 교체/);
    assert.equal(r.minutes.decisions.length, 2); assert.equal(r.minutes.todos.length, 2); assert.equal(r.minutes.todos[0].assignee, '이직원');
    assert.equal(r.minutes.durationSec, 600); assert.ok(r.minutes.costKrw >= 1, '약 N원'); assert.equal(r.minutes.createdByName, '이직원');
    assert.deepEqual(r.quota, { capMin: 30, usedMin: 10 });
    const st = await fakeState();
    assert.equal(st.openai.length - n0, 1, 'STT 1번'); assert.equal(st.openai.at(-1).kind, 'transcription');
    const req = st.anthropic.at(-1).body;
    assert.match(req.system, /회의: "강남점 운영 회의"/); assert.match(req.system, /참석자: 이직원/);
    assert.match(req.messages[0].content[0].text, /\[회의 녹취\]\n다음 주 수요일까지/);
    assert.ok((await sql`select deleted_at from library_files where id = ${audio}`)[0].deleted_at, '녹음 파일은 쓰고 지움');
    const u = await sql`select purpose, cost_usd::float8 cost from ai_usage where user_id = ${ctx.staffA.id} and purpose in ('stt', 'minutes') order by purpose`;
    assert.deepEqual(u.map((x) => x.purpose), ['minutes', 'stt']); assert.ok(u[1].cost > 0);
    const list = await ctx.owner.ok('GET', `/api/events/${P.ev}/minutes`);
    assert.equal(list.items.length, 1); assert.equal(list.items[0].id, r.minutes.id); assert.equal(list.quota.usedMin, 10);
    P.todo = r.minutes.todos[0];
  });
  test('할 일 후보 → 후속 업무(noteLine = 제목) → 연결 업무에 followup 으로 · 담당자 알림', async () => {
    const t = await ctx.staffA.client.ok('POST', `/api/events/${P.ev}/tasks`, { title: P.todo.title, assigneeId: ctx.staffA.id, dueDate: P.todo.due, noteLine: P.todo.title });
    const linked = (await ctx.staffA.client.ok('GET', `/api/events/${P.ev}/tasks`)).tasks;
    const l = linked.find((x) => x.id === t.id);
    assert.equal(l.link_role, 'followup'); assert.equal(l.note_line, P.todo.title); assert.equal(l.due_date?.slice(0, 10) ?? l.due_date, P.todo.due);
  });
  test('월 한도: 무료 30분 — 남은 20분보다 긴 녹음은 429 minutes_quota(파일은 그대로) · 60분 넘는 duration 은 400', async () => {
    const audio = await upLib(ctx.staffA.client, '긴 회의.webm', 'audio/webm', AUDIO);
    const r = await ctx.staffA.client.req('POST', `/api/events/${P.ev}/minutes`, { audioFileId: audio, duration: 1500 });
    assert.equal(r.status, 429); assert.equal(r.body.error.code, 'minutes_quota'); assert.match(JSON.stringify(r.body), /30분/);
    assert.equal((await sql`select deleted_at from library_files where id = ${audio}`)[0].deleted_at, null, '한도 때문에 안 썼으면 파일은 남음');
    assert.equal((await ctx.staffA.client.req('POST', `/api/events/${P.ev}/minutes`, { audioFileId: audio, duration: 3601 })).status, 400);
    // 20분은 됨(합계 30분)
    await queue([say(JSON.stringify({ summary: '짧은 회의', decisions: [], todos: [] }))]);
    const ok = await ctx.staffA.client.ok('POST', `/api/events/${P.ev}/minutes`, { audioFileId: audio, duration: 1200 });
    assert.deepEqual(ok.quota, { capMin: 30, usedMin: 30 });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/events/${P.ev}/minutes`)).items.length, 2);
  });
  test('참석자·작성자가 아닌 사람은 403 · 남의 녹음 파일 400 · 음성 아닌 파일 400', async () => {
    const mine = await upLib(ctx.staffB.client, '남의 회의.webm', 'audio/webm', AUDIO);
    assert.equal((await ctx.staffB.client.req('POST', `/api/events/${P.ev}/minutes`, { audioFileId: mine, duration: 60 })).status, 403);
    const owner = (await ctx.owner.req('POST', `/api/events/${P.ev}/minutes`, { audioFileId: mine, duration: 60 }));
    assert.equal(owner.status, 400, '남이 올린 파일');
    const doc = await upLib(ctx.owner, '메모.txt', 'text/plain', Buffer.from('hello'));
    assert.equal((await ctx.owner.req('POST', `/api/events/${P.ev}/minutes`, { audioFileId: doc, duration: 60 })).status, 400);
  });
});
