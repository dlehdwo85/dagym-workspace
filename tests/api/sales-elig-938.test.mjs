// 350차(대표 11/04 #938 "천안푸르지오레이크사이드 참가자격을 K-apt 에서 못 찾았다고 나오는데 KG2B 에 있다 — 이런 일이 생길 때 어떻게 처리할 건지"):
// 참가자격 읽기는 원천 첨부 밖에서도 공고문을 찾는다 — ① 이 공고의 자료실 자동 첨부 사본(sales_auto) ② 이 공고에서 만든 업무에 사람이 올린 hwp·pdf·docx 첨부(자료실 문서 연결 포함) ·
// 그런 문서가 새로 생기면 정기 실행이 다시 읽음(ldocs) · 3번 실패하면 멈추고 '자동 확인 실패 — 원문에서' + 원문 링크 · 그 공고 업무 체크리스트에 '참가자격 직접 확인' 줄(읽어 내면 거둠)
// (구조 시험 — 가짜 K-apt. 실제 KG2B 공고문 읽기는 운영에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

const PORT = 3286;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const DOC = `입찰공고\n1. 입찰에 부치는 사항\n가. 사업명: 주민공동시설 위탁운영\n4. 입찰방법\n가. 적격심사 제한경쟁입찰\n5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n나. 공고일 현재 주민운동시설 위탁운영 등록업체로서 자본금 5억 이상인 업체\n6. 제출서류\n가. 입찰참가신청서\n나. 사업자등록증`;
let srv, ctx, sql, fake;
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json({ first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row })}, 'workin')`;
const notice = (id, ext) => ({ id, source_type: 'kapt_bid', source_external_id: ext, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${ext}`, kg2b_url: `https://www.kg2b.co.kr/user/bid_list/KaptBidView?bidcode=${ext.slice(5)}`,
  title: `[충남천안] 시험푸르지오 ${id} 주민공동시설 위탁운영 사업자 선정 입찰공고`, issuer: `시험푸르지오${id}`, facility_name: `시험푸르지오${id}`, related: true, fit_business: '다짐', matched_keywords: ['주민공동', '위탁운영'],
  classification: '즉시 검토', current_status: '진행중', notice_state: '신규공고', posted_date: today, deadline_at: `${plus(8)}T17:00:00+09:00`, household_count: 900 });
const lib = async (p) => (await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, ext_ref, meta, text_content)
  values ('default', 'sales', '영업/공고/시험', ${p.title}, ${p.fileName}, 'application/x-hwp', 1234, ${ctx.ownerId}, 'ready', ${p.source}, '{}', ${p.extRef ?? null}, ${p.meta ? sql.json(p.meta) : null}, ${p.text}) returning id`)[0].id;
const read = (id) => ctx.owner.ok('POST', '/api/sales/eligibility', { id });
const rowOf = async (id) => (await sql`select row from sales_src_rows where tbl = 'procurement_notices' and src_id = ${id}`)[0].row;
const item = async (id) => (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => String(x.id) === id);
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const items = async (tid) => (await sql`select text, done from task_checklist_items where task_id = ${tid} order by sort`).map((x) => x.text);

before(async () => {
  const kapt = fakeKapt({}); // K-apt 상세에 첨부 없음(kg2b_ 공고)
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    if (kapt.handle(req, res, body)) return;
    res.statusCode = 404; res.end('nope');
  }).listen(PORT);
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, SALES_ELIGIBILITY: 'on', SALES_ELIGIBILITY_MAX: '10' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await put(notice('N1', 'kg2b_938001')); await put(notice('N2', 'kg2b_938002'));
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('① 원천 첨부가 없어도 자료실 자동 첨부 사본(sales_auto, meta.id = 공고)에서 참가자격 절을 읽음 · 본 문서 id(ldocs) 저장', async () => {
  const L1 = await lib({ title: '주민공동시설 입찰공고문', fileName: '주민공동시설 입찰공고문 (1).hwp', source: 'sales_auto', extRef: 'salesfile:test938', meta: { url: 'https://www.kg2b.co.kr/x', kind: 'bid', id: 'N1' }, text: DOC });
  const { eligibility: e } = await read('N1');
  assert.match(e.text ?? '', /참가자격/, JSON.stringify(e));
  assert.match(e.line ?? '', /자본금|등록업체/);
  assert.deepEqual([e.error, e.tries, e.file?.name, e.file?.url, e.ldocs], [null, 0, '주민공동시설 입찰공고문 (1).hwp', `/api/library/${L1}/download`, [String(L1)]]);
  assert.match((await item('N1')).elig.line ?? '', /자본금|등록업체/);
});

test('③ 공고문이 어디에도 없으면 3번 뒤 멈춤 — 목록 elig.failed · 업무 고정 칸 eligFail(원문 링크) · 체크리스트 "참가자격 직접 확인" 줄', async () => {
  for (let i = 0; i < 3; i++) await read('N2');
  const r = await rowOf('N2');
  assert.deepEqual([r.eligibility.text, r.eligibility.error, r.eligibility.tries, r.eligibility.ldocs], [null, '첨부 공고문 없음', 3, []]);
  const it = await item('N2');
  assert.equal(it.elig.failed, true, JSON.stringify(it.elig)); assert.equal(it.elig.error, '첨부 공고문 없음');
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '[입찰] 시험푸르지오 N2', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, space: 'sales' });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'N2', handoff: true })} where id = ${t.id}`;
  const d = await tick();
  assert.ok(d.bidDueAlign?.infoFilled >= 1, JSON.stringify(d.bidDueAlign));
  const [row] = await sql`select sales_ref from tasks where id = ${t.id}`;
  assert.deepEqual(row.sales_ref.bidInfo.eligFail, { reason: '첨부 공고문 없음', url: `https://www.kg2b.co.kr/user/bid_list/KaptBidView?bidcode=938002` });
  assert.ok((await items(t.id)).includes('참가자격 직접 확인 · 자동 읽기 실패 — 원문에서'), (await items(t.id)).join(' | '));
  globalThis.__t938 = t.id;
});

test('②·④ 그 업무에 사람이 공고문을 올리면(자료실 문서 연결) 다음 정기 실행이 다시 읽어 절을 찾고 · 고정 칸 eligFail 없어짐 · "직접 확인" 줄 거둠', async () => {
  const tid = globalThis.__t938;
  const L2 = await lib({ title: '입찰공고문(담당자 올림)', fileName: '천안 입찰공고문.pdf', source: 'upload', text: DOC });
  const [a] = await sql`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, created_by, doc_id) values (${tid}, 'file', 'test/938/천안 입찰공고문.pdf', '천안 입찰공고문.pdf', 'application/pdf', 2048, 'ready', ${ctx.ownerId}, ${L2}) returning id`;
  const d1 = await tick();
  assert.ok((d1.salesEligibility?.tried ?? []).some((x) => /938002 절 찾음/.test(x)), JSON.stringify(d1.salesEligibility));
  const r = await rowOf('N2');
  assert.match(r.eligibility.text ?? '', /참가자격/); assert.deepEqual([r.eligibility.tries, r.eligibility.ldocs, r.eligibility.file?.url], [0, [String(a.id)], `/api/attachments/${a.id}/download`]);
  await tick(); // 고정 칸·체크리스트 맞춤(같은 실행에서 순서가 뒤면 다음 실행)
  const [row] = await sql`select sales_ref from tasks where id = ${tid}`;
  assert.equal(row.sales_ref.bidInfo.eligFail ?? null, null);
  assert.ok(!(await items(tid)).some((x) => /^참가자격 직접 확인/.test(x)), (await items(tid)).join(' | '));
  assert.equal((await item('N2')).elig.failed, false);
});
