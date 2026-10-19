// V31 ① 회사 공용 연락처: 등록(번호 정리·중복 409)·검색(이름·번호 일부)·권한(같은 회사 열람, 등록자·담당·관리자만 수정)·휴지통/복원,
// 자동 등록(문자 보냄 → 연락처+업무 연결, 웹사이트 문의 → 문의자, 직원 번호는 안 넣음) · ② 자동 완성(이 업무 연결 맨 위·직원 포함·번호/이메일 종류) · 가져오기(CSV 열 짝·vCard QP 한글·중복은 빈 칸만)·엑셀 · 다른 회사 404
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, ctx, sql, other;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('fit@other.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'fit@other.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼짐', industry: '운동·피트니스', agree: { terms: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  other = c;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V31 연락처', () => {
  let hong, taskId;
  test('등록: 번호 정리(01011112222 → 010-1111-2222)·번호/이메일 둘 다 없으면 400·같은 번호 409 · 검색 이름/번호 일부 · 같은 회사는 보이고 등록자·관리자만 고침(직원 B 403) · 다른 회사 404', async () => {
    assert.equal((await ctx.staffA.client.req('POST', '/api/contacts', { name: '홍고객' })).status, 400);
    hong = (await ctx.staffA.client.ok('POST', '/api/contacts', { name: '홍고객', organization: '푸르지오 관리사무소', title: '소장', phone: '01011112222', email: 'Hong@Client.Test', tags: ['관리소', '고객'] })).id;
    const dup = await ctx.owner.req('POST', '/api/contacts', { name: '다른이름', phone: '010-1111-2222' });
    assert.equal(dup.status, 409); assert.match(dup.body.error.message, /홍고객/);
    const l = await ctx.staffB.client.ok('GET', '/api/contacts?q=1112');
    assert.deepEqual([l.contacts.length, l.contacts[0].name, l.contacts[0].phone, l.contacts[0].email, l.contacts[0].canEdit, l.total], [1, '홍고객', '010-1111-2222', 'hong@client.test', false, 1]);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/contacts?q=푸르지오')).contacts.length, 1);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/contacts?tag=관리소')).contacts.length, 1);
    assert.equal((await ctx.staffB.client.req('PATCH', `/api/contacts/${hong}`, { name: '홍고객', phone: '010-1111-2222', memo: 'x' })).status, 403, '남이 등록한 건 못 고침');
    await ctx.owner.ok('PATCH', `/api/contacts/${hong}`, { name: '홍고객', organization: '푸르지오 관리사무소', title: '소장', phone: '010-1111-2222', email: 'hong@client.test', memo: '월요일 오전 통화 선호', tags: ['관리소'], ownerId: ctx.staffB.id });
    const d = await ctx.staffB.client.ok('GET', `/api/contacts/${hong}`);
    assert.deepEqual([d.contact.memo, d.contact.owner_name, d.contact.canEdit, d.history.map((h) => h.action)], ['월요일 오전 통화 선호', '박직원', true, ['updated', 'created']], '담당 직원이 되면 고칠 수 있음·변경 기록');
    assert.equal((await other.req('GET', `/api/contacts/${hong}`)).status, 404, '다른 회사');
    assert.equal((await other.ok('GET', '/api/contacts')).contacts.length, 0);
  });
  test('자동 등록: 문자 보냄 → 받는 번호가 연락처(출처 발송)+업무 연결, 이미 있는 홍고객은 마지막 연락만 갱신 · 직원 번호는 안 넣음 · 자동 완성은 이 업무 연결 맨 위·직원 포함', async () => {
    taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '연락처 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    await sql`update users set phone = '010-9999-0000' where id = ${ctx.staffA.id}`;
    await ctx.owner.ok('POST', '/api/mail/sms-log', { taskId, to: ['010-3333-4444', '010-1111-2222', '010-9999-0000'], body: '자료 보내 드립니다' });
    const all = await ctx.owner.ok('GET', '/api/contacts');
    assert.deepEqual(all.contacts.map((c) => [c.name, c.source, c.task_count]).sort(), [['고객 010-3333-4444', 'send', 1], ['홍고객', 'manual', 1]], '직원 번호(010-9999-0000)는 연락처에 안 들어감');
    assert.ok(all.contacts.every((c) => c.last_contact_at), '마지막 연락 갱신');
    const s = await ctx.staffA.client.ok('GET', `/api/contacts/suggest?q=고&kind=phone&taskId=${taskId}`);
    assert.deepEqual(s.suggestions.map((x) => x.name).sort(), ['고객 010-3333-4444', '홍고객']);
    assert.ok(s.suggestions.every((x) => x.linked && x.kind === 'contact'), '이 업무에 연결된 사람으로 표시');
    const e = await ctx.owner.ok('GET', '/api/contacts/suggest?q=이직원&kind=email');
    assert.deepEqual([e.suggestions[0].kind, e.suggestions[0].name, e.suggestions[0].email], ['employee', '이직원', 'staffa@dagym.test'], '직원도 자동 완성(내부 표시)');
    assert.equal((await ctx.owner.ok('GET', '/api/contacts/suggest?q=홍&kind=email')).suggestions[0].email, 'hong@client.test');
    assert.equal((await ctx.owner.ok('GET', '/api/contacts/suggest?q=3333&kind=email')).suggestions.length, 0, '이메일 없는 연락처는 메일 칸에 안 나옴');
    const detail = await ctx.owner.ok('GET', `/api/contacts/${hong}`);
    assert.deepEqual([detail.tasks.length, detail.tasks[0].title, detail.sent.length, detail.sent[0].channel], [1, '연락처 시험 업무', 1, 'sms:handoff'], '연결 업무·보낸 기록');
  });
  test('웹사이트 문의 → 문의자(이름·기관·번호·이메일) 자동 등록 + 업무 연결', async () => {
    const tok = (await ctx.owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'hilink' })).token;
    const r = await fetch(`${BASE}/api/integrations/inquiries`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify({ lead_id: 'HL-C-0001', inquiry_type: 'HILINK 플랫폼', organization: '음성푸르지오', name: '김문의', phone: '010-5555-6666', email: 'lead@example.com', message: '데모 요청' }) });
    assert.equal(r.status, 200);
    const inq = (await ctx.owner.ok('GET', '/api/contacts?q=김문의')).contacts[0];
    assert.deepEqual([inq.name, inq.organization, inq.phone, inq.email, inq.source, inq.task_count], ['김문의', '음성푸르지오', '010-5555-6666', 'lead@example.com', 'inquiry', 1]);
  });
  test('휴지통 → 목록·자동 완성에서 빠짐 → 휴지통 목록 → 복원 · 30일 지난 건 정리', async () => {
    const id = (await ctx.owner.ok('POST', '/api/contacts', { name: '지울고객', phone: '010-7777-8888' })).id;
    assert.equal((await ctx.staffA.client.req('DELETE', `/api/contacts/${id}`)).status, 403);
    await ctx.owner.ok('DELETE', `/api/contacts/${id}`);
    assert.equal((await ctx.owner.ok('GET', '/api/contacts?q=지울')).contacts.length, 0);
    assert.equal((await ctx.owner.ok('GET', '/api/contacts/suggest?q=7777&kind=phone')).suggestions.length, 0);
    const tr = await ctx.owner.ok('GET', '/api/contacts?trash=1');
    assert.deepEqual(tr.contacts.map((c) => c.name), ['지울고객']);
    assert.equal((await ctx.owner.req('GET', `/api/contacts/${id}`)).status, 200, '휴지통 것도 상세는 열림(복원용)');
    await ctx.owner.ok('POST', `/api/contacts/${id}/restore`);
    assert.equal((await ctx.owner.ok('GET', '/api/contacts?q=지울')).contacts.length, 1);
    await ctx.owner.ok('DELETE', `/api/contacts/${id}`);
    await sql`update contacts set deleted_at = now() - interval '31 days' where id = ${id}`;
    await tick(); // 정기 실행의 contacts 단계가 30일 지난 휴지통을 비움
    assert.equal((await sql`select count(*)::int n from contacts where id = ${id}`)[0].n, 0);
  });
  test('가져오기: CSV 머리글로 열 짝 추측 → 미리보기(이름 없음·번호/이메일 없음·형식·파일 안 중복 건너뜀) → 반영(새로 2·기존은 빈 칸만) · vCard(QUOTED-PRINTABLE 한글) · 엑셀 내려받기', async () => {
    const csv = '이름,회사,직함,휴대폰,이메일,태그\n이신규,A아파트,과장,010-2222-3333,,입주\n박신규,B오피스,,,park@b.test,"입주, VIP"\n홍고객,,,010-1111-2222,,\n이름없음,,,,,\n번호없음,C,,,,\n중복,,,010-2222-3333,,\n형식,,,abc,,';
    const p = await ctx.owner.ok('POST', '/api/contacts/import/parse', { fileName: '연락처.csv', data: b64(csv) });
    assert.deepEqual(p.mapping, { name: 0, organization: 1, title: 2, phone: 3, email: 4, tags: 5 }); assert.equal(p.rows.length, 7);
    const pv = await ctx.owner.ok('POST', '/api/contacts/import/preview', { headers: p.headers, rows: p.rows, mapping: p.mapping });
    assert.deepEqual(pv.counts, { total: 7, ready: 3, errors: 4 });
    assert.deepEqual(pv.rows.filter((r) => r.errors.length).map((r) => [r.name, r.errors[0]]), [['이름없음', '번호·이메일 둘 다 없음'], ['번호없음', '번호·이메일 둘 다 없음'], ['중복', '파일 안 중복'], ['형식', '번호 형식']]);
    assert.equal((await ctx.owner.req('POST', '/api/contacts/import', { headers: p.headers, rows: p.rows, mapping: {} })).status, 400, '이름 열 없음');
    const r = await ctx.owner.ok('POST', '/api/contacts/import', { headers: p.headers, rows: p.rows, mapping: p.mapping, tags: ['2026박람회'] });
    assert.deepEqual([r.created, r.updated], [2, 1]);
    const park = (await ctx.owner.ok('GET', '/api/contacts?q=박신규')).contacts[0];
    assert.deepEqual([park.email, park.organization, park.tags.sort(), park.source], ['park@b.test', 'B오피스', ['2026박람회', 'VIP', '입주'], 'import']);
    const hongNow = (await ctx.owner.ok('GET', `/api/contacts/${hong}`)).contact;
    assert.equal(hongNow.organization, '푸르지오 관리사무소', '기존 값은 안 덮음');
    // vCard: 휴대폰 주소록 내보내기(2.1 QP 한글·3.0)
    const vcf = ['BEGIN:VCARD', 'VERSION:2.1', 'N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=EC=B5=9C;=EC=B9=B4=EB=93=9C;;;', 'TEL;CELL:010-4444-5555', 'ORG;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=EB=8C=80=ED=95=9C=EA=B1=B4=EC=84=A4', 'END:VCARD',
      'BEGIN:VCARD', 'VERSION:3.0', 'FN:John Smith', 'N:Smith;John;;;', 'TEL;TYPE=WORK:02-123-4567', 'TEL;TYPE=CELL:+82 10 6666 7777', 'EMAIL;TYPE=INTERNET:john@smith.test', 'TITLE:Manager', 'NOTE:박람회에서 만남', 'END:VCARD'].join('\r\n');
    const v = await ctx.owner.ok('POST', '/api/contacts/import/parse', { fileName: '주소록.vcf', data: b64(vcf) });
    assert.equal(v.vcard, true);
    assert.deepEqual(v.rows, [['최카드', '대한건설', '', '010-4444-5555', '', ''], ['John Smith', '', 'Manager', '+82 10 6666 7777', 'john@smith.test', '박람회에서 만남']]);
    const vr = await ctx.owner.ok('POST', '/api/contacts/import', { headers: v.headers, rows: v.rows, mapping: v.mapping, source: 'vcard' });
    assert.deepEqual([vr.created, vr.updated], [2, 0]);
    const john = (await ctx.owner.ok('GET', '/api/contacts?q=john')).contacts[0];
    assert.deepEqual([john.phone, john.source, john.memo], ['010-6666-7777', 'vcard', '박람회에서 만남']);
    const x = await fetch(`${BASE}/api/contacts/export`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200); assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
  });
});
