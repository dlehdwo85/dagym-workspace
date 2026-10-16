// V14 15번 기밀 자료 보호 · 18번 자료실 폴더: 보안 등급은 서버가 강제(목록·읽기·내려받기·AI 도구·제안·사용 내역), 우회 시도 포함
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, BASE, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const D = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
async function up(c, meta, text) {
  const data = Buffer.from(text, 'utf8');
  const init = await c.ok('POST', '/api/library', { mimeType: 'text/csv', ...meta, size: data.length });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  await c.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}
/** AI 에게 묻고, 이번 차례에 AI 로 간 모든 요청(도구 결과 포함)을 글자로 돌려준다 */
async function ask(c, text, items) {
  await ctl({ anthropicReset: true, anthropicQueue: items });
  const before = (await fakeState()).anthropic.length;
  const r = await c.ok('POST', '/api/ai/chat', { text });
  const reqs = (await fakeState()).anthropic.slice(before);
  const sent = JSON.stringify(reqs.map((x) => x.body.messages));
  // 도구 결과(서버가 AI 에게 넘긴 자료)만 — 사용자가 친 글자는 빼고 본다
  const results = JSON.stringify(reqs.flatMap((x) => x.body.messages.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : []))));
  return { r, sent, results };
}

before(async () => {
  await resetDb(); await ensureTls();
  fake = await startFakeGoogle();
  srv = await startServer();
  sql = testDb();
  ctx = await bootstrap();
  // 본부장(부서 책임자)·본사 관리자
  for (const [k, name, role] of [['head', '박본부장', 'dept_lead'], ['adm', '정관리', 'admin']]) {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role, orgUnitIds: [ctx.hq] });
    const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
    D[k] = { c, id: (await c.ok('GET', '/api/auth/me')).user.id };
  }
  D.conf = await up(ctx.owner, { fileName: '2026 급여 대장.csv', folder: '인사' }, '이름,급여\n김대표,9000000\n');
  D.memo = await up(ctx.owner, { fileName: '회의록.csv', folder: '공용' }, '안건,내용\n신규 오픈,10월\n');
  await ctx.owner.ok('PATCH', `/api/library/${D.conf}`, { security: 'confidential' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V14 15번 보안 등급 — 자료실', () => {
  test('기밀 제안: 이름에 급여 → 등급은 내부 그대로 + 제안 표시, 대표가 기밀로 지정하면 확인됨', async () => {
    const [f] = await sql`select security, security_suggested, security_confirmed from library_files where id = ${D.conf}`;
    assert.equal(f.security, 'confidential'); assert.equal(f.security_suggested, 'confidential'); assert.equal(f.security_confirmed, true);
    const t = await up(ctx.staffA.client, { fileName: '거래처 매입 단가.csv', folder: '영업' }, 'a,b\n1,2\n');
    const [g] = await sql`select security, security_suggested from library_files where id = ${t}`;
    assert.equal(g.security, 'internal', '확인 전 기본 내부'); assert.equal(g.security_suggested, 'confidential');
    D.quote = t;
  });
  test('직원: 목록·검색·폴더·상세·내려받기 모두 숨김(존재도 404)', async () => {
    const c = ctx.staffA.client;
    const all = await c.ok('GET', '/api/library');
    assert.ok(!all.files.some((f) => f.id === D.conf)); assert.ok(all.files.some((f) => f.id === D.memo));
    assert.ok(!all.folders.some((f) => f.folder === '인사'), '기밀 파일만 있는 폴더는 이름도 안 보임');
    assert.equal((await c.ok('GET', '/api/library?q=' + encodeURIComponent('급여'))).files.length, 0);
    assert.equal((await c.ok('GET', '/api/library?q=9000000')).files.length, 0, '본문 검색으로도 안 나옴');
    assert.equal((await c.get(`/api/library/${D.conf}`)).status, 404);
    assert.equal((await c.get(`/api/library/${D.conf}/download`)).status, 404);
    assert.equal((await c.req('PATCH', `/api/library/${D.conf}`, { title: 'x' })).status, 404);
  });
  test('대표는 정상, 열람·내려받기는 감사 기록', async () => {
    assert.ok((await ctx.owner.ok('GET', '/api/library')).files.some((f) => f.id === D.conf && f.effective_security === 'confidential'));
    assert.equal((await ctx.owner.req('GET', `/api/library/${D.conf}/download`)).status, 302);
    const logs = (await ctx.owner.ok('GET', '/api/library/confidential-log')).logs;
    assert.ok(logs.some((l) => l.action === 'library.confidential_download' && l.target_id === D.conf));
    assert.equal((await ctx.staffA.client.get('/api/library/confidential-log')).status, 404);
  });
  test('본부장: 권한 부여 전 숨김 → "기밀 자료 열람" 부여 후 정상', async () => {
    assert.equal((await D.head.c.get(`/api/library/${D.conf}`)).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'confidential', userId: D.head.id, level: 'view' });
    assert.equal((await D.head.c.ok('GET', `/api/library/${D.conf}`)).file.id, D.conf);
    assert.ok((await D.head.c.ok('GET', '/api/library?q=' + encodeURIComponent('급여'))).files.some((f) => f.id === D.conf));
    assert.equal((await D.head.c.req('PATCH', `/api/library/${D.conf}`, { security: 'internal' })).status, 403, '조회 권한으로는 등급을 못 내림');
  });
  test('폴더 등급 상속: 폴더를 기밀로 → 그 안의 내부 파일도 기밀, 직원은 폴더 등급을 못 바꿈', async () => {
    const plan = await up(ctx.owner, { fileName: '조직 개편안.csv', folder: '경영/계획' }, 'x\n1\n');
    assert.ok((await ctx.staffA.client.ok('GET', '/api/library')).files.some((f) => f.id === plan));
    assert.equal((await ctx.staffA.client.req('PUT', '/api/library/folder-security', { folder: '경영', security: 'public' })).status, 403);
    await ctx.owner.ok('PUT', '/api/library/folder-security', { folder: '경영', security: 'confidential' });
    assert.ok(!(await ctx.staffA.client.ok('GET', '/api/library')).files.some((f) => f.id === plan), '하위 폴더 파일까지 상속');
    assert.equal((await ctx.staffA.client.get(`/api/library/${plan}`)).status, 404);
    assert.ok((await D.head.c.ok('GET', '/api/library')).files.some((f) => f.id === plan));
  });
  test('내부 자료 열람 끈 등급은 일반 자료만', async () => {
    const pub = await up(ctx.owner, { fileName: '회사 소개서.csv', folder: '공용' }, 'x\n1\n');
    await ctx.owner.ok('PATCH', `/api/library/${pub}`, { security: 'public' });
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library_internal', role: 'staff', level: 'none' });
    const ids = (await ctx.staffA.client.ok('GET', '/api/library')).files.map((f) => f.id);
    assert.ok(ids.includes(pub) && !ids.includes(D.memo));
    assert.ok(ids.includes(D.quote), '본인이 올린 파일은 항상');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library_internal', role: 'staff', level: null });
  });
  test('기밀 파일은 열람 권한 없는 사람이 담당인 업무에 첨부 불가', async () => {
    const t1 = (await ctx.owner.ok('POST', '/api/tasks', { title: '급여 확인', orgUnitId: ctx.hq, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    assert.equal((await ctx.owner.req('POST', `/api/library/${D.conf}/attach`, { taskId: t1 })).status, 403);
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '급여 검토', orgUnitId: ctx.hq, assigneeId: D.head.id, approvalRequired: false })).id;
    await ctx.owner.ok('POST', `/api/library/${D.conf}/attach`, { taskId: t2 });
  });
});

describe('V14 15번 AI 비서 — 서버 강제(프롬프트에 의존하지 않음)', () => {
  test('직원이 AI 로 우회: "급여 알려줘"·"파일 목록 전부"·파일 id 직접 읽기·매출 → 내용·제목·존재 모두 안 넘어감', async () => {
    const c = ctx.staffA.client;
    const a = await ask(c, '급여 대장 알려줘', [toolUse('t1', 'search_library', { query: '급여' }), say('찾지 못했습니다')]);
    assert.ok(!/9000000|급여 대장/.test(a.results), '검색 결과에 기밀 파일 없음');
    const b = await ask(c, '자료실 파일 목록 전부 보여줘', [toolUse('t2', 'search_library', { query: '' }), say('목록입니다')]);
    assert.ok(!b.results.includes(D.conf) && !/급여/.test(b.results) && b.results.includes(D.memo));
    const r = await ask(c, `이 파일 읽어줘 ${D.conf}`, [toolUse('t3', 'read_library_file', { fileId: D.conf }), say('읽지 못했습니다')]);
    assert.ok(!/9000000|급여/.test(r.results)); assert.match(r.results, /찾을 수 없거나 볼 권한이 없습니다/, '권한 밖 파일은 "없음"으로');
    const m = await ask(c, '매출 알려줘', [toolUse('t4', 'revenue_summary', { fromMonth: '2026-01', toMonth: '2026-09' }), say('권한이 없습니다')]);
    assert.match(m.results, /권한이 없습니다/);
    assert.ok(!(await sql`select 1 from audit_logs where action = 'library.confidential_ai' and actor_id = ${ctx.staffA.id}`).length);
  });
  test('대표는 정상 + AI 참조 기록, 기밀 근거 결과물은 같은 등급·권한자에게만', async () => {
    const a = await ask(ctx.owner, '급여 대장 요약하고 직원에게 업무로 줘', [toolUse('t1', 'read_library_file', { fileId: D.conf }),
      toolUse('t2', 'propose_create_task', { title: '급여 점검', orgUnitId: ctx.hq, assigneeId: ctx.staffA.id, description: '김대표 9000000' }),
      toolUse('t3', 'propose_xlsx_report', { title: '급여 요약', sheets: [{ name: '요약', rows: [['이름', '급여'], ['김대표', 9000000]] }] }), say('제안했습니다')]);
    assert.match(a.sent, /9000000/, '대표는 내용을 읽음');
    assert.ok((await sql`select 1 from audit_logs where action = 'library.confidential_ai' and actor_id = ${ctx.ownerId}`).length, 'AI 참조 기록');
    const [task, xlsx] = a.r.proposals;
    const deny = await ctx.owner.req('POST', `/api/ai/proposals/${task.id}`, { accept: true });
    assert.equal(deny.status, 403, '기밀 근거 업무를 권한 없는 직원에게 배정 불가');
    const ok = await ctx.owner.ok('POST', `/api/ai/proposals/${xlsx.id}`, { accept: true });
    const [f] = await sql`select security from library_files where id = ${ok.fileId}`;
    assert.equal(f.security, 'confidential', '기밀 근거 엑셀은 기밀로 저장');
    assert.equal((await ctx.staffA.client.get(`/api/library/${ok.fileId}`)).status, 404);
    D.thread = a.r.threadId;
  });
  test('AI 사용 내역: 기밀 대화는 기밀 권한 없는 관리자에게 제목·내용 가림, 검색에도 안 걸림', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'ai_logs', userId: D.adm.id, level: 'view' });
    // V34 C4: 관리자는 기본으로 기밀 열람 — 이 시험은 권한을 끈 관리자
    assert.ok(!(await D.adm.c.ok('GET', `/api/ai/logs/${D.thread}`)).redacted, '기본: 관리자 기밀 열람');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'confidential', userId: D.adm.id, level: 'none' });
    const v = await D.adm.c.ok('GET', `/api/ai/logs/${D.thread}`);
    assert.equal(v.redacted, true); assert.ok(!JSON.stringify(v).includes('9000000') && !JSON.stringify(v).includes('급여'));
    const l = await D.adm.c.ok('GET', '/api/ai/logs?q=' + encodeURIComponent('급여'));
    assert.ok(!l.threads.some((t) => t.id === D.thread));
    const o = await ctx.owner.ok('GET', `/api/ai/logs/${D.thread}`);
    assert.ok(!o.redacted && JSON.stringify(o).includes('급여'));
  });
});

describe('V14 18번 자료실 폴더', () => {
  test('빈 폴더 만들기 → 목록에 보임, 이름 바꾸기는 하위 파일·폴더 등급까지, 빈 폴더만 삭제, 여러 파일 옮기기', async () => {
    await ctx.owner.ok('POST', '/api/library/folders', { path: '브랜드/로고' });
    assert.ok((await ctx.staffA.client.ok('GET', '/api/library')).folders.some((f) => f.folder === '브랜드/로고' && f.n === 0));
    const a = await up(ctx.owner, { fileName: '로고 A.csv', folder: '브랜드/로고' }, 'x\n');
    const b = await up(ctx.owner, { fileName: '로고 B.csv', folder: '공용' }, 'x\n');
    const mv = await ctx.owner.ok('POST', '/api/library/move', { ids: [b], folder: '브랜드/로고' });
    assert.equal(mv.moved, 1);
    await ctx.owner.ok('PUT', '/api/library/folder-security', { folder: '브랜드', security: 'public' });
    await ctx.owner.ok('PATCH', '/api/library/folders', { from: '브랜드', to: '디자인/브랜드' });
    const files = await sql`select folder from library_files where id in (${a}, ${b})`;
    assert.ok(files.every((f) => f.folder === '디자인/브랜드/로고'));
    assert.equal((await sql`select security from library_folder_security where folder = '디자인/브랜드'`)[0]?.security, 'public', '폴더 등급도 따라감');
    assert.equal((await ctx.owner.req('DELETE', '/api/library/folders', { path: '디자인' })).status, 409, '자료가 있으면 삭제 안 됨');
    await ctx.owner.ok('POST', '/api/library/folders', { path: '임시' });
    await ctx.owner.ok('DELETE', '/api/library/folders', { path: '임시' });
    assert.ok(!(await ctx.owner.ok('GET', '/api/library')).folders.some((f) => f.folder === '임시'));
    // 볼 수 없는 기밀 파일이 든 폴더는 권한 없는 사람이 옮길 수 없음
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', userId: D.adm.id, level: 'delete' });
    assert.equal((await D.adm.c.req('PATCH', '/api/library/folders', { from: '인사', to: '보관/인사' })).status, 403);
  });
});
