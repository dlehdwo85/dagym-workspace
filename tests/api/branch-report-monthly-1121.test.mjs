// #1096 2단계 — 월간 업무 보고서(양식 B) + 시설별 이용 현황(양식 C) + 미완료 추적 + PDF·엑셀 내려받기 (가짜 Anthropic 서버 — 구조 시험)
// 입력 = 그 달 제출된 주간보고만(초안·다른 달 제외) · C 와 미완료는 프로그램이 주간보고에서 그대로 계산(AI 가 못 바꿈) · B 세 칸만 AI(없는 W번호 지움·자료에 없는 숫자/근거 없음 → check)
// · 권한(다른 지점 작성 담당·다른 회사 404) · 제출·제출 취소 · 30일 정리 작업은 월간을 건드리지 않음
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb, FAKE, ensureTls, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, sql, ctx, other, siteA, siteB, reportId;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const W = (usage, facilities, issues) => ({ usage, lockers: [], facilities, issues, notes: '', sources: { w: [] } });
const weekly = (site, day, body, status = 'submitted') => sql`insert into branch_reports (tenant, site_id, kind, period_start, period_end, report_day, status, body, submitted_at)
  values ('default', ${site}, 'weekly', ${day}::date - 7, ${day}::date - 1, ${day}, ${status}, ${sql.json(body)}, ${status === 'submitted' ? sql`now()` : null}) returning id`;

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_APPROVAL: '0', SIGNUP_IP_PER_DAY: '50' });
  sql = testDb(); ctx = await bootstrap();
  const c = new Client('other@brm.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'other@brm.test', password: 'signup-pass-1234', name: '다른대표', mode: 'team', company: '다른상사2', size: '2-10', industry: '제조', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  other = c;
  const s = await ctx.owner.ok('PUT', '/api/branch-reports/setup', { sites: [{ name: '월간 강남점', writerUserId: ctx.staffA.id }, { name: '월간 판교점', writerUserId: ctx.staffB.id }] });
  [siteA, siteB] = s.sites.map((x) => x.id);
  // 9월 마지막 주(전달) · 10월 3주(제출) + 10월 초안 1주(빠져야) · 11월 1주(다른 달)
  await weekly(siteA, '2026-09-25', W([{ item: '헬스', count: '400' }, { item: '골프', count: '50명' }], [], []));
  await weekly(siteA, '2026-10-02', W([{ item: '헬스', count: '410' }, { item: '골프', count: '45' }],
    [{ name: '골프장', visitors: '45', cleaning: '청결', condition: '양호', lines: [{ item: '타석 3번 센서', status: '고장', action: '업체 수리 요청', state: '진행 중', evidence: [] }] }],
    [{ title: '사우나 온도 민원', details: ['10/1 접수'], state: '진행 중', evidence: [] }, { title: '주차 스티커 문의', details: [], state: '확인 필요', evidence: [] }]));
  await weekly(siteA, '2026-10-09', W([{ item: '헬스', count: '420' }, { item: '골프', count: '46' }],
    [{ name: '골프장', visitors: '46', cleaning: '청결', condition: '양호', lines: [{ item: '타석 3번 센서', status: '수리 중', action: '부품 대기', state: '진행 중', evidence: [] }] }],
    [{ title: '사우나 온도 민원', details: ['설비 업체 점검 10/8'], state: '진행 중', evidence: [] }]));
  await weekly(siteA, '2026-10-16', W([{ item: '헬스', count: '443' }, { item: '골프', count: '47' }, { item: '독서실', count: '38' }],
    [{ name: '골프장', visitors: '47', cleaning: '청결', condition: '양호', lines: [{ item: '타석 3번 센서', status: '교체', action: '', state: '완료', evidence: [] }] }],
    [{ title: '사우나 온도 민원', details: ['온도 조절기 교체 10/15'], state: '완료', evidence: [] }]));
  await weekly(siteA, '2026-10-23', W([{ item: '헬스', count: '999' }], [], [{ title: '초안 민원', details: [], state: '진행 중', evidence: [] }]), 'draft');
  await weekly(siteA, '2026-11-06', W([{ item: '헬스', count: '777' }], [], []));
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('#1096 2단계 월간 보고서', () => {
  test('막힘: 잘못된 달·주간 제출이 없는 달 400 · 다른 지점 작성 담당·다른 회사 404', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-13' })).status, 400);
    assert.equal((await ctx.staffA.client.req('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-08' })).status, 400, '제출된 주간보고 없음');
    assert.equal((await ctx.staffB.client.req('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-10' })).status, 404);
    assert.equal((await other.req('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-10' })).status, 404);
  });

  test('월간 초안: 그 달 제출된 주간만 · C(이번달 = 마지막 주, 전달 = 지난달 마지막 주) · 미완료·완료로 바뀐 것은 프로그램 계산 · B 는 AI(검사)', async () => {
    const ai = {
      important: [{ work: '사우나 온도 민원 처리', result: '온도 조절기 교체로 완료(10/15)', evidence: ['W1', 'W3', 'W9'] }, { work: '회원 500명 돌파', result: '헬스 회원 증가', evidence: ['W3'] }],
      progress: [{ week: '1주차(10/2)', task: '민원 접수', focus: '사우나 온도', result: '업체 연락', note: '', evidence: ['W1'] }, { week: '2주차(10/9)', task: '설비 점검', focus: '', result: '부품 대기', note: '', evidence: [] }],
      next: [{ goal: '주차 스티커 문의 정리', actions: '관리사무소와 기준 확인' }], notes: '',
    };
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify(ai) }], stop_reason: 'end_turn' }] });
    const n0 = (await fakeState()).anthropic.length;
    const r = await ctx.staffA.client.ok('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-10' });
    reportId = r.report.id;
    assert.equal(r.weeks, 3, '10월 제출된 주간 3건(초안·11월 제외)');
    assert.equal(r.report.kind, 'monthly'); assert.equal(r.report.period_start, '2026-10-01'); assert.equal(r.report.period_end, '2026-10-31');
    const sent = (await fakeState()).anthropic.slice(n0)[0].body;
    const text = sent.messages[0].content;
    assert.match(text, /W1 1주차\(10\/2\) 주간보고/); assert.match(text, /W3 3주차\(10\/16\)/);
    assert.ok(!/초안 민원|777|999/.test(text), '초안·다른 달 주간보고는 보내지 않음');
    assert.ok(sent.output_config.format.schema.required.includes('progress'));
    const b = r.report.body;
    assert.deepEqual(b.usage, [{ item: '헬스', prev: '400', cur: '443' }, { item: '골프', prev: '50명', cur: '47' }, { item: '독서실', prev: '', cur: '38' }], 'C: 마지막 주 기준');
    assert.deepEqual(b.unfinished, [{ title: '주차 스티커 문의', since: '10/2', lastWeek: '10/2', state: '확인 필요' }], '마지막 상태가 완료가 아닌 것');
    assert.deepEqual(b.resolved.map((x) => [x.title, x.doneWeek]).sort(), [['골프장 · 타석 3번 센서', '10/16'], ['사우나 온도 민원', '10/16']]);
    assert.deepEqual(b.important[0].evidence, ['W1', 'W3'], '없는 W번호는 지움'); assert.equal(b.important[0].check, false);
    assert.equal(b.important[1].check, true, "자료에 없는 숫자('500명')는 확인 필요 표시");
    assert.equal(b.progress[1].check, true, '근거 없는 줄은 확인 필요 표시');
    assert.deepEqual(b.sources.w.map((x) => x.day), ['2026-10-02', '2026-10-09', '2026-10-16']);
    const ev = await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}/evidence?refs=W1,W3`);
    assert.deepEqual(ev.items.map((x) => x.text), ['10/2(금) 주간보고', '10/16(금) 주간보고']);
    const h = await ctx.staffA.client.ok('GET', `/api/branch-reports?site=${siteA}`);
    assert.deepEqual(h.monthly.map((x) => [x.month, x.status]), [['2026-10', 'draft']]);
  });

  test('고치기(월간 양식으로 저장) · 제출 잠김 · 엑셀·인쇄 · 다른 지점 404 · 제출 취소', async () => {
    const cur = (await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report.body;
    const edited = { ...cur, usage: cur.usage.map((x) => (x.item === '골프' ? { ...x, prev: '50' } : x)), important: cur.important.slice(0, 1), notes: '담당 확인' };
    const s = await ctx.staffA.client.ok('PUT', `/api/branch-reports/${reportId}`, edited);
    assert.equal(s.report.body.usage[1].prev, '50'); assert.equal(s.report.body.important.length, 1); assert.equal(s.report.body.unfinished.length, 1, '미완료 그대로');
    assert.equal((await ctx.staffB.client.req('GET', `/api/branch-reports/${reportId}`)).status, 404);
    const x = await fetch(`${BASE}/api/branch-reports/${reportId}/xlsx`, { headers: { cookie: ctx.staffA.client.cookie } });
    assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/);
    const buf = Buffer.from(await x.arrayBuffer()); assert.equal(buf.subarray(0, 2).toString(), 'PK', '엑셀(zip) 파일');
    assert.match(decodeURIComponent(x.headers.get('content-disposition')), /월간 강남점_월간보고_2026-10\.xlsx/);
    const p = await ctx.staffA.client.req('GET', `/branch-print/${reportId}`);
    assert.equal(p.status, 200); assert.match(p.body, /월간 업무 보고서/); assert.match(p.body, /시설별 이용 현황/); assert.match(p.body, /주식회사 다짐 운영팀/);
    assert.equal((await ctx.staffB.client.req('GET', `/api/branch-reports/${reportId}/xlsx`)).status, 404);
    await ctx.staffA.client.ok('POST', `/api/branch-reports/${reportId}/submit`, {});
    assert.equal((await ctx.staffA.client.req('PUT', `/api/branch-reports/${reportId}`, edited)).status, 409);
    assert.equal((await ctx.staffA.client.req('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-10' })).status, 409, '제출한 달은 다시 만들기 막힘');
    // 30일 정리 작업은 월간을 '근거 지움'으로 바꾸지 않음(월간은 붙여 넣은 글이 없음)
    await sql`update branch_reports set submitted_at = now() - interval '31 days' where id = ${reportId}`;
    await tick();
    const [row] = await sql`select purged_at from branch_reports where id = ${reportId}`; assert.equal(row.purged_at, null);
    const un = await ctx.owner.ok('DELETE', `/api/branch-reports/${reportId}/submit`); assert.equal(un.report.status, 'draft');
    const acts = (await sql`select action from audit_logs where action = 'branch_report.monthly_draft'`).length; assert.equal(acts, 1);
  });

  test('주간보고 엑셀 내려받기', async () => {
    const [w] = await sql`select id from branch_reports where site_id = ${siteA} and report_day = '2026-10-16'`;
    const x = await ctx.staffA.client.req('GET', `/api/branch-reports/${w.id}/xlsx`);
    assert.equal(x.status, 200);
  });
});
