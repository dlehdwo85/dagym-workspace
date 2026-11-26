// 대표 11/27(로컬 — 참가자격 요약 줄이 자격증 급수를 지움 · 다짐은 생활스포츠지도사 1급 보유자 없음):
// ① 요약 줄의 체육 지도 자격은 급수·인원·4대보험·필수를 그대로 — '생활스포츠지도사 1급 1명 이상(필수)', '생활스포츠지도사 2급 이상 5명 이상(4대보험)'
// ② 회사 자격 표(영업 맞춤 설정 — 빈 칸 = 모름)와 공고 요건을 대조해 카드에 '자격 부족: …'(숨기지 않음, 대표 11/07 '공고는 계속 보이게')
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const E = await import('../../src/lib/sales/eligibilityText.ts');
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const plus = (n) => kst(new Date(Date.now() + n * 864e5));
// 실제 공고문 문장 꼴(강화 서희스타힐스 참가자격 라. · 다른 단지 2급 5인 · 1급 또는 2급 + ※ 1급 보유 업체)
const T1 = '가. 자본금 5억원 이상인 업체 나. 최근 5년간 800세대 이상 주민공동시설 5개 이상 운영 완료 실적 라. 생활스포츠지도사 1급 이상의 자격증 소지자를 1인 이상 보유한 업체일 것.';
const T2 = '가. 생활스포츠지도사 2급 이상의 직원 5인 이상(4대보험 가입자)을 보유한 업체';
const T3 = '나. 생활스포츠 지도자 1급 또는 2급 자격을 갖춘 자 1인 이상 ※ 생활스포츠지도사 1급 자격 보유 업체';
let srv, ctx, sql;
const put = async (ext, title, text) => {
  const id = randomUUID();
  const row = { id, source_type: 'kapt_bid', source_external_id: ext, source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${ext}`, title, issuer: '시험단지', facility_name: '시험단지', current_status: '진행중', notice_state: '신규공고', notice_kind: 'new',
    posted_date: plus(-1), deadline_at: `${plus(10)}T17:00:00+09:00`, first_seen_at: new Date().toISOString(), related: true, fit_business: '다짐', matched_keywords: ['주민운동', '위탁운영'], classification: '즉시 검토',
    bid_category: '사업자 - 용역 - 주민운동시설의 위탁', eligibility: { text: `3. 입찰 참가자격\n${text}`, readAt: new Date().toISOString(), file: { name: '입찰공고.hwpx', url: 'https://example.test/f' } } };
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json(row)}, 'workin')`; return id;
};
const card = async (no) => (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => x.noticeNo === no);

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await put('20261125102521799', '[인천] 시험스타힐스 입주민 편의시설 운영업체 선정', T1);
  await put('20261120100000098', '[경기] 시험단지 주민운동시설 위탁운영 업체 선정', T2);
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('요약 줄: 체육 지도 자격 급수·인원·4대보험·필수 그대로(예전: 스포츠지도사 5명 이상 · 스포츠지도사)', () => {
  const line = (t) => E.eligibilityLine(E.eligibilityItems(t), t);
  assert.equal(line(T1), '자본금 5억 이상 · 실적 최근 5년 800세대 이상 주민공동시설 5개 이상 운영 · 생활스포츠지도사 1급 1명 이상(필수)');
  assert.equal(line(T2), '생활스포츠지도사 2급 이상 5명 이상(4대보험)');
  assert.match(line(T3), /생활스포츠지도자 1·2급 1명 이상/);
  assert.match(line('다. 스포츠지도사 소지자 우대(가점)'), /스포츠지도사\(우대\)/);
  assert.equal(line('○ 생활체육지도자 2명 이상 보유, 신용평가등급 BB 이상'), '생활체육지도자 2명 이상 · 신용등급 BB 이상', '예전 이름은 원문 그대로');
});

test('자격 대조(순수 함수): 1급 0명 → 1급 공고만 부족 · 2급 이상은 1·2급 합 · 자본금 · 모르는 칸은 대조 안 함', () => {
  assert.deepEqual(E.qualGaps(T1, { sport1: 0 }), ['생활스포츠지도사 1급 없음']);
  assert.deepEqual(E.qualGaps(T1, { sport1: 0, capitalEok: 3 }), ['생활스포츠지도사 1급 없음', '자본금 5억 미만']);
  assert.deepEqual(E.qualGaps(T2, { sport1: 0 }), [], '2급 인원을 모르면 대조 안 함');
  assert.deepEqual(E.qualGaps(T2, { sport1: 1, sport2: 2 }), ['생활스포츠지도사 2급 이상 2명 부족']);
  assert.deepEqual(E.qualGaps(T2, { sport1: 1, sport2: 4 }), []);
  assert.deepEqual(E.qualGaps(T1, {}), []);
  assert.deepEqual(E.qualGaps('다. 스포츠지도사 1급 소지자 우대(가점)', { sport1: 0 }), [], '우대·가점은 부족으로 안 봄');
});

test('회사 자격 표(영업 맞춤 설정) → 카드 \'자격 부족\' · 공고는 그대로 보임 · 관리자만 바꿈 · 비우면 대조 안 함', async () => {
  assert.equal((await card('20261125102521799')).eligGap, undefined, '자격 표가 비면 표시 없음');
  const r = await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { quals: { sport1: 0 } });
  assert.deepEqual(r.quals ?? r.prefs?.quals, { sport1: 0 });
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs.quals, { sport1: 0 });
  const a = await card('20261125102521799');
  assert.ok(a, '공고는 계속 보임'); assert.equal(a.eligGap, '자격 부족: 생활스포츠지도사 1급 없음'); assert.match(a.elig.line, /생활스포츠지도사 1급 1명 이상\(필수\)/);
  assert.equal((await card('20261120100000098')).eligGap, undefined, '2급 이상 5명 공고는 2급 인원을 몰라 표시 없음');
  // 다른 설정을 저장해도 자격 표는 그대로
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: ['헬스'] });
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs.quals, { sport1: 0 });
  // 직원은 못 바꿈
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/digest/prefs', { quals: { sport1: 3 } })).status, 403);
  // 비우면(모름) 대조 안 함
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { quals: { sport1: null } });
  assert.deepEqual((await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs.quals, {});
  assert.equal((await card('20261125102521799')).eligGap, undefined);
});
