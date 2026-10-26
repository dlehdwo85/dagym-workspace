// 183차 #177(로컬 10/23 요청 · 대표 "비슷한 글은 하나만 남기고 나머지 삭제"): 마케팅 콘텐츠 휴지통(mig 208)
// 관리자가 지우면 status canceled + deleted_at·deleted_by·deleted_from — 승인함에서 빠짐 · 열린 제작 요청·대기 게시 작업 취소 · 감사 건별 · 게시된 글은 못 지움(건너뜀 사유) · 직원 불가
// 휴지통 목록(지운 사람·원래 상태·영구 삭제 예정일) · [되살리기] 원래 상태·승인함 복귀 · 30일 지나면 정기 실행이 영구 삭제(버전 함께 · 이 글에만 쓰인 자동 시안 그림은 자료실 휴지통으로)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, ctx, sql, brandId;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const mk = async (title) => (await ctx.owner.ok('POST', '/api/marketing/contents', { title, channel: 'instagram', brandId, body: `${title} 본문입니다. 오늘도 좋은 하루 보내세요.` })).id; // v1 = 승인 대기

test('지우기: 보류·승인 대기·초안 → 휴지통(canceled + deleted_from) · 게시된 글은 건너뜀(사유) · 승인함에서 빠짐 + trash 건수 · 열린 제작 요청·대기 게시 작업 취소 · 감사 건별 · 직원 불가 · 한 건 DELETE(이미 휴지통 404 · 게시됨 400)', async () => {
  brandId = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '휴지통 시험 브랜드' })).id;
  const h = await mk('휴지통 보류'); const p = await mk('휴지통 대기'); const d = await mk('휴지통 초안'); const pub = await mk('휴지통 게시됨'); const one = await mk('휴지통 한 건');
  await sql`update mkt_contents set status = 'hold' where id = ${h}`;
  await sql`update mkt_contents set status = 'draft' where id = ${d}`;
  await sql`update mkt_contents set status = 'published', published_at = now() where id = ${pub}`;
  await sql`insert into mkt_production_requests (tenant, content_id, version, kind, brief, status) select tenant, id, 1, 'image', '시험', 'open' from mkt_contents where id = ${h}`;
  await sql`insert into mkt_publish_jobs (tenant, content_id, version, provider, status, idempotency_key) select tenant, id, 1, 'manual', 'queued', ${h + ':1:manual'} from mkt_contents where id = ${h}`;
  assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/marketing/contents/trash', { ids: [h] })).status), '직원은 못 지움');
  const r = await ctx.owner.ok('POST', '/api/marketing/contents/trash', { ids: [h, p, d, pub] });
  assert.deepEqual([r.count, r.skipped.length, r.skipped[0].id, r.days], [3, 1, pub, 30], JSON.stringify(r));
  assert.match(r.skipped[0].reason, /게시된 글/);
  const by = Object.fromEntries((await sql`select id, status, deleted_from, deleted_at, deleted_by from mkt_contents where id in (${h}, ${p}, ${d}, ${pub})`).map((x) => [x.id, x]));
  assert.deepEqual([by[h].status, by[h].deleted_from, by[p].deleted_from, by[d].deleted_from, by[pub].status, by[pub].deleted_at], ['canceled', 'hold', 'pending', 'draft', 'published', null]);
  assert.equal(by[h].deleted_by, ctx.ownerId, '누가 지웠는지');
  assert.equal((await sql`select status from mkt_production_requests where content_id = ${h}`)[0].status, 'canceled', '열린 제작 요청 취소');
  assert.equal((await sql`select status from mkt_publish_jobs where content_id = ${h}`)[0].status, 'canceled', '대기 게시 작업 취소');
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.ok(!list.contents.some((c) => [h, p, d].includes(c.id)), '승인함에서 빠짐');
  assert.ok(list.contents.some((c) => c.id === one), '안 지운 글은 그대로');
  assert.equal(list.trash, 3, '휴지통 건수(관리자 칸)');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt_content.trash'`)[0].n, 3, '건별 감사');
  const one1 = await ctx.owner.ok('DELETE', `/api/marketing/contents/${one}`);
  assert.deepEqual([one1.ok, one1.days], [true, 30]);
  assert.equal((await ctx.owner.req('DELETE', `/api/marketing/contents/${one}`)).status, 404, '이미 휴지통');
  assert.equal((await ctx.owner.req('DELETE', `/api/marketing/contents/${pub}`)).status, 400, '게시된 글');
  assert.notEqual((await ctx.staffA.client.req('GET', '/api/marketing/contents/trash')).status, 200, '직원은 휴지통 못 봄');
});

test('휴지통 목록(지운 사람·원래 상태·영구 삭제 예정일 = 30일 뒤) · 되살리기 → 원래 상태·승인함 복귀·감사 · 이미 되살린 건 404 · 휴지통 글 상세는 열림(purgeAt)', async () => {
  const t = await ctx.owner.ok('GET', '/api/marketing/contents/trash');
  assert.equal(t.days, 30);
  const row = t.items.find((i) => i.title === '휴지통 보류');
  assert.ok(row, JSON.stringify(t.items.map((i) => i.title)));
  assert.deepEqual([row.deleted_from, row.brand, row.deleted_by_name, row.media_count], ['hold', '휴지통 시험 브랜드', '김대표', 0]);
  assert.ok(Math.abs(new Date(row.purge_at) - new Date(row.deleted_at) - 30 * 864e5) < 1000, '영구 삭제 예정일 = 지운 날 + 30일');
  const r = await ctx.owner.ok('POST', '/api/marketing/contents/restore', { ids: [row.id] });
  assert.deepEqual([r.count, r.items[0].status], [1, 'hold']);
  const [c] = await sql`select status, deleted_at, deleted_from from mkt_contents where id = ${row.id}`;
  assert.deepEqual([c.status, c.deleted_at, c.deleted_from], ['hold', null, null]);
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.ok(list.contents.some((x) => x.id === row.id && x.status === 'hold'), '승인함 보류 칸 복귀');
  assert.equal(list.trash, 3, '휴지통 4건 중 1건 되살림');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt_content.restore'`)[0].n, 1);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/contents/restore', { ids: [row.id] })).status, 404, '이미 되살린 건');
  assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/marketing/contents/restore', { ids: [row.id] })).status), '직원은 못 되살림');
  const d = t.items.find((i) => i.title === '휴지통 초안');
  const det = await ctx.owner.ok('GET', `/api/marketing/contents/${d.id}`);
  assert.ok(det.content.deleted_at && det.content.purgeAt && det.content.status === 'canceled', '휴지통 글 상세 = 띠에 쓸 정보');
});

test('30일 지난 글은 정기 실행이 영구 삭제 — 행·버전 삭제 · 이 글에만 쓰인 자동 시안 그림은 자료실 휴지통으로(다른 글과 같이 쓴 그림은 그대로) · 감사 · 30일 안 된 글은 그대로', async () => {
  const t = await ctx.owner.ok('GET', '/api/marketing/contents/trash');
  const old = t.items.find((i) => i.title === '휴지통 대기'); const keep = t.items.find((i) => i.title === '휴지통 초안');
  const [{ tenant }] = await sql`select tenant from mkt_contents where id = ${old.id}`;
  const file = async (title) => (await sql`insert into library_files (tenant, folder, title, file_name, mime_type, upload_status, space, source) values (${tenant}, '마케팅/자동 시안', ${title}, ${title + '.jpg'}, 'image/jpeg', 'ready', 'marketing', 'generated') returning id`)[0].id;
  const f1 = await file('지울 글만 쓴 시안'); const f2 = await file('남는 글도 쓴 시안'); const f3 = await file('사람이 올린 사진');
  await sql`update library_files set folder = '마케팅/실사' where id = ${f3}`;
  await sql`update mkt_versions set media_ids = array[${f1}::uuid, ${f2}::uuid, ${f3}::uuid] where content_id = ${old.id} and version = 1`;
  await sql`update mkt_versions set media_ids = array[${f2}::uuid] where content_id = ${keep.id} and version = 1`;
  await sql`update mkt_contents set deleted_at = now() - interval '31 days' where id = ${old.id}`;
  await tick();
  assert.equal((await sql`select count(*)::int n from mkt_contents where id = ${old.id}`)[0].n, 0, '행 삭제');
  assert.equal((await sql`select count(*)::int n from mkt_versions where content_id = ${old.id}`)[0].n, 0, '버전 함께');
  const fs = Object.fromEntries((await sql`select id, deleted_at from library_files where id in (${f1}, ${f2}, ${f3})`).map((x) => [x.id, !!x.deleted_at]));
  assert.deepEqual([fs[f1], fs[f2], fs[f3]], [true, false, false], '이 글에만 쓰인 자동 시안 그림만 자료실 휴지통으로 · 공유 그림·사람 사진은 그대로');
  assert.equal((await sql`select count(*)::int n from mkt_contents where id = ${keep.id} and deleted_at is not null`)[0].n, 1, '30일 안 된 글은 그대로');
  const [a] = await sql`select detail from audit_logs where action = 'mkt.trash_purge' order by created_at desc limit 1`;
  assert.deepEqual([a.detail.count, a.detail.files, a.detail.titles], [1, 1, ['휴지통 대기']]);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).trash, 2, '휴지통 건수 줄어듦');
});
