// 332차(대표 11/02 16:1x 업무 첨부 ⑤·④): 올리기 skipDuplicate(같은 업무 같은 이름·크기면 안 올리고 duplicate) · 합치기 때 같은 파일 하나만(겹친 것은 지워진 원래 업무에) ·
// 선택 첨부 zip(파일 수·같은 이름 (2)·링크 건너뜀) · [자료실로](등록/이미 있음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const up = async (client, taskId, name, body, extra = {}) => {
  const r = await client.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: name, mimeType: 'application/pdf', size: body.length, ...extra });
  if (r.duplicate) return r;
  await fetch(BASE + r.upload.url, { method: 'PUT', headers: r.upload.headers, body }); await client.ok('POST', `/api/attachments/${r.id}/complete`, {}); return r;
};
const files = async (taskId) => (await sql`select file_name, size_bytes::int as n from attachments where task_id = ${taskId} and deleted_at is null order by created_at`).map((x) => `${x.file_name}:${x.n}`);
const mk = (title, assigneeId) => ctx.owner.ok('POST', '/api/tasks', { title, assigneeId, orgUnitId: ctx.siteA, approvalRequired: false });

test('올리기 skipDuplicate: 같은 업무에 같은 이름·크기가 있으면 duplicate: true 로 그 첨부 id · 새 줄 없음 · 크기 다르면 올림 · 플래그 없으면 예전처럼 올림', async () => {
  const t = await mk('중복 올리기 시험', ctx.staffA.id);
  const r1 = await up(ctx.owner, t.id, '공고문.hwp', Buffer.from('AAAA'), { skipDuplicate: true });
  const r2 = await up(ctx.owner, t.id, '공고문.hwp', Buffer.from('AAAA'), { skipDuplicate: true });
  assert.deepEqual([r2.duplicate, r2.id], [true, r1.id], '같은 이름·크기 → 그 첨부');
  assert.deepEqual(await files(t.id), ['공고문.hwp:4']);
  const r3 = await up(ctx.owner, t.id, '공고문.hwp', Buffer.from('BBBBBB'), { skipDuplicate: true });
  assert.equal(r3.duplicate, undefined, '같은 이름이라도 크기 다르면 다른 파일');
  await up(ctx.owner, t.id, '공고문.hwp', Buffer.from('AAAA'));
  assert.deepEqual(await files(t.id), ['공고문.hwp:4', '공고문.hwp:6', '공고문.hwp:4'], '플래그 없으면 그대로 올림(다른 화면·예전 앱)');
});

test('합치기(327차 dupes): 같은 파일(이름·크기)은 하나만 옮기고 겹친 것은 지워진 원래 업무에 남음 · 다른 파일은 옮김 · 활동 기록 attachments {moved, skipped}', async () => {
  const a = await mk('래미안 시험 공고 서류', ctx.staffA.id);
  const b = await mk('래미안 시험 공고 서류', ctx.managerA.id);
  await up(ctx.owner, a.id, '주민운동시설 공고.hwp', Buffer.from('X1'));
  await up(ctx.owner, b.id, '주민운동시설 공고.hwp', Buffer.from('X1'));
  await up(ctx.owner, b.id, '산출내역.hwp', Buffer.from('Y22'));
  await ctx.owner.ok('POST', '/api/attachments', { taskId: a.id, kind: 'link', url: 'https://example.com/notice', docTitle: '공고 링크' });
  await ctx.owner.ok('POST', '/api/attachments', { taskId: b.id, kind: 'link', url: 'https://example.com/notice', docTitle: '공고 링크' });
  const m = await ctx.owner.ok('POST', '/api/tasks/dupes', { sets: [[a.id, b.id]] });
  assert.equal(m.merged.length, 1, JSON.stringify(m));
  const keep = m.merged[0].keep; const gone = keep === a.id ? b.id : a.id;
  const kept = await sql`select kind, file_name, size_bytes::int as n, url from attachments where task_id = ${keep} and deleted_at is null order by created_at`;
  assert.deepEqual(kept.map((x) => (x.kind === 'link' ? `link:${x.url}` : `${x.file_name}:${x.n}`)).sort(), ['link:https://example.com/notice', '산출내역.hwp:3', '주민운동시설 공고.hwp:2'], '같은 공고문·같은 링크는 하나만');
  const left = await sql`select kind, file_name from attachments where task_id = ${gone} and deleted_at is null`;
  assert.deepEqual(left.map((x) => x.kind === 'link' ? 'link' : x.file_name).sort(), ['link', '주민운동시설 공고.hwp'], '겹친 것은 원래(지워진) 업무에 그대로');
  const [act] = await sql`select changes from activities where entity_id = ${keep} and action = 'merged'`;
  assert.deepEqual(act.changes.attachments, { moved: 1, skipped: 2 });
});

test('수동 통합(/merge)도 같은 파일은 하나만', async () => {
  const a = await mk('통합 원본', ctx.staffA.id); const b = await mk('통합 대상', ctx.staffA.id);
  await up(ctx.owner, a.id, '견적서.pdf', Buffer.from('QQQ')); await up(ctx.owner, b.id, '견적서.pdf', Buffer.from('QQQ')); await up(ctx.owner, a.id, '계약서.pdf', Buffer.from('CCCCC'));
  await ctx.owner.ok('POST', `/api/tasks/${a.id}/merge`, { intoId: b.id });
  assert.deepEqual(await files(b.id), ['견적서.pdf:3', '계약서.pdf:5']);
});

test('zip: 선택 첨부를 zip 하나로(파일 수·같은 이름은 (2)·링크는 건너뜀 x-skipped·활동 기록) · 없는 권한은 403 아닌 건너뜀 · [자료실로] 등록/이미 있음', async () => {
  const t = await mk('zip 시험', ctx.staffA.id);
  const a1 = await up(ctx.owner, t.id, '안내문.pdf', Buffer.from('%PDF one'));
  const a2 = await up(ctx.owner, t.id, '안내문.pdf', Buffer.from('%PDF two!!'));
  const link = await ctx.owner.ok('POST', '/api/attachments', { taskId: t.id, kind: 'link', url: 'https://example.com/x', docTitle: '링크' });
  const res = await fetch(`${BASE}/api/attachments/zip`, { method: 'POST', headers: { cookie: ctx.owner.cookie, origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ ids: [a1.id, a2.id, link.id] }) });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /application\/zip/);
  assert.deepEqual([res.headers.get('x-count'), res.headers.get('x-skipped')], ['2', '1']);
  assert.match(decodeURIComponent(res.headers.get('content-disposition')), /zip 시험_첨부2개_\d{8}\.zip/);
  const buf = Buffer.from(await res.arrayBuffer());
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(buf.readUInt16LE(eocd + 10), 2, 'zip 안 2개');
  assert.ok(buf.includes(Buffer.from('안내문 (2).pdf')) && buf.includes(Buffer.from('%PDF two!!')), '같은 이름은 (2) · 내용 그대로');
  assert.equal((await sql`select count(*)::int c from activities where entity_id = ${t.id} and action = 'file_downloaded' and (changes->>'zip')::boolean`)[0].c, 1);
  // 다른 조직 직원(볼 수 없음)은 그 파일을 건너뜀 → 담을 게 없으면 400
  const other = await fetch(`${BASE}/api/attachments/zip`, { method: 'POST', headers: { cookie: ctx.staffB.client.cookie, origin: BASE, 'content-type': 'application/json' }, body: JSON.stringify({ ids: [a1.id] }) });
  assert.equal(other.status, 400);
  // 자료실로: 올릴 때 자동 등록된 것은 '이미 있음', 자동 등록을 끈 회사도 사람이 고르면 등록
  const r1 = await ctx.owner.ok('POST', '/api/attachments/to-library', { ids: [a1.id, a2.id, link.id] });
  assert.deepEqual([r1.added + r1.already, r1.skipped], [2, 1], JSON.stringify(r1));
  await sql`update tenants set attach_to_library = false where id = 'default'`;
  const t2 = await mk('자료실로 시험', ctx.staffA.id);
  const b1 = await up(ctx.owner, t2.id, '손으로 등록.pdf', Buffer.from('%PDF manual'));
  assert.equal((await sql`select count(*)::int c from library_files where storage_key = (select storage_key from attachments where id = ${b1.id})`)[0].c, 0, '자동 등록 꺼짐');
  const r2 = await ctx.owner.ok('POST', '/api/attachments/to-library', { ids: [b1.id] });
  assert.deepEqual([r2.added, r2.already], [1, 0]); assert.ok(r2.folders[0].startsWith('업무 첨부/'), r2.folders[0]);
  const r3 = await ctx.owner.ok('POST', '/api/attachments/to-library', { ids: [b1.id] });
  assert.deepEqual([r3.added, r3.already], [0, 1]);
  await sql`update tenants set attach_to_library = true where id = 'default'`;
});
