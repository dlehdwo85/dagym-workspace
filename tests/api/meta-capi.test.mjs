// #499-3 리드 단계 → Meta 전환 API(CAPI for CRM) (가짜 Meta Graph 서버 = 구조 시험 — 실제 데이터 세트·토큰·이벤트 관리자 확인은 로컬 확인 전)
// 설정(관리자만·토큰은 '저장됨'만·켜려면 데이터 세트+토큰) · [시험 보내기](test_event_code·최근 리드 ID) · 리드 광고 리드의 단계 기록 → 이벤트(건너뛴 앞 단계 채움·같은 이름 한 번·시험 리드 제외)
// · lead_id 는 숫자 그대로(17자리) · 이름·전화·이메일 안 보냄 · 묶음 실패 → 한 건씩 → 3번 실패 · 토큰 오류 3건 연속이면 멈춤 · 7일/35일 범위 · tick · 끄기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3242;
const DATASET = '1234567890123456';
const TOKEN = 'EAAGcapitest' + 'x'.repeat(40);
const TOKEN2 = 'EAAGcapirotated' + 'y'.repeat(40);
let srv, ctx, sql, fake, calls = [], validToken = TOKEN;
const badLeads = new Set(); // 이 리드 ID 가 들어 있으면 메타가 거절(code 100)
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let raw = ''; for await (const c of req) raw += c;
    const send = (code, j) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    const m = u.pathname.match(/^\/graph\/(\d+)\/events$/);
    if (req.method !== 'POST' || !m) return send(404, { error: { message: `nope ${req.method} ${u.pathname}`, code: 803 } });
    // lead_id 는 JSON 숫자 — JSON.parse 하면 17자리 끝자리가 바뀌므로 원문에서 읽음
    const leadIds = [...raw.matchAll(/"lead_id":(\d+)/g)].map((x) => x[1]);
    const token = u.searchParams.get('access_token');
    calls.push({ dataset: m[1], token, raw, leadIds, json: JSON.parse(raw), ct: req.headers['content-type'] });
    if (token !== validToken) return send(400, { error: { message: 'Invalid OAuth access token - Cannot parse access token', type: 'OAuthException', code: 190, fbtrace_id: 'trace-190' } });
    if (leadIds.some((id) => badLeads.has(id))) return send(400, { error: { message: 'Invalid parameter', type: 'OAuthException', code: 100, error_subcode: 2804050, error_user_msg: '리드 ID 를 찾을 수 없습니다', fbtrace_id: 'trace-100' } });
    send(200, { events_received: leadIds.length, messages: [], fbtrace_id: `trace-ok-${calls.length}` });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing', 'sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

let seq = 0;
const lead = async (name) => (await ctx.owner.ok('POST', '/api/sales/leads', { name: `${name} ${++seq}호`, force: true })).id;
const stage = (id, status, reason) => ctx.owner.ok('PATCH', `/api/sales/leads/${id}`, { status, ...(reason ? { reason } : {}) });
/** 리드 광고로 들어온 신청(처리 기록) — 받은 시각 = ago 전, 메타 생성 시각은 그 5초 전 */
async function metaLead(leadgen, leadId, { ago = '1 hour', test = false, status = 'created' } = {}) {
  const [m] = await sql`insert into mkt_meta_leads (tenant, page_id, leadgen_id, via, status, lead_id, is_test, received_at, created_time)
    values ('default', '1001', ${leadgen}, 'webhook', ${status}, ${leadId}, ${test}, now() - ${ago}::interval, now() - ${ago}::interval - interval '5 seconds') returning id, received_at`;
  return m;
}
const events = (metaId) => sql`select event_name, stage, event_time, status, attempts, error, fbtrace_id from mkt_capi_events where meta_lead_id = ${metaId} order by event_time, created_at`;
const sendNow = () => ctx.owner.ok('POST', '/api/marketing/lead-ads/capi/send', {});
const sec = (d) => Math.floor(+new Date(d) / 1000);

test('설정: 관리자만 · 켜려면 데이터 세트+토큰 · 토큰은 암호화하고 다시 안 보여 줌 · 공간 밖 404', async () => {
  const v0 = await ctx.owner.ok('GET', '/api/marketing/lead-ads/capi');
  assert.deepEqual({ on: v0.on, hasToken: v0.hasToken, canEdit: v0.canEdit, datasetId: v0.datasetId, since: v0.since }, { on: false, hasToken: false, canEdit: true, datasetId: '', since: null }, '기본 꺼짐');
  assert.equal(v0.stages.length, 12); assert.equal(v0.map['신규리드'], 'Lead'); assert.equal(v0.map['계약완료'], 'ConvertedLead'); assert.equal(v0.map['보류'], '', '보류는 기본 안 보냄');
  assert.deepEqual(v0.stats, { sent7: 0, pending: 0, failed: 0, skipped7: 0, lastSent: null, lastError: null });
  // 직원(마케팅 공간): 보기만 · 공간 밖: 404
  const st = await ctx.staffA.client.ok('GET', '/api/marketing/lead-ads/capi');
  assert.equal(st.canEdit, false);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/lead-ads/capi', { on: false, datasetId: DATASET, token: TOKEN })).status, 403);
  assert.equal((await ctx.staffA.client.post('/api/marketing/lead-ads/capi/send', {})).status, 403);
  assert.equal((await ctx.staffA.client.post('/api/marketing/lead-ads/capi/test', { testEventCode: 'TEST123' })).status, 403);
  assert.equal((await ctx.staffB.client.get('/api/marketing/lead-ads/capi')).status, 404, '마케팅 공간 밖은 404');
  // 켜려면 데이터 세트 ID 와 토큰
  const r1 = await ctx.owner.req('PUT', '/api/marketing/lead-ads/capi', { on: true, datasetId: '' });
  assert.equal(r1.status, 409); assert.equal(r1.body.error.code, 'capi_incomplete');
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/lead-ads/capi', { on: true, datasetId: DATASET })).status, 409, '토큰 없이 못 켬');
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/lead-ads/capi', { on: false, datasetId: '12ab34' })).status, 400, '데이터 세트 ID 는 숫자');
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/lead-ads/capi', { on: false, datasetId: DATASET, token: 'short' })).status, 400);
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/lead-ads/capi', { on: false, datasetId: DATASET, map: { 신규리드: '<b>Lead</b>' } })).status, 400, '이벤트 이름은 글자·숫자·공백·_·- 만');
  // 저장(아직 꺼 둠) — 이름표 일부만 바꾸면 나머지는 기본값
  const v1 = await ctx.owner.ok('PUT', '/api/marketing/lead-ads/capi', { on: false, datasetId: DATASET, token: TOKEN, source: '워크인 CRM', map: { 보류: 'OnHold' } });
  assert.deepEqual({ on: v1.on, hasToken: v1.hasToken, datasetId: v1.datasetId, source: v1.source, since: v1.since }, { on: false, hasToken: true, datasetId: DATASET, source: '워크인 CRM', since: null });
  assert.equal(v1.map['보류'], 'OnHold'); assert.equal(v1.map['신규리드'], 'Lead');
  assert.ok(!JSON.stringify(v1).includes(TOKEN) && !JSON.stringify(await ctx.owner.ok('GET', '/api/marketing/lead-ads/capi')).includes(TOKEN), '토큰은 화면·API 에 안 나감');
  const [row] = await sql`select capi_token_enc from mkt_settings where tenant = 'default'`;
  assert.ok(row.capi_token_enc && !row.capi_token_enc.includes(TOKEN), '토큰은 암호화해 보관');
  const [au] = await sql`select detail from audit_logs where action = 'mkt.capi' order by created_at desc limit 1`;
  assert.equal(au.detail.token, '바꿈'); assert.ok(!JSON.stringify(au.detail).includes(TOKEN), '감사 기록에도 토큰 없음');
  // 꺼져 있으면 [지금 보내기] 안 됨
  const off = await ctx.owner.req('POST', '/api/marketing/lead-ads/capi/send', {});
  assert.equal(off.status, 409); assert.equal(off.body.error.code, 'capi_off');
  assert.equal(calls.length, 0);
});

test('[시험 보내기]: 리드 광고 신청이 없으면 안내 → 최근 리드 ID 로 첫 단계 1건 + test_event_code · 메타 오류는 토큰 없이 502', async () => {
  const none = await ctx.owner.req('POST', '/api/marketing/lead-ads/capi/test', { testEventCode: 'TEST4821' });
  assert.equal(none.status, 409); assert.equal(none.body.error.code, 'capi_no_lead');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/lead-ads/capi/test', { testEventCode: 'a b' })).status, 400, '시험 코드 형식');
  // 시험 리드(메타 [시험 리드 보내기])도 시험 보내기에는 씀 — 단계 보내기에는 안 씀
  const tl = await metaLead('77700011122233344', await lead('시험 리드'), { test: true, ago: '2 minutes' });
  const r = await ctx.owner.ok('POST', '/api/marketing/lead-ads/capi/test', { testEventCode: 'TEST4821' });
  assert.deepEqual({ ok: r.ok, received: r.received, eventName: r.eventName, leadTail: r.leadTail }, { ok: true, received: 1, eventName: 'Lead', leadTail: '3344' });
  const c = calls.at(-1);
  assert.equal(c.dataset, DATASET); assert.equal(c.token, TOKEN); assert.equal(c.ct, 'application/json');
  assert.equal(c.json.test_event_code, 'TEST4821');
  assert.deepEqual(c.leadIds, ['77700011122233344'], 'lead_id 는 17자리 숫자 그대로(따옴표·반올림 없음)');
  const [ev] = c.json.data;
  assert.equal(ev.event_name, 'Lead'); assert.equal(ev.action_source, 'system_generated');
  assert.deepEqual(ev.custom_data, { event_source: 'crm', lead_event_source: '워크인 CRM' });
  assert.deepEqual(Object.keys(ev.user_data), ['lead_id'], '이름·전화·이메일은 보내지 않음');
  assert.ok(Number.isInteger(ev.event_time) && ev.event_time > sec(tl.received_at) && ev.event_time <= Math.floor(Date.now() / 1000), '초 단위 · 리드 생성 뒤');
  assert.equal((await sql`select count(*)::int n from mkt_capi_events`)[0].n, 0, '시험 이벤트는 보낸 기록에 안 쌓음');
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.capi_test'`).length);
  // 메타가 토큰을 거절 → 502 · 오류 문구에 토큰·주소 없음
  validToken = 'meta-revoked';
  const bad = await ctx.owner.req('POST', '/api/marketing/lead-ads/capi/test', { testEventCode: 'TEST4821' });
  assert.equal(bad.status, 502); assert.equal(bad.body.error.code, 'capi_upstream');
  assert.match(bad.body.error.message, /code 190/);
  assert.ok(!bad.body.error.message.includes(TOKEN) && !bad.body.error.message.includes('access_token'));
  validToken = TOKEN;
});

let A, B, H, I;
test('단계 기록 → 이벤트: 첫 단계·건너뛴 앞 단계 채움·같은 이름 한 번·보류(이름표)·실패 · 시험 리드·리드 광고 아닌 리드 제외 · 형식 아닌 ID 건너뜀', async () => {
  const la = await lead('강남 피트니스'), lb = await lead('역삼 요가'), lh = await lead('형식 오류'), li = await lead('판교 필라테스'), le = await lead('리드 광고 아님');
  A = await metaLead('98765432109876543', la); B = await metaLead('123456789012345', lb); H = await metaLead('99887766', lh); I = await metaLead('5550001112223334', li);
  await stage(la, '미팅예정');              // 1차연락완료를 건너뜀 → Contacted 도 같은 시각
  await stage(lb, '실패', '예산 없음');
  await stage(li, '보류', '다음 달 재연락');
  await stage(le, '1차연락완료');
  // 켜기(토큰은 비우면 그대로) → 켠 시각 기록
  const on = await ctx.owner.ok('PUT', '/api/marketing/lead-ads/capi', { on: true, datasetId: DATASET, source: '워크인 CRM' });
  assert.equal(on.on, true); assert.equal(on.hasToken, true); assert.ok(on.since);
  const before = calls.length;
  const r = await sendNow();
  assert.deepEqual(r, { queued: 8, sent: 7, failed: 0 }, 'A 3 + B 2 + I 2 + H 1(형식 아님 → 건너뜀)');
  assert.equal(calls.length, before + 1, '한 묶음으로');
  const c = calls.at(-1);
  assert.equal(c.json.data.length, 7); assert.equal(c.token, TOKEN); assert.equal(c.json.test_event_code, undefined);
  const byLead = (id) => c.json.data.map((e, k) => ({ ...e, lead: c.leadIds[k] })).filter((e) => e.lead === id);
  const ea = byLead('98765432109876543');
  assert.deepEqual(ea.map((e) => e.event_name), ['Lead', 'Contacted', 'QualifiedLead']);
  assert.equal(ea[0].event_time, sec(A.received_at), '첫 단계 = 신청 받은 시각');
  assert.ok(ea[1].event_time === ea[2].event_time && ea[1].event_time > ea[0].event_time, '건너뛴 단계는 바뀐 시각으로');
  assert.match(c.raw, /"lead_id":98765432109876543[,}]/);
  assert.deepEqual(byLead('123456789012345').map((e) => e.event_name), ['Lead', 'DisqualifiedLead'], '실패는 앞 단계를 채우지 않음');
  assert.deepEqual(byLead('5550001112223334').map((e) => e.event_name), ['Lead', 'OnHold'], '보류 = 이름표에 넣은 이름');
  assert.ok(c.json.data.every((e) => e.action_source === 'system_generated' && e.custom_data.event_source === 'crm' && Object.keys(e.user_data).join() === 'lead_id'));
  assert.ok(!/강남|역삼|판교|phone|email/.test(c.raw), '이름·연락처 없음');
  assert.ok(!c.leadIds.includes('77700011122233344'), '시험 리드는 안 보냄');
  const eh = await events(H.id);
  assert.equal(eh.length, 1); assert.equal(eh[0].status, 'skipped'); assert.match(eh[0].error, /형식/);
  assert.ok((await events(A.id)).every((e) => e.status === 'sent' && e.fbtrace_id && e.attempts === 1));
  // 화면: 지난 7일 보냄·건너뜀 · 최근 기록은 리드 ID 끝 4자리만
  const v = await ctx.owner.ok('GET', '/api/marketing/lead-ads/capi');
  assert.deepEqual({ sent7: v.stats.sent7, pending: v.stats.pending, failed: v.stats.failed, skipped7: v.stats.skipped7 }, { sent7: 7, pending: 0, failed: 0, skipped7: 1 });
  assert.ok(v.stats.lastSent); assert.ok(v.recent.some((x) => x.lead_tail === '6543'));
  assert.ok(!JSON.stringify(v).includes('98765432109876543'), '화면엔 끝 4자리만');
  // 다시 보내도 같은 것은 한 번
  assert.deepEqual(await sendNow(), { queued: 0, sent: 0, failed: 0 });
  assert.equal(calls.length, before + 1, '보낼 것이 없으면 메타를 부르지 않음');
  // 미팅예정 → 현장방문완료(이미 QualifiedLead) → 계약완료(ConvertedLead 1건)
  await stage(la, '현장방문완료');
  assert.deepEqual(await sendNow(), { queued: 0, sent: 0, failed: 0 }, '같은 이름은 리드마다 한 번');
  await stage(la, '계약완료');
  assert.deepEqual(await sendNow(), { queued: 1, sent: 1, failed: 0 });
  assert.deepEqual(calls.at(-1).json.data.map((e) => e.event_name), ['ConvertedLead']); assert.deepEqual(calls.at(-1).leadIds, ['98765432109876543']);
});

test('묶음 실패 → 한 건씩(틀린 건만 실패, 3번이면 멈춤) · 토큰 오류가 처음부터 3건 연속이면 이번엔 멈춤 → 토큰 바꾸면 이어서', async () => {
  const j = await metaLead('111111111111111', await lead('묶음 하나')), k = await metaLead('222222222222222', await lead('묶음 둘')), l = await metaLead('333333333333333', await lead('묶음 셋'));
  badLeads.add('222222222222222');
  const before = calls.length;
  assert.deepEqual(await sendNow(), { queued: 3, sent: 2, failed: 1 });
  assert.equal(calls.length, before + 4, '묶음 1번 + 한 건씩 3번');
  assert.equal((await events(j.id))[0].status, 'sent'); assert.equal((await events(l.id))[0].status, 'sent');
  let [ek] = await events(k.id);
  assert.deepEqual({ status: ek.status, attempts: ek.attempts }, { status: 'pending', attempts: 1 }); assert.match(ek.error, /code 100\/2804050/); assert.match(ek.error, /리드 ID 를 찾을 수 없습니다/);
  assert.deepEqual(await sendNow(), { queued: 0, sent: 0, failed: 1 });
  assert.deepEqual(await sendNow(), { queued: 0, sent: 0, failed: 1 });
  [ek] = await events(k.id);
  assert.deepEqual({ status: ek.status, attempts: ek.attempts }, { status: 'failed', attempts: 3 }, '3번 실패하면 멈춤');
  const v = await ctx.owner.ok('GET', '/api/marketing/lead-ads/capi');
  assert.equal(v.stats.failed, 1); assert.match(v.stats.lastError, /code 100/);
  const c0 = calls.length;
  assert.deepEqual(await sendNow(), { queued: 0, sent: 0, failed: 0 }, '실패로 멈춘 것은 다시 안 보냄'); assert.equal(calls.length, c0);
  // 메타가 토큰을 무효화 → 묶음 실패 → 한 건씩 3건 연속 같은 오류 → 나머지는 손대지 않고 멈춤
  validToken = 'meta-revoked';
  const ms = [];
  for (const [n, id] of [['토큰 하나', '444444444444441'], ['토큰 둘', '444444444444442'], ['토큰 셋', '444444444444443'], ['토큰 넷', '444444444444444']]) ms.push(await metaLead(id, await lead(n)));
  assert.deepEqual(await sendNow(), { queued: 4, sent: 0, failed: 3 });
  const st = await sql`select attempts, status, error from mkt_capi_events where meta_lead_id = any(${ms.map((m) => m.id)}::uuid[]) order by attempts desc`;
  assert.deepEqual(st.map((x) => `${x.status}:${x.attempts}`), ['pending:1', 'pending:1', 'pending:1', 'pending:0']);
  assert.ok(st.slice(0, 3).every((x) => /code 190/.test(x.error) && !x.error.includes(TOKEN) && !x.error.includes('access_token')), '오류 문구에 토큰·주소 없음');
  // 새 토큰 저장 → 나머지·실패한 것 이어서 보냄
  validToken = TOKEN2;
  await ctx.owner.ok('PUT', '/api/marketing/lead-ads/capi', { on: true, datasetId: DATASET, token: TOKEN2, source: '워크인 CRM' });
  assert.deepEqual(await sendNow(), { queued: 0, sent: 4, failed: 0 });
  assert.equal(calls.at(-1).token, TOKEN2);
  const [au] = await sql`select detail from audit_logs where action = 'mkt.capi' order by created_at desc limit 1`;
  assert.equal(au.detail.token, '바꿈');
  badLeads.clear();
  // 점검이 보내는 중이면 [지금 보내기]는 기다려 달라고(같은 이벤트를 두 번 보내지 않게)
  await sql`insert into job_locks (name, locked_until, holder) values ('capi:default', now() + interval '1 minute', 'other-run')`;
  const busy = await ctx.owner.req('POST', '/api/marketing/lead-ads/capi/send', {});
  assert.equal(busy.status, 409); assert.equal(busy.body.error.code, 'capi_busy');
  await sql`delete from job_locks where name = 'capi:default'`;
  assert.deepEqual(await sendNow(), { queued: 0, sent: 0, failed: 0 });
  assert.equal((await sql`select count(*)::int n from job_locks where name = 'capi:default'`)[0].n, 0, '끝나면 잠금 풀림');
});

test('기간: 처음 단계는 7일 안 신청만 · 오래된 신청도 7일 안 단계 변경은 보냄(앞 단계 채움) · 35일 넘은 신청·7일 지난 대기 건은 건너뜀 · tick · 끄기', async () => {
  // 켠 지 30일 지난 회사로
  await sql`update mkt_settings set capi = capi || ${sql.json({ since: new Date(Date.now() - 30 * 864e5).toISOString() })} where tenant = 'default'`;
  const ld = await lead('열흘 전 신청'), lg = await lead('사십일 전 신청'), lq = await lead('구일 전 신청');
  const d = await metaLead('666666666666661', ld, { ago: '10 days' }), g = await metaLead('666666666666662', lg, { ago: '40 days' }), q = await metaLead('666666666666663', lq, { ago: '9 days' });
  await sql`insert into sales_status_log (tenant, lead_id, from_status, to_status, changed_at) values ('default', ${lq}, '신규리드', '1차연락완료', now() - interval '8 days')`;
  await stage(ld, '1차연락완료'); await stage(lg, '미팅예정');
  // 보내지 못한 채 7일 지난 대기 건(꺼 둔 사이 등)
  await sql`insert into mkt_capi_events (tenant, meta_lead_id, leadgen_id, lead_id, event_name, stage, event_time) values ('default', ${q.id}, '666666666666663', ${lq}, 'Lead', '신규리드', now() - interval '8 days')`;
  const r = await sendNow();
  assert.deepEqual(r, { queued: 2, sent: 2, failed: 0 }, '열흘 전 신청: Lead+Contacted(바뀐 시각)만');
  const c = calls.at(-1);
  assert.deepEqual(c.leadIds, ['666666666666661', '666666666666661']); assert.deepEqual(c.json.data.map((e) => e.event_name), ['Lead', 'Contacted']);
  assert.ok(c.json.data.every((e) => e.event_time > Math.floor(Date.now() / 1000) - 600), '7일 안 시각만');
  assert.equal((await events(g.id)).length, 0, '35일 넘은 신청은 안 보냄');
  const [old] = await events(q.id);
  assert.equal(old.status, 'skipped'); assert.match(old.error, /7일/);
  // tick(점검)이 켠 회사만 만들고 보냄
  await stage(ld, '미팅예정');
  const c1 = calls.length;
  await tick();
  assert.equal(calls.length, c1 + 1); assert.deepEqual(calls.at(-1).json.data.map((e) => e.event_name), ['QualifiedLead']);
  // 끄면 tick 도 안 보냄 · [지금 보내기] 409
  await ctx.owner.ok('PUT', '/api/marketing/lead-ads/capi', { on: false, datasetId: DATASET, source: '워크인 CRM' });
  await stage(ld, '계약완료');
  const c2 = calls.length;
  await tick();
  assert.equal(calls.length, c2, '꺼져 있으면 안 보냄');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/lead-ads/capi/send', {})).status, 409);
  assert.equal((await sql`select count(*)::int n from mkt_capi_events where meta_lead_id = ${d.id} and event_name = 'ConvertedLead'`)[0].n, 0);
  // 다시 켜면 처음 켠 시각 그대로 → 꺼 둔 사이(7일 안) 바뀐 단계도 보냄(열흘 전 신청의 계약완료)
  const { since } = await ctx.owner.ok('GET', '/api/marketing/lead-ads/capi');
  const again = await ctx.owner.ok('PUT', '/api/marketing/lead-ads/capi', { on: true, datasetId: DATASET, source: '워크인 CRM' });
  assert.equal(again.since, since, '껐다 켜도 처음 켠 시각');
  assert.deepEqual(await sendNow(), { queued: 1, sent: 1, failed: 0 });
  assert.deepEqual(calls.at(-1).json.data.map((e) => e.event_name), ['ConvertedLead']); assert.deepEqual(calls.at(-1).leadIds, ['666666666666661']);
});
