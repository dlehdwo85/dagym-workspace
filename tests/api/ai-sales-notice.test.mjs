// #650(대표 10/25 23:20 'AI 세일즈가 온비드 공고문을 웹 검색으로 찾다 실패 · 답 첫 줄 "Results are JSON strings; parse."'):
// ① 영업 공간(또는 공고·입찰 낱말)에서 공고 도구 search_sales_notices → read_sales_notice 가 붙고 시스템 지시에 'DB 먼저' ② 도구가 영업 DB 원문·첨부(서버가 받아 자료실 영업/공고에 한 번만 저장)를 돌려줌
// ③ 답 첫 줄의 도구 안내 문장은 일반·스트리밍 모두 화면에 안 감 ④ 온비드 줄은 '온비드 공고 검색에서 공고번호 검색' 안내 (가짜 Anthropic 서버 + 첨부는 127.0.0.1 작은 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, files, fileBase;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });
const sysOf = (req) => (typeof req.body.system === 'string' ? req.body.system : req.body.system.map((b) => b.text ?? '').join('\n'));
const names = (req) => req.body.tools.map((t) => t.name).filter(Boolean);
/** 그 요청의 메시지에 담긴 도구 결과(JSON 글자) */
const toolResult = (req, tid) => { for (const m of req.body.messages) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result' && b.tool_use_id === tid) return typeof b.content === 'string' ? b.content : JSON.stringify(b.content); return null; };
const ONBID_SEARCH = 'https://www.onbid.co.kr/op/cltrpbancinf/pbanc/pbancsrch/PbancClgInqController/mvmnSrchPbancClg.do';
const ID = '00000000-0000-4000-8000-000000000650';
let hits = 0;

async function ask(body) {
  const res = await fetch(BASE + '/api/ai/chat', { method: 'POST', headers: { origin: BASE, cookie: ctx.owner.cookie, 'content-type': 'application/json', accept: 'text/event-stream' }, body: JSON.stringify({ ...body, stream: true }) });
  const events = []; const dec = new TextDecoder(); let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    for (let k = buf.indexOf('\n\n'); k >= 0; k = buf.indexOf('\n\n')) {
      const line = buf.slice(0, k).split('\n').find((l) => l.startsWith('data:')); buf = buf.slice(k + 2);
      if (line) events.push(JSON.parse(line.slice(5)));
    }
  }
  return { res, events };
}

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  files = http.createServer((req, res) => {
    if (req.url.startsWith('/notice.txt')) { hits++; res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="notice.txt"' }); res.end('과업 범위: 체육센터 헬스장 운동기구 유지보수 연 2회\n참가 자격: 체육시설업 등록 업체\n현장설명회: 입찰 3일 전'); }
    else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => files.listen(0, '127.0.0.1', r));
  fileBase = `http://127.0.0.1:${files.address().port}`;
  const now = new Date().toISOString(); const dl = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID}, ${sql.json({ id: ID, source_type: 'onbid_lease', source_external_id: 'ONB-650', notice_no: 'ONB-650', source_url: ONBID_SEARCH, onbid_ids: { cltrNo: '1', pbctNo: '2' },
    title: '구민체육센터 헬스장 운영 위탁(임대)', issuer: '○○구시설관리공단', bid_category: '임대', deadline_at: `${dl} 10:00`, posted_date: now.slice(0, 10), estimated_amount: '12,000,000', region: '경기',
    attachment_urls: [{ name: '공고문.txt', url: `${fileBase}/notice.txt` }], fit_business: 'dagym', matched_keywords: ['헬스장'], first_seen_at: now, updated_at: now, notice_kind: 'new' })}, 'workin')`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); files?.close(); await sql?.end(); });

describe('AI 세일즈 공고문(#650)', () => {
  test('영업 공간: 공고 도구·DB 먼저 지시 → 검색 결과(온비드 공고번호 검색 안내) → 상세·첨부 본문(자료실 영업/공고 저장) → 답 첫 줄 안내 문장 제거', async () => {
    const n0 = (await fakeState()).anthropic.length;
    await queue([toolUse('s1', 'search_sales_notices', { query: '구민체육센터' }), toolUse('r1', 'read_sales_notice', { id: ID }), say('Results are JSON strings; parse.\n구민체육센터 헬스장 운영 위탁 공고입니다.\n- 참가 자격: 체육시설업 등록 업체\n- 현장설명회: 입찰 3일 전')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '구민체육센터 공고문 요약해줘', space: 'sales' });
    const reqs = (await fakeState()).anthropic.slice(n0);
    assert.equal(reqs.length, 3, '검색 → 읽기 → 답');
    assert.ok(names(reqs[0]).includes('search_sales_notices') && names(reqs[0]).includes('read_sales_notice'), `영업 공간에는 공고 도구 ${names(reqs[0])}`);
    assert.match(sysOf(reqs[0]), /web_search 보다 먼저 search_sales_notices → read_sales_notice/);
    assert.match(sysOf(reqs[0]), /Results are JSON strings; parse\./, '안내 문장을 옮겨 적지 말라는 지시');
    const s = JSON.parse(toolResult(reqs[1], 's1'));
    assert.equal(s.items.length, 1); assert.equal(s.items[0].id, ID); assert.equal(s.items[0].source, '온비드 임대'); assert.equal(s.items[0].attachments, 1);
    assert.equal(s.items[0].url, null); assert.match(s.items[0].search, /온비드 공고 검색에서 공고번호 'ONB-650' 검색 \(https:\/\/www\.onbid\.co\.kr\/op\//, '온비드는 바로 가는 주소 대신 공고 검색 안내');
    const d = JSON.parse(toolResult(reqs[2], 'r1'));
    assert.equal(d.title, '구민체육센터 헬스장 운영 위탁(임대)'); assert.equal(d.issuer, '○○구시설관리공단'); assert.equal(d.estimated, '12,000,000'); assert.deepEqual(d.onbidIds, { cltrNo: '1', pbctNo: '2' });
    assert.equal(d.files.length, 1); assert.equal(d.files[0].name, '공고문.txt', '공고 줄에 적힌 첨부 이름'); assert.match(d.files[0].text, /참가 자격: 체육시설업 등록 업체/); assert.ok(d.files[0].libraryId); assert.equal(d.moreFiles, 0);
    assert.match(d.note, /지어내지 말고/);
    assert.equal(r.reply, '구민체육센터 헬스장 운영 위탁 공고입니다.\n- 참가 자격: 체육시설업 등록 업체\n- 현장설명회: 입찰 3일 전', '첫 줄 "Results are JSON strings; parse." 제거');
    assert.deepEqual(r.tools, ['search_sales_notices', 'read_sales_notice'], '단계 기록');
    const lib = await sql`select id, folder, space, source, text_content, tags from library_files where ext_ref like 'salesfile:%' and deleted_at is null`;
    assert.equal(lib.length, 1); assert.equal(lib[0].id, d.files[0].libraryId);
    assert.equal(lib[0].folder, '영업/공고/구민체육센터 헬스장 운영 위탁(임대)'); assert.deepEqual([lib[0].space, lib[0].source], ['sales', 'sales_auto']); assert.match(lib[0].text_content, /현장설명회/);
    assert.equal(hits, 1);
    // 다시 읽으면 자료실 것을 쓰고(새로 받지 않음) 저장도 1건 그대로
    const n1 = (await fakeState()).anthropic.length;
    await queue([toolUse('r2', 'read_sales_notice', { id: ID }), say('참가 자격은 체육시설업 등록 업체입니다.')]);
    const r2 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이 공고 참가 자격만 알려줘', space: 'sales' });
    const d2 = JSON.parse(toolResult((await fakeState()).anthropic.slice(n1)[1], 'r2'));
    assert.equal(d2.files[0].libraryId, lib[0].id); assert.match(d2.files[0].text, /체육시설업/);
    assert.equal(hits, 1, '두 번째는 받지 않음'); assert.equal((await sql`select count(*)::int n from library_files where ext_ref like 'salesfile:%'`)[0].n, 1);
    assert.equal(r2.reply, '참가 자격은 체육시설업 등록 업체입니다.');
    // 없는 공고 · 짧은 검색어
    const n2 = (await fakeState()).anthropic.length;
    await queue([toolUse('s2', 'search_sales_notices', { query: '없는공고이름' }), toolUse('r3', 'read_sales_notice', { id: '00000000-0000-4000-8000-000000000651' }), say('영업 DB 에는 없습니다.')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '없는공고이름 공고 찾아줘', space: 'sales' });
    const more = (await fakeState()).anthropic.slice(n2);
    assert.match(JSON.parse(toolResult(more[1], 's2')).note, /영업 DB 에 없는 공고/);
    assert.match(toolResult(more[2], 'r3'), /찾을 수 없/, '없는 공고 id 는 404 문구(도구 오류)로');
  });

  test('일반 공간: 공고 낱말 없으면 공고 도구 없음 · "공고" 낱말이 있으면 붙음 · more_tools 뒤 전체에 포함 · 스트리밍 첫 줄 안내 문장 제거', async () => {
    const send = async (text, body = {}) => { const n0 = (await fakeState()).anthropic.length; await queue([say('네')]); await ctx.owner.ok('POST', '/api/ai/chat', { text, ...body }); return (await fakeState()).anthropic.slice(n0)[0]; };
    const a = await send('오늘 내 업무 뭐 남았어?');
    assert.ok(!names(a).includes('search_sales_notices') && !names(a).includes('read_sales_notice'), '업무 질문엔 공고 도구 없음');
    assert.doesNotMatch(sysOf(a), /search_sales_notices → read_sales_notice/, '영업 공간 지시는 영업 공간에서만');
    const b = await send('이번 주 입찰 공고 뭐 있어?');
    assert.ok(names(b).includes('search_sales_notices') && names(b).includes('read_sales_notice'), '공고·입찰 낱말이면 붙음');
    const n0 = (await fakeState()).anthropic.length;
    await queue([toolUse('m1', 'more_tools', { reason: '공고 보기' }), say('네')]);
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '이거 좀 봐줘' });
    const two = (await fakeState()).anthropic.slice(n0);
    assert.ok(!names(two[0]).includes('read_sales_notice') && names(two[1]).includes('read_sales_notice'), 'more_tools 뒤 전체 도구에 포함');
    // 스트리밍: 첫 줄이 안내 문장이면 조각에도 끝 내용에도 없음, 둘째 줄부터 그대로
    await queue([say('Results are JSON strings; parse.\n구민체육센터 공고는 다음 주 월요일 마감입니다.\n\n- 추정가 1,200만 원', { chunkDelayMs: 5 })]);
    const { res, events } = await ask({ text: '구민체육센터 공고 마감 언제야?', space: 'sales' });
    assert.equal(res.status, 200);
    const text = events.filter((e) => e.type === 'text').map((e) => e.delta).join('');
    assert.equal(text, '구민체육센터 공고는 다음 주 월요일 마감입니다.\n\n- 추정가 1,200만 원');
    const done = events.find((e) => e.type === 'done');
    assert.equal(done.reply, text);
    // 안내 문장이 없으면 한 글자도 안 잃음(첫 줄 모으기만)
    const plain = '마감은 다음 주 월요일입니다. 준비 서류는 3가지입니다.';
    await queue([say(plain, { chunkDelayMs: 5 })]);
    const p = await ask({ text: '마감 언제야?', space: 'sales' });
    assert.equal(p.events.filter((e) => e.type === 'text').map((e) => e.delta).join(''), plain);
    assert.equal(p.events.find((e) => e.type === 'done').reply, plain);
  });
});
