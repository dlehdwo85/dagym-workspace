// V22 AI 비서 문서 엔진(Agent Skills + 코드 실행): 회사 정보 설정, 파일 작업 → 응답 뒤 실행 → 결과·미리보기·버전·자료실 저장, 컨테이너 재사용, 웹 도구·문서 작업 끄기, 비용 기록 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const xlsxBytes = Buffer.from('PK\u0003\u0004 fake xlsx');
/** 코드 실행이 파일 두 개(결과·미리보기)를 만들었다는 가짜 응답 */
const engineReply = (ids, text = '다짐 견적서를 1페이지로 만들었습니다.\nPAGES: 1') => ({ content: [
  { type: 'server_tool_use', id: 'srv_1', name: 'bash_code_execution', input: { command: 'python make.py' } },
  { type: 'bash_code_execution_tool_result', tool_use_id: 'srv_1', content: { type: 'bash_code_execution_result', stdout: 'ok', stderr: '', return_code: 0, content: ids.map((file_id) => ({ type: 'bash_code_execution_output', file_id })) } },
  { type: 'text', text }], stop_reason: 'end_turn' });
const waitJob = async (c, id) => { for (let i = 0; i < 60; i++) { const r = await c.ok('GET', `/api/ai/doc-jobs/${id}`); if (['done', 'failed'].includes(r.job.status)) return r; await new Promise((s) => setTimeout(s, 250)); } throw new Error('job timeout'); };

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V22 문서 엔진', () => {
  let ref, job1, threadId;
  test('회사 정보 설정: 대표 저장·직원 수정 불가, 기본 회사', async () => {
    await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', ceo: '시험대표', bizNo: '000-00-00000', address: '시험시 시험구', phone: '02-000-0000', brandColor: '#0F766E', isDefault: true });
    await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: '시험상호 하이링크', bizNo: '999-99-99999' });
    const r = await ctx.owner.ok('GET', '/api/org/company-profiles');
    assert.deepEqual(r.profiles.map((p) => p.key), ['dagym', 'hilink'], '기본 회사가 먼저');
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/org/company-profiles', { key: 'x1', name: 'x' })).status));
    assert.equal((await ctx.owner.req('PUT', '/api/org/company-profiles', { key: 'Bad Key', name: 'x' })).status, 400);
  });

  test('파일 작업: 대화가 작업을 만들고(만드는 중) → 응답 뒤 Skills+코드 실행 → 결과·미리보기, 자료실엔 아직 없음', async () => {
    const init = await ctx.owner.ok('POST', '/api/library', { fileName: '하이링크 견적서 양식.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', size: xlsxBytes.length, folder: '양식' });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: xlsxBytes });
    await ctx.owner.ok('POST', `/api/library/${init.id}/complete`);
    ref = init.id;
    const n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicFiles: { file_out_1: { filename: '다짐 견적서.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b64: xlsxBytes.toString('base64') },
      file_out_2: { filename: 'preview.png', mime: 'image/png', b64: png.toString('base64') } },
      anthropicQueue: [toolUse('t1', 'run_file_task', { mode: 'create', kind: 'xlsx', title: '다짐 견적서', instructions: '하이링크 양식을 참고해 다짐 견적서, 품목 3개, 1페이지', referenceFileIds: [ref], company: 'dagym' }),
        say('견적서를 만드는 중입니다.'), engineReply(['file_out_1', 'file_out_2'])] });
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '하이링크 견적서 참고해서 다짐 견적서 1페이지로 만들어줘' });
    threadId = r.threadId;
    assert.equal(r.docJobs.length, 1); assert.equal(r.docJobs[0].status, 'queued');
    job1 = r.docJobs[0].id;
    const chatReq = (await fakeState()).anthropic.slice(n0)[0];
    assert.ok(chatReq.body.tools.some((t) => t.name === 'run_file_task'));
    assert.ok(chatReq.body.tools.some((t) => t.type === 'web_search_20260209') && chatReq.body.tools.some((t) => t.type === 'web_fetch_20260209'), '웹 도구 기본 켜짐');
    const done = await waitJob(ctx.owner, job1);
    assert.equal(done.job.status, 'done', done.job.error);
    assert.equal(done.job.pages, 1); assert.match(done.job.summary, /1페이지/); assert.ok(done.job.hasPreview && done.job.hasFile);
    const st = await fakeState();
    const eng = st.anthropic.slice(n0).find((x) => x.body.container);
    assert.deepEqual(eng.body.container.skills, [{ type: 'anthropic', skill_id: 'xlsx', version: 'latest' }]);
    assert.ok(eng.body.tools.some((t) => t.type === 'code_execution_20260521'));
    assert.match(String(eng.beta), /code-execution-2025-08-25/);
    const content = eng.body.messages[0].content;
    assert.ok(content.some((b) => b.type === 'container_upload'), '참고 양식을 컨테이너에 올림');
    const brief = content.find((b) => b.type === 'text').text;
    assert.ok(brief.includes('시험상호 다짐') && brief.includes('000-00-00000'), '다짐 회사 정보 주입');
    assert.ok(!brief.includes('시험상호 하이링크') && !brief.includes('999-99-99999'), '다른 회사 정보는 안 넣음');
    assert.ok(st.anthropicUploads.includes('하이링크 견적서 양식.xlsx'));
    assert.equal((await sql`select anthropic_file_id from library_files where id = ${ref}`)[0].anthropic_file_id !== null, true, '한 번 올린 파일 id 기억');
    const f = await fetch(`${BASE}/api/ai/doc-jobs/${job1}/file`, { headers: { cookie: ctx.owner.cookie } });
    assert.equal(f.status, 200); assert.match(f.headers.get('content-disposition'), /attachment/);
    assert.deepEqual(Buffer.from(await f.arrayBuffer()), xlsxBytes);
    const pv = await fetch(`${BASE}/api/ai/doc-jobs/${job1}/preview`, { headers: { cookie: ctx.owner.cookie } });
    assert.equal(pv.headers.get('content-type'), 'image/png');
    assert.equal((await sql`select count(*)::int n from library_files where title like '다짐 견적서%'`)[0].n, 0, '저장 전엔 자료실에 없음');
    const u = await sql`select purpose, cost_usd::float8 c from ai_usage where purpose = 'doc_engine'`;
    assert.equal(u.length, 1); assert.ok(u[0].c > 0, '문서 작업 비용 따로 기록');
    assert.equal((await ctx.staffA.client.req('GET', `/api/ai/doc-jobs/${job1}`)).status, 404, '남의 작업은 없는 것처럼');
  });

  test('더 다듬기(edit): 같은 컨테이너 재사용·이전 결과를 올림 → v2, 버전 목록, 대화 기록에 [파일 작업]', async () => {
    const container = (await sql`select container_id from ai_threads where id = ${threadId}`)[0].container_id;
    assert.ok(container, '대화에 컨테이너 기억');
    const n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicFiles: { file_out_3: { filename: '다짐 견적서.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b64: Buffer.from('PK v2').toString('base64') } },
      anthropicQueue: [toolUse('t2', 'run_file_task', { mode: 'edit', kind: 'xlsx', title: '다짐 견적서', instructions: '색을 청록으로, 표 테두리 얇게', baseJobId: job1 }), say('고치는 중입니다.'), engineReply(['file_out_3'], '색을 바꿨습니다.\nPAGES: 1')] });
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '색을 청록으로 바꿔줘', threadId });
    const job2 = r.docJobs[0].id;
    assert.equal(r.docJobs[0].version, 2);
    const chatReq = (await fakeState()).anthropic.slice(n0)[0];
    assert.ok(JSON.stringify(chatReq.body.messages).includes(`[파일 작업: id=${job1}`), '앞 작업 id 가 대화 기록에');
    const d = await waitJob(ctx.owner, job2);
    assert.equal(d.job.status, 'done');
    const eng = (await fakeState()).anthropic.slice(n0).find((x) => x.body.container);
    assert.equal(eng.body.container.id, container, '같은 컨테이너');
    assert.ok(eng.body.messages[0].content.some((b) => b.type === 'container_upload' && b.file_id === 'file_out_1'), '이전 결과를 다시 올리지 않고 file_id 로');
    assert.deepEqual(d.versions.map((v) => v.version), [1, 2]);
    // 자료실에 저장(사람이 누를 때) → AI 문서 폴더·v2 태그·업무 첨부
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '견적 발송', assigneeId: ctx.ownerId, approvalRequired: false })).id;
    const s = await ctx.owner.ok('POST', `/api/ai/doc-jobs/${job2}/save`, { taskId: t });
    const [lf] = await sql`select title, folder, tags, file_name from library_files where id = ${s.fileId}`;
    assert.equal(lf.folder, 'AI 문서'); assert.equal(lf.title, '다짐 견적서 v2'); assert.ok(lf.tags.includes('v2')); assert.equal(lf.file_name, '다짐 견적서 v2.xlsx');
    assert.ok((await ctx.owner.ok('GET', `/api/tasks/${t}`)).attachments.length >= 1);
    assert.equal((await ctx.owner.ok('GET', `/api/ai/doc-jobs/${job2}`)).job.savedFileId, s.fileId);
  });

  test('운영 실패 보정: 잘린 답(max_tokens) 이어 요청, text_editor 결과의 file_id 도 찾음, 진단 기록(대표만)', async () => {
    const n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicFiles: { fx_edit: { filename: '잘림 시험.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', b64: xlsxBytes.toString('base64') } },
      anthropicQueue: [toolUse('t5', 'run_file_task', { mode: 'create', kind: 'xlsx', title: '잘림 시험', instructions: '긴 표' }), say('만들기 시작했습니다.'),
        { content: [{ type: 'text', text: '표를 만드는 중' }, { type: 'server_tool_use', id: 'srv_cut', name: 'bash_code_execution', input: { command: 'python big.py' } }], stop_reason: 'max_tokens' },
        { content: [{ type: 'server_tool_use', id: 'srv_te', name: 'text_editor_code_execution', input: { command: 'create', path: '/mnt/user-data/outputs/잘림 시험.xlsx' } },
          { type: 'text_editor_code_execution_tool_result', tool_use_id: 'srv_te', content: { type: 'text_editor_code_execution_create_result', is_file_update: false, file_id: 'fx_edit' } },
          { type: 'text', text: '표를 만들었습니다.\nPAGES: 2' }], stop_reason: 'end_turn' }] });
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '긴 표 엑셀로' });
    const id = r.docJobs[0].id;
    const d = await waitJob(ctx.owner, id);
    assert.equal(d.job.status, 'done', d.job.error);
    assert.equal(d.job.pages, 2); assert.equal(d.job.summary, '표를 만들었습니다.', '마지막 단계 글이 요약');
    const eng = (await fakeState()).anthropic.slice(n0).filter((x) => x.body.container);
    assert.equal(eng.length, 2);
    assert.equal(eng[0].body.max_tokens, 20000);
    const cont = eng[1].body.messages;
    assert.ok(!JSON.stringify(cont.at(-2)).includes('srv_cut'), '결과 없는 잘린 도구 호출은 빼고 이어 보냄');
    assert.match(JSON.stringify(cont.at(-1)), /잘렸습니다/);
    assert.deepEqual(d.job.debug.steps.map((x) => x.stop), ['max_tokens', 'end_turn']);
    assert.equal(d.job.debug.found, 1);
    const st = (await sql`select debug from ai_doc_jobs where id = ${id}`)[0].debug;
    assert.ok(st.steps[1].types.text_editor_code_execution_tool_result === 1);
  });

  test('운영 실패 보정: 파일이 안 오면 한 번 다시 저장 요청 → 그래도 없으면 이 작업 제목의 새 파일만 목록에서 찾음, 끝내 없으면 실패+진단', async () => {
    const n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicFiles: { fl_other: { filename: '남의 문서.docx', mime: 'application/octet-stream', b64: Buffer.from('x').toString('base64') },
      // 엔진이 만든 결과 파일이 응답에는 안 오고 목록에만 있는 경우
      fl_mine: { filename: '휴관 안내문.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', b64: Buffer.from('PK docx').toString('base64') } },
      anthropicQueue: [toolUse('t6', 'run_file_task', { mode: 'create', kind: 'docx', title: '휴관 안내문', instructions: '휴관 안내' }), say('만들기 시작했습니다.'),
        say('휴관 안내문을 만들었습니다.\nPAGES: 1'), say('다시 저장했습니다.\nPAGES: 1')] });
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '휴관 안내문' });
    const d = await waitJob(ctx.owner, r.docJobs[0].id);
    assert.equal(d.job.status, 'done', d.job.error);
    assert.equal(d.job.resultName, '휴관 안내문.docx', '제목이 같은 파일만, 남의 문서는 안 가져옴');
    const eng = (await fakeState()).anthropic.slice(n0).filter((x) => x.body.container);
    assert.equal(eng.length, 2); assert.match(JSON.stringify(eng[1].body.messages.at(-1)), /결과 파일이 전달되지 않았습니다/);
    assert.equal(d.job.debug.fallback, 'files.list 1');

    await ctl({ anthropicReset: true, anthropicQueue: [toolUse('t7', 'run_file_task', { mode: 'create', kind: 'pptx', title: '없는 발표', instructions: 'x' }), say('만들기 시작했습니다.'), say('만들었습니다.'), say('저장했습니다.')] });
    const r2 = await ctx.owner.ok('POST', '/api/ai/chat', { text: '발표 자료' });
    const d2 = await waitJob(ctx.owner, r2.docJobs[0].id);
    assert.equal(d2.job.status, 'failed'); assert.match(d2.job.error, /결과 파일을 받지 못했습니다/);
    assert.equal(d2.job.debug.found, 0); assert.equal(d2.job.debug.lastText, '저장했습니다.');
    // 시스템 지시: 시작만 알리고 완료형 금지
    const chat = (await fakeState()).anthropic.at(-4);
    assert.match(chat.body.system?.[0]?.text ?? JSON.stringify(chat.body.system), /만들기 시작했습니다/);
  });

  test('회사 설정: 웹 도구 끄기·문서 작업 끄기', async () => {
    await ctx.owner.ok('PUT', '/api/ai/settings', { webTools: false, docEngine: false });
    const n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicQueue: [toolUse('t3', 'run_file_task', { mode: 'create', kind: 'docx', title: '안내문', instructions: '휴관 안내' }), say('대신 간단한 문서로 하겠습니다.')] });
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '휴관 안내문 만들어줘' });
    assert.equal(r.docJobs, undefined, '문서 작업 꺼짐 → 작업 안 만듦');
    const reqs = (await fakeState()).anthropic.slice(n0);
    assert.ok(!reqs[0].body.tools.some((t) => t.type === 'web_search_20260209'), '웹 도구 꺼짐');
    assert.match(JSON.stringify(reqs[1].body.messages.at(-1)), /문서 작업이 꺼져/);
    await ctx.owner.ok('PUT', '/api/ai/settings', { webTools: true, docEngine: true });
  });
});
