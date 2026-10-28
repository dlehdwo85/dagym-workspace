// #753(로컬 10/28 17:25, 대표 'AI 비서에게 자료실에서 필요한 자료를 찾아 달라고 하면 찾아 주는 기능'): search_library — 낱말이 모두 맞는 자료가 없으면
// 낱말마다 찾아 많이 맞은 순 · 답에 이름이 나온 자료만 카드(files: 열기·내려받기·업무에 붙이기) · 권한 밖(기밀) 자료는 직원에게 카드도 없음 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });

async function up(c, name, folder) {
  const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'text/plain', size: 5, folder });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from('hello') });
  await c.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}
async function chat(c, body, steps) {
  const n0 = (await fakeState()).anthropic.length;
  await queue(steps);
  const r = await c.ok('POST', '/api/ai/chat', body);
  const reqs = (await fakeState()).anthropic.slice(n0);
  const results = reqs.flatMap((x) => (Array.isArray(x.body.messages?.at(-1)?.content) ? x.body.messages.at(-1).content.filter((b) => b.type === 'tool_result') : []));
  return { r, reqs, results: Object.fromEntries(results.map((x) => [x.tool_use_id, x])) };
}
const parse = (res) => JSON.parse(typeof res.content === 'string' ? res.content : res.content[0].text);

before(async () => {
  await resetDb(); await ensureTls();
  fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('#753 AI 비서 자료실 찾기', () => {
  let logo, photo, secret;
  test('모두 맞는 자료가 없으면 낱말마다 찾아 많이 맞은 순 — 답에 이름이 나온 자료만 카드', async () => {
    logo = await up(ctx.owner, '다짐 로고.txt', '디자인/로고');
    photo = await up(ctx.owner, '다짐 행사 사진.txt', '행사');
    const { r, results } = await chat(ctx.owner, { text: '다짐 로고 원본 파일 찾아줘' }, [
      toolUse('s1', 'search_library', { query: '다짐 로고 원본 파일' }), say('자료실에서 「다짐 로고」를 찾았습니다. 디자인/로고 폴더에 있습니다.')]);
    assert.ok(!results.s1.is_error, results.s1.content);
    assert.deepEqual(parse(results.s1).map((f) => f.id), [logo, photo], '두 낱말(다짐·로고) 맞은 로고 먼저, 한 낱말 맞은 행사 사진 다음 — 원본·파일은 어디에도 없음');
    assert.equal(r.files?.length, 1, '답에 이름이 나온 로고만');
    assert.deepEqual([r.files[0].id, r.files[0].title, r.files[0].folder, r.files[0].fileName], [logo, '다짐 로고', '디자인/로고', '다짐 로고.txt']);
    assert.ok(!('snippet' in r.files[0]) && !('text' in r.files[0]), '카드에는 본문 없이 이름·폴더만');
  });

  test('모두 맞는 자료가 있으면 그것만(낱말 따로 찾기 안 함) · 이름 없이 "자료실에서 찾았다"면 찾은 순서대로 · 아무 말 없으면 카드 없음', async () => {
    const a = await chat(ctx.owner, { text: '다짐 로고' }, [toolUse('s2', 'search_library', { query: '다짐 로고' }), say('자료실에서 1건 찾았습니다.')]);
    assert.deepEqual(parse(a.results.s2).map((f) => f.id), [logo], '모두 맞는 자료가 있으면 행사 사진은 안 섞임');
    assert.deepEqual(a.r.files?.map((f) => f.id), [logo]);
    const b = await chat(ctx.owner, { text: '오늘 날씨' }, [toolUse('s3', 'search_library', { query: '행사' }), say('관련 자료는 없습니다.')]);
    assert.equal(b.r.files, undefined, '이름도 자료실도 안 나오면 카드 없음');
    const c = await chat(ctx.owner, { text: '안녕' }, [say('안녕하세요. 다짐 로고 이야기를 해 볼까요?')]);
    assert.equal(c.r.files, undefined, '찾지 않은 자료는 이름이 나와도 카드 없음');
  });

  test('권한 밖(기밀) 자료는 직원 검색·카드에 없고, 대표는 보임', async () => {
    secret = await up(ctx.owner, '다짐 로고 계약서.txt', '디자인/로고');
    await ctx.owner.ok('PATCH', `/api/library/${secret}`, { security: 'confidential' });
    const s = await chat(ctx.staffA.client, { text: '다짐 로고 계약서 찾아줘' }, [
      toolUse('s4', 'search_library', { query: '다짐 로고 계약서' }), say('자료실에서 「다짐 로고 계약서」와 「다짐 로고」를 찾았습니다.')]);
    assert.ok(!results(s).includes(secret), '직원 도구 결과에 기밀 없음');
    assert.ok(!(s.r.files ?? []).some((f) => f.id === secret), '답에 이름이 나와도(AI 추측) 직원 카드에 기밀 없음');
    const o = await chat(ctx.owner, { text: '다짐 로고 계약서 찾아줘' }, [
      toolUse('s5', 'search_library', { query: '다짐 로고 계약서' }), say('자료실에서 「다짐 로고 계약서」를 찾았습니다.')]);
    assert.deepEqual(o.r.files?.map((f) => f.id), [secret], '대표는 기밀도 카드');
    function results(x) { return JSON.stringify(Object.values(x.results).map((v) => v.content)); }
  });
});
