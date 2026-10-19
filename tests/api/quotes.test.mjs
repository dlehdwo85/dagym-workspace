// V19 문자·견적서 — AI 는 초안만(draft_sms·draft_quote·quote_template), 보내기·만들기는 사람이 [확인]. 금액은 서버 재계산, A4 1페이지 고정(넘치면 400),
// 견적번호 Q-YYYYMMDD-001, PDF 는 자료실 "견적서" 폴더 + 업무 첨부, 보낸 기록(outbox quote:*·sms:handoff)은 [보냈어요]일 때만, 외부 발송 권한 없으면 403 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, FAKE, ensureTls, Client } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, taskId, other;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
async function chat(c, body, steps) {
  const n0 = (await fakeState()).anthropic.length;
  await queue(steps);
  const r = await c.ok('POST', '/api/ai/chat', body);
  const reqs = (await fakeState()).anthropic.slice(n0);
  const results = reqs.flatMap((x) => (Array.isArray(x.body.messages?.at(-1)?.content) ? x.body.messages.at(-1).content.filter((b) => b.type === 'tool_result') : []));
  return { r, reqs, results: Object.fromEntries(results.map((x) => [x.tool_use_id, x])) };
}
const parse = (res) => JSON.parse(typeof res.content === 'string' ? res.content : res.content[0].text);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).replace(/-/g, '');
const ITEMS = [{ name: '러닝머신 A형', spec: '3.0HP', qty: 2, unitPrice: 100000 }, { name: '설치비', qty: 1, unitPrice: 55000 }];

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '주식회사 다짐', ceo: '김대표', bizNo: '123-45-67890', address: '서울 강남구 테헤란로 1', phone: '02-000-0000', email: 'hello@dagym.test', isDefault: true });
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'hilink', name: '하이링크', ceo: '김대표', bizNo: '987-65-43210', address: '성남 분당구 판교로 2', phone: '031-000-0000' });
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '강남점 장비 견적', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  other = new Client('other');
  const r = await other.ok('POST', '/api/auth/signup', { email: 'q@other.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼짐', industry: '운동·피트니스', agree: { terms: true, privacy: true, ai: true } });
  await other.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V19 견적서 API', () => {
  test('양식: 첫 양식은 기본, 직원(회사 정보 편집 없음) 403 · 미리 계산: 공급가액·부가세·합계 서버 계산, 60개 품목은 1페이지 초과', async () => {
    assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/quotes/templates', { company: 'dagym', name: '직원 양식' })).status), '직원은 회사 정보 편집 메뉴 없음(숨김 404)');
    const t = await ctx.owner.ok('POST', '/api/quotes/templates', { company: 'dagym', name: '다짐 기본 견적서', layout: { terms: ['견적 유효기간: {validUntil}', '납기: 발주 후 2주'], footer: '위와 같이 견적합니다.' } });
    const list = await ctx.owner.ok('GET', '/api/quotes/templates?company=dagym');
    assert.deepEqual([list.templates.length, list.templates[0].id, list.templates[0].isDefault], [1, t.id, true]);
    assert.deepEqual(list.companies.map((c) => c.key), ['dagym', 'hilink']);
    const pv = await ctx.owner.ok('POST', '/api/quotes/preview?json=1', { company: 'dagym', to: { name: '강남 피트니스' }, items: ITEMS });
    assert.deepEqual([pv.supply, pv.vat, pv.total, pv.overflow, pv.template.name], [255000, 25500, 280500, false, '다짐 기본 견적서']);
    const many = await ctx.owner.ok('POST', '/api/quotes/preview?json=1', { company: 'dagym', to: { name: 'x' }, items: Array.from({ length: 60 }, (_, i) => ({ name: `품목 ${i + 1}`, qty: 1, unitPrice: 1000 })) });
    assert.equal(many.overflow, true, '60개는 A4 한 장을 넘음');
    const pdf = await fetch(`${BASE}/api/quotes/preview`, { method: 'POST', headers: { cookie: ctx.owner.cookie, origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ company: 'dagym', to: { name: '강남 피트니스' }, items: ITEMS }) });
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await ctx.owner.req('POST', '/api/quotes/preview?json=1', { company: 'nope', to: { name: 'x' }, items: ITEMS })).status, 400, '없는 회사');
  });

  let quoteId;
  test('만들기: 견적번호 Q-날짜-001·002, PDF 가 자료실 "견적서" 폴더 + 업무 첨부, 다른 회사 404, 넘치면 400', async () => {
    const q1 = await ctx.owner.ok('POST', '/api/quotes', { company: 'dagym', to: { name: '강남 피트니스', contact: '이담당', phone: '010-1111-2222', email: 'buyer@example.com' }, items: ITEMS, validDays: 14, note: '납품 후 현금 결제', taskId });
    quoteId = q1.id;
    assert.deepEqual([q1.no, q1.total, q1.link], [`Q-${today}-001`, 280500, `/quotes/${q1.id}`]);
    const q2 = await ctx.staffA.client.ok('POST', '/api/quotes', { company: 'dagym', to: { name: '판교 센터' }, items: [{ name: '덤벨 세트', qty: 10, unitPrice: 30000 }] });
    assert.equal(q2.no, `Q-${today}-002`, '직원도 초안은 만들 수 있음(보내기만 권한)');
    const [f] = await sql`select folder, mime_type, source, tags, text_content from library_files where id = ${q1.fileId}`;
    assert.deepEqual([f.folder, f.mime_type, f.source], ['견적서', 'application/pdf', 'quote']); assert.ok(f.tags.includes('견적서') && f.tags.includes('주식회사 다짐'));
    assert.ok(f.text_content && f.text_content.includes('강남 피트니스') && f.text_content.includes('280,500'), `PDF 글자 추출: ${String(f.text_content).slice(0, 80)}`);
    assert.ok(!f.text_content.includes('하이링크'), '공급자에 다른 회사 정보 없음');
    assert.equal((await sql`select count(*)::int n from attachments where task_id = ${taskId} and deleted_at is null`)[0].n, 1, '업무에 첨부');
    const g = await ctx.owner.ok('GET', `/api/quotes/${quoteId}`);
    assert.deepEqual([g.quote.quote_no, g.quote.to_email, Number(g.quote.vat), g.quote.status, g.canSend, g.quote.task_title], [q1.no, 'buyer@example.com', 25500, 'draft', true, '강남점 장비 견적']);
    assert.equal((await other.req('GET', `/api/quotes/${quoteId}`)).status, 404);
    assert.equal((await other.req('GET', `/api/quotes/${quoteId}/pdf`)).status, 404);
    const pdf = await fetch(`${BASE}/api/quotes/${quoteId}/pdf?download=1`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(pdf.status, 200); assert.match(decodeURIComponent(pdf.headers.get('content-disposition')), /attachment; .*견적서_Q-\d{8}-001_강남 피트니스\.pdf/);
    assert.equal((await ctx.owner.req('POST', '/api/quotes', { company: 'dagym', to: { name: 'x' }, items: Array.from({ length: 60 }, (_, i) => ({ name: `품목 ${i + 1}`, qty: 1, unitPrice: 1000 })) })).status, 400);
    const l = await ctx.owner.ok('GET', `/api/quotes?taskId=${taskId}`);
    assert.deepEqual(l.quotes.map((x) => x.quote_no), [q1.no]);
  });

  test('보내기 기록: 직원은 403, 대표 [보냈어요] → status sent·outbox quote:* · 문자 시안은 14일 링크 포함 · 메일은 업무 연결 필수', async () => {
    assert.equal((await ctx.staffA.client.req('POST', `/api/quotes/${quoteId}/sent`, { via: 'download' })).status, 403);
    const sms = await ctx.owner.ok('POST', `/api/quotes/${quoteId}/sms`, {});
    assert.match(sms.body, /\[주식회사 다짐\] 강남 피트니스 견적서\(Q-\d{8}-001\)/); assert.match(sms.body, /280,500원/); assert.match(sms.body, /견적서 보기\(14일\): http.*\/d\//);
    assert.equal(sms.to, '010-1111-2222');
    const [sl] = await sql`select files from share_links where task_id = ${taskId}`; assert.equal(sl.files.length, 1, '링크는 PDF 하나');
    const sres = await ctx.owner.req('POST', `/api/quotes/${quoteId}/sent`, { via: 'sms', to: '010-1111-2222' });
    if (sres.status !== 200) console.log('SENT-ERR', JSON.stringify(await sql`select message, stack from error_logs order by created_at desc limit 1`).slice(0, 600));
    const s = sres.body;
    assert.equal(s.via, 'sms');
    const g = await ctx.owner.ok('GET', `/api/quotes/${quoteId}`);
    assert.deepEqual([g.quote.status, g.quote.sent_via, g.quote.sent_to], ['sent', 'sms', '010-1111-2222']);
    const [ob] = await sql`select channel, task_id, to_addrs from outbox where channel = 'quote:sms'`;
    assert.deepEqual([ob.task_id, ob.to_addrs], [taskId, ['010-1111-2222']]);
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'quote_sent'`).length, '업무 활동 기록');
    const q2 = (await ctx.owner.ok('GET', '/api/quotes')).quotes.find((x) => x.to_name === '판교 센터');
    assert.equal((await ctx.owner.req('POST', `/api/quotes/${q2.id}/mail`, { to: 'a@b.co' })).status, 400, '업무 없는 견적서는 메일 첨부 발송 불가');
    const nolink = await ctx.owner.ok('POST', `/api/quotes/${q2.id}/sms`, {});
    assert.ok(!nolink.body.includes('/d/'), '업무 없으면 링크 없음'); assert.equal(nolink.to, '');
  });
});

describe('V19 AI 비서 문자·견적서 시안', () => {
  test('문자 시안: 번호는 사용자가 말한 것·문의 연락처만(지어내지 않음), 카드에서 고친 번호·본문으로 [보냈어요] → 기록, 직원은 403', async () => {
    const { r, reqs, results } = await chat(ctx.owner, { text: '010-3333-4444 번호로 내일 방문 안내 문자 보내줘' }, [
      toolUse('s1', 'propose_draft_sms', { body: '안녕하세요, 주식회사 다짐입니다. 내일 오전 10시 방문 예정입니다.', to: ['010-3333-4444', '홍길동'] }), say('문자 시안입니다.')]);
    assert.ok(reqs[0].body.tools.some((t) => t.name === 'propose_draft_sms'), `문자 낱말 → 문자 도구 묶음: ${reqs.map((x) => (x.body.tools ?? []).map((t) => t.name).join(',')).join(' | ')}`);
    assert.ok(!results.s1.is_error, results.s1.content);
    const p = r.proposals[0];
    assert.equal(p.kind, 'draft_sms'); assert.deepEqual(p.preview.sms.to, ['010-3333-4444'], '이름은 버림'); assert.equal(p.preview.sms.long, p.preview.sms.bytes > 90); assert.ok(p.preview.sms.bytes > 40);
    assert.equal((await sql`select count(*)::int n from outbox where channel = 'sms:handoff'`)[0].n, 0, '카드만 — 보낸 기록 없음');
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true, patch: { to: ['010-3333-4444', '010-5555-6666'], body: '내일 10시 방문합니다 — 다짐' } });
    assert.equal(done.status, 'done');
    const [ob] = await sql`select to_addrs, body_text, task_id from outbox where channel = 'sms:handoff' order by sent_at desc limit 1`;
    assert.deepEqual([ob.to_addrs, ob.body_text, ob.task_id], [['010-3333-4444', '010-5555-6666'], '내일 10시 방문합니다 — 다짐', null], '카드에서 고친 내용으로 기록');
    // 번호 못 찾으면 경고, 업무 문의 연락처는 자동
    const none = await chat(ctx.owner, { text: '고객한테 문자 보내줘' }, [toolUse('s2', 'propose_draft_sms', { body: '안내 문자' }), say('.')]);
    assert.deepEqual(none.r.proposals[0].preview.sms.to, []); assert.match(none.r.proposals[0].preview.warnings[0], /번호를 찾지 못했습니다/);
    await ctx.owner.ok('POST', `/api/ai/proposals/${none.r.proposals[0].id}`, { accept: false });
    const st = await chat(ctx.staffA.client, { text: '010-3333-4444 로 문자' }, [toolUse('s3', 'propose_draft_sms', { body: '직원 문자', to: ['010-3333-4444'], taskId }), say('.')]);
    assert.ok(!st.results.s3.is_error, '시안은 직원도 받음');
    assert.equal((await ctx.staffA.client.req('POST', `/api/ai/proposals/${st.r.proposals[0].id}`, { accept: true })).status, 403, '보내기(기록)는 외부 발송 권한');
  });

  test('견적서 시안: 회사 목록 → 시안(서버 재계산·1페이지)·PDF 미리보기 → [견적서 만들기] → 자료실·업무 첨부·링크 · 양식 제안 → 저장', async () => {
    const { r, results } = await chat(ctx.owner, { text: '강남 피트니스에 러닝머신 2대 견적서 만들어줘' }, [
      toolUse('c1', 'list_quote_companies', {}),
      toolUse('q1', 'propose_draft_quote', { company: 'dagym', to: { name: '강남 피트니스', email: 'buyer@example.com' }, items: [{ name: '러닝머신 A형', spec: '3.0HP', qty: 2, unitPrice: 100000 }, { name: '설치비', qty: 1, unitPrice: 55000 }], taskId }),
      say('견적서 시안입니다.')]);
    const cos = parse(results.c1);
    assert.deepEqual(cos.companies.map((c) => [c.key, c.hasBizInfo]), [['dagym', true], ['hilink', true]]); assert.equal(cos.templates.length, 1);
    assert.ok(!results.q1.is_error, results.q1.content);
    const p = r.proposals[0];
    assert.equal(p.kind, 'draft_quote'); assert.deepEqual([p.preview.quote.supply, p.preview.quote.vat, p.preview.quote.total, p.preview.quote.overflow, p.preview.quote.companyName], [255000, 25500, 280500, false, '주식회사 다짐']);
    const pdf = await fetch(`${BASE}/api/ai/proposals/${p.id}/quote-pdf`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await fetch(`${BASE}/api/ai/proposals/${p.id}/quote-pdf`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE } })).status, 404, '제안 주인만');
    const n0 = (await sql`select count(*)::int n from quotes`)[0].n;
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    assert.match(String(done.no), /^Q-\d{8}-00\d$/, JSON.stringify(done)); assert.equal(done.link, `/quotes/${done.quoteId}`);
    assert.equal((await sql`select count(*)::int n from quotes`)[0].n, n0 + 1);
    const g = await ctx.owner.ok('GET', `/api/quotes/${done.quoteId}`);
    assert.deepEqual([g.quote.to_name, Number(g.quote.total), g.quote.task_id], ['강남 피트니스', 280500, taskId]);
    // 넘치는 시안은 카드에 경고(만들기는 400)
    const big = await chat(ctx.owner, { text: '품목 60개 견적' }, [toolUse('q2', 'propose_draft_quote', { company: 'dagym', to: { name: 'x' }, items: Array.from({ length: 60 }, (_, i) => ({ name: `품목 ${i + 1}`, qty: 1, unitPrice: 1000 })) }), say('.')]);
    assert.equal(big.r.proposals[0].preview.quote.overflow, true);
    assert.equal((await ctx.owner.req('POST', `/api/ai/proposals/${big.r.proposals[0].id}`, { accept: true })).status, 400);
    // 양식 제안(회사 정보 편집 권한) → 저장
    const tp = await chat(ctx.owner, { text: '하이링크 견적서 양식 만들어줘' }, [toolUse('t1', 'propose_create_quote_template', { company: 'hilink', name: '하이링크 표준 견적서', layout: { terms: ['유효기간 {validUntil}', '결제: 세금계산서 발행 후 30일'], footer: '감사합니다.' }, isDefault: true }), say('.')]);
    assert.equal(tp.r.proposals[0].kind, 'quote_template'); assert.match(String(tp.r.proposals[0].preview.moves?.[1]), /결제: 세금계산서/, JSON.stringify(tp.r.proposals[0].preview));
    const td = await ctx.owner.ok('POST', `/api/ai/proposals/${tp.r.proposals[0].id}`, { accept: true });
    assert.ok(td.templateId);
    assert.equal((await ctx.owner.ok('GET', '/api/quotes/templates?company=hilink')).templates[0].name, '하이링크 표준 견적서');
    const sp = await chat(ctx.staffA.client, { text: '양식' }, [toolUse('t2', 'propose_create_quote_template', { company: 'dagym', name: 'x' }), say('.')]);
    assert.ok(sp.results.t2.is_error, '직원은 양식 제안도 못 함');
    // 다른 회사: 가입 때 만든 상호만 있고 사업자 정보가 없음 → hasBizInfo false(카드에서 회사 정보 등록 안내), 우리 회사 양식·회사는 안 보임
    const o = await chat(other, { text: '견적서' }, [toolUse('c2', 'list_quote_companies', {}), say('.')]);
    const oc = parse(o.results.c2);
    assert.ok(oc.companies.every((c) => c.hasBizInfo === false && c.name !== '주식회사 다짐'), JSON.stringify(oc)); assert.equal(oc.templates.length, 0);
  });
});
