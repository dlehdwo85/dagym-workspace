// 16차: 다짐·하이링크 웹사이트 문의 → 워크인 업무 자동 등록 (다짐 회사 전용)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql, token, hilinkToken;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' });
  sql = testDb();
  ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const send = (tok, body) => fetch(`${BASE}/api/integrations/inquiries`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

const lead = {
  lead_id: 'HL-20261014-0001', inquiry_type: 'HILINK 플랫폼', organization: '음성푸르지오더퍼스트', region: '충북', facility_scale: '1,200세대',
  name: '홍길동', phone: '010-0000-0000', email: 'lead@example.com', organization_type: '관리사무소', services: ['커뮤니티 예약', '출입 관리'],
  current_operation: '자체 운영', message: '데모를 보고 싶습니다.\n다음 주 가능할까요?', utm: { utm_source: 'naver', utm_campaign: 'fall' }, landing_page: '/hilink', referrer: 'https://search.naver.com',
};

describe('16차 웹사이트 문의 연동', () => {
  test('토큰 발급: 다짐 회사 슈퍼관리자만, 원문은 한 번만, 해시 저장', async () => {
    const r = await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'hilink' });
    assert.match(r.token, /^wkin_/);
    hilinkToken = token = r.token;
    const [row] = await sql`select token_hash, tenant from integration_tokens where id = ${r.id}`;
    assert.notEqual(row.token_hash, r.token); assert.equal(row.tenant, 'default');
    const list = await ctx.owner.ok('GET', '/api/platform/inquiries');
    assert.ok(!JSON.stringify(list).includes(r.token), '목록에 원문이 나오지 않는다');
    assert.equal((await ctx.staffA.client.get('/api/platform/inquiries')).status, 404);
    assert.equal((await ctx.staffA.client.post('/api/platform/inquiries/tokens', { site: 'dagym' })).status, 404);
  });

  test('토큰 없음·틀림·폐기 → 401', async () => {
    assert.equal((await send(null, lead)).status, 401);
    assert.equal((await send('wkin_wrong', lead)).status, 401);
    const t = await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'dagym' });
    await ctx.owner.ok('DELETE', `/api/platform/inquiries/tokens/${t.id}`);
    assert.equal((await send(t.token, { lead_id: 'x-1' })).status, 401);
    // 세션 토큰(로그인 Bearer)으로는 등록할 수 없다
    assert.equal((await sql`select count(*)::int n from inquiries`)[0].n, 0);
  });

  test('다른 회사(tenant) 토큰은 차단', async () => {
    const raw = 'wkin_other_tenant_token';
    await sql`insert into integration_tokens (tenant, site, token_hash) values ('t_other', 'dagym', ${createHash('sha256').update(`inquiry:${raw}`).digest('hex')})`;
    const r = await send(raw, { lead_id: 'other-1' });
    assert.equal(r.status, 401);
  });

  test('문의 → 업무: 프로젝트·섹션·제목·표·태그·체크리스트·담당·마감·우선순위·알림', async () => {
    const r = await send(token, lead);
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.duplicate, false);
    const d = await ctx.owner.ok('GET', `/api/tasks/${r.body.taskId}`);
    const t = d.task;
    assert.equal(t.title, '[하이링크 문의] 음성푸르지오더퍼스트 · HILINK 플랫폼 (충북)');
    assert.equal(t.priority, 'high'); assert.equal(t.assignee_id, ctx.ownerId); assert.equal(t.requested_by, ctx.ownerId);
    assert.equal(t.due_time, '18:00');
    const dow = new Date(t.due_date + 'T00:00:00Z').getUTCDay(); assert.ok(dow >= 1 && dow <= 5, '마감은 영업일');
    assert.deepEqual([...t.tags].sort(), ['출입 관리', '충북', '커뮤니티 예약', '하이링크웹'].sort());
    for (const s of ['| 회사/단지명 | 음성푸르지오더퍼스트 |', '| 연락처 | 010-0000-0000 |', '| Lead ID | HL-20261014-0001 |', 'source=naver', '데모를 보고 싶습니다.']) assert.ok(t.description.includes(s), s);
    assert.deepEqual(d.checklist.map((c) => c.text), ['1차 연락 (접수 24시간 이내)', '요구사항 확인·현장 정보 수집', '데모 일정', '자료/제안서 발송', '견적', '미팅 일정', '결과 기록 (수주·보류·실패)']);
    const [p] = await sql`select p.name, s.name as section from tasks t join projects p on p.id = t.project_id join project_sections s on s.id = t.section_id where t.id = ${t.id}`;
    assert.deepEqual({ ...p }, { name: '웹사이트 문의', section: 'HILINK 플랫폼' });
    const n = await sql`select title from notifications where user_id = ${ctx.ownerId} and entity_id = ${t.id}`;
    assert.equal(n[0]?.title, '새 웹사이트 문의 · 음성푸르지오더퍼스트');
  });

  test('같은 lead_id 두 번 → 1건 (동시 전송 포함)', async () => {
    const again = await send(token, lead);
    assert.equal(again.body.duplicate, true);
    const many = await Promise.all([1, 2, 3].map(() => send(token, { lead_id: 'HL-dup-2', inquiry_type: '위탁운영' })));
    assert.equal(new Set(many.map((m) => m.body.taskId)).size, 1);
    assert.equal(many.filter((m) => !m.body.duplicate).length, 1);
    assert.equal((await sql`select count(*)::int n from inquiries where lead_id in ('HL-20261014-0001','HL-dup-2')`)[0].n, 2);
    assert.equal((await sql`select count(*)::int n from tasks where title like '[하이링크 문의]%'`)[0].n, 2);
  });

  test('선택 필드 누락 허용, lead_id 는 필수, 유형별 템플릿·기본 담당자', async () => {
    assert.equal((await send(token, { organization: 'x' })).status, 400);
    await ctx.owner.ok('PUT', '/api/platform/inquiries/assignees', { assignees: { 위탁운영: ctx.managerA.id } });
    const r = await send(token, { lead_id: 'HL-min-3', inquiry_type: '위탁 운영 문의' });
    assert.equal(r.status, 200);
    const d = await ctx.owner.ok('GET', `/api/tasks/${r.body.taskId}`);
    assert.equal(d.task.assignee_id, ctx.managerA.id);
    assert.ok(d.checklist.some((c) => c.text === '현장 실사'));
    assert.equal(d.task.title, '[하이링크 문의] 이름 없는 문의 · 위탁 운영 문의');
    const other = await send(token, { lead_id: 'HL-min-4', message: '그냥 궁금' });
    const d2 = await ctx.owner.ok('GET', `/api/tasks/${other.body.taskId}`);
    assert.equal(d2.task.assignee_id, ctx.ownerId, '기타 유형은 지정 없음 → 대표');
    const [s] = await sql`select s.name from tasks t join project_sections s on s.id = t.section_id where t.id = ${other.body.taskId}`;
    assert.equal(s.name, '기타');
    assert.equal((await ctx.owner.req('PUT', '/api/platform/inquiries/assignees', { assignees: { 기타: '00000000-0000-0000-0000-0000000000ff' } })).status, 400);
  });

  test('유형별 담당자 여러 명: 기본은 주 담당 + 협업자(전원 알림·1차 연락 항목 담당), "각각" 이면 담당자마다 업무', async () => {
    await ctx.owner.ok('PUT', '/api/platform/inquiries/assignees', { assignees: { 'HILINK 플랫폼': [ctx.managerA.id, ctx.staffA.id] } });
    const st = await ctx.owner.ok('GET', '/api/platform/inquiries');
    assert.deepEqual(st.assignees['HILINK 플랫폼'], [ctx.managerA.id, ctx.staffA.id]); assert.equal(st.modes['HILINK 플랫폼'], 'together');
    const r = await send(token, { lead_id: 'HL-multi-1', inquiry_type: 'HILINK 플랫폼', organization: '여럿단지' });
    assert.equal(r.body.taskIds.length, 1);
    const d = await ctx.owner.ok('GET', `/api/tasks/${r.body.taskId}`);
    assert.equal(d.task.assignee_id, ctx.managerA.id);
    assert.deepEqual(d.collaborators.map((c) => c.user_id ?? c.id), [ctx.staffA.id]);
    assert.equal(d.checklist[0].assignee_id, ctx.managerA.id, '1차 연락 담당 = 주 담당');
    const n = await sql`select user_id from notifications where entity_id = ${r.body.taskId} and title like '새 웹사이트 문의%'`;
    assert.deepEqual(n.map((x) => x.user_id).sort(), [ctx.managerA.id, ctx.staffA.id].sort());
    await ctx.owner.ok('PUT', '/api/platform/inquiries/assignees', { assignees: { 'HILINK 플랫폼': [ctx.managerA.id, ctx.staffA.id] }, modes: { 'HILINK 플랫폼': 'each' } });
    const e = await send(token, { lead_id: 'HL-multi-2', inquiry_type: 'HILINK 플랫폼', organization: '각각단지' });
    assert.equal(e.body.taskIds.length, 2);
    const ts = await sql`select assignee_id, batch_id from tasks where id = any(${e.body.taskIds}::uuid[])`;
    assert.deepEqual(ts.map((x) => x.assignee_id).sort(), [ctx.managerA.id, ctx.staffA.id].sort());
    assert.ok(ts[0].batch_id && ts[0].batch_id === ts[1].batch_id, '같은 묶음');
    assert.equal((await send(token, { lead_id: 'HL-multi-2' })).body.duplicate, true, '재전송은 추가 생성 없음');
    assert.equal((await sql`select count(*)::int n from tasks where title like '%각각단지%'`)[0].n, 2);
  });

  test('다짐 외 회사(가입한 다른 회사 대표, 슈퍼관리자 표시가 있어도) → 메뉴·API 404', async () => {
    const c = new Client('other');
    const r = await c.ok('POST', '/api/auth/signup', { email: 'boss@other.test', name: '남사장', mode: 'team', company: '남의상사', password: 'signup-pass-1234', agree: { terms: true, privacy: true, ai: true, marketing: false } });
    await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
    await c.ok('POST', '/api/auth/login', { email: 'boss@other.test', password: 'signup-pass-1234' });
    await sql`update users set platform_admin = true where email = 'boss@other.test'`;
    assert.equal((await c.get('/api/platform/inquiries')).status, 404);
    assert.equal((await c.post('/api/platform/inquiries/tokens', { site: 'dagym' })).status, 404);
    // 다른 회사 사람은 문의 업무를 볼 수 없다
    const [q] = await sql`select task_id from inquiries limit 1`;
    assert.equal((await c.get(`/api/tasks/${q.task_id}`)).status, 404);
    const list = await c.ok('GET', '/api/tasks?view=all');
    assert.ok(!JSON.stringify(list).includes('하이링크 문의'));
  });
});
