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
    assert.deepEqual(b.usage, [], '#1106: C 는 하이링크 이용현황 파일에서 — 주간 글로 채우지 않음'); assert.equal(b.usageFile, null);
    assert.deepEqual(b.usageWeekly, [{ item: '헬스', prev: '400', cur: '443' }, { item: '골프', prev: '50명', cur: '47' }, { item: '독서실', prev: '', cur: '38' }], '주간 값(월말)은 제안으로만');
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
    const edited = { ...cur, usage: cur.usageWeekly.map((x) => ({ ...x, prev: x.item === '골프' ? '50' : x.prev })), important: cur.important.slice(0, 1), notes: '담당 확인', usageFile: { name: '위조.pdf', size: 1, parsed: true, rows: 9, at: '' } };
    const s = await ctx.staffA.client.ok('PUT', `/api/branch-reports/${reportId}`, edited);
    assert.equal(s.report.body.usage[1].prev, '50'); assert.equal(s.report.body.important.length, 1); assert.equal(s.report.body.unfinished.length, 1, '미완료 그대로');
    assert.equal(s.report.body.usageFile, null, '첨부 표시는 화면에서 바꿀 수 없음');
    assert.equal((await ctx.staffB.client.req('GET', `/api/branch-reports/${reportId}`)).status, 404);
    const x = await fetch(`${BASE}/api/branch-reports/${reportId}/xlsx`, { headers: { cookie: ctx.staffA.client.cookie } });
    assert.equal(x.status, 200); assert.match(x.headers.get('content-type'), /spreadsheetml/);
    const buf = Buffer.from(await x.arrayBuffer()); assert.equal(buf.subarray(0, 2).toString(), 'PK', '엑셀(zip) 파일');
    assert.match(decodeURIComponent(x.headers.get('content-disposition')), /초안_월간 강남점_월간보고_2026-10\.xlsx/);
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

  test('#1106 하이링크 이용현황 올리기: 못 읽는 파일은 첨부만 · CSV·엑셀·PDF 표 읽기(원문 그대로·합계 줄) · 내려받기 · 다시 만들어도 유지 · 빼기 · 권한', async () => {
    const up = (c, name, buf) => c.req('POST', `/api/branch-reports/${reportId}/usage-file`, { name, b64: Buffer.from(buf).toString('base64') });
    const { PDFDocument, StandardFonts } = await import('pdf-lib');
    const pdf = async (lines) => { const d = await PDFDocument.create(); const pg = d.addPage([595, 842]); const f = await d.embedFont(StandardFonts.Helvetica); lines.forEach((t, k) => pg.drawText(t, { x: 40, y: 780 - k * 24, size: 12, font: f })); return Buffer.from(await d.save()); };
    // 표가 없는 PDF → 첨부만(값은 그대로 빈칸 아님 — 앞에서 손으로 넣은 값 유지)
    const r0 = await (await up(ctx.staffA.client, 'scan.pdf', await pdf(['Monthly usage report', 'see attached']))).body;
    assert.equal(r0.parsed, 0); assert.equal(r0.report.body.usageFile.parsed, false); assert.equal(r0.report.body.usageFile.name, 'scan.pdf');
    assert.equal(r0.report.body.usage.length, 3, '못 읽으면 표 값은 건드리지 않음');
    const p0 = await ctx.staffA.client.req('GET', `/branch-print/${reportId}`); assert.match(p0.body, /원본 첨부/);
    // CSV(하이링크 표 모양) → 원문 그대로
    const csv = '시설,전달 인원,이번달 인원,증감,증감률\n헬스장,"1,234명","1,240명",+6명,▲ 0.4%\n골프장,269명,174명,-95명,▼ 35.3%\n카페&키즈룸,50명,50명,0명,0%\n전시설 총 이용현황,"1,553명","1,464명",-89명,▼ 5.7%\n';
    const r1 = (await up(ctx.staffA.client, '11월 시설별_이용현황.csv', csv)).body;
    assert.equal(r1.parsed, 3); assert.equal(r1.total, true);
    assert.deepEqual(r1.report.body.usage, [{ item: '헬스장', prev: '1,234명', cur: '1,240명', diff: '+6명', rate: '▲0.4%' }, { item: '골프장', prev: '269명', cur: '174명', diff: '-95명', rate: '▼35.3%' }, { item: '카페&키즈룸', prev: '50명', cur: '50명', diff: '0명', rate: '0%' }]);
    assert.equal(r1.report.body.usageTotal.cur, '1,464명');
    const dl = await fetch(`${BASE}/api/branch-reports/${reportId}/usage-file`, { headers: { cookie: ctx.staffA.client.cookie } });
    assert.equal(dl.status, 200); assert.equal(Buffer.from(await dl.arrayBuffer()).toString('utf8'), csv, '원본 그대로 내려받기');
    const p1 = await ctx.staffA.client.req('GET', `/branch-print/${reportId}`);
    assert.match(p1.body, /▼35\.3%/); assert.match(p1.body, /전시설 총 이용현황/); assert.match(p1.body, /출처: 하이링크 이용현황/);
    // 엑셀(xlsx) → 같은 결과
    const { writeXlsx } = await import('../../src/lib/xlsx.ts');
    const x = writeXlsx([{ name: 'S', rows: [['시설', '전달 인원', '이번달 인원', '증감', '증감률'], ['독서실', '38명', '40명', '+2명', '▲ 5.3%'], ['합계', '38명', '40명', '+2명', '▲ 5.3%']] }]);
    const r2 = (await up(ctx.staffA.client, 'usage.xlsx', x)).body;
    assert.deepEqual(r2.report.body.usage, [{ item: '독서실', prev: '38명', cur: '40명', diff: '+2명', rate: '▲5.3%' }]); assert.equal(r2.report.body.usageTotal.item, '합계');
    // PDF(글자 PDF) → 표 읽기
    const r3 = (await up(ctx.staffA.client, 'hilink.pdf', await pdf(['Gym 1,234 1,240 +6 0.4%', 'Golf 269 174 -95 35.3%']))).body;
    assert.deepEqual(r3.report.body.usage.map((u) => [u.item, u.prev, u.cur, u.diff, u.rate]), [['Gym', '1,234', '1,240', '+6', '0.4%'], ['Golf', '269', '174', '-95', '35.3%']]);
    // 다시 만들기(AI) 해도 올린 하이링크 값·첨부는 그대로
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ important: [], progress: [], next: [], notes: '' }) }], stop_reason: 'end_turn' }] });
    const re = await ctx.staffA.client.ok('POST', '/api/branch-reports/monthly', { siteId: siteA, month: '2026-10' });
    assert.equal(re.report.body.usageFile.name, 'hilink.pdf'); assert.equal(re.report.body.usage[0].item, 'Gym');
    // 막힘: 다른 지점 작성 담당 404 · 다른 회사 404 · 모르는 형식 400 · 주간보고에는 못 올림 400
    assert.equal((await up(ctx.staffB.client, 'a.csv', csv)).status, 404);
    assert.equal((await up(other, 'a.csv', csv)).status, 404);
    assert.equal((await up(ctx.staffA.client, 'a.hwp', 'x')).status, 400);
    const [wk] = await sql`select id from branch_reports where site_id = ${siteA} and report_day = '2026-10-16'`;
    assert.equal((await ctx.staffA.client.req('POST', `/api/branch-reports/${wk.id}/usage-file`, { name: 'a.csv', b64: Buffer.from(csv).toString('base64') })).status, 400);
    // 빼기 → 첨부 없음(값은 그대로) · 내려받기 404
    const rm = await ctx.staffA.client.ok('DELETE', `/api/branch-reports/${reportId}/usage-file`);
    assert.equal(rm.report.body.usageFile, null); assert.equal(rm.report.body.usage.length, 2);
    assert.equal((await ctx.staffA.client.req('GET', `/api/branch-reports/${reportId}/usage-file`)).status, 404);
    const acts = (await sql`select count(*)::int as n from audit_logs where action = 'branch_report.usage_file'`)[0].n; assert.equal(acts, 4);
  });

  test('#1112·#1115 하이링크 회원목록 엑셀 → 이용권·수강권 현황: \'전체\' 시트만 · 이름·연락처는 어디에도 남지 않음 · 분류(회사 기억)·바꾸기 · 전달 대비 · 제외 켜기/끄기 · 제출하면 분류 굳음 · 막힘', async () => {
    const { writeXlsx } = await import('../../src/lib/xlsx.ts');
    const ml = await import('../../src/lib/branchReport/memberList.ts');
    const H = ['순번', '동', '호수', '이름', '연락처', '이용권명', '금액', '시작일', '종료일', '이용권 상태', '락커', '자리번호', '부과월'];
    const rows = [
      ['1', '401', '1203', '가나다회원', '010-9999-1111', '헬스권', '50000', '2026-10-03', '', '활성', 'X', '', '매월'],
      ['2', '401', '1203', '라마바회원', '010-9999-2222', '(여) 헬스+골프+수영', '120000', '2026-09-01', '', '활성', 'O', '12', '매월'],
      ['3', '402', '101', '사아자회원', '010-9999-3333', '남자 독서실', '30000', '2026-10-10', '', '활성', 'X', '', '매월'],
      ['4', '402', '101', '하하하회원', '010-9999-6666', '오전 수영강습A (월수금 9시)', '60000', '2026-10-05', '', '활성', 'X', '', '매월'],
      ['5', '999', '1', '직원회원', '010-9999-4444', '헬스권', '0', '2026-10-01', '', '활성', 'X', '', '매월'],
      ['6', '403', '7', '차카타회원', '010-9999-5555', '테스트', '0', '', '', '활성', 'X', '', '매월'],
    ];
    // 동별 시트는 같은 내용(중복) — '전체' 만 읽어야 2배로 세지 않음
    const x = writeXlsx([{ name: '전체', rows: [H, ...rows] }, { name: '401동', rows: [H, rows[0], rows[1]] }]);
    // 지난달(9월) 집계를 먼저 넣어 둠: 헬스권 5 · 수영강습 1 → 이번 달 헬스권 1(80% 감소 → 빨강)
    const pr = [1, 2, 3, 4, 5].map((k) => ['', '401', String(k), '', '', '헬스권', '50000', '', '', '활성']).concat([['', '402', '101', '', '', '오전 수영강습A (월수금 9시)', '60000', '', '', '활성']]);
    const pv = ml.aggregateMembers(H.slice(0, 10), pr, '2026-09');
    await sql`insert into branch_member_stats (site_id, month, tenant, stats, stats_all, excluded) values (${siteA}, '2026-09', 'default', ${sql.json(pv.stats)}, ${sql.json(pv.statsAll)}, 0)`;
    const up = (c, name, buf) => c.req('POST', `/api/branch-reports/${reportId}/member-file`, { name, b64: Buffer.from(buf).toString('base64') });
    const r = (await up(ctx.staffA.client, '회원목록_2026-10-31.xlsx', x)).body;
    assert.equal(r.active, 4, '활성 4(직원 999동·테스트 제외)'); assert.equal(r.excluded, 2); assert.equal(r.prev, true);
    const mb = r.report.body.members;
    assert.equal(mb.v, 2); assert.equal(mb.month, '2026-10'); assert.equal(mb.exclude, true); assert.equal(mb.prev.month, '2026-09');
    const swim = ml.nameKey('오전 수영강습A (월수금 9시)');
    assert.equal(mb.kinds[swim], 'class'); assert.equal(mb.kinds[ml.nameKey('헬스권')], 'use'); assert.equal(mb.kinds[ml.nameKey('남자 독서실')], 'use');
    assert.equal(mb.unconfirmed.length, 5, '처음 보는 이름 5개(헬스권·통합·독서실·수영강습 + 제외 줄의 테스트) — 분류 확인 표시');
    const use = ml.viewOf(mb.stats, mb.kinds, 'use'), cls = ml.viewOf(mb.stats, mb.kinds, 'class'), all = ml.viewOf(mb.stats, mb.kinds, 'all');
    assert.deepEqual([use.active, use.households, use.billing], [3, 2, 200000]); assert.deepEqual([cls.active, cls.households, cls.billing], [1, 1, 60000]);
    assert.deepEqual([all.active, all.households, all.billing], [4, 2, 260000]);
    // 이름·연락처는 보고서·집계 표·분류 목록·감사 기록 어디에도 없음
    const blob = JSON.stringify(r.report.body) + JSON.stringify(await sql`select * from branch_member_stats`) + JSON.stringify(await sql`select * from branch_pass_kinds`) + JSON.stringify(await sql`select detail from audit_logs where action like 'branch_report.member%' or action = 'branch_report.pass_kind'`);
    assert.ok(!/회원"|가나다|라마바|하하하|010-9999|1203/.test(blob), '이름·연락처·호수 저장 안 함');
    const p = await ctx.staffA.client.req('GET', `/branch-print/${reportId}`);
    assert.match(p.body, /이용권 현황/); assert.match(p.body, /수강권 현황/); assert.match(p.body, /전체 합계\(이용권 \+ 수강권\)/);
    assert.match(p.body, /30% 넘게 줄어듦/); assert.match(p.body, /시험·직원 줄 2건 제외/); assert.match(p.body, /오전 수영강습A \(월수금 9시\)/);
    // 분류 바꾸기 → 회사 목록에 기억(확인됨) · 이 보고서에 바로 반영
    const k1 = await ctx.staffA.client.ok('PATCH', `/api/branch-reports/${reportId}/member-file`, { pass: { key: swim, kind: 'use' } });
    assert.equal(k1.report.body.members.kinds[swim], 'use'); assert.equal(k1.report.body.members.unconfirmed.includes(swim), false);
    const [pk] = await sql`select kind, confirmed from branch_pass_kinds where tenant = 'default' and name_key = ${swim}`; assert.deepEqual([pk.kind, pk.confirmed], ['use', true]);
    assert.equal(ml.viewOf(k1.report.body.members.stats, k1.report.body.members.kinds, 'class').active, 0);
    // 같은 파일을 다시 올려도 회사 분류(이용권)를 따름
    const again = (await up(ctx.staffA.client, '회원목록_2026-10-31.xlsx', x)).body;
    assert.equal(again.report.body.members.kinds[swim], 'use'); assert.equal(again.report.body.members.unconfirmed.length, 4);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/branch-reports/${reportId}/member-file`, { pass: { key: '없는이름', kind: 'use' } })).status, 400);
    await ctx.staffA.client.ok('PATCH', `/api/branch-reports/${reportId}/member-file`, { pass: { key: swim, kind: 'class' } });
    // 제외 끄기 → 포함 집계로 보임
    const off = await ctx.staffA.client.ok('PATCH', `/api/branch-reports/${reportId}/member-file`, { exclude: false });
    assert.equal(off.report.body.members.exclude, false);
    assert.match((await ctx.staffA.client.req('GET', `/branch-print/${reportId}`)).body, /시험·직원 줄 제외 안 함/);
    await ctx.staffA.client.ok('PATCH', `/api/branch-reports/${reportId}/member-file`, { exclude: true });
    const xl = await ctx.staffA.client.req('GET', `/api/branch-reports/${reportId}/xlsx`); assert.equal(xl.status, 200);
    // 화면 저장으로 집계·분류를 바꿀 수 없음
    const cur = (await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report.body;
    const forged = await ctx.staffA.client.ok('PUT', `/api/branch-reports/${reportId}`, { ...cur, members: { ...cur.members, kinds: { [swim]: 'use' }, statsAll: {} } });
    assert.equal(forged.report.body.members.kinds[swim], 'class'); assert.equal(forged.report.body.members.statsAll.v, 2);
    // 제출하면 그때 분류로 굳음(회사 분류가 바뀌어도 제출본은 그대로)
    await ctx.staffA.client.ok('POST', `/api/branch-reports/${reportId}/submit`, {});
    await sql`update branch_pass_kinds set kind = 'use' where tenant = 'default' and name_key = ${swim}`;
    assert.equal((await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report.body.members.kinds[swim], 'class');
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/branch-reports/${reportId}/member-file`, { pass: { key: swim, kind: 'use' } })).status, 409);
    await ctx.owner.ok('DELETE', `/api/branch-reports/${reportId}/submit`);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report.body.members.kinds[swim], 'use', '초안으로 돌아오면 회사 분류 지금 값');
    // 막힘
    assert.equal((await up(ctx.staffB.client, 'a.xlsx', x)).status, 404);
    assert.equal((await other.req('PATCH', `/api/branch-reports/${reportId}/member-file`, { pass: { key: swim, kind: 'use' } })).status, 404);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/branch-reports/${reportId}/member-file`, {})).status, 400);
    assert.equal((await up(ctx.staffA.client, 'a.csv', 'x')).status, 400);
    assert.equal((await up(ctx.staffA.client, 'b.xlsx', writeXlsx([{ name: '전체', rows: [['순번', '동'], ['1', '401']] }]))).status, 400, '이용권명 머리줄 없음');
    const [wk] = await sql`select id from branch_reports where site_id = ${siteA} and report_day = '2026-10-16'`;
    assert.equal((await ctx.staffA.client.req('POST', `/api/branch-reports/${wk.id}/member-file`, { name: 'a.xlsx', b64: Buffer.from(x).toString('base64') })).status, 400, '주간보고에는 못 올림');
  });

  test('#1116 고객사 보고: 최근 6개월 흐름(올린 파일 숫자만·없는 달 -) · 이번 달 민원·특이사항 모음 · 고객사 제출용 표시·파일 이름 · 화면 저장으로 못 바꿈 · 제출 때 굳힘', async () => {
    const { readXlsx } = await import('../../src/lib/xlsxSheet.ts');
    const agg = (h, s) => ({ v: 2, rows: h + s, names: { '헬스1개월': { name: '헬스 1개월', active: h, billing: h * 50000, newThisMonth: 0, endedThisMonth: 0, byDong: { 401: h } }, '수영강습': { name: '수영 강습', active: s, billing: s * 60000, newThisMonth: 0, endedThisMonth: 0, byDong: { 401: s } } }, hh: { '헬스1개월': h } });
    await sql`insert into branch_member_stats (site_id, month, tenant, stats, stats_all, excluded, file_name) values (${siteA}, '2026-07', 'default', ${sql.json(agg(5, 2))}, ${sql.json(agg(6, 2))}, 1, 'jul.xlsx')`; // 6월 이전은 없음(9·10월은 앞 시험에서 올림)
    const g = (await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report;
    assert.equal(g.status, 'draft');
    const f = g.body.flow; const row = (k) => f.rows.find((x) => x.key === k).vals;
    assert.deepEqual(f.months, ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    assert.deepEqual([row('use')[2], row('class')[2], row('billing')[2]], [5, 2, 370000], '7월 = 저장된 집계(시험·직원 줄 제외)');
    assert.deepEqual([row('use')[1], row('use')[0]], [null, null], '없는 달은 비움(-)');
    assert.ok(row('use')[5] !== null && row('billing')[5] !== null, '이번 달 = 올린 회원목록');
    const num = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || null;
    if (g.body.usageTotal) { assert.equal(row('usage')[5], num(g.body.usageTotal.cur)); assert.equal(row('usage')[4], num(g.body.usageTotal.prev), '9월 이용인원 = 10월 보고의 전달 값'); }
    assert.deepEqual(g.body.issuesMonth, [
      { title: '사우나 온도 민원', first: '1주차(10/2)', last: '3주차(10/16)', state: '완료', details: ['10/1 접수', '설비 업체 점검 10/8', '온도 조절기 교체 10/15'], weeks: 3 },
      { title: '주차 스티커 문의', first: '1주차(10/2)', last: '1주차(10/2)', state: '확인 필요', details: [], weeks: 1 },
    ], '제출된 10월 주간보고만(초안·11월 제외), 같은 제목은 한 줄 · 마지막 상태');
    // 화면 저장으로 흐름·민원 모음을 바꿀 수 없음
    const forged = await ctx.staffA.client.ok('PUT', `/api/branch-reports/${reportId}`, { ...g.body, flow: { months: ['위조'], rows: [], notes: [] }, issuesMonth: [] });
    assert.equal(forged.report.body.flow.months[0], '2026-05'); assert.equal(forged.report.body.issuesMonth.length, 2);
    // 인쇄·엑셀: 초안 표시·파일 이름
    const p = await ctx.staffA.client.req('GET', `/branch-print/${reportId}`);
    assert.match(p.body, /최근 6개월 흐름/); assert.match(p.body, /이번 달 민원·특이사항/); assert.match(p.body, /초안\(제출 전\)/); assert.match(p.body, /<title>초안_월간 강남점_월간보고_2026-10<\/title>/);
    const x = await fetch(`${BASE}/api/branch-reports/${reportId}/xlsx`, { headers: { cookie: ctx.staffA.client.cookie } });
    assert.match(decodeURIComponent(x.headers.get('content-disposition')), /초안_월간 강남점_월간보고_2026-10\.xlsx/);
    const sheets = await readXlsx(await x.arrayBuffer());
    assert.equal(sheets[0].cells[0][0].v, '초안(제출 전) · 월간 업무 보고서');
    assert.ok(sheets[0].cells.some((r) => r.some((c) => c?.v === '사우나 온도 민원')), '민원 모음이 엑셀에');
    const fs = sheets.find((s) => s.name === '최근 6개월 흐름'); assert.ok(fs, '흐름 시트');
    assert.deepEqual(fs.cells[0].map((c) => c?.v), ['구분', '2026.05', '2026.06', '2026.07', '2026.08', '2026.09', '2026.10']);
    assert.deepEqual(fs.cells[2].map((c) => c?.v), ['활성 이용권(개)', ...row('use').map((v) => (v === null ? '-' : String(v)))]); assert.equal(fs.cells[2][3].v, '5');
    // 제출 → 고객사 제출용 · 그때 값으로 굳음(뒤에 6월 집계를 넣어도 제출본은 그대로) · 제출 취소하면 다시 계산
    await ctx.staffA.client.ok('POST', `/api/branch-reports/${reportId}/submit`, {});
    const [db1] = await sql`select body->'flow' as flow, body->'issuesMonth' as im from branch_reports where id = ${reportId}`;
    assert.equal(db1.flow.months.length, 6); assert.equal(db1.im.length, 2);
    await sql`insert into branch_member_stats (site_id, month, tenant, stats, stats_all, excluded, file_name) values (${siteA}, '2026-06', 'default', ${sql.json(agg(7, 3))}, ${sql.json(agg(7, 3))}, 0, 'jun.xlsx')`;
    const sub = (await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report;
    assert.equal(sub.body.flow.rows.find((x) => x.key === 'use').vals[1], null, '제출본은 굳은 값');
    const ps = await ctx.staffA.client.req('GET', `/branch-print/${reportId}`);
    assert.match(ps.body, /고객사 제출용/); assert.match(ps.body, /<title>고객사제출용_월간 강남점_월간보고_2026-10<\/title>/);
    const xs = await fetch(`${BASE}/api/branch-reports/${reportId}/xlsx`, { headers: { cookie: ctx.staffA.client.cookie } });
    assert.match(decodeURIComponent(xs.headers.get('content-disposition')), /고객사제출용_월간 강남점_월간보고_2026-10\.xlsx/);
    await ctx.owner.ok('DELETE', `/api/branch-reports/${reportId}/submit`);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/branch-reports/${reportId}`)).report.body.flow.rows.find((x) => x.key === 'use').vals[1], 7, '초안으로 돌아오면 다시 계산');
    // 주간보고도 표지 표시
    const [wk] = await sql`select id from branch_reports where site_id = ${siteA} and report_day = '2026-10-16'`;
    assert.match((await ctx.staffA.client.req('GET', `/branch-print/${wk.id}`)).body, /고객사 제출용/);
  });

  test('주간보고 엑셀 내려받기', async () => {
    const [w] = await sql`select id from branch_reports where site_id = ${siteA} and report_day = '2026-10-16'`;
    const x = await ctx.staffA.client.req('GET', `/api/branch-reports/${w.id}/xlsx`);
    assert.equal(x.status, 200);
  });
});
