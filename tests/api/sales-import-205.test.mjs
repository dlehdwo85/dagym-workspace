// 205차 #461 ⑦ 가져오기·중복(설계 docs/handoff/SALES_LEADS_REVAMP_2026-10-23.md 4절 중복 방지 · 5절 '미리보기 → 중복 표시 → 반영'):
// POST /api/sales/leads/import/preview — 줄마다 이미 있음(같은 이름) · 파일 안 겹침 · 같은 연락처(사업자번호·전화·메일) · 비슷한 이름 · 새로, 합치면 채울 칸·다른 값.
// POST /api/sales/leads/import — 줄마다 action(merge·new·skip), 없으면 예전 그대로(같은 이름 건너뜀). 합치기는 빈 칸만 채우고 다른 값은 메모 한 줄 · 다른 회사 거래처는 못 찾음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, A, B, C;
const today = seoulToday();
const leadRow = async (id) => (await sql`select name, phone, email, scale, contact_name, biz_no, memo, next_contact_date::text as next from sales_leads where id = ${id}`)[0];

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const mk = async (body) => (await ctx.owner.ok('POST', '/api/sales/leads', { force: true, ...body })).id;
  A = await mk({ name: '한빛 스포츠센터', status: '미팅예정', phone: '031-555-1234', region: '경기', contactName: '김담당', ownerId: ctx.staffA.id });
  B = await mk({ name: '푸른숲 커뮤니티', bizNo: '123-45-67890', email: 'office@purun.example' });
  C = await mk({ name: '새벽별 아파트 관리사무소' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const ROWS = [
  { name: '한빛스포츠센터', phone: '031-555-1234', email: 'hanbit@example.com', scale: '1,200세대', contactName: '이담당' }, // 0 이미 있음(이름·전화)
  { name: '한빛 스포츠센터', region: '경기' }, // 1 이미 있음 — 채울 것 없음
  { name: '다른이름 본사', bizNo: '1234567890' }, // 2 같은 연락처(사업자번호)
  { name: '연락처만 같은 곳', phone: '+82 31-555-1234', nextContactDate: addDays(today, 7) }, // 3 같은 연락처(전화, +82)
  { name: '메일 같은 곳', email: 'OFFICE@purun.example' }, // 4 같은 연락처(메일, 대소문자)
  { name: '새벽별 아파트 2단지' }, // 5 비슷한 이름(앞 4자)
  { name: '완전히 새로운 곳' }, // 6 새로
  { name: '완전히새로운곳' }, // 7 파일 안 겹침(6과 같은 이름)
];

test('미리보기: 이미 있음·파일 안 겹침·같은 연락처(사업자번호·전화·메일)·비슷한 이름·새로 + 합치면 채울 칸·다른 값 — 쓰기 없음', async () => {
  const before = (await sql`select count(*)::int n from sales_leads`)[0].n;
  const p = await ctx.owner.ok('POST', '/api/sales/leads/import/preview', { rows: ROWS });
  assert.deepEqual(p.counts, { new: 1, same: 2, file: 1, contact: 3, similar: 1 });
  assert.deepEqual(p.rows.map((r) => r.kind), ['same', 'same', 'contact', 'contact', 'contact', 'similar', 'new', 'file']);
  const m0 = p.rows[0].matches[0];
  assert.deepEqual([m0.id, m0.by, m0.fill, m0.diff, m0.memo, m0.owner, m0.status], [A, ['name', 'phone'], ['이메일', '규모'], ['고객 담당자 이담당'], true, '이직원', '미팅예정']);
  assert.deepEqual([p.rows[1].matches[0].fill, p.rows[1].matches[0].diff, p.rows[1].matches[0].memo], [[], [], false], '같은 값뿐이면 바뀌는 것 없음');
  assert.deepEqual([p.rows[2].matches[0].id, p.rows[2].matches[0].by], [B, ['bizNo']]);
  assert.deepEqual([p.rows[3].matches[0].id, p.rows[3].matches[0].by, p.rows[3].matches[0].fill], [A, ['phone'], ['다음 연락일']], '+82 전화도 같은 번호');
  assert.deepEqual([p.rows[4].matches[0].id, p.rows[4].matches[0].by], [B, ['email']]);
  assert.deepEqual([p.rows[5].matches[0].id, p.rows[5].matches[0].by], [C, []]);
  assert.deepEqual([p.rows[6], p.rows[7].dupOf], [{ kind: 'new' }, 6]);
  assert.equal((await sql`select count(*)::int n from sales_leads`)[0].n, before, '미리보기는 쓰지 않음');
  assert.deepEqual((await ctx.owner.ok('POST', '/api/sales/leads/import/preview', { rows: [{ name: '전혀 없는 이름 하나' }] })).rows, [{ kind: 'new' }], '겹치는 줄이 없어도');
  // 권한: 직원 403 · 영업 공간 밖 404
  assert.equal((await ctx.staffA.client.req('POST', '/api/sales/leads/import/preview', { rows: [{ name: 'x' }] })).status, 403);
  assert.equal((await ctx.managerA.client.req('POST', '/api/sales/leads/import/preview', { rows: [{ name: 'x' }] })).status, 404);
});

test('반영: 줄마다 합치기(빈 칸만, 다른 값은 메모 한 줄 — 다시 합쳐도 두 번 안 붙음)·새로·건너뛰기 · 고르지 않은 줄은 예전 그대로 · 다른 회사 거래처는 못 찾음', async () => {
  await sql`insert into tenants (id, name) values ('t_imp', '남의회사') on conflict do nothing`;
  const [other] = await sql`insert into sales_leads (tenant, name, status) values ('t_imp', '남의 거래처', '신규리드') returning id`;
  const d7 = addDays(today, 7);
  const rows = [
    { ...ROWS[0], action: 'merge', mergeId: A }, { ...ROWS[1], action: 'skip' }, { ...ROWS[2], action: 'new' }, { ...ROWS[3], action: 'merge', mergeId: A },
    { ...ROWS[4], action: 'merge', mergeId: other.id }, { ...ROWS[5], action: 'new' }, ROWS[6], ROWS[7], { name: '고르지 않은 합치기', action: 'merge' },
  ];
  const r = await ctx.owner.ok('POST', '/api/sales/leads/import', { rows });
  assert.deepEqual([r.created, r.merged, r.skipped], [3, 2, ['한빛 스포츠센터', '완전히새로운곳']]);
  assert.deepEqual(r.failed.map((f) => [f.name, f.message]), [['메일 같은 곳', '합칠 거래처를 찾을 수 없습니다'], ['고르지 않은 합치기', '합칠 거래처를 고르지 않았습니다']]);
  const a = await leadRow(A);
  assert.deepEqual([a.name, a.phone, a.email, a.scale, a.contact_name, a.next], ['한빛 스포츠센터', '031-555-1234', 'hanbit@example.com', '1,200세대', '김담당', d7], '빈 칸만 채우고 이름·전화·고객 담당자는 그대로');
  assert.equal(a.memo, `[가져오기 ${today}] 다른 값 — 고객 담당자 이담당`);
  assert.equal((await sql`select count(*)::int n from tasks where lead_id = ${A} and deleted_at is null and status <> 'done' and due_date = ${d7}::date`)[0].n, 1, '다음 연락일을 채우면 영업 업무 마감도');
  assert.equal((await sql`select biz_no from sales_leads where name = '다른이름 본사' and tenant = 'default'`)[0].biz_no, '1234567890');
  assert.equal((await sql`select count(*)::int n from sales_leads where tenant = 'default' and name in ('새벽별 아파트 2단지', '완전히 새로운 곳', '완전히새로운곳')`)[0].n, 2);
  assert.equal((await leadRow(other.id)).email, null, '다른 회사 거래처는 그대로');
  const merges = await sql`select detail from audit_logs where action = 'sales.lead_merge' and target_id = ${A} order by id`;
  assert.deepEqual(merges.map((m) => m.detail), [{ from: 'csv', fill: ['이메일', '규모'], diff: 1 }, { from: 'csv', fill: ['다음 연락일'], diff: 0 }], '기록엔 칸 이름·개수만(전화·메일 값 없음)');
  const [imp] = await sql`select detail from audit_logs where action = 'sales.lead_import' order by created_at desc limit 1`;
  assert.deepEqual([imp.detail.created, imp.detail.merged, imp.detail.skipped, imp.detail.failed], [3, 2, 2, 2]);
  // 같은 줄을 다시 합쳐도 메모가 두 번 붙지 않음(바뀌는 것 없으면 기록도 없음)
  const again = await ctx.owner.ok('POST', '/api/sales/leads/import', { rows: [{ ...ROWS[0], action: 'merge', mergeId: A }] });
  assert.equal(again.merged, 1);
  assert.equal((await leadRow(A)).memo, a.memo);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'sales.lead_merge' and target_id = ${A}`)[0].n, 2);
});

test('새 리드: 이름이 달라도 같은 사업자번호·전화·메일이면 먼저 알려 줌(무엇이 같은지) · 사업자번호 고치기·목록', async () => {
  const s1 = await ctx.owner.ok('POST', '/api/sales/leads', { name: '전혀 다른 이름', phone: '0315551234' });
  assert.deepEqual(s1.similar.filter((x) => x.id === A).map((x) => x.by), ['phone']);
  const s2 = await ctx.owner.ok('POST', '/api/sales/leads', { name: '또 다른 이름', bizNo: '123 45 67890' });
  assert.ok(s2.similar.some((x) => x.id === B && x.by === 'bizNo'), JSON.stringify(s2.similar));
  const s3 = await ctx.owner.ok('POST', '/api/sales/leads', { name: '한빛 스포츠센터 2관' });
  assert.ok(s3.similar.some((x) => x.id === A && x.by === 'name'), '비슷한 이름은 예전 그대로');
  assert.equal((await ctx.owner.ok('POST', '/api/sales/leads', { name: '대표번호 공유', phone: '1588-1234' })).similar, undefined, '8자리 대표번호는 대조하지 않음');
  const K = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '주식회사 가온누리', force: true })).id;
  assert.equal((await ctx.owner.ok('POST', '/api/sales/leads', { name: '주식회사 하늘정원' })).similar, undefined, '회사 형태(주식회사)만 같으면 비슷하지 않음');
  assert.ok((await ctx.owner.ok('POST', '/api/sales/leads', { name: '(주)가온누리 본점' })).similar.some((x) => x.id === K && x.by === 'name'));
  await ctx.owner.ok('PATCH', `/api/sales/leads/${C}`, { bizNo: '987-65-43210' });
  assert.equal((await leadRow(C)).biz_no, '987-65-43210');
  const list = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads;
  assert.deepEqual([list.find((l) => l.id === B).bizNo, list.find((l) => l.id === C).bizNo], ['123-45-67890', '987-65-43210']);
});
