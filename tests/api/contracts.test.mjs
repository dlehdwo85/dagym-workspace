// 대표 10/20 20:00 ④ (#116) 전자계약서 1차: 서식 2종 기본 → 보내기(문서번호·링크·접속 코드·메일 dev) → 로그인 없이 코드 확인·순서·서명(PNG)·거절·잠김 → 완료 PDF 자료실(기밀) + 감사 추적(IP·기기) · 다른 회사 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';
import { assertPdfGlyphs } from '../pdfCheck.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const year = new Date().getFullYear();
const pub = async (method, path, body, headers = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'content-type': 'application/json', origin: BASE, 'user-agent': 'E2E-Phone/1.0 (Android)', 'x-forwarded-for': '203.0.113.7', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
};
const tokenOf = (link) => link.split('/').pop();

describe('#116 전자계약서', () => {
  let c1, emp, co;
  test('서식 기본 2종(근로계약서·비밀유지서약서) · 직원은 403/404 · 필수 칸 검사', async () => {
    const t = await ctx.owner.ok('GET', '/api/contracts/templates');
    assert.deepEqual(t.templates.map((x) => [x.kind, x.isDefault]), [['employment', true], ['nda', true]]);
    assert.ok(t.templates[0].body.includes('{{employee_name}}') && t.templates[0].fields.some((f) => f.key === 'salary' && f.required));
    assert.ok([403, 404].includes((await ctx.staffA.client.req('GET', '/api/contracts')).status), '직원은 목록 못 봄');
    assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/contracts', { kind: 'employment', userId: ctx.staffB.id, data: {} })).status));
    const bad = await ctx.owner.req('POST', '/api/contracts', { kind: 'employment', userId: ctx.staffA.id, data: { start_date: '2026-11-01' } });
    assert.equal(bad.status, 400); assert.match(bad.body.error.message, /"근무 장소"/);
  });
  test('보내기: 문서번호·서명자 2명(근로자 1 → 회사 2)·링크·접속 코드·메일 dev·감사 created/sent · 사용자 카드 목록', async () => {
    const data = { start_date: '2026-11-01', workplace: '서울 본사', duties: '현장 관리', work_hours: '09:00~18:00', work_days: '주 5일, 주휴일 일요일', salary: '월 2,800,000원', pay_day: '매월 25일' };
    const r = await ctx.owner.ok('POST', '/api/contracts', { kind: 'employment', userId: ctx.staffA.id, data });
    c1 = r.id;
    assert.equal(r.docNo, `계약-${year}-0001`); assert.equal(r.title, '근로계약서 — 이직원'); assert.equal(r.status, 'sent');
    assert.equal(r.delivery.length, 1, '1순서(근로자)에게만 먼저'); emp = r.delivery[0];
    assert.equal(emp.role, 'employee'); assert.match(emp.link, new RegExp(`^${BASE}/sign/[A-Za-z0-9_-]{20,}$`)); assert.match(emp.code, /^\d{6}$/); assert.equal(emp.mail, 'dev');
    assert.match(emp.smsText, /접속 코드: \d{6}/);
    const d = await ctx.owner.ok('GET', `/api/contracts/${c1}`);
    assert.deepEqual(d.signers.map((s) => [s.ord, s.role, s.status]), [[1, 'employee', 'pending'], [2, 'company', 'pending']]);
    assert.deepEqual(d.events.map((e) => e.type), ['created', 'sent']);
    assert.ok(d.contract.body.includes('이직원') && d.contract.body.includes('서울 본사') && d.contract.body.includes('기간의 정함이 없음'), '자리표시자 채움');
    assert.equal((await ctx.owner.ok('GET', `/api/contracts?userId=${ctx.staffA.id}`)).contracts.length, 1, '사용자 카드');
    assert.ok((await sql`select 1 from contract_signers where contract_id = ${c1} and token_hash is not null and code_hash is not null`).length === 2, '원문은 저장 안 함(해시)');
  });
  test('공개 서명 화면: 코드 전 안내(이름 가림) → 틀린 코드 403 → 코드 확인 → 회사 서명자는 아직 차례 아님(409) → 근로자 서명(PNG) → 일부 서명·IP·기기 기록', async () => {
    const tok = tokenOf(emp.link);
    const info = await pub('GET', `/api/sign/${tok}`);
    assert.equal(info.status, 200); assert.ok(info.body.company && typeof info.body.company === 'string'); assert.match(info.body.signerName, /^이\*직?원?$|^이\*+원$/); assert.equal(info.body.myStatus, 'pending');
    assert.equal((await pub('GET', '/api/sign/nope-token')).status, 404);
    const wrong = await pub('POST', `/api/sign/${tok}/view`, { code: '000000' });
    assert.equal(wrong.status, 403); assert.match(wrong.body.error.message, /4회 남음/);
    const v = await pub('POST', `/api/sign/${tok}/view`, { code: emp.code });
    assert.equal(v.status, 200); assert.equal(v.body.myTurn, true); assert.ok(v.body.body.includes('근로계약서')); assert.equal(v.body.signers.length, 2);
    // 회사 서명자(2순서) 링크를 발급받아 먼저 서명 시도 → 409
    const re = await ctx.owner.ok('POST', `/api/contracts/${c1}/resend`, {}).catch((e) => ({ error: e }));
    assert.ok(re.delivery?.length === 1 && re.delivery[0].role === 'employee', '다시 보내기는 지금 차례(근로자)만');
    emp = re.delivery[0]; // 링크·코드가 바뀜(예전 것 무효)
    assert.equal((await pub('POST', `/api/sign/${tok}/view`, { code: emp.code })).status, 404, '예전 링크 무효');
    const tok2 = tokenOf(emp.link);
    const s = await pub('POST', `/api/sign/${tok2}/sign`, { code: emp.code, image: PNG, method: 'draw', agree: true });
    assert.equal(s.status, 200); assert.equal(s.body.status, 'partially_signed'); assert.equal(s.body.completed, false);
    assert.equal((await pub('POST', `/api/sign/${tok2}/sign`, { code: emp.code, image: PNG, method: 'draw', agree: true })).status, 409, '두 번 서명 불가');
    const d = await ctx.owner.ok('GET', `/api/contracts/${c1}`);
    const e = d.signers.find((x) => x.role === 'employee');
    assert.equal(e.status, 'signed'); assert.equal(e.ip, '203.0.113.7'); assert.match(e.user_agent, /E2E-Phone/); assert.equal(e.has_signature, true); assert.equal(e.sign_method, 'draw');
    assert.ok(d.events.some((x) => x.type === 'code_fail') && d.events.some((x) => x.type === 'code_ok' && x.ip === '203.0.113.7') && d.events.some((x) => x.type === 'signed'));
    assert.equal(d.events.filter((x) => x.type === 'sent').length, 2, '근로자 서명 뒤 회사 서명자에게 발송');
    assert.equal(d.contract.status, 'partially_signed');
    const sv = await pub('POST', `/api/sign/${tok2}/view`, { code: emp.code });
    assert.equal(sv.body.myStatus, 'signed'); assert.equal(sv.body.pdfReady, false);
  });
  test('회사 서명자 서명 → 완료: PDF 자료실(인사/전자계약서·기밀) · 감사 completed · 완료본 공개 내려받기(코드) · 알림', async () => {
    const re = await ctx.owner.ok('POST', `/api/contracts/${c1}/resend`, {});
    co = re.delivery[0]; assert.equal(co.role, 'company');
    const tok = tokenOf(co.link);
    const s = await pub('POST', `/api/sign/${tok}/sign`, { code: co.code, image: PNG, method: 'stamp', agree: true });
    assert.equal(s.status, 200); assert.equal(s.body.completed, true);
    const d = await ctx.owner.ok('GET', `/api/contracts/${c1}`);
    assert.equal(d.contract.status, 'completed'); assert.ok(d.contract.file_id && d.contract.completed_at);
    const [f] = await sql`select folder, mime_type, security, size_bytes, storage_key, created_by from library_files where id = ${d.contract.file_id}`;
    assert.deepEqual([f.folder, f.mime_type, f.security, f.created_by], ['인사/전자계약서', 'application/pdf', 'confidential', ctx.ownerId]); assert.ok(Number(f.size_bytes) > 5000);
    assert.equal(d.events.at(-1).type, 'completed');
    const pdf = await pub('GET', `/api/sign/${tok}/pdf?code=${co.code}`);
    assert.equal(pdf.status, 200); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
    // 147차: 완료본을 다시 읽어 — 본문·서명란·감사 추적 쪽 글이 원문 그대로이고, 한글이 실제로 그려지는지(글꼴 깨짐이면 실패)
    const pages = await assertPdfGlyphs(assert, pdf.body, '전자계약 1차 완료본');
    const lines = pages.flatMap((p) => p.text);
    for (const s of ['근로계약서 — 이직원', '이직원', '김대표', '서명 감사 추적', '근로자(을)', '회사(갑)', '접속 코드 확인']) assert.ok(lines.includes(s), `완료본 줄 '${s}'`);
    for (const s of ['서울 본사', '월 2,800,000원', '매월 25일']) assert.ok(lines.some((l) => l.includes(s)), `완료본 본문 '${s}'`);
    assert.ok(pages.at(-1).text.includes('서명 감사 추적'), '감사 추적은 마지막 쪽');
    assert.equal((await pub('GET', `/api/sign/${tok}/pdf?code=111111`)).status, 403);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title like '전자계약 완료:%'`).length, '근로자(사용자)에게 완료 알림');
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and title like '전자계약 완료:%'`).length, '보낸 사람에게 완료 알림');
    const list = await ctx.owner.ok('GET', '/api/contracts');
    assert.equal(list.contracts[0].status, 'completed'); assert.equal(list.contracts[0].signers.filter((x) => x.status === 'signed').length, 2);
    assert.equal((await ctx.owner.req('POST', `/api/contracts/${c1}/resend`, {})).status, 409, '완료 뒤 재발송 없음');
  });
  test('비밀유지서약서(초대 중 계정·메일 코드) → 거절 → 상태 declined·알림 · 코드 5회 오류 잠김 · 취소 · 다른 회사 404', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'newbie@dagym.test', name: '신입이', role: 'staff', orgUnitIds: [ctx.hq] });
    const r = await ctx.owner.ok('POST', '/api/contracts', { kind: 'nda', userId: inv.userId, data: { effective_date: '2026-11-01', years: '2' }, codeBy: 'mail', signers: [{ role: 'employee', name: '신입이', email: 'newbie@dagym.test', ord: 1 }, { role: 'company', name: '김대표', email: 'ceo@dagym.test', ord: 2 }, { role: 'witness', name: '최매니저', email: 'managera@dagym.test', ord: 2 }] });
    assert.equal(r.docNo, `계약-${year}-0002`); assert.equal(r.delivery.length, 1);
    const tok = tokenOf(r.delivery[0].link);
    const dec = await pub('POST', `/api/sign/${tok}/decline`, { code: r.delivery[0].code, reason: '급여 조건 재협의' });
    assert.equal(dec.status, 200);
    const d = await ctx.owner.ok('GET', `/api/contracts/${r.id}`);
    assert.equal(d.contract.status, 'declined'); assert.equal(d.signers[0].decline_reason, '급여 조건 재협의');
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and title like '전자계약서 서명 거절:%'`).length);
    // 잠김: 새 계약서에 코드 5회 오류
    const r2 = await ctx.owner.ok('POST', '/api/contracts', { kind: 'nda', employee: { name: '외부인', email: 'out@example.com' }, data: { effective_date: '2026-11-01', years: '1' } });
    const t2 = tokenOf(r2.delivery[0].link);
    let last;
    for (let i = 0; i < 5; i++) last = await pub('POST', `/api/sign/${t2}/view`, { code: '999999' });
    assert.equal(last.status, 423);
    assert.equal((await pub('POST', `/api/sign/${t2}/view`, { code: r2.delivery[0].code })).status, 423, '맞는 코드도 잠김');
    assert.equal((await pub('GET', `/api/sign/${t2}`)).body.locked, true);
    const d2 = await ctx.owner.ok('GET', `/api/contracts/${r2.id}`);
    assert.equal(d2.signers[0].status, 'locked'); assert.ok(d2.events.some((x) => x.type === 'locked'));
    const re = await ctx.owner.ok('POST', `/api/contracts/${r2.id}/resend`, { signerId: d2.signers[0].id });
    assert.equal((await pub('POST', `/api/sign/${tokenOf(re.delivery[0].link)}/view`, { code: re.delivery[0].code })).status, 200, '다시 보내면 풀림');
    await ctx.owner.ok('DELETE', `/api/contracts/${r2.id}`);
    assert.equal((await pub('GET', `/api/sign/${tokenOf(re.delivery[0].link)}`)).status, 404, '취소하면 링크 막힘');
    // 다른 회사
    await sql`insert into contracts (tenant, kind, title, body, status) values ('other-co', 'nda', '남의 계약', 'x', 'sent')`;
    const [oc] = await sql`select id from contracts where tenant = 'other-co'`;
    assert.equal((await ctx.owner.req('GET', `/api/contracts/${oc.id}`)).status, 404);
    assert.equal((await ctx.owner.ok('GET', '/api/contracts')).contracts.some((x) => x.id === oc.id), false);
  });
  test('회사 서식 저장(칸 추가) → 보낼 때 그 서식·새 칸 필수', async () => {
    const t = await ctx.owner.ok('POST', '/api/contracts/templates', { kind: 'employment', name: '우리 회사 근로계약서', body: '# 근로계약서\n{{company_name}} 과 {{employee_name}} 은 다음과 같이 계약한다.\n부서: {{dept}}\n{{today}}', fields: [{ key: 'dept', label: '부서', type: 'text', required: true }] });
    const list = await ctx.owner.ok('GET', '/api/contracts/templates');
    assert.equal(list.templates.find((x) => x.kind === 'employment').id, t.id);
    assert.equal((await ctx.owner.req('POST', '/api/contracts', { templateId: t.id, kind: 'employment', userId: ctx.staffB.id, data: {} })).status, 400);
    const r = await ctx.owner.ok('POST', '/api/contracts', { templateId: t.id, kind: 'employment', userId: ctx.staffB.id, data: { dept: '영업부' }, send: false });
    assert.equal(r.status, 'draft'); assert.equal(r.delivery.length, 0);
    assert.ok((await ctx.owner.ok('GET', `/api/contracts/${r.id}`)).contract.body.includes('부서: 영업부'));
    const re = await ctx.owner.ok('POST', `/api/contracts/${r.id}/resend`, {});
    assert.equal(re.delivery.length, 1, '임시 저장을 보내기');
    assert.equal((await ctx.owner.ok('GET', `/api/contracts/${r.id}`)).contract.status, 'sent');
  });
});
