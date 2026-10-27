// 215차(#530 로컬 10/24 21라인 실메일 대조 ①~⑨): 당일 공고 메일 미리보기 — 받은 기간 · 맞춤 조건 상자 · 금액 나눔(기초금액·추정가격·배정예산) · 지역 제한 + 본사 기준 참가 가능/불가 ·
// 일정 줄(현장설명 → 참가신청마감 → 입찰마감 → 개찰) · 배지(수의계약·현장설명·낙찰) · 구역 안 사업별 묶음 · 낙찰률·참가 수 · 휴대폰 폭 넘침 없음
// + 주의(로컬 10/24): 정기 시각 전 [지금 보내기] = '나에게 시험 발송'(오늘 기록 없음 → 정기 메일 그대로)
import assert from 'node:assert/strict';

export async function digest215({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const at = (n, hm) => `${ymd(n)}T${hm}:00+09:00`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  // 관심 사업 2개(있는 사업은 그대로 두고 더함) · 본사 경기 용인시(회사 프로필의 다른 칸은 그대로)
  const cats = (await ctx.owner.ok('GET', '/api/sales/business-categories')).items.filter((c) => c.active);
  const add = [{ key: 'e2e215-a', name: 'E2E사업A', color: '#2563EB', keywords: ['E2E215운동'] }, { key: 'e2e215-b', name: 'E2E사업B', color: '#DC2626', keywords: ['E2E215출입'] }].filter((a) => !cats.some((c) => c.key === a.key));
  if (add.length) await ctx.owner.ok('PUT', '/api/sales/business-categories', { items: [...cats.map((c) => ({ key: c.key, name: c.name, color: c.color, keywords: c.keywords })), ...add] });
  const pf = (await ctx.owner.ok('GET', '/api/sales/support/profile')).profile;
  if (pf.region_sido !== '경기' || pf.region_sigungu !== '용인시') await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: pf.founded ?? null, size: pf.size ?? null, employees: pf.employees ?? null,
    revenueKrw: pf.revenue_krw ?? null, industries: pf.industries ?? [], keywords: pf.keywords ?? [], certs: pf.certs ?? [], brands: pf.brands ?? [], interests: pf.interests ?? [], excludes: pf.excludes ?? [], memo: pf.memo ?? null });
  const now = new Date().toISOString();
  const ins = async (n, row) => { const id = `00000000-0000-4000-8000-000000215e${String(n).padStart(2, '0')}`; await sql`delete from sales_src_rows where src_id = ${id}`;
    await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', fit_business: '다짐', related: true, classification: '즉시 검토', notice_kind: 'new', current_status: '공고중',
      bid_category: '용역', posted_date: ymd(0), first_seen_at: now, updated_at: now, source_url: `https://www.g2b.go.kr/link/E2E215-${n}`, source_external_id: `E2E215-${n}-000`, ...row })}, 'workin')`; };
  await ins(1, { title: 'E2E215운동 시설 위탁운영 서울 제한', issuer: '서울특별시 시험구', region: '서울특별시', region_restriction: '서울특별시', estimated_amount: 50000000,
    site_briefing_at: at(2, '10:00'), participation_deadline_at: at(3, '18:00'), deadline_at: at(4, '10:00'), opening_at: at(4, '11:00') });
  await ins(2, { title: 'E2E215운동 시설 위탁 경기 제한', issuer: '경기도 시험시', region: '경기도', region_restriction: '경기도', base_amount: 100000000, estimated_amount: 90909091, budget_amount: 100000000, contract_method: '수의계약', deadline_at: at(4, '15:00') });
  await ins(3, { title: 'E2E215출입 통제 시스템 구축', fit_business: '하이링크', issuer: '시험 관리사무소', deadline_at: at(5, '10:00') });
  await ins(4, { title: 'E2E215 체육관 위탁운영 결과', current_status: '낙찰', winner_name: 'E2E낙찰(주)', winner_amount: 120000000, winner_rate: 88.1, bidders: 7, award_date: ymd(0), result_at: now, first_seen_at: new Date(Date.now() - 30 * 864e5).toISOString(), deadline_at: at(-3, '10:00') });

  await owner.setViewportSize({ width: 760, height: 900 });
  await owner.goto(`${BASE}/api/sales/digest?preview=html`);
  await owner.locator('[data-digest-section="now"]').waitFor();
  assert.match(await owner.locator('[data-digest-period]').innerText(), /^받은 기간 \d+\/\d+\(.\) \d{2}:\d{2} ~ \d+\/\d+\(.\) \d{2}:\d{2}$/);
  const cond = await owner.locator('[data-digest-cond]').innerText();
  assert.ok(/^맞춤 조건/.test(cond) && cond.includes('E2E사업A·E2E사업B') && cond.includes('본사 경기 용인시') && cond.includes('바꾸기'), cond);
  const row = (t) => owner.locator('[data-digest-item]').filter({ hasText: t });
  const r1 = await row('E2E215운동 시설 위탁운영 서울 제한').innerText();
  assert.ok(r1.includes('지역 제한 서울 — 참가 불가(본사 경기 용인시)') && r1.includes('현장설명') && /일정\s*현장설명 .+ · 참가신청마감 .+ · 입찰마감 .+ · 개찰 /.test(r1), r1);
  const r2 = await row('E2E215운동 시설 위탁 경기 제한').innerText();
  assert.ok(r2.includes('기초금액 1억 · 추정가격 9,091만원 · 배정예산 1억') && r2.includes('지역 제한 경기 — 참가 가능') && r2.includes('수의계약'), r2);
  const r4 = await row('E2E215 체육관 위탁운영 결과').innerText();
  assert.ok(r4.includes('낙찰 E2E낙찰(주) · 낙찰금액 1.2억 · 낙찰률 88.1% · 참가 7곳'), r4);
  assert.ok(await owner.locator('[data-digest-group]').count() >= 2, '구역 안 사업별 묶음 머리');
  const head = await owner.locator('[data-digest-head]').boundingBox(); const cb = await owner.locator('[data-digest-cond]').boundingBox();
  await owner.screenshot({ path: `${SHOTS}/564-digest-215-head.png`, clip: { x: 0, y: 0, width: 760, height: Math.ceil(cb.y + cb.height - 0) + 16 } });
  const i1 = await row('E2E215운동 시설 위탁운영 서울 제한').boundingBox(); const i2 = await row('E2E215운동 시설 위탁 경기 제한').boundingBox();
  await row('E2E215운동 시설 위탁운영 서울 제한').scrollIntoViewIfNeeded();
  await row('E2E215운동 시설 위탁운영 서울 제한').screenshot({ path: `${SHOTS}/565-digest-215-item.png` });
  assert.ok(head && i1 && i2);
  // 휴대폰 폭: 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭에서 가로로 넘치지 않음');
  await row('E2E215운동 시설 위탁 경기 제한').scrollIntoViewIfNeeded();
  await row('E2E215운동 시설 위탁 경기 제한').screenshot({ path: `${SHOTS}/566-digest-215-390.png` });

  // 주의: 정기 시각 전이면 [지금 보내기] = '나에게 시험 발송'(오늘 기록 없음 → 정기 메일 그대로)
  const kh = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
  if (kh >= 23) return; // 서울 23시 — 정기 시각 전을 만들 수 없음(서버 시험에서 확인)
  const prev = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs.digest_hour;
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestHour: 23 });
  await sql`delete from sales_digests where tenant = ${tenant} and day = ${ymd(0)}`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/sources`);
    const btn = owner.getByTestId('prefs-send-now'); await btn.waitFor();
    assert.equal((await btn.innerText()).trim(), '나에게 시험 발송'); assert.match(await btn.getAttribute('title'), /정기 시각\(23:00\) 전이라 나에게만 시험으로 보냅니다/);
    await btn.click();
    await owner.getByTestId('toast').filter({ hasText: '시험 발송 — 나에게 메일' }).filter({ hasText: '오늘 23:00 정기 메일은 그대로 갑니다' }).first().waitFor();
    assert.equal((await sql`select count(*)::int n from sales_digests where tenant = ${tenant} and day = ${ymd(0)}`)[0].n, 0, '시험 발송은 오늘 기록을 남기지 않음');
  } finally { await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestHour: prev }); }
}
