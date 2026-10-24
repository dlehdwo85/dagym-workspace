// #543 영업 공고 [원문] 404(로컬 10/24): 옛 나라장터 입찰공고 주소 → 새 형식(목록·상세·당일 메일 + 저장분 고치기 185 마이그레이션)
// · 바로 가는 주소가 없는 원천(온비드·국방 첫 화면 주소, 옛 사전규격 주소)은 [원문] 대신 '○○에서 공고번호 ○○ 검색' 안내 · 상세 주소가 있는 원천(K-apt)은 그대로
// 새 주소가 실제 나라장터에서 그 공고로 가는지는 로컬 확인(나라장터 로그인을 거침) — 이 시험은 주소 모양만
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const at = (d, hm) => `${d}T${hm}:00+09:00`;
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const ID = (n) => `00000000-0000-4000-8000-000000543${String(n).padStart(3, '0')}`;
const OLD = 'https://www.g2b.go.kr:8081/ep/invitation/publish/bidInfoDtl.do?bidno=R26BK00543001&bidseq=000&releaseYn=Y';
const NEW = 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK00543001&bidPbancOrd=000';
let srv, sql, ctx;
const ins = (n, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n),
  notice_kind: 'new', current_status: '공고중', related: true, fit_business: '다짐', classification: '즉시 검토', posted_date: today, first_seen_at: ago(2), updated_at: ago(2),
  deadline_at: at(plus(6), '10:00'), ...row })}, 'workin')`;

before(async () => {
  await resetDb(); srv = await startServer({ MAIL_DEV: '1', SALES_COLLECT_TEST_BASE: 'http://127.0.0.1:9' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${plus(-1)}, '[]', '{}', 1, 1, ${new Date(at(plus(-1), '08:00'))})`;
  await ins(1, { source_type: 'g2b_bid', source_external_id: 'R26BK00543001-000', source_url: OLD, title: '시험시 체육센터 헬스장 위탁운영 용역', issuer: '시험시' });
  await ins(2, { source_type: 'onbid_lease', source_external_id: '202610-36613-00', notice_no: '202610-36613-00', source_url: 'https://www.onbid.co.kr', title: '시험 스포츠센터 내 매점 사용허가', issuer: '시험구' });
  await ins(3, { source_type: 'd2b_bid', source_external_id: 'F-2026-D-77-1', source_url: 'https://www.d2b.go.kr', title: '부대 체력단련장 위탁 운영', issuer: '국군재정관리단' });
  await ins(4, { source_type: 'g2b_prespec', source_external_id: 'R26BD00543004', source_url: 'https://www.g2b.go.kr/ep/preparation/prestd/preStdDtl.do?preStdRegNo=R26BD00543004', title: '시험 커뮤니티센터 운영 위탁 사전규격', issuer: 'LH' });
  await ins(5, { source_type: 'kapt_bid', source_external_id: 'K543-5', source_url: 'https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=K543-5', title: '[시험] 단지 피트니스 위탁운영', issuer: '시험 단지' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('목록: 옛 나라장터 주소 → 새 형식 · 온비드·국방·옛 사전규격 = 번호 검색 안내 · K-apt 상세 주소는 그대로', async () => {
  const items = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items;
  const by = (t) => { const x = items.find((i) => i.title === t); assert.ok(x, `${t} 없음: ${items.map((i) => i.title).join(' / ')}`); return x; };
  const g = by('시험시 체육센터 헬스장 위탁운영 용역');
  assert.deepEqual([g.url, g.search], [NEW, null]);
  assert.deepEqual(by('시험 스포츠센터 내 매점 사용허가').search, { site: '온비드', home: 'https://www.onbid.co.kr', label: '공고번호', no: '202610-36613-00' });
  assert.deepEqual(by('부대 체력단련장 위탁 운영').search, { site: '국방전자조달', home: 'https://www.d2b.go.kr', label: '공고번호', no: '2026-D-77' }, '시설 F-·차수 -1 을 뗀 공고번호');
  assert.deepEqual(by('시험 커뮤니티센터 운영 위탁 사전규격').search, { site: '나라장터', home: 'https://www.g2b.go.kr', label: '사전규격 등록번호', no: 'R26BD00543004' });
  const k = by('[시험] 단지 피트니스 위탁운영');
  assert.deepEqual([k.url, k.search], ['https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=K543-5', null]);
});

test('당일 메일: 나라장터 [원문] = 새 주소 · 온비드는 [원문] 대신 "온비드에서 공고번호 … 검색"', async () => {
  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body;
  assert.ok(html.includes(`href="${NEW.replace(/&/g, '&amp;')}"`), '새 형식 원문 주소');
  assert.ok(!html.includes('bidInfoDtl.do'), '옛 주소 없음');
  assert.match(html, /<a href="https:\/\/www\.onbid\.co\.kr"[^>]*>온비드<\/a>에서 공고번호 <b>202610-36613-00<\/b> 검색/);
  assert.doesNotMatch(html, /href="https:\/\/www\.onbid\.co\.kr"[^>]*>원문</, '첫 화면 주소를 [원문]으로 걸지 않음');
});

test('185 마이그레이션: 저장된 옛 나라장터 입찰공고 주소만 새 형식으로(차수 순서·포트 무관, 다른 주소는 그대로)', async () => {
  await ins(11, { source_type: 'g2b_bid', source_external_id: 'X-11', source_url: 'https://www.g2b.go.kr/ep/invitation/publish/bidInfoDtl.do?bidseq=01&bidno=20251012345', title: '마이그레이션 시험 1' });
  await ins(12, { source_type: 'onbid_lease', source_external_id: 'X-12', source_url: 'https://www.onbid.co.kr', title: '마이그레이션 시험 2' });
  await ins(13, { source_type: 'g2b_bid', source_external_id: 'X-13', source_url: NEW, title: '마이그레이션 시험 3' });
  await sql.unsafe(readFileSync(new URL('../../db/migrations/185_g2b_new_bid_url.sql', import.meta.url), 'utf8'));
  const u = Object.fromEntries((await sql`select src_id, row->>'source_url' as u from sales_src_rows where src_id in ${sql([ID(1), ID(11), ID(12), ID(13)])}`).map((r) => [r.src_id, r.u]));
  assert.deepEqual([u[ID(1)], u[ID(11)], u[ID(12)], u[ID(13)]], [NEW, 'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=20251012345&bidPbancOrd=01', 'https://www.onbid.co.kr', NEW]);
});
