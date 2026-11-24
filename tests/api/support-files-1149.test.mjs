// #1149(대표 11/24 '지원사업을 업무로 넘길 때 첨부가 안 넘어옴'): K-Startup 상세 화면의 내려받기 링크(/afile/fileDownload/…)를 읽어 첨부를 채우고 기존 업무에 붙임
//   (자료실 '영업/지원사업/…' 한 번 저장 → 업무 연결) · 내려받기가 막히면 업무 설명에 실패 줄
// #1151·#1152: 탭 숫자 = 지금 거름을 적용한 값 · 관심·준비 탭은 종류 거름과 관계없이 다 보임 · 찾기는 거름 무시 · '거름으로 n건 숨김'
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays, tick } from '../helpers.mjs';

let srv, ctx, sql, fake;
const PORT = 3249;
const d = (n) => addDays(seoulToday(), n);
const ins = (o) => sql`insert into support_programs ${sql({ source: 'kstartup', regions: [], nationwide: true, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '창업기업', agency: '창업진흥원', ...o })} returning id`.then((r) => r[0].id);
before(async () => {
  fake = http.createServer((req, res) => {
    if (req.url.startsWith('/kstartup/K1149')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(`<html><body><ul class="file_bg">
      <li><span>모집공고문_Next OI.hwp</span><a href="/afile/fileDownload/AAA111" class="btn">다운로드</a></li>
      <li><span>신청서 양식.docx</span><a href="/afile/fileDownload/BBB222" class="btn">다운로드</a></li></ul></body></html>`); return; }
    if (req.url.startsWith('/kstartup/')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>첨부 없음</body></html>'); return; }
    if (req.url === '/afile/fileDownload/AAA111') { res.writeHead(200, { 'content-type': 'application/x-hwp', 'content-disposition': 'attachment; filename="notice.hwp"' }); res.end(Buffer.from('HWP-FAKE-1149')); return; }
    if (req.url === '/afile/fileDownload/BBB222') { res.writeHead(403); res.end('login required'); return; }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => fake.listen(PORT, '127.0.0.1', r));
  await resetDb(); srv = await startServer({ SUPPORT_WEEKLY: 'off', SALES_COLLECT_TEST_BASE: `http://127.0.0.1:${PORT}`, SUPPORT_REMIND_HOURS: '0-24' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: '소기업', employees: 8, industries: ['소프트웨어'], keywords: [], certs: [], brands: ['다짐'], interests: [] });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('#1149 진행 중 K-Startup 공고: 상세 화면 첨부를 채우고 기존 업무에 붙임 · 막힌 파일은 업무에 실패 줄', async () => {
  const p = await ins({ source_id: 'K1149', title: '「Next OI 기술 커넥트」 참여 스타트업 모집', url: 'https://www.k-startup.go.kr/web/contents/bizpbanc-ongoing.do?schM=view&pbancSn=K1149' });
  const other = await ins({ source_id: 'K0000', title: '관심 없는 공고' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'preparing', ownerId: ctx.staffA.id });
  const [w] = await sql`select task_id from support_work where program_id = ${p}`; assert.ok(w.task_id);
  for (let i = 0; i < 20; i++) { const [x] = await sql`select jsonb_array_length(attachments) n from support_programs where id = ${p}`; if (x.n) break; await tick(); await new Promise((r) => setTimeout(r, 300)); }
  const [pp] = await sql`select attachments, raw->>'files_found' as found from support_programs where id = ${p}`;
  assert.deepEqual(pp.attachments.map((a) => a.name), ['모집공고문_Next OI.hwp', '신청서 양식.docx']);
  assert.equal(pp.attachments[0].url, `http://127.0.0.1:${PORT}/afile/fileDownload/AAA111`);
  const [o] = await sql`select jsonb_array_length(attachments) n, raw->>'files_checked_at' as checked from support_programs where id = ${other}`;
  assert.deepEqual([o.n, o.checked], [0, null], '진행하지 않는 공고는 상세 화면을 읽지 않음');
  let att = [];
  for (let i = 0; i < 20 && !att.length; i++) { att = await sql`select file_name, source from attachments where task_id = ${w.task_id} and deleted_at is null`; if (!att.length) await new Promise((r) => setTimeout(r, 300)); }
  assert.equal(att.length, 1, '받을 수 있는 파일은 업무에 붙음'); assert.equal(att[0].source, 'sales_auto');
  const [lib] = await sql`select f.path from library_files l left join library_folders f on f.id = l.folder_id where l.ext_ref like 'salesfile:%' and l.deleted_at is null limit 1`.catch(() => [{}]);
  if (lib?.path) assert.match(lib.path, /^영업\/지원사업\//, '자료실 영업/지원사업/… 에 한 번 저장');
  const [t] = await sql`select description from tasks where id = ${w.task_id}`;
  assert.match(t.description, /공고 첨부 2건 중 1건 자동 첨부 실패/, '막힌 파일은 업무에 원문 안내 줄');
});

test('로컬 11/24: 진행 업무가 있는 공고가 첨부 없는 다른 공고들에 밀리지 않음 · 상세 응답에 첨부 수집 상태', async () => {
  // 예전: 첨부 없는 K-Startup 공고 전체에서 마감 순 5건을 먼저 고른 뒤 진행 업무가 있는 것만 남겨, 더 늦게 마감하는 진행 공고는 차례가 오지 않았음
  for (let k = 0; k < 6; k++) await ins({ source_id: `KX${k}`, title: `진행하지 않는 공고 ${k}`, apply_end: d(3) });
  const p = await ins({ source_id: 'K1149B', title: '늦게 마감하는 진행 공고', apply_end: d(40) });
  await sql`insert into support_work (tenant, program_id, status, owner_id) values ('default', ${p}, 'preparing', ${ctx.staffA.id})`; // 즉시 채우기 없이(정기 실행만으로)
  const before = await ctx.owner.ok('GET', `/api/sales/support/${p}`);
  assert.deepEqual(before.filesStatus, { checkedAt: null, found: null, error: null }, '아직 안 읽음');
  for (let i = 0; i < 10; i++) { const [x] = await sql`select jsonb_array_length(attachments) n from support_programs where id = ${p}`; if (x.n) break; await tick(); }
  const after = await ctx.owner.ok('GET', `/api/sales/support/${p}`);
  assert.equal(after.attachments.length, 2, '진행 공고의 첨부가 채워짐');
  assert.equal(after.filesStatus.found, 2); assert.ok(after.filesStatus.checkedAt); assert.equal(after.filesStatus.error, null);
  assert.equal((await sql`select count(*)::int n from support_programs where source_id like 'KX%' and raw ? 'files_checked_at'`)[0].n, 0, '진행하지 않는 공고는 읽지 않음');
});

test('#1151·#1152 탭 숫자는 거름 적용 · 관심·준비 탭은 거름과 관계없이 다 보임 · 찾기는 전체 · 거름으로 n건 숨김', async () => {
  const ev = await ins({ source_id: 'K1151', title: '스타트업 밋업 행사 참가자 모집', category: '행사·네트워크' });
  await ctx.owner.ok('POST', `/api/sales/support/${ev}/work`, { status: 'interest' });
  const L = await ctx.owner.ok('GET', '/api/sales/support?tab=mine&kind=space&dd=all&sort=new');
  assert.equal(L.items.length, L.counts.mine, '관심·준비 탭: 숫자와 목록이 같음(거름 무시)');
  assert.ok(L.items.some((x) => x.id === ev), '종류 거름과 관계없이 보임');
  assert.equal(L.chips, null, '진행 탭은 거름 칩 없음');
  const S = await ctx.owner.ok('GET', `/api/sales/support?tab=fit&kind=all&dd=all&q=${encodeURIComponent('밋업')}`);
  assert.ok(S.items.some((x) => x.id === ev) && S.searchAll === true, '찾기는 탭과 관계없이 전체에서(맞춤 탭에서도 진행 중인 공고가 찾아짐)');
  const S2 = await ctx.owner.ok('GET', `/api/sales/support?tab=fit&kind=space&dd=all&q=${encodeURIComponent('밋업')}`);
  if (!S2.items.some((x) => x.id === ev)) assert.ok(S2.filteredOut >= 1, '거름에 걸려 숨으면 숨긴 건수를 알려 줌');
  const A = await ctx.owner.ok('GET', '/api/sales/support?tab=all&kind=space&dd=all&sort=new');
  assert.equal(A.items.length, Math.min(A.counts.all, 60), '다른 탭 숫자 = 거름 적용 값');
  assert.ok(A.filteredOut >= 1, '거름으로 숨긴 건수');
});
