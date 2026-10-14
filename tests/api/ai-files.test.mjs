// 대표 요청(2026-10-14): AI 비서 사진 첨부 → 문서 파일 만들기(docx·md) · 대화에 올린 자료를 자료실 폴더로 정리 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function up(c, name, mime, data) {
  const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder: 'AI 요청 첨부', tags: ['AI 첨부'], purpose: 'ai_attach' });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  await c.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}
/** 묻고, 이번 차례 AI 요청들과 도구 결과를 돌려준다 */
async function chat(c, body, steps) {
  const n0 = (await fakeState()).anthropic.length;
  await queue(steps);
  const r = await c.ok('POST', '/api/ai/chat', body);
  const reqs = (await fakeState()).anthropic.slice(n0);
  const results = reqs.flatMap((x) => (Array.isArray(x.body.messages?.at(-1)?.content) ? x.body.messages.at(-1).content.filter((b) => b.type === 'tool_result') : []));
  return { r, reqs, results: Object.fromEntries(results.map((x) => [x.tool_use_id, x])) };
}

before(async () => {
  await resetDb(); await ensureTls();
  fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('AI 비서 사진 → 문서 만들기 · 자료실 정리', () => {
  let img, threadId;
  test('사진 첨부 → 비전 입력 → 문서(docx) 제안 → 확인 전 미생성 → 확인하면 자료실 저장·본문 검색 가능', async () => {
    img = await up(ctx.owner, '붙여넣은 이미지 2026-10-14.png', 'image/png', png);
    const content = '# 안건\n- 10월 매출 점검\n- **전단 배포** 일정\n\n| 지점 | 매출 |\n|---|---|\n| 강남점 | 4,800만 |\n\n1. 다음 회의 11월 3일';
    const { r, reqs, results } = await chat(ctx.owner, { text: '이 화이트보드 사진으로 회의록 문서 만들어줘', fileIds: [img] }, [
      toolUse('d1', 'propose_create_document', { title: '10월 운영 회의록', content, folder: '회의록', tags: ['회의록', '10월'] }), say('확인을 누르면 문서가 만들어집니다.')]);
    threadId = r.threadId;
    const first = reqs[0].body.messages.at(-1).content;
    assert.equal(first[0].type, 'image', '사진은 비전 입력으로');
    assert.ok(reqs[0].body.tools.some((t) => t.name === 'propose_create_document') && reqs[0].body.tools.some((t) => t.name === 'propose_organize_files'));
    assert.ok(!results.d1.is_error, results.d1.content);
    const p = r.proposals[0];
    assert.equal(p.kind, 'create_document'); assert.match(p.summary, /10월 운영 회의록\.docx → 자료실 회의록/); assert.equal(p.preview.folder, '회의록');
    assert.equal((await sql`select count(*)::int n from library_files where title = '10월 운영 회의록'`)[0].n, 0, '확인 전 미생성');
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    const [f] = await sql`select folder, file_name, mime_type, tags, text_content, storage_key from library_files where id = ${done.fileId}`;
    assert.equal(f.folder, '회의록'); assert.equal(f.file_name, '10월 운영 회의록.docx');
    assert.equal(f.mime_type, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.ok(f.tags.includes('AI') && f.tags.includes('회의록'));
    // 만든 docx 를 다시 읽어 본문이 그대로 — 올바른 Word 파일(압축·XML) 이라는 확인
    for (const w of ['10월 운영 회의록', '안건', '10월 매출 점검', '전단 배포', '강남점', '4,800만', '다음 회의 11월 3일']) assert.ok(f.text_content.includes(w), `본문에 ${w}`);
    assert.ok(!f.text_content.includes('**') && !f.text_content.includes('|---'), '마크다운 기호는 서식으로 바뀜');
    assert.ok((await ctx.owner.ok('GET', '/api/library?q=' + encodeURIComponent('전단 배포'))).files.some((x) => x.id === done.fileId), '자료실 본문 검색');
    assert.equal(done.link, `/library?file=${done.fileId}`);
  });

  test('같은 대화에서 "아까 올린 사진 자료실에 정리해줘" → 기록의 첨부 id → 기존 폴더 보고 정리 제안 → 확인하면 폴더·제목·태그', async () => {
    await ctx.owner.ok('POST', '/api/library/folders', { path: '현장사진/강남점' }).catch(() => null);
    const { r, reqs, results } = await chat(ctx.owner, { text: '아까 올린 사진은 자료실에 정리해줘', threadId }, [
      toolUse('l1', 'list_library_folders', {}),
      toolUse('o1', 'propose_organize_files', { items: [{ fileId: img, folder: '현장사진/강남점', title: '강남점 회의 화이트보드', tags: ['회의', '강남점'] }] }), say('정리안입니다.')]);
    const hist = JSON.stringify(reqs[0].body.messages);
    assert.ok(hist.includes(`[첨부: id=${img}`), '앞선 질문의 첨부 id 가 대화 기록에');
    const folders = JSON.parse(results.l1.content).folders;
    assert.ok(folders.includes('회의록') && folders.includes('AI 요청 첨부'), JSON.stringify(folders));
    assert.ok(!results.o1.is_error, results.o1.content);
    const p = r.proposals[0];
    assert.equal(p.kind, 'organize_files');
    assert.match(p.preview.moves[0], /AI 요청 첨부\) → 현장사진\/강남점/);
    assert.equal((await sql`select folder from library_files where id = ${img}`)[0].folder, 'AI 요청 첨부', '확인 전 그대로');
    await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    const [f] = await sql`select folder, title, tags, source from library_files where id = ${img}`;
    assert.equal(f.folder, '현장사진/강남점'); assert.equal(f.title, '강남점 회의 화이트보드');
    assert.ok(f.tags.includes('회의') && !f.tags.includes('AI 첨부'), JSON.stringify(f.tags));
    assert.equal(f.source, 'upload', '대화 첨부 → 일반 자료');
    assert.equal((await sql`select count(*)::int n from library_folders where path = '현장사진/강남점'`)[0].n, 1);
  });

  test('권한: 남이 올린 자료는 정리 제안 불가, 볼 수 없는 자료 id 는 없는 것처럼', async () => {
    const mine = await up(ctx.owner, '대표 메모.txt', 'text/plain', Buffer.from('메모'));
    const { r, results } = await chat(ctx.staffA.client, { text: '대표 메모 정리해줘' }, [
      toolUse('o2', 'propose_organize_files', { items: [{ fileId: mine, folder: '기타' }] }), say('못 했습니다.')]);
    assert.ok(results.o2.is_error, '직원이 대표 자료 정리 제안 → 오류');
    assert.equal(r.proposals.length, 0);
    const { results: r2 } = await chat(ctx.owner, { text: '정리' }, [
      toolUse('o3', 'propose_organize_files', { items: [{ fileId: '00000000-0000-4000-8000-000000000000', folder: '기타' }] }), say('없음')]);
    assert.ok(r2.o3.is_error && /찾을 수 없거나/.test(r2.o3.content));
  });

  test('md 형식·폴더 비우면 "AI 문서"·업무 첨부', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '안내문 작성', assigneeId: ctx.ownerId, approvalRequired: false })).id;
    const { r } = await chat(ctx.owner, { text: '휴관 안내문 md 로 만들어 이 업무에 붙여줘' }, [
      toolUse('d2', 'propose_create_document', { title: '추석 휴관 안내', content: '- 휴관: 10/5~10/7', format: 'md', taskId: t }), say('ok')]);
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true });
    const [f] = await sql`select folder, file_name, mime_type, text_content from library_files where id = ${done.fileId}`;
    assert.equal(f.folder, 'AI 문서'); assert.equal(f.file_name, '추석 휴관 안내.md'); assert.equal(f.mime_type, 'text/markdown');
    assert.ok(f.text_content.startsWith('# 추석 휴관 안내') && f.text_content.includes('10/5~10/7'));
    const d = await ctx.owner.ok('GET', `/api/tasks/${t}`);
    assert.ok(d.attachments.some((a) => /추석 휴관 안내/.test(a.doc_title ?? a.file_name ?? '')), '업무에 첨부');
  });
});
