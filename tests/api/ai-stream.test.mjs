// #497 R44: AI 비서 답을 글자 단위로(SSE) — 시작(대화 id) → 글 조각 → 도구 단계 → 끝(지금 응답과 같은 모양) · 사전 점검 오류는 HTTP 오류 · 시작 뒤 오류는 error 이벤트 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });

/** 스트리밍으로 묻고 이벤트를 받은 순서대로(받은 시각 포함) */
async function ask(body) {
  const res = await fetch(BASE + '/api/ai/chat', { method: 'POST', headers: { origin: BASE, cookie: ctx.owner.cookie, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ ...body, stream: true }) });
  if (!(res.headers.get('content-type') ?? '').includes('text/event-stream')) return { res, events: [], json: await res.json() };
  const events = []; const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    for (let k = buf.indexOf('\n\n'); k >= 0; k = buf.indexOf('\n\n')) {
      const line = buf.slice(0, k).split('\n').find((l) => l.startsWith('data:')); buf = buf.slice(k + 2);
      if (line) events.push({ at: Date.now(), ...JSON.parse(line.slice(5)) });
    }
  }
  return { res, events };
}

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('AI 비서 스트리밍', () => {
  test('글이 조각으로 먼저 오고(시작 → 글 → 끝), 끝 내용은 지금 응답과 같고 대화에 저장 · AI 호출도 stream', async () => {
    const n0 = (await fakeState()).anthropic.length;
    const text = '## 이번 주 정리\n\n**마감 2건**이 남았습니다.\n\n- 견적서 보내기\n- 회의록 정리\n\n| 업무 | 마감 |\n| --- | --- |\n| 견적서 | 금 |';
    await queue([say(text, { chunkDelayMs: 40 })]);
    const { res, events } = await ask({ text: '이번 주 내 업무 정리해줘' });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    assert.equal(events[0].type, 'start');
    const deltas = events.filter((e) => e.type === 'text');
    assert.ok(deltas.length >= 4, `글 조각 ${deltas.length}개`);
    assert.equal(deltas.map((e) => e.delta).join(''), text);
    const done = events.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.reply, text);
    assert.equal(done.threadId, events[0].threadId);
    assert.ok(done.at - deltas[0].at >= 150, '첫 조각이 끝보다 먼저 옴(한 번에 오지 않음)');
    // 로컬 10/24 첫 글자 시각 기록: 답 첫 글자·끝·조각 수(서버 기준) — 끝 이벤트와 감사 기록에
    const tm = done.timing;
    assert.ok(tm && tm.answerMs > 0 && tm.firstMs === tm.answerMs && tm.totalMs - tm.answerMs >= 150 && tm.chunks === deltas.length, JSON.stringify(tm));
    const [lg] = await sql`select detail from audit_logs where action = 'ai.chat' and detail->>'threadId' = ${done.threadId}`;
    assert.deepEqual(lg.detail.timing, tm);
    const [m] = await sql`select text from ai_messages where thread_id = ${done.threadId} and role = 'assistant'`;
    assert.equal(m.text, text);
    assert.equal((await fakeState()).anthropic.slice(n0)[0].body.stream, true);
  });

  test('도구 단계: 도구 이름 이벤트 → 다음 단계 글 → 끝(제안 포함)', async () => {
    await queue([{ content: [{ type: 'text', text: '찾아볼게요.' }, { type: 'tool_use', id: 't1', name: 'search_tasks', input: { query: '견적' } }], stop_reason: 'tool_use' },
      toolUse('t2', 'propose_create_task', { title: '스트리밍 시험 업무', assigneeId: ctx.ownerId }), say('업무를 준비했습니다. 확인을 눌러 주세요.')]);
    const { events } = await ask({ text: '견적 업무 찾아서 새 업무 만들어줘' });
    const kinds = events.map((e) => e.type);
    const t1 = kinds.indexOf('tools');
    assert.ok(t1 > 0 && kinds.lastIndexOf('text') > t1, kinds.join(','));
    assert.deepEqual(events.filter((e) => e.type === 'tools').map((e) => e.names), [['search_tasks'], ['propose_create_task']]);
    const done = events.at(-1);
    assert.equal(done.reply, '업무를 준비했습니다. 확인을 눌러 주세요.');
    assert.equal(done.proposals.length, 1);
    assert.deepEqual(done.tools, ['search_tasks', 'propose_create_task']);
    // 첫 글자('찾아볼게요.')는 도구 전 — 답 첫 글자는 마지막 도구 단계 뒤부터, 조각 수도 그 답만
    assert.ok(done.timing.firstMs < done.timing.answerMs, JSON.stringify(done.timing));
    assert.equal(done.timing.chunks, events.filter((e, k) => e.type === 'text' && k > kinds.lastIndexOf('tools')).length);
  });

  test('사전 점검 오류(빈 질문)는 지금처럼 HTTP 오류 JSON — 스트림을 열지 않음', async () => {
    const { res, json } = await ask({ text: '   ' });
    assert.equal(res.status, 400);
    assert.match(json.error.message, /질문을 입력/);
  });

  test('시작 뒤 AI 오류는 error 이벤트(상태·안내 문구), 대화에는 저장 안 함', async () => {
    await queue([{ httpError: 400, errorType: 'invalid_request_error', message: 'bad' }]);
    const { res, events } = await ask({ text: '오류 시험 질문' });
    assert.equal(res.status, 200);
    assert.equal(events[0].type, 'start');
    const err = events.at(-1);
    assert.equal(err.type, 'error');
    assert.equal(err.status, 502);
    assert.match(err.message, /AI/);
    assert.equal((await sql`select count(*)::int n from ai_messages where text = '오류 시험 질문'`)[0].n, 0);
  });

  test('stream 없이 부르면 지금처럼 JSON 한 번에(다른 화면·앱 호환)', async () => {
    await queue([say('한 번에 답')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '한 번에 답해줘' });
    assert.equal(r.reply, '한 번에 답');
    assert.deepEqual([r.timing.firstMs, r.timing.answerMs, r.timing.chunks], [null, null, 0], '스트리밍이 아니면 끝 시각만');
  });
});
