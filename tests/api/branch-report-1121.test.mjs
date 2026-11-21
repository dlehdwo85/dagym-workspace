// #1096 지점 주간보고(다짐 전용, 대표 11/21 결정) 1단계 — 스위치(다짐만, 다른 회사 404) · 보고 지점 목록(기능 안의 별도 목록 — 조직 단위는 건드리지 않음,
// 작성 담당은 자기 지점만 · 검토 담당·관리자는 전체 · 숨김)
// · 대화 파일 올리기(가린 글만 저장, 같은 파일 두 번 = 겹침) · AI 초안(가짜 Anthropic 서버) — 붙여 넣은 글 가림, 숫자는 글에 있는 것만, 없는 근거·근거 없는 '완료'는 '확인 필요'
// · 근거 보기 · 고치기·제출(잠김)·관리자 제출 취소 · 권한(다른 지점 사람 404) · 인쇄 화면 · 정기 작업(제출 30일 뒤 근거 지움)
// 구조 시험(가짜 AI) — 실제 AI 초안 품질·운영 확인은 로컬
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, FAKE, ensureTls, seoulToday, addDays, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, sql, ctx, other, siteA, siteB, siteC;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const dow = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const friday = addDays(seoulToday(), -((dow(seoulToday()) + 2) % 7)); // 오늘 또는 그 전 금요일 = 이번 보고일
const tue = addDays(friday, -3), wed = addDays(friday, -2);
const kor = (d) => `${Number(d.slice(0, 4))}년 ${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 ${'일월화수목금토'[dow(d)]}요일`;
const PC = `시험지점 운영방 님과 카카오톡 대화
저장한 날짜 : ${friday} 18:00:00

--------------- ${kor(tue)} ---------------
[김관리] [오전 9:05] 사우나 온도 민원 접수했습니다
 -010-1234-5678 (입주민) 101동 1203호
[김관리] [오전 9:06] 사진
[이매니저] [오후 1:30] 설비 업체 연락했습니다
--------------- ${kor(wed)} ---------------
[김관리] [오전 10:00] 골프장 타석 3번 센서 교체 완료`;
const D = `강남점 주간보고
<이용인원> 헬스 120 / 골프 35
<특이사항 건의사항 및 민원>
내용 : 사우나 온도 민원 (연락처 010-2222-3333)
- 업체 점검 예정
<골프장> 총이용인원 35 / 청소상태 청결 / 시설상태 양호
- 타석 3번 센서 : 완료`;

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_APPROVAL: '0', SIGNUP_IP_PER_DAY: '50' });
  sql = testDb(); ctx = await bootstrap();
  const c = new Client('other@br.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'other@br.test', password: 'signup-pass-1234', name: '다른대표', mode: 'team', company: '다른상사', size: '2-10', industry: '제조', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  other = c;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('#1096 지점 주간보고', () => {
  let msgId, reportId;
  test('스위치: 다짐(기본 회사)만 — 다른 회사는 화면·API 모두 404', async () => {
    const h = await ctx.owner.ok('GET', '/api/branch-reports');
    assert.equal(h.admin, true); assert.deepEqual(h.sites, []); assert.equal(h.friday, friday);
    // 화면: 앱 틀이 먼저 흘러 나가므로(상태 200) 다른 회사는 없는 화면(404 대체 화면) + 메뉴에 '지점 보고' 없음
    const own = await ctx.owner.req('GET', '/branch-reports');
    assert.equal(own.status, 200); assert.ok(!own.body.includes('NEXT_HTTP_ERROR_FALLBACK;404')); assert.ok(own.body.includes('href="/branch-reports"'), '다짐 관리자 메뉴에 지점 보고');
    const oth = await other.req('GET', '/branch-reports');
    assert.ok(oth.body.includes('NEXT_HTTP_ERROR_FALLBACK;404'), '다른 회사는 없는 화면'); assert.ok(!oth.body.includes('href="/branch-reports"'), '다른 회사 메뉴에 없음');
    for (const [m, p] of [['GET', '/api/branch-reports'], ['GET', '/api/branch-reports/setup'], ['PUT', '/api/branch-reports/setup'], ['POST', '/api/branch-reports/draft']]) {
      assert.equal((await other.req(m, p, m === 'GET' ? undefined : { sites: [{ name: 'x' }], siteId: ctx.siteA, day: friday })).status, 404, `${m} ${p}`);
    }
    assert.equal((await ctx.staffA.client.ok('GET', '/api/branch-reports')).sites.length, 0, '담당 지점 전 직원은 빈 목록');
    assert.ok((await ctx.owner.ok('GET', '/api/notifications/prefs')).types.some((t) => t.type === 'branch_report'), '다짐 알림 설정에는 있음');
    assert.ok(!(await other.ok('GET', '/api/notifications/prefs')).types.some((t) => t.type === 'branch_report'), '다른 회사 알림 설정에는 없음');
    assert.ok(!(await ctx.staffA.client.req('GET', '/branch-reports')).body.includes('href="/branch-reports"'), '담당 지점이 없는 직원 메뉴에는 없음');
  });

  test('보고 지점 목록(관리자): 조직 단위와 따로 · 작성 담당은 자기 지점만 · 검토 담당·관리자는 전체 · 숨김 · 이름 겹침·다른 회사 사람 막음', async () => {
    const units0 = (await sql`select count(*)::int as n from org_units`)[0].n;
    assert.equal((await ctx.staffA.client.req('GET', '/api/branch-reports/setup')).status, 403);
    const s = await ctx.owner.ok('PUT', '/api/branch-reports/setup', { sites: [{ name: '시험 강남점', writerUserId: ctx.staffA.id }, { name: '시험  판교점', hidden: true, writerUserId: ctx.staffB.id }, { name: '시험 수원점', reviewerUserId: ctx.managerA.id }] });
    assert.deepEqual(s.sites.map((x) => x.name), ['시험 강남점', '시험 판교점', '시험 수원점'], '순서대로 · 띄어쓰기 하나로');
    [siteA, siteB, siteC] = s.sites.map((x) => x.id);
    assert.equal((await sql`select count(*)::int as n from org_units`)[0].n, units0, '조직 단위를 만들지 않음');
    assert.ok(s.users.some((x) => x.id === ctx.staffA.id), '담당 고를 사람 목록');
    const [otherUser] = await sql`select id from users where lower(email) = 'other@br.test'`;
    assert.equal((await ctx.owner.req('PUT', '/api/branch-reports/setup', { sites: [{ id: siteA, name: '시험 강남점', writerUserId: otherUser.id }] })).status, 400, '다른 회사 사람은 담당 불가');
    assert.equal((await ctx.owner.req('PUT', '/api/branch-reports/setup', { sites: [{ name: '가' }, { name: '가' }] })).status, 400, '같은 이름 두 번');
    const a = await ctx.staffA.client.ok('GET', '/api/branch-reports');
    assert.deepEqual(a.sites.map((t) => t.id), [siteA], '작성 담당은 자기 지점만'); assert.equal(a.canWrite, true); assert.equal(a.canReopen, false);
    assert.ok((await ctx.staffA.client.req('GET', '/branch-reports')).body.includes('href="/branch-reports"'), '작성 담당 메뉴에 지점 보고');
    assert.equal((await ctx.staffB.client.ok('GET', '/api/branch-reports')).sites.length, 0, '숨긴 지점은 작성 담당에게도 안 보임');
    const m = await ctx.managerA.client.ok('GET', '/api/branch-reports');
    assert.deepEqual(m.sites.map((t) => t.id), [siteA, siteC], '검토 담당은 숨기지 않은 전체 지점');
    const o = await ctx.owner.ok('GET', '/api/branch-reports');
    assert.equal(o.sites.length, 3); assert.equal(o.sites.find((t) => t.id === siteB).hidden, true, '관리자에게는 (숨김)으로 보임');
    // 이름 바꾸기·순서 바꾸기는 같은 지점(id 유지)
    const s2 = await ctx.owner.ok('PUT', '/api/branch-reports/setup', { sites: [{ id: siteC, name: '시험 강남점2', reviewerUserId: ctx.managerA.id }, { id: siteA, name: '시험 강남점', writerUserId: ctx.staffA.id }, { id: siteB, name: '시험 판교점', hidden: true, writerUserId: ctx.staffB.id }] });
    assert.deepEqual(s2.sites.map((x) => [x.id, x.name]), [[siteC, '시험 강남점2'], [siteA, '시험 강남점'], [siteB, '시험 판교점']]);
  });

  test('대화 파일 올리기: 가린 글만 저장 · 목록 표시 뒤 휴대폰 번호·동호수 가림 · 같은 파일 두 번 = 겹침 · 다른 지점 사람 404', async () => {
    const r = await ctx.staffA.client.ok('POST', '/api/branch-reports/upload', { siteId: siteA, files: [{ name: 'KakaoTalk_시험.txt', text: PC }] });
    assert.equal(r.added, 3); assert.equal(r.from, tue); assert.equal(r.to, wed);
    const rows = await sql`select id::text as id, sender, text from branch_chat_messages where site_id = ${siteA} order by at`;
    assert.equal(rows.length, 3);
    assert.ok(!rows.some((x) => /010-1234|1203호/.test(x.text)), '원래 번호·호수가 남지 않음');
    assert.match(rows[0].text, /\[전화\]/); assert.match(rows[0].text, /\[호수\]/);
    msgId = rows[0].id;
    const again = await ctx.staffA.client.ok('POST', '/api/branch-reports/upload', { siteId: siteA, files: [{ name: 'KakaoTalk_시험.txt', text: PC }] });
    assert.equal(again.added, 0); assert.equal(again.duplicates, 3);
    assert.equal((await ctx.staffB.client.req('POST', '/api/branch-reports/upload', { siteId: siteA, files: [{ name: 'a.txt', text: PC }] })).status, 404);
    assert.equal((await ctx.staffA.client.req('POST', '/api/branch-reports/upload', { siteId: siteA, files: [{ name: 'a.txt', text: '아무 글' }] })).status, 400);
  });

  test('초안(AI): 붙여 넣은 글 가림 · 숫자는 글에 있는 것만 · 없는 근거·근거 없는 완료 → 확인 필요 · 금요일만', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/branch-reports/draft', { siteId: siteA, day: addDays(friday, -1), text: D })).status, 400, '금요일이 아니면 400');
    assert.equal((await ctx.staffB.client.req('POST', '/api/branch-reports/draft', { siteId: siteA, day: friday, text: D })).status, 404);
    const ai = { usage: [{ item: '헬스', count: '120' }, { item: '골프', count: '999명' }], lockers: [],
      facilities: [{ name: '골프장', visitors: '35', cleaning: '청결', condition: '양호', lines: [
        { item: '타석 3번 센서', status: '완료', action: '교체', state: '완료', evidence: ['D7', `M${msgId}`] },
        { item: '조명', status: '', action: '', state: '완료', evidence: ['M999999', 'D99'] }] }],
      issues: [{ title: '사우나 온도 민원', details: ['업체 점검 예정'], state: '진행 중', evidence: ['D4', `M${msgId}`] }], notes: '' };
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify(ai) }], stop_reason: 'end_turn' }] });
    const n0 = (await fakeState()).anthropic.length;
    const r = await ctx.staffA.client.ok('POST', '/api/branch-reports/draft', { siteId: siteA, day: friday, text: D, useChat: true });
    reportId = r.report.id;
    const sent = (await fakeState()).anthropic.slice(n0)[0].body;
    const userText = sent.messages[0].content;
    assert.ok(!/010-2222-3333|010-1234-5678/.test(userText), 'AI 로 보낸 글에 전화번호 없음');
    assert.match(userText, /D4 내용 : 사우나 온도 민원 \(연락처 \[전화\]\)/);
    assert.match(userText, new RegExp(`M${msgId} `)); assert.ok(sent.output_config.format.schema.required.includes('facilities'));
    const b = r.report.body;
    assert.equal(b.usage[0].count, '120'); assert.equal(b.usage[1].count, '확인 필요', '글에 없는 숫자');
    assert.deepEqual(b.facilities[0].lines[0].evidence, ['D7', `M${msgId}`]); assert.equal(b.facilities[0].lines[0].state, '완료');
    assert.deepEqual(b.facilities[0].lines[1].evidence, [], '없는 근거 번호는 지움'); assert.equal(b.facilities[0].lines[1].state, '확인 필요', '근거 없는 완료');
    assert.equal(r.fixed, 1); assert.equal(r.report.status, 'draft'); assert.equal(r.report.unit_name, '시험 강남점');
    assert.equal(r.report.period_start, addDays(friday, -7)); assert.equal(r.report.period_end, addDays(friday, -1));
    assert.ok(!/010-2222/.test(r.report.source_text), '저장한 붙여 넣은 글도 가린 글');
    const [u] = await sql`select count(*)::int as n from ai_usage where purpose = 'branch_report'`; assert.equal(u.n, 1, 'AI 사용 기록');
    const h = await ctx.staffA.client.ok('GET', '/api/branch-reports');
    assert.equal(h.reports[0].id, reportId); assert.equal(h.chat.n, 3);
  });

  test('근거 보기 · 고치기 · 제출(잠김) · 관리자만 제출 취소 · 권한', async () => {
    const ev = await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}/evidence?refs=D4,M${msgId},M999999`);
    assert.deepEqual(ev.items.map((x) => x.kind), ['주간보고 글', '단체방 대화', '단체방 대화']);
    assert.match(ev.items[0].text, /\[전화\]/); assert.equal(ev.items[1].sender, '김관리'); assert.match(ev.items[2].text, /없는 메시지/);
    const cur = (await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report.body;
    const edited = { ...cur, usage: [...cur.usage.slice(0, 1), { item: '골프', count: '35' }], notes: '담당 확인' };
    const s = await ctx.staffA.client.ok('PUT', `/api/branch-reports/${reportId}`, edited);
    assert.equal(s.report.body.usage[1].count, '35'); assert.equal(s.report.body.notes, '담당 확인');
    assert.equal((await ctx.staffB.client.req('GET', `/api/branch-reports/${reportId}`)).status, 404, '다른 지점 작성 담당');
    const rv = await ctx.managerA.client.ok('GET', `/api/branch-reports/${reportId}`);
    assert.equal(rv.canWrite, false, '다른 지점 검토 담당은 보기만'); assert.equal((await ctx.managerA.client.req('PUT', `/api/branch-reports/${reportId}`, edited)).status, 403);
    assert.equal((await other.req('GET', `/api/branch-reports/${reportId}`)).status, 404, '다른 회사');
    assert.equal((await ctx.owner.req('GET', '/api/branch-reports/not-a-uuid')).status, 404);
    await ctx.staffA.client.ok('POST', `/api/branch-reports/${reportId}/submit`, {});
    assert.equal((await ctx.staffA.client.req('PUT', `/api/branch-reports/${reportId}`, edited)).status, 409, '제출 뒤 고치기 막힘');
    assert.equal((await ctx.staffA.client.req('POST', '/api/branch-reports/draft', { siteId: siteA, day: friday, text: D })).status, 409, '제출한 주는 초안 다시 만들기 막힘');
    assert.equal((await ctx.staffA.client.req('DELETE', `/api/branch-reports/${reportId}/submit`)).status, 403, '작성 담당은 제출 취소 못 함');
    assert.equal((await ctx.managerA.client.req('DELETE', `/api/branch-reports/${reportId}/submit`)).status, 403, '다른 지점 검토 담당도 못 함');
    const un = await ctx.owner.ok('DELETE', `/api/branch-reports/${reportId}/submit`);
    assert.equal(un.report.status, 'draft');
    await ctx.staffA.client.ok('POST', `/api/branch-reports/${reportId}/submit`, {});
    // 그 지점 검토 담당이 되면 제출 취소 가능
    await ctx.owner.ok('PUT', '/api/branch-reports/setup', { sites: [{ id: siteC, name: '시험 강남점2' }, { id: siteA, name: '시험 강남점', writerUserId: ctx.staffA.id, reviewerUserId: ctx.managerA.id }, { id: siteB, name: '시험 판교점', hidden: true }] });
    const g = await ctx.managerA.client.ok('GET', `/api/branch-reports/${reportId}`);
    assert.equal(g.report.status, 'submitted'); assert.equal(g.canReopen, true);
    await ctx.managerA.client.ok('DELETE', `/api/branch-reports/${reportId}/submit`);
    await ctx.staffA.client.ok('POST', `/api/branch-reports/${reportId}/submit`, {});
    assert.equal((await ctx.owner.req('PUT', '/api/branch-reports/setup', { sites: [{ id: siteC, name: '시험 강남점2' }] })).status, 409, '보고서가 있는 지점은 지울 수 없음(숨김으로)');
    const acts = (await sql`select action from audit_logs where action like 'branch_report.%' order by id`).map((x) => x.action);
    for (const a of ['branch_report.setup', 'branch_report.chat_upload', 'branch_report.draft', 'branch_report.edit', 'branch_report.submit', 'branch_report.unsubmit']) assert.ok(acts.includes(a), a);
  });

  test('인쇄 화면(PDF): 다짐 머리·양식 — 다른 회사·다른 지점은 404', async () => {
    const p = await ctx.owner.req('GET', `/branch-print/${reportId}`);
    assert.equal(p.status, 200);
    assert.match(p.body, /커뮤니티 주간 운영 보고서/); assert.match(p.body, /시험 강남점/); assert.match(p.body, /이용 인원 현황/);
    assert.equal((await other.req('GET', `/branch-print/${reportId}`)).status, 404);
    assert.equal((await ctx.staffB.client.req('GET', `/branch-print/${reportId}`)).status, 404);
  });

  test('정기 작업: 제출 30일 뒤 그 주 대화·붙여 넣은 글 지움 → 제출 취소 막힘', async () => {
    await sql`update branch_reports set submitted_at = now() - interval '31 days' where id = ${reportId}`;
    await tick();
    const [r] = await sql`select source_text, purged_at from branch_reports where id = ${reportId}`;
    assert.equal(r.source_text, null); assert.ok(r.purged_at);
    assert.equal((await sql`select count(*)::int as n from branch_chat_messages where site_id = ${siteA}`)[0].n, 0);
    const g = await ctx.owner.ok('GET', `/api/branch-reports/${reportId}`);
    assert.equal(g.report.body.usage[0].count, '120', '보고서 본문은 남음');
    assert.equal((await ctx.owner.req('DELETE', `/api/branch-reports/${reportId}/submit`)).status, 409);
  });
});
