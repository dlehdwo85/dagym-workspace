// #161 V25 매출 자료 자동 분석: 자료실 매출 자료 → '확인 대기' 카드(지금 값과 다른 칸 노란 줄) → 고쳐서 [확정] → 분석 대기 띠 → [지금 분석]
// → AI 분석 보고서(서버 계산 KPI·동향 표·12개월 선·전망 범위 '추정'·현장별 대안·확인 필요·근거 파일) · 휴대폰 폭 넘침 없음
// 시험 서버는 REVENUE_AUTO=0(자동 감지는 API 시험에서) — 여기서는 감지된 상태(확인 대기 1건)를 DB 에 만들고 화면 흐름을 본다
import assert from 'node:assert/strict';

const addMonth = (p, k) => { const [y, m] = p.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };

export async function revenueAuto({ owner, ctx, BASE, SHOTS, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
  // 지난 6개월 실적(동향·전망 계산용) — 이미 있으면 그대로
  for (let k = 1; k <= 6; k++) {
    const m = addMonth(month, -k) + '-01';
    await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, source) values (${ctx.siteA}, ${m}, ${45000000 - k * 800000}, ${28000000}, 'manual') on conflict (org_unit_id, month) do nothing`;
    await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, source) values (${ctx.siteB}, ${m}, ${13000000 + k * 300000}, ${9000000}, 'manual') on conflict (org_unit_id, month) do nothing`;
  }
  // 이번 달: 앞 단계(W-4)에서 넣었으면 그 값(강남 매출 48,000,000 · 판교 지출 9,000,000), 단독 실행이면 같은 값으로
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, source) values (${ctx.siteA}, ${month + '-01'}, ${48000000}, ${30000000}, 'manual') on conflict (org_unit_id, month) do nothing`;
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, source) values (${ctx.siteB}, ${month + '-01'}, ${12000000}, ${9000000}, 'manual') on conflict (org_unit_id, month) do nothing`;
  // 직원이 자료실에 올린 정산서(근거 파일)
  const data = Buffer.from('현장,매출\n강남,49000000\n');
  const lf = await ctx.staffA.client.ok('POST', '/api/library', { fileName: `${month} 정산.csv`, mimeType: 'text/csv', size: data.length, folder: '' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data });
  await ctx.staffA.client.ok('POST', `/api/library/${lf.id}/complete`);
  const rows = [{ site: '다짐 강남점', month, item: '매출', amount: 49000000 }, { site: '다짐 강남점', month, item: '회원수', amount: 900 }, { site: '하이링크 판교 위탁현장', month, item: '지출', amount: 9500000 }];
  const [imp] = await sql`insert into revenue_imports (tenant, file_id, file_name, detected_by, status, rows, notes, created_by)
    values ('default', ${lf.id}, ${`${month} 정산.csv`}, 'name', 'pending', ${sql.json(rows)}, '판교 매출 칸은 흐려서 못 읽었습니다', ${ctx.staffA.id}) returning id`;

  await owner.goto(BASE + '/revenue');
  const card = owner.getByTestId('revenue-import').first();
  await card.waitFor();
  await card.getByText('AI 메모: 판교 매출 칸은 흐려서').waitFor();
  assert.equal(await card.locator('tr[data-state="changed"]').count(), 2, '지금 실적과 다른 칸(강남 매출 48,000,000·판교 지출 9,000,000) 노란 줄');
  assert.equal(await card.locator('tr[data-state="new"]').count(), 1, '강남 회원 수는 새 값');
  await owner.screenshot({ path: `${SHOTS}/200-revenue-import.png`, fullPage: true });
  // 고쳐서 확정 → 실적 반영 · 분석 대기 띠
  await card.getByLabel('1번째 읽은 값').fill('49500000');
  await card.getByTestId('revenue-import-confirm').click();
  await owner.getByText(/2건을 실적에 반영했습니다/).waitFor();
  const [e] = await sql`select revenue::float8 as revenue, source, source_file_ids from revenue_entries where org_unit_id = ${ctx.siteA} and month = ${month + '-01'}`;
  assert.equal(e.revenue, 49500000, '사람이 고친 값으로 반영'); assert.equal(e.source, 'ai'); assert.deepEqual(e.source_file_ids, [lf.id]);
  assert.equal((await sql`select status from revenue_imports where id = ${imp.id}`)[0].status, 'confirmed');
  const q = owner.getByTestId('revenue-queue');
  await q.getByText(/분석 대기/).waitFor();
  // 10분 기다리지 않고 [지금 분석] → 보고서
  await q.getByTestId('revenue-analyze-now').click();
  const ai = owner.getByTestId('revenue-ai');
  await ai.getByTestId('revenue-report-kind').getByText('자동 분석').waitFor();
  await ai.getByText('AI 제안', { exact: true }).waitFor();
  await ai.getByTestId('revenue-report-kpis').waitFor();
  const trend = ai.getByTestId('revenue-trend');
  await trend.getByRole('img', { name: /다짐 강남점 최근 12개월 매출 추이/ }).waitFor();
  await ai.getByTestId('revenue-forecast').getByText('추정', { exact: true }).waitFor();
  await ai.getByTestId('revenue-actions').waitFor();
  await ai.getByTestId('revenue-checks').waitFor();
  await owner.getByTestId('revenue-queue').waitFor({ state: 'detached' }); // 분석하면 대기 띠가 사라짐
  await owner.screenshot({ path: `${SHOTS}/201-revenue-report.png`, fullPage: true });
  // 근거 파일 링크
  await ai.locator('summary').filter({ hasText: '근거' }).click();
  await ai.getByTestId('revenue-report-files').getByText(`${month} 정산.csv`).waitFor();
  // 휴대폰 폭: 가로 넘침 없음(표는 카드 안에서만 옆으로)
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(BASE + '/revenue');
  await owner.getByTestId('revenue-ai').getByTestId('revenue-trend').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 직원은 매출 자료 확인 화면도 404
  assert.equal((await ctx.staffA.client.get('/api/revenue/auto')).status, 404);
}
