// 계약 관리 1단계(대표 11/19 · docs/contract-docs-design.md) — 맺은 계약 보관·만료일 관리
// ① 권한: 메뉴 권한 '계약 관리'(기본 대표·관리자만) · 권한 없는 직원에게는 없는 메뉴(404) · 조회만 있는 사람의 편집 403 · 다른 회사 404 ② 등록·목록(상태·남은 날·임박 순)·고치기·꼬리표
// ③ 만료 알림: 90·60·30·7일 전 가운데 가장 가까운 단계 하나만, 같은 단계는 한 번 · 자동 연장 + 해지 통보 기한이면 기준일 = 통보 마감일 · 지나면 한 번 더
//    · 첫 알림 때 담당자에게 '[계약 갱신 검토]' 업무 1건 · 알림 받는 사람은 계약마다(기본 담당자 + 등록한 사람)
// ④ 갱신 등록(기간 이력) · 종료 ⑤ 계약서 파일(올리기·열기 = 권한 + 감사 기록 · 저장공간에 포함) ⑥ 회사 기본 알림 날짜 · 엑셀
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, other;
const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return r.json(); };
const notes = (userId) => sql`select title, body, link from notifications where user_id = ${userId} and type = 'agreement_expiry' order by created_at`;

before(async () => {
  await resetDb(); sql = testDb(); srv = await startServer({}); ctx = await bootstrap();
  await sql`insert into tenants (id, name) values ('t_agr2', '남의회사') on conflict do nothing`;
  const [u] = await sql`insert into users (email, name, role, status, tenant) values ('boss@other-agr.test', '남대표', 'owner', 'active', 't_agr2') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (id, user_id, client, expires_at) values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, 'web', now() + interval '1 day')`;
  other = new Client('other'); other.cookie = `wos_session=${token}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

let a1;
test('① 권한 · ② 등록·목록·고치기: 기본은 대표·관리자만 · 상태와 남은 날 · 임박한 것부터 · 꼬리표 · 다른 회사 404', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/agreements')).status, 404, '직원은 기본 권한 없음 — 없는 메뉴처럼');
  assert.equal((await ctx.staffA.client.req('POST', '/api/agreements', { title: 'x' })).status, 404);
  assert.deepEqual((await ctx.owner.ok('GET', '/api/agreements')).agreements, []);
  assert.equal((await ctx.owner.req('POST', '/api/agreements', { title: '  ' })).status, 400);
  assert.equal((await ctx.owner.req('POST', '/api/agreements', { title: '거꾸로', startDate: day(10), endDate: day(1) })).status, 400, '만료일이 시작일보다 앞');
  a1 = (await ctx.owner.ok('POST', '/api/agreements', { title: '사무실 임대차', counterparty: '한빛빌딩', amount: 3300000, tags: ['임대차', '임대차', ' 본사 '], startDate: day(-340), endDate: day(25), memo: '보증금 별도' })).id;
  const far = (await ctx.owner.ok('POST', '/api/agreements', { title: '정수기 렌탈', counterparty: '맑은물', endDate: day(200), tags: ['렌탈'], ownerId: ctx.managerA.id })).id;
  const open = (await ctx.owner.ok('POST', '/api/agreements', { title: '기한 없는 협약', tags: ['협약'] })).id;
  const past = (await ctx.owner.ok('POST', '/api/agreements', { title: '지난 유지보수', endDate: day(-3) })).id;
  const l = await ctx.owner.ok('GET', '/api/agreements');
  assert.deepEqual(l.agreements.map((x) => [x.title, x.state, x.daysLeft]), [['지난 유지보수', 'expired', -3], ['사무실 임대차', 'soon', 25], ['정수기 렌탈', 'active', 200], ['기한 없는 협약', 'open_ended', null]]);
  assert.deepEqual(l.counts, { total: 4, in30: 1, in90: 1, attention: 1, ended: 0 });
  assert.deepEqual(l.tags, ['렌탈', '본사', '임대차', '협약']);
  assert.deepEqual(l.alertDays, [90, 60, 30, 7]);
  const g = await ctx.owner.ok('GET', `/api/agreements/${a1}`);
  assert.deepEqual([g.agreement.amount, g.agreement.tags, g.agreement.ownerName, g.agreement.termNo, g.agreement.stateLabel], [3300000, ['임대차', '본사'], '김대표', 1, '만료 임박']);
  assert.deepEqual(g.notifyUsers.map((x) => x.name), ['김대표'], '알림 받는 사람 기본 = 담당자 + 등록한 사람(같은 사람이면 한 명)');
  const g2 = await ctx.owner.ok('GET', `/api/agreements/${far}`);
  assert.deepEqual(g2.notifyUsers.map((x) => x.name).sort(), ['김대표', '최매니저'], '담당자 + 등록한 사람');
  // 거르기
  assert.deepEqual((await ctx.owner.ok('GET', `/api/agreements?tag=${encodeURIComponent('렌탈')}`)).agreements.map((x) => x.title), ['정수기 렌탈']);
  assert.deepEqual((await ctx.owner.ok('GET', `/api/agreements?q=${encodeURIComponent('한빛')}`)).agreements.map((x) => x.title), ['사무실 임대차']);
  assert.deepEqual((await ctx.owner.ok('GET', '/api/agreements?state=soon')).agreements.map((x) => x.title), ['사무실 임대차']);
  // 고치기: 담당자를 바꾸면 새 담당자가 알림 받는 사람에 들어감
  await ctx.owner.ok('PATCH', `/api/agreements/${a1}`, { ownerId: ctx.managerA.id, memo: null });
  const g3 = await ctx.owner.ok('GET', `/api/agreements/${a1}`);
  assert.deepEqual([g3.agreement.ownerName, g3.agreement.memo, g3.notifyUsers.map((x) => x.name).sort()], ['최매니저', null, ['김대표', '최매니저']]);
  assert.equal((await ctx.owner.req('PATCH', `/api/agreements/${a1}`, { ownerId: other.cookie ? (await sql`select id from users where email = 'boss@other-agr.test'`)[0].id : null })).status, 400, '다른 회사 사람은 담당자로 못 넣음');
  // 다른 회사: 목록은 자기 것만 · 남의 계약은 404
  assert.deepEqual((await other.ok('GET', '/api/agreements')).agreements, []);
  for (const [m, p, b] of [['GET', `/api/agreements/${a1}`], ['PATCH', `/api/agreements/${a1}`, { title: '탈취' }], ['POST', `/api/agreements/${a1}/renew`, { endDate: day(400) }], ['POST', `/api/agreements/${a1}/end`, { reason: 'x' }], ['POST', `/api/agreements/${a1}/files`, { fileName: 'a.pdf', size: 10 }]])
    assert.equal((await other.req(m, p, b)).status, 404, `${m} ${p}`);
  // 권한을 켜 주면 직원도 조회(편집은 안 됨)
  await sql`insert into menu_user_perms (menu, user_id, level) values ('agreements', ${ctx.staffA.id}, 'view')`;
  assert.equal((await ctx.staffA.client.ok('GET', '/api/agreements')).agreements.length, 4);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/agreements/${a1}`, { title: '바꿈' })).status, 403);
  void open; void past;
});

test('③ 만료 알림: 가장 가까운 단계 하나만 · 같은 단계는 한 번 · 자동 연장 + 통보 기한 = 통보 마감일 기준 · 지나면 한 번 · 갱신 검토 업무', async () => {
  // 자동 연장 + 해지 통보 30일 전: 만료 50일 뒤 → 기준일 20일 뒤 → '해지 통보 기한 30일 전' 단계
  const auto = (await ctx.owner.ok('POST', '/api/agreements', { title: '보안 용역', counterparty: '든든보안', endDate: day(50), autoRenew: true, noticeDays: 30, ownerId: ctx.staffB.id, notifyUserIds: [ctx.staffB.id] })).id;
  const d = await tick();
  assert.ok(d.detail?.agreements ?? d.agreements ?? true);
  // a1(25일 뒤 만료): 90·60·30 단계를 한꺼번에 보내지 않고 가장 가까운 30일 전 하나만 — 받는 사람 = 대표 + 최매니저(담당)
  const own = await notes(ctx.ownerId);
  assert.deepEqual(own.map((n) => n.title).sort(), ['계약 만료 30일 전: 사무실 임대차', '계약이 만료됐습니다: 지난 유지보수'].sort());
  assert.match(own.find((n) => /임대차/.test(n.title)).body, /한빛빌딩 · \d+월 \d+일 만료 — 갱신·종료를 정해 주세요/);
  assert.equal(own.find((n) => /임대차/.test(n.title)).link, `/agreements?open=${a1}`);
  assert.deepEqual((await notes(ctx.managerA.id)).map((n) => n.title), ['계약 만료 30일 전: 사무실 임대차'], '200일 남은 정수기 렌탈은 아직 알림 없음');
  // 자동 연장 계약: 통보 마감일 기준 문구, 지정한 사람(박직원)에게만
  const sb = await notes(ctx.staffB.id);
  assert.deepEqual(sb.map((n) => n.title), ['해지 통보 기한 30일 전: 보안 용역']);
  assert.match(sb[0].body, /든든보안 · \d+월 \d+일까지 통보하지 않으면 자동 연장됩니다\(만료일 \d+월 \d+일\)/);
  // 갱신 검토 업무: 담당자에게 1건씩(만료가 지난 계약은 만들지 않음)
  const tasks = await sql`select t.title, t.assignee_id, t.tags from tasks t where t.title like '[계약 갱신 검토]%' order by t.title`;
  assert.deepEqual(tasks.map((t) => [t.title, t.assignee_id]), [['[계약 갱신 검토] 보안 용역', ctx.staffB.id], ['[계약 갱신 검토] 사무실 임대차', ctx.managerA.id]]);
  assert.deepEqual(tasks[0].tags, ['계약 관리']);
  // 같은 단계는 다시 보내지 않음
  await tick();
  assert.equal((await notes(ctx.ownerId)).length, 2); assert.equal((await notes(ctx.staffB.id)).length, 1);
  assert.equal((await sql`select count(*)::int c from tasks where title like '[계약 갱신 검토]%'`)[0].c, 2);
  // 날이 지나 7일 전 단계에 닿으면 한 번 더(30일 전은 이미 보냄) — 만료일을 5일 뒤로 당겨 흉내
  await ctx.owner.ok('PATCH', `/api/agreements/${a1}`, { endDate: day(5) });
  await tick();
  assert.deepEqual((await notes(ctx.managerA.id)).map((n) => n.title), ['계약 만료 30일 전: 사무실 임대차', '계약 만료 7일 전: 사무실 임대차']);
  // 통보 기한이 지남(자동 연장): 한 번 알림 '해지 통보 기한이 지났습니다' — 목록 상태도
  await ctx.owner.ok('PATCH', `/api/agreements/${auto}`, { endDate: day(20) });
  await tick(); await tick();
  assert.deepEqual((await notes(ctx.staffB.id)).map((n) => n.title), ['해지 통보 기한 30일 전: 보안 용역', '해지 통보 기한이 지났습니다: 보안 용역']);
  const row = (await ctx.owner.ok('GET', '/api/agreements')).agreements.find((x) => x.id === auto);
  assert.deepEqual([row.state, row.stateLabel, row.basisKind], ['notice_passed', '통보 기한 지남', 'notice']);
  // 알림 받는 사람은 권한이 없어도 알림은 받지만(계약명·만료일), 계약·파일은 못 엶
  assert.equal((await ctx.staffB.client.req('GET', `/api/agreements/${auto}`)).status, 404);
});

test('④ 갱신 등록(기간 이력·알림 다시) · 종료 ⑤ 계약서 파일 ⑥ 회사 기본 알림 날짜 · 엑셀', async () => {
  // 갱신: 지난 기간이 이력으로, 새 만료일로 이어 감
  assert.equal((await ctx.owner.req('POST', `/api/agreements/${a1}/renew`, { endDate: day(1) })).status, 400, '새 만료일은 지금 만료일보다 뒤');
  const r = await ctx.owner.ok('POST', `/api/agreements/${a1}/renew`, { endDate: day(370), amount: 3500000, memo: '월 20만 인상' });
  assert.equal(r.termNo, 2);
  const g = await ctx.owner.ok('GET', `/api/agreements/${a1}`);
  assert.deepEqual([g.agreement.termNo, g.agreement.endDate, g.agreement.amount, g.agreement.state, g.agreement.startDate], [2, day(370), 3500000, 'active', day(6)]);
  assert.deepEqual(g.terms.map((t) => [t.term_no, t.end_date, Number(t.amount), t.memo, t.by_name]), [[1, day(5), 3300000, '월 20만 인상', '김대표']]);
  // 종료
  assert.equal((await ctx.owner.req('POST', `/api/agreements/${a1}/end`, { reason: ' ' })).status, 400);
  const past = (await ctx.owner.ok('GET', '/api/agreements')).agreements.find((x) => x.title === '지난 유지보수');
  await ctx.owner.ok('POST', `/api/agreements/${past.id}/end`, { reason: '업체 변경' });
  const l = await ctx.owner.ok('GET', '/api/agreements');
  assert.equal(l.agreements.at(-1).title, '지난 유지보수'); assert.deepEqual([l.agreements.at(-1).state, l.counts.ended, l.counts.attention], ['ended', 1, 1]);
  assert.deepEqual((await ctx.owner.ok('GET', '/api/agreements?state=open')).agreements.some((x) => x.state === 'ended'), false);
  await tick();
  assert.equal((await notes(ctx.ownerId)).filter((n) => /지난 유지보수/.test(n.title)).length, 1, '종료한 계약은 알림 멈춤');
  // ⑤ 파일: 올리기 시작 → 저장소로 보내기 → 마무리 → 열기(권한 + 감사 기록)
  const init = await ctx.owner.ok('POST', `/api/agreements/${a1}/files`, { fileName: '임대차 계약서.pdf', mimeType: 'application/pdf', size: 4 });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from('%PDF') });
  assert.equal((await ctx.owner.ok('POST', `/api/agreements/files/${init.id}`, {})).sizeBytes, 4);
  const g2 = await ctx.owner.ok('GET', `/api/agreements/${a1}`);
  assert.deepEqual(g2.files.map((f) => [f.file_name, f.term_no, f.size_bytes]), [['임대차 계약서.pdf', 2, 4]]);
  assert.equal(g2.agreement.files, 1);
  const u = await ctx.owner.ok('GET', `/api/agreements/files/${init.id}?inline=1`);
  const dl = await fetch(BASE + u.url); assert.equal(dl.status, 200); assert.equal(await dl.text(), '%PDF');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/agreements/files/${init.id}`)).url.includes('/api/files/local'), true, '조회 권한이 있으면 열 수 있음');
  assert.equal((await ctx.staffB.client.req('GET', `/api/agreements/files/${init.id}`)).status, 404, '권한 없는 사람');
  assert.equal((await other.req('GET', `/api/agreements/files/${init.id}`)).status, 404, '다른 회사');
  assert.equal((await ctx.staffA.client.req('DELETE', `/api/agreements/files/${init.id}`)).status, 403, '조회만으로는 못 지움');
  const opens = await sql`select actor_id from audit_logs where action = 'agreement.file_open' and target_id = ${a1}`;
  assert.equal(opens.length, 2, '열람은 감사 기록에');
  // 저장공간 사용량에 포함
  const [{ bytes }] = await sql`select coalesce(sum(size_bytes), 0)::int bytes from agreement_files where tenant = 'default' and upload_status = 'ready'`;
  assert.equal(bytes, 4);
  await ctx.owner.ok('DELETE', `/api/agreements/files/${init.id}`);
  assert.equal((await ctx.owner.ok('GET', `/api/agreements/${a1}`)).files.length, 0);
  // ⑥ 회사 기본 알림 날짜
  assert.deepEqual((await ctx.owner.ok('GET', '/api/agreements/settings')).alertDays, [90, 60, 30, 7]);
  assert.deepEqual((await ctx.owner.ok('PUT', '/api/agreements/settings', { alertDays: [14, 60, 60] })).alertDays, [60, 14]);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/agreements/settings', { alertDays: [30] })).status, 403);
  assert.equal((await ctx.owner.ok('GET', '/api/agreements')).alertDays.join(), '60,14');
  assert.deepEqual((await ctx.owner.ok('PUT', '/api/agreements/settings', { alertDays: null })).alertDays, [90, 60, 30, 7]);
  // 엑셀
  const x = await fetch(`${BASE}/api/agreements/export`, { headers: { cookie: ctx.owner.cookie } });
  assert.equal(x.status, 200); assert.match(x.headers.get('content-type') ?? '', /spreadsheetml/);
  assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  assert.equal((await fetch(`${BASE}/api/agreements/export`, { headers: { cookie: ctx.staffB.client.cookie } })).status, 404);
});
