// 대기열 ②(2026-10-19): AI 비서 기밀·회사 설정 도구 — 기밀 후보 목록(기밀 관리자만) → 기밀 지정 제안 → [확인] 뒤 반영(확정 표시),
// 회사 설정 보기(관리자만) → 기밀 단어·첨부 자동 저장·AI 회사 정보 바꾸기 제안(고객 문서 단어는 경고) → [확인] 뒤 반영, 직원은 제안조차 못 함 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, tenant;
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
  [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('AI 비서 기밀 후보 · 기밀 지정 제안', () => {
  let pay, plain;
  test('이름 규칙으로 기밀 후보가 된 파일만 목록에 — 기밀 관리자(대표)만, 직원은 권한 오류', async () => {
    pay = await up(ctx.owner, '10월 급여 명세.txt', '인사');
    plain = await up(ctx.owner, '10월 행사 안내.txt', '행사'); // V14 32-4: 인사·재무 폴더는 폴더만으로도 기밀 후보가 되므로 일반 파일은 다른 폴더에
    const [f] = await sql`select security, security_suggested, security_confirmed from library_files where id = ${pay}`;
    assert.deepEqual([f.security, f.security_suggested, f.security_confirmed], ['internal', 'confidential', false], '올릴 때는 내부 + 기밀 제안');
    const { reqs, results } = await chat(ctx.owner, { text: '기밀로 해야 할 자료 있어?' }, [toolUse('c1', 'list_confidential_suggestions', {}), say('1건 있습니다.')]);
    assert.ok(reqs[0].body.tools.some((t) => t.name === 'list_confidential_suggestions') && reqs[0].body.tools.some((t) => t.name === 'propose_set_confidential'), '기밀 낱말 → 기밀 도구 묶음');
    assert.ok(!results.c1.is_error, results.c1.content);
    const out = parse(results.c1);
    assert.deepEqual(out.files.map((x) => [x.id, x.security]), [[pay, '내부']], '후보만(급여 이름 규칙 + 인사 폴더)·현재 등급 한글');
    const s = await chat(ctx.staffA.client, { text: '기밀 후보 보여줘' }, [toolUse('c2', 'list_confidential_suggestions', {}), say('못 봅니다.')]);
    assert.ok(s.results.c2.is_error); assert.match(String(s.results.c2.content), /기밀 자료.*편집 권한/);
  });

  test('기밀 지정 제안 → 확인 전 그대로 → 확인하면 기밀·확정, 다시 목록에 없음 · 같은 등급이면 제안 없음', async () => {
    const { r, results } = await chat(ctx.owner, { text: '급여 명세는 기밀로 바꿔줘' }, [
      toolUse('p1', 'propose_set_confidential', { fileIds: [pay] }), say('확인을 누르면 기밀이 됩니다.')]);
    assert.ok(!results.p1.is_error, results.p1.content);
    const p = r.proposals[0];
    assert.equal(p.kind, 'set_security'); assert.match(p.summary, /기밀로: 1개 — 10월 급여 명세/);
    assert.match(p.preview.moves[0], /10월 급여 명세 \(인사\): 내부 → 기밀/);
    assert.equal((await sql`select security from library_files where id = ${pay}`)[0].security, 'internal', '확인 전 그대로');
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    assert.equal(done.link, `/library?file=${pay}`);
    const [f] = await sql`select security, security_confirmed from library_files where id = ${pay}`;
    assert.deepEqual([f.security, f.security_confirmed], ['confidential', true], '기밀 관리자가 확인 = 확정');
    const again = await chat(ctx.owner, { text: '기밀 후보 더 있어?' }, [toolUse('c3', 'list_confidential_suggestions', {}), say('없습니다.')]);
    assert.deepEqual(parse(again.results.c3).files, []);
    const same = await chat(ctx.owner, { text: '급여 명세 기밀로' }, [toolUse('p2', 'propose_set_confidential', { fileIds: [pay] }), say('이미 기밀입니다.')]);
    assert.equal(same.r.proposals.length, 0); assert.match(parse(same.results.p2).note, /이미 그 등급/);
    assert.ok((await sql`select 1 from audit_logs where action = 'library.security_set' and target_id = ${pay}`).length, '등급 변경 기록');
  });

  test('기밀 열람 권한 없는 직원은 남의 자료를 기밀로 못 올리고(확인 때 403), 기밀을 내리는 제안은 기밀 편집 권한이 없어 막힌다', async () => {
    const s = await chat(ctx.staffA.client, { text: '행사 안내 기밀로' }, [toolUse('p3', 'propose_set_confidential', { fileIds: [plain] }), say('확인하세요.')]);
    assert.ok(!s.results.p3.is_error, s.results.p3.content);
    assert.equal((await ctx.staffA.client.req('POST', `/api/ai/proposals/${s.r.proposals[0].id}`, { accept: true })).status, 403, '기밀 열람 권한 없음 → 남의 파일 기밀 지정 불가');
    assert.equal((await sql`select security from library_files where id = ${plain}`)[0].security, 'internal');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'confidential', userId: ctx.staffA.id, level: 'view' });
    const mine = await up(ctx.staffA.client, '내 통장 사본.txt', '');
    await ctx.owner.ok('POST', '/api/ai/proposals/' + (await chat(ctx.owner, { text: '통장 사본 기밀로' }, [toolUse('p4', 'propose_set_confidential', { fileIds: [mine] }), say('.')])).r.proposals[0].id, { accept: true });
    const down = await chat(ctx.staffA.client, { text: '내 통장 사본 일반으로 바꿔' }, [toolUse('p5', 'propose_set_confidential', { fileIds: [mine], security: 'public' }), say('.')]);
    assert.ok(!down.results.p5.is_error, down.results.p5.content);
    const res = await ctx.staffA.client.req('POST', `/api/ai/proposals/${down.r.proposals[0].id}`, { accept: true });
    assert.equal(res.status, 403, '기밀 내리기는 기밀 편집 권한 필요');
    assert.equal((await sql`select security from library_files where id = ${mine}`)[0].security, 'confidential');
  });
});

describe('AI 비서 회사 설정 보기·바꾸기 제안', () => {
  test('관리자만 현재 값을 보고, 기밀 단어 추가(고객 문서 단어는 경고)·첨부 자동 저장 끄기·AI 회사 정보 → 확인하면 반영', async () => {
    const g = await chat(ctx.owner, { text: '회사 설정 보여줘' }, [toolUse('g1', 'get_company_settings', {}), say('현재 설정입니다.')]);
    assert.ok(g.reqs[0].body.tools.some((t) => t.name === 'get_company_settings'), '설정 낱말 → 설정 도구 묶음');
    const cur = parse(g.results.g1);
    assert.equal(cur.attachToLibrary, true); assert.ok(cur.confWordsDefault && cur.confWords.includes('급여'));
    const s = await chat(ctx.staffA.client, { text: '회사 설정 보여줘' }, [toolUse('g2', 'get_company_settings', {}), say('.')]);
    assert.ok(s.results.g2.is_error, '직원은 못 봄');

    const { r, results } = await chat(ctx.owner, { text: '기밀 단어에 제안서랑 원가표 추가하고 첨부 자동 저장은 꺼줘. 말투는 정중하게' }, [
      toolUse('u1', 'propose_update_company_settings', { confWords: [...cur.confWords, '제안서', '원가표'], attachToLibrary: false, tone: '정중하고 간결하게' }), say('확인을 누르면 반영됩니다.')]);
    assert.ok(!results.u1.is_error, results.u1.content);
    const p = r.proposals[0];
    assert.equal(p.kind, 'company_settings'); assert.match(p.summary, /회사 설정 바꾸기: 업무 첨부 자료실 자동 저장: 켬 → 끔 외 2건/);
    assert.ok(p.preview.moves.some((m) => /기밀 단어: \d+개 \(\+ 제안서, 원가표\)/.test(m)), JSON.stringify(p.preview.moves));
    assert.ok(p.preview.moves.some((m) => m.includes('말투: 정중하고 간결하게')));
    assert.match(p.preview.warnings[0], /제안서: 고객에게 보내는 문서 단어라 .*보낼 때마다 한 번 확인/, '제안서를 넣으면 보낼 때마다 확인 경고');
    const [before] = await sql`select attach_to_library, conf_words, ai_tone from tenants where id = ${tenant}`;
    assert.deepEqual([before.attach_to_library, before.conf_words, before.ai_tone], [true, null, null], '확인 전 그대로');
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    assert.equal(done.link, '/admin/company');
    const [t] = await sql`select attach_to_library, conf_words, ai_tone from tenants where id = ${tenant}`;
    assert.equal(t.attach_to_library, false); assert.ok(t.conf_words.includes('제안서') && t.conf_words.includes('원가표') && t.conf_words.includes('급여')); assert.equal(t.ai_tone, '정중하고 간결하게');
    const after = await ctx.owner.ok('GET', '/api/org/attach-library');
    assert.equal(after.confWordsDefault, false);
    // 이제 '제안서' 이름 파일은 기밀 후보
    const prop = await up(ctx.owner, '강남 제안서.txt', '영업');
    assert.equal((await sql`select security_suggested from library_files where id = ${prop}`)[0].security_suggested, 'confidential');
  });

  test('빈 목록 = 기본값으로 되돌리기 · 바꿀 항목 없으면 오류 · 직원은 제안 단계에서 막힘', async () => {
    const { r } = await chat(ctx.owner, { text: '기밀 단어 기본값으로' }, [toolUse('u2', 'propose_update_company_settings', { confWords: [] }), say('.')]);
    assert.match(r.proposals[0].preview.moves[0], /기밀 단어: 기본값/);
    await ctx.owner.ok('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true });
    assert.equal((await sql`select conf_words from tenants where id = ${tenant}`)[0].conf_words, null);
    const none = await chat(ctx.owner, { text: '설정 바꿔' }, [toolUse('u3', 'propose_update_company_settings', {}), say('.')]);
    assert.ok(none.results.u3.is_error); assert.match(String(none.results.u3.content), /바꿀 항목이 없습니다/);
    const s = await chat(ctx.staffA.client, { text: '첨부 자동 저장 꺼줘' }, [toolUse('u4', 'propose_update_company_settings', { attachToLibrary: false }), say('.')]);
    assert.ok(s.results.u4.is_error, '직원은 제안 못 함'); assert.equal(s.r.proposals.length, 0);
    assert.equal((await sql`select attach_to_library from tenants where id = ${tenant}`)[0].attach_to_library, false, '앞 시험에서 끈 값 그대로');
  });
});
