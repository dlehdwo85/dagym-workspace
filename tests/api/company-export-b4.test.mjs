// 상용화 B4 회사 전체 내보내기(DB 287): 대표·관리자 요청 → 압축 파일(영역별 CSV + 자료실·첨부 원본 + 목록) → 7일 내려받기 → 기간 지나면 저장소에서 지움.
// ① 직원·다른 회사는 못 함(403·404) ② 압축 안: 읽어 주세요·자료 CSV·파일 원본 — '내 파일'·200MB 넘는 파일은 빠지고 목록에 표시 · 비밀번호 칸 없음
// ③ 하루 한 번 ④ 파일이 많으면 압축 파일 여러 개(정기 실행이 이어서) ⑤ 7일 지나면 파일 지움 · 내려받기 막힘 · 감사 기록
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client, BASE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const UP = path.join(tmpdir(), 'workos-test', 'uploads');
const exists = (k) => access(path.join(UP, k)).then(() => true, () => false);
const put = async (k, data) => { await mkdir(path.dirname(path.join(UP, k)), { recursive: true }); await writeFile(path.join(UP, k), data); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 압축 없이 담은 zip 읽기(중앙 목록) → { 이름: Buffer } */
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  assert.ok(e >= 0, 'zip 끝 표시');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const size = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), el = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lel = buf.readUInt16LE(off + 28);
    out[name] = buf.subarray(off + 30 + lnl + lel, off + 30 + lnl + lel + size);
    p += 46 + nl + el + cl;
  }
  return out;
}
async function waitDone(id, ms = 40_000) {
  const end = Date.now() + ms; let last = 0;
  for (;;) {
    const [r] = await sql`select status from company_exports where id = ${id}`;
    if (r.status === 'done' || r.status === 'failed') return r.status;
    if (Date.now() > end) return r.status;
    if (Date.now() - last > 3000) { last = Date.now(); await tick().catch(() => {}); }
    await sleep(300);
  }
}
async function download(c, id, part = 1) {
  const r = await c.ok('GET', `/api/export/company/${id}/download?part=${part}&json=1`);
  const res = await fetch(r.url.startsWith('http') ? r.url : BASE + r.url);
  assert.equal(res.status, 200);
  return Buffer.from(await res.arrayBuffer());
}

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', COMPANY_EXPORT_PART_MB: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@export-b4.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@export-b4.test', password: 'signup-pass-1234', name: '내대표', mode: 'team', company: '내보내기상사', industry: '운동·피트니스', industries: ['운동·피트니스'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('대표가 요청 → 압축 파일에 영역별 CSV·파일 원본 · 개인 영역·큰 파일은 빠짐 · 직원·다른 회사는 막힘', async () => {
  const task = await T.c.ok('POST', '/api/tasks', { title: '내보낼 업무, "따옴표"' });
  await T.c.ok('POST', `/api/tasks/${task.id}/comments`, { body: '내보낼 댓글' });
  await T.c.ok('POST', '/api/contacts', { name: '내보낼 고객', phone: '010-1234-0000' });
  const attKey = `att/2026-11/export-b4/첨부.txt`; await put(attKey, '첨부 내용');
  await sql`insert into attachments (task_id, kind, storage_key, file_name, size_bytes, upload_status, created_by) values (${task.id}, 'file', ${attKey}, '첨부.txt', 13, 'ready', ${T.id})`;
  await sql`insert into attachments (task_id, kind, storage_key, file_name, size_bytes, upload_status, created_by) values (${task.id}, 'file', 'att/2026-11/export-b4/큰영상.mp4', '큰영상.mp4', ${300 * 1024 * 1024}, 'ready', ${T.id})`;
  const libKey = `lib/${T.tenant}/계약/자료.txt`; await put(libKey, '자료실 내용');
  await sql`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, storage_key, upload_status, scope, created_by) values (${T.tenant}, '계약/2026', '자료', '자료.txt', 'text/plain', 16, ${libKey}, 'ready', 'company', ${T.id})`;
  const mineKey = `lib/${T.tenant}/mine/개인.txt`; await put(mineKey, '개인 파일');
  await sql`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, storage_key, upload_status, scope, created_by) values (${T.tenant}, '', '개인', '개인.txt', 'text/plain', 13, ${mineKey}, 'ready', 'mine', ${T.id})`;

  // ① 권한: 직원 403 · 다른 회사 목록에는 안 보임
  assert.equal((await ctx.staffA.client.req('POST', '/api/export/company', {})).status, 403, '직원은 요청 못 함');
  const req1 = await T.c.ok('POST', '/api/export/company', {});
  assert.equal((await T.c.req('POST', '/api/export/company', {})).status, 400, '만드는 중에는 다시 요청 못 함');
  assert.equal(await waitDone(req1.id), 'done');
  const list = await T.c.ok('GET', '/api/export/company');
  const it = list.items.find((x) => x.id === req1.id);
  assert.equal(it.status, 'done'); assert.equal(it.parts.length, 1); assert.equal(it.counts.files, 2, '자료실 1 + 첨부 1'); assert.equal(it.counts.big, 1, '300MB 영상은 빠짐');
  assert.ok(new Date(it.expires_at) - Date.now() > 6.9 * 864e5, '7일');
  assert.equal((await ctx.owner.ok('GET', '/api/export/company')).items.filter((x) => x.id === req1.id).length, 0, '다른 회사 목록에 없음');
  assert.equal((await ctx.owner.req('GET', `/api/export/company/${req1.id}/download?part=1&json=1`)).status, 404, '다른 회사는 404');
  assert.equal((await T.c.req('POST', '/api/export/company', {})).status, 400, '하루 한 번');

  // ② 압축 파일 안
  const z = unzip(await download(T.c, req1.id));
  const names = Object.keys(z);
  for (const n of ['읽어 주세요.txt', '자료/사람.csv', '자료/업무.csv', '자료/업무_댓글.csv', '자료/일정.csv', '자료/연락처.csv', '자료/결재.csv', '자료/계약.csv', '자료/대화.csv', '자료/출퇴근.csv', '파일_목록.csv', '파일/자료실/계약/2026/자료.txt'])
    assert.ok(names.includes(n), `${n} 있음 — ${names.join(' | ')}`);
  const att = names.find((n) => n.startsWith('파일/업무 첨부/') && n.endsWith('/첨부.txt'));
  assert.ok(att && att.includes(`~${task.id.slice(0, 8)}`), `업무 첨부 경로 ${att}`);
  assert.equal(z[att].toString(), '첨부 내용'); assert.equal(z['파일/자료실/계약/2026/자료.txt'].toString(), '자료실 내용');
  assert.ok(!names.some((n) => n.includes('개인.txt')), "직원 '내 파일'은 빠짐");
  assert.ok(!names.some((n) => n.includes('큰영상')), '큰 파일은 빠짐');
  const tasksCsv = z['자료/업무.csv'].toString('utf8');
  assert.equal(tasksCsv.charCodeAt(0), 0xfeff, '엑셀용 BOM');
  assert.ok(tasksCsv.includes('"내보낼 업무, ""따옴표"""'), 'CSV 따옴표·쉼표 처리');
  assert.ok(z['자료/업무_댓글.csv'].toString().includes('내보낼 댓글'));
  assert.ok(z['자료/연락처.csv'].toString().includes('내보낼 고객'));
  const people = z['자료/사람.csv'].toString();
  assert.ok(people.includes('ceo@export-b4.test') && people.includes('대표'));
  assert.ok(!/scrypt|password|비밀번호/i.test(people), '비밀번호 칸 없음');
  assert.ok(!z['자료/출퇴근.csv'].toString().split('\r\n')[0].includes('lat'), '좌표 칸 없음');
  const manifest = z['파일_목록.csv'].toString();
  assert.ok(manifest.includes('큰영상.mp4') && manifest.includes('큰 파일(200MB 넘음)'), '큰 파일은 목록에 위치 표시');
  assert.ok(!manifest.includes('개인.txt'));
  assert.ok(z['읽어 주세요.txt'].toString().includes('내보내기상사'));
  // 감사 기록
  const acts = (await sql`select action from audit_logs where target_id = ${req1.id}`).map((x) => x.action);
  assert.ok(acts.includes('company.export_request') && acts.includes('company.export_download'), acts.join(','));
  // 알림
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${T.id} and type = 'company_export'`)[0].n, 1);
});

test('파일이 많으면 압축 파일 여러 개 · 7일 지나면 저장소에서 지우고 내려받기 막힘', async () => {
  await sql`update company_exports set created_at = now() - interval '2 days' where tenant = ${T.tenant}`;
  const big = Buffer.alloc(700 * 1024, 7); // 한 압축 파일 상한 1MB(시험) → 700KB 파일 3개면 압축 파일 3개 이상
  for (let i = 1; i <= 3; i++) {
    const k = `lib/${T.tenant}/큰/파일${i}.bin`; await put(k, big);
    await sql`insert into library_files (tenant, folder, title, file_name, mime_type, size_bytes, storage_key, upload_status, scope, created_by) values (${T.tenant}, '큰', ${`파일${i}`}, ${`파일${i}.bin`}, 'application/octet-stream', ${big.length}, ${k}, 'ready', 'company', ${T.id})`;
  }
  const r = await T.c.ok('POST', '/api/export/company', {});
  assert.equal(await waitDone(r.id, 60_000), 'done');
  const [row] = await sql`select parts, counts from company_exports where id = ${r.id}`;
  assert.ok(row.parts.length >= 3, `압축 파일 ${row.parts.length}개`);
  const all = {};
  for (const p of row.parts) Object.assign(all, unzip(await download(T.c, r.id, p.n)));
  for (let i = 1; i <= 3; i++) assert.equal(all[`파일/자료실/큰/파일${i}.bin`]?.length, big.length, `파일${i} 담김`);
  assert.ok(all['자료/업무.csv'], '자료는 첫 압축 파일에');
  assert.equal(row.counts.missingCount, 0);

  // 7일 지남 → 지움
  for (const p of row.parts) assert.ok(await exists(p.key));
  await sql`update company_exports set expires_at = now() - interval '1 minute' where id = ${r.id}`;
  await tick();
  for (let i = 0; i < 30 && (await sql`select status from company_exports where id = ${r.id}`)[0].status !== 'expired'; i++) await sleep(300);
  assert.equal((await sql`select status from company_exports where id = ${r.id}`)[0].status, 'expired');
  for (const p of row.parts) assert.equal(await exists(p.key), false, `${p.key} 지움`);
  assert.equal((await T.c.req('GET', `/api/export/company/${r.id}/download?part=1&json=1`)).status, 400, '기간 지나 내려받기 막힘');
});
