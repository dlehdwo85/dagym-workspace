// 범용화 2단계 '용어 사전 구조'(대표 11/13 승인 — 질문 2·3, docs/generalization-audit.md G-04·G-05·G-06·G-07·G-33·G-34·G-68):
// 다짐(기본 회사)은 지금 표현 그대로(대표·본사 관리자·부서 책임자·현장 관리자·직원 / 본사·위탁운영 현장 / 연차 / 회사·단지) — 역할 이름을 바꿀 수 없음
// 다른 회사는 공통 표현(대표·관리자·팀 책임자·지점 관리자·직원 / 회사·사업장 / 휴가 / 회사·지점) + 회사가 정한 역할 이름
// 서버 안내 문구("…에게 요청하세요", "… 이상이 …")·초대 화면·권한 배지 설명·연락처 내려받기 머리글도 같은 사전을 따른다
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T, mate, unitO;
const msg = (r) => String(r.body?.error?.message ?? JSON.stringify(r.body));
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@other-terms.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-terms.test', password: 'signup-pass-1234', name: '박원장', mode: 'team', company: '새싹학원', industry: '교육', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  // 다른 회사 직원 1명(초대 → 합류)
  const units = (await c.ok('GET', '/api/admin/org-units')).units; unitO = units[0].id;
  const inv = await c.ok('POST', '/api/admin/users', { email: 'staff@other-terms.test', name: '김선생', role: 'staff', orgUnitIds: [units[0].id] });
  mate = { c: new Client('staff@other-terms.test'), token: inv.path.split('/').pop() };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('범용화 2단계 용어 사전', () => {
  test('다짐(기본 회사): 지금 표현 그대로 · 역할 이름 바꾸기 400 · 저장한 것이 있어도 읽지 않음', async () => {
    const v = await ctx.owner.ok('GET', '/api/org/terms');
    assert.equal(v.fixed, true);
    assert.deepEqual(v.terms.role, { owner: '대표', admin: '본사 관리자', dept_lead: '부서 책임자', site_manager: '현장 관리자', staff: '직원' });
    assert.deepEqual(v.terms.unit, { hq: '본사', department: '부서', branch: '지점', site: '위탁운영 현장' });
    assert.deepEqual([v.terms.event.vacation, v.terms.event.half_day, v.terms.event.outside, v.terms.event.business_trip, v.terms.contactOrg], ['연차', '반차', '외근', '출장', '회사·단지']);
    // 409차 P1 예시 문구(G-01·G-02·G-03·G-08): 다짐은 지금 예시 그대로
    assert.deepEqual(v.terms.example, { quickTask: '예: 다음 주 금요일까지 김민수 본부장한테 푸르지오 비교 파일 검수받고 보고하라고 해 줘', voiceTask: '금요일까지 김민수 두정점 원판 수량 파악, 중요',
      assistReply: '예: 견적서 첨부해서 관리소장님께 회신 써줘', honorific: '관리소장님', contactTags: '고객, 관리소', aiChip: '3분기 매출 현장별로 엑셀 만들어줘', person: '김민수', profileKey: 'dagym', upperLead: '본부장' });
    assert.equal(v.terms.base, true);
    const r = await ctx.owner.req('PUT', '/api/org/terms', { role: { admin: '점장' } });
    assert.equal(r.status, 400); assert.match(msg(r), /역할 이름은 바꾸지 않습니다/);
    await sql`insert into app_settings (key, value) values ('terms:default', ${sql.json({ role: { admin: '끼어든 이름' } })}) on conflict (key) do update set value = excluded.value`;
    assert.equal((await ctx.owner.ok('GET', '/api/org/terms')).terms.role.admin, '본사 관리자', '기본 회사는 보관 값을 읽지 않음');
    await sql`delete from app_settings where key = 'terms:default'`;
    // 서버 안내 문구·권한 배지 설명·초대 화면도 예전 글자 그대로
    const p = await ctx.staffA.client.req('POST', '/api/projects', { name: '직원이 만드는 프로젝트', orgUnitId: ctx.siteA });
    assert.equal(p.status, 403); assert.equal(msg(p), '프로젝트는 현장 관리자 이상이 만들 수 있습니다');
    const w = await ctx.staffA.client.get('/api/reports');
    assert.equal(w.status, 403); assert.equal(msg(w), '주간 보고는 대표·본사 관리자가 봅니다');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'company', userId: ctx.staffA.id, level: 'view' });
    const e = await ctx.staffA.client.req('PUT', '/api/org/company-profiles', { key: 'dagym', name: '바꾸기 시도' });
    assert.equal(e.status, 403); assert.match(msg(e), /권한이 없습니다\. 대표에게 요청하세요$/);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'company', userId: ctx.staffA.id, level: null });
    assert.equal((await ctx.owner.ok('GET', '/api/org/role-badge')).modeLabels.ko, '한글 (대표 · 본사 관리자 · 부서 책임자 · 현장 관리자 · 직원)');
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'new-site@dagym.test', name: '새매니저', role: 'site_manager', orgUnitIds: [ctx.siteA] });
    assert.equal((await new Client('anon').ok('GET', `/api/invitations/${inv.path.split('/').pop()}`)).roleLabel, '현장 관리자');
    assert.equal((await sql`select role_badge from tenants where id = 'default'`)[0].role_badge, 'en', '다짐 권한 배지 설정은 그대로');
  });

  test('다른 회사: 공통 표현 기본값 · 새 회사 권한 배지는 한글 · 초대 화면·서버 문구가 그 회사 이름으로', async () => {
    const v = await T.c.ok('GET', '/api/org/terms');
    assert.equal(v.fixed, false);
    assert.deepEqual(v.terms.role, { owner: '대표', admin: '관리자', dept_lead: '팀 책임자', site_manager: '지점 관리자', staff: '직원' });
    assert.deepEqual(v.terms.unit, { hq: '회사', department: '부서', branch: '지점', site: '사업장' });
    assert.deepEqual([v.terms.event.vacation, v.terms.contactOrg], ['휴가', '회사·지점']);
    // 409차 P1 예시 문구: 다른 회사에는 다짐 직원 이름·지점·아파트·호칭·'현장'이 든 예시가 없다
    assert.deepEqual(Object.keys(v.terms.example).sort(), ['aiChip', 'assistReply', 'contactTags', 'honorific', 'person', 'profileKey', 'quickTask', 'upperLead', 'voiceTask']);
    assert.ok(!/김민수|본부장|푸르지오|두정점|원판|관리소|현장|매출|dagym/.test(JSON.stringify(v.terms.example)), JSON.stringify(v.terms.example));
    assert.deepEqual([v.terms.base, v.terms.example.person, v.terms.example.profileKey, v.terms.example.upperLead], [false, '홍길동', 'main', '부서장']);
    assert.deepEqual([v.terms.example.honorific, v.terms.example.contactTags], ['김 과장님', '고객, 거래처']);
    assert.deepEqual(v.defaults, v.terms.role); assert.deepEqual(v.custom, {});
    assert.equal((await sql`select role_badge from tenants where id = ${T.tenant}`)[0].role_badge, 'ko', '새 회사는 한글 배지');
    assert.equal((await T.c.ok('GET', '/api/org/role-badge')).modeLabels.ko, '한글 (대표 · 관리자 · 팀 책임자 · 지점 관리자 · 직원)');
    assert.equal((await new Client('anon').ok('GET', `/api/invitations/${mate.token}`)).roleLabel, '직원');
    await mate.c.ok('POST', `/api/invitations/${mate.token}/accept`, { password: 'mate-pass-1234' });
    const p = await mate.c.req('POST', '/api/projects', { name: '직원이 만드는 프로젝트', orgUnitId: unitO });
    assert.equal(p.status, 403); assert.equal(msg(p), '프로젝트는 지점 관리자 이상이 만들 수 있습니다');
    assert.ok(!msg(p).includes('현장'));
  });

  test('역할 이름 바꾸기: 회사 정보 편집 권한만 · 글자 규칙 · 겹치는 이름 400 · 비우면 기본값 · 문구에 바로 반영 · 다짐에는 영향 없음', async () => {
    assert.equal((await mate.c.req('PUT', '/api/org/terms', { role: { staff: '선생님' } })).status, 404, '직원은 회사 정보 메뉴가 없음');
    assert.equal((await T.c.req('PUT', '/api/org/terms', { role: { admin: '<b>관리</b>' } })).status, 400);
    assert.equal((await T.c.req('PUT', '/api/org/terms', { role: { admin: '아주아주아주아주아주긴역할이름' } })).status, 400);
    const dup = await T.c.req('PUT', '/api/org/terms', { role: { admin: '직원' } });
    assert.equal(dup.status, 400); assert.match(msg(dup), /겹칩니다/);
    const r = await T.c.ok('PUT', '/api/org/terms', { role: { owner: '원장', admin: '부원장', site_manager: '분원장', staff: '선생님' } });
    assert.deepEqual(r.terms.role, { owner: '원장', admin: '부원장', dept_lead: '팀 책임자', site_manager: '분원장', staff: '선생님' });
    assert.deepEqual(r.custom.role, { owner: '원장', admin: '부원장', site_manager: '분원장', staff: '선생님' });
    assert.equal(r.terms.capacity['대표'], '원장', "자격 표시의 '대표'도 그 회사 대표 이름");
    const p = await mate.c.req('POST', '/api/projects', { name: '직원이 만드는 프로젝트', orgUnitId: unitO });
    assert.equal(msg(p), '프로젝트는 분원장 이상이 만들 수 있습니다');
    const w = await mate.c.get('/api/reports');
    assert.equal(w.status, 403); assert.equal(msg(w), '주간 보고는 원장·부원장이 봅니다', '받침에 맞는 조사');
    assert.equal((await T.c.ok('GET', '/api/org/role-badge')).modeLabels.ko, '한글 (원장 · 부원장 · 팀 책임자 · 분원장 · 선생님)');
    // 비우면 기본값
    const back = await T.c.ok('PUT', '/api/org/terms', { role: { staff: null, admin: '' } });
    assert.deepEqual([back.terms.role.staff, back.terms.role.admin, back.terms.role.owner], ['직원', '관리자', '원장']);
    // 다짐은 그대로
    assert.equal((await ctx.owner.ok('GET', '/api/org/terms')).terms.role.owner, '대표');
    assert.equal(msg(await ctx.staffA.client.req('POST', '/api/projects', { name: 'x', orgUnitId: ctx.siteA })), '프로젝트는 현장 관리자 이상이 만들 수 있습니다');
    assert.equal((await fetch(`${BASE}/api/org/terms`)).status, 401);
  });

  test('화면에 실리는 용어(세션): 다짐 설정 화면 = 본사 관리자 · 다른 회사 = 바꾼 이름 / 연락처 내려받기 머리글', async () => {
    const page = async (c, path) => String((await c.get(path)).body);
    const d = await page(ctx.owner, '/settings'); const o = await page(T.c, '/settings');
    assert.ok(d.includes('위탁운영 현장') && d.includes('본사 관리자'), '다짐 세션 용어');
    assert.ok(o.includes('원장') && o.includes('사업장') && !o.includes('본사 관리자') && !o.includes('위탁운영 현장'), '다른 회사 세션 용어에 다짐 표현 없음');
  });
});
