// #522 영업 DB 누락 점검: 원천이 2회 연속 실패하거나 24시간 넘게 성공이 없으면 영업 홈 빨간 띠(수집기 보기 링크)
// → 수집기 칸 같은 띠 + 원천별 줄(받은 줄·관련·실패 사유)·첫 줄 칸 이름(값 없이) — 구조 시험(실행 기록을 직접 심음, 실제 원천 응답은 운영 [지금 수집]으로 확인)
import assert from 'node:assert/strict';

export async function collectorAlerts({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const lh = { label: 'LH 입찰공고', ok: true, calls: 2, received: 2, kept: 1, total: 2, keys: ['bidNum', 'bidDegree', 'bidnmKor', 'zoneHqCd', 'presmtPrc', 'fdmtlAmt', 'tndrdocAcptEndDtm', 'openDtm', 'zoneRstrct1', 'zoneRstrct2', 'req1Reqlic1Nm', 'cstrtnJobGbNm'], note: '날짜를 yyyy-MM-dd 로 다시 보냄' };
  const onbid = { label: '온비드 공고(차세대)', ok: false, calls: 1, received: 0, kept: 0, error: '활용신청 필요: SERVICE_KEY_IS_NOT_REGISTERED_ERROR' };
  const agency = sql.json({ sources: { lh_bid: lh, onbid_lease: onbid } });
  const hotel = sql.json({ sources: { tourist_hotels: { label: '관광숙박업', ok: false, calls: 1, received: 0, kept: 0, error: '활용신청 필요(HTTP 401): 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR' } } });
  await sql`insert into sales_collector_runs (slug, trigger, started_at, finished_at, status, errors, summary, error_log, detail) values
    ('public_agency_bids', 'cron', now() - interval '26 hours', now() - interval '26 hours', 'partial', 1, '관련 공고 1건 · 신규 1 · 갱신 0 — LH 입찰공고 받음 2·관련 1 / 온비드 공고(차세대) 실패', 'onbid_lease: 활용신청 필요', ${agency}),
    ('public_agency_bids', 'manual', now() - interval '5 minutes', now() - interval '5 minutes', 'partial', 1, '관련 공고 1건 · 신규 0 · 갱신 1 — LH 입찰공고 받음 2·관련 1 / 온비드 공고(차세대) 실패', 'onbid_lease: 활용신청 필요', ${agency}),
    ('tourist_hotels_localdata', 'cron', now() - interval '30 hours', now() - interval '30 hours', 'failed', 1, '활용신청 필요(HTTP 401): 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR', '활용신청 필요(HTTP 401)', ${hotel})`;

  await owner.setViewportSize({ width: 1366, height: 1000 });
  await owner.goto(`${BASE}/s/sales`);
  const box = owner.getByTestId('space-home-sales').getByTestId('sales-collector-alerts');
  await box.waitFor();
  const lines = await box.getByTestId('sales-collector-alert').allInnerTexts();
  // #629(대표 10/25 21:20): 첫 줄은 '할 일' 문장 — 연속 실패 수·영문 오류 코드·HTTP 코드는 접힘 '자세히'에만, 서비스 번호를 알면 [신청 방법] 링크
  assert.ok(lines.some((l) => /^LH·국방·온비드 공고 › 온비드 공고\(차세대\) — 공공데이터포털 활용신청이 필요합니다/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^관광숙박업\(호텔·리조트\) — 공공데이터포털 활용신청\(서비스 15155090\)이 필요합니다 \[신청 방법\]/.test(l)), `원천 하나뿐인 수집기는 수집기 이름만 + 코드에 적힌 서비스 번호 · ${lines.join('\n')}`);
  assert.ok(!lines.some((l) => /SERVICE_KEY|HTTP ?\d{3}|_ERROR|연속 실패/.test(l)), `접기 전 첫 줄에 원문·코드 없음 · ${lines.join('\n')}`);
  const hotelLine = box.getByTestId('sales-collector-alert').filter({ hasText: '관광숙박업' });
  assert.equal(await hotelLine.getByTestId('sales-collector-alert-link').getAttribute('href'), 'https://www.data.go.kr/data/15155090/openapi.do');
  await hotelLine.getByTestId('sales-collector-alert-more').click();
  assert.match(await hotelLine.getByTestId('sales-collector-alert-detail').innerText(), /최근 성공 없음 · 활용신청 필요\(HTTP 401\): 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR/);
  assert.ok(!lines.some((l) => /LH 입찰공고/.test(l)), '받고 있는 원천(LH 입찰)은 알림 없음');
  await box.screenshot({ path: `${SHOTS}/245-sales-collector-alerts.png` });

  await box.getByRole('link', { name: /수집기 보기/ }).click();
  await owner.waitForURL(/\/s\/sales\/sources/);
  const card = owner.locator('[data-testid="sales-collector"][data-slug="public_agency_bids"]');
  await card.waitFor();
  const srcs = card.getByTestId('sales-collector-sources');
  assert.match(await srcs.locator('[data-source="lh_bid"]').innerText(), /LH 입찰공고: 받음 2줄 · 관련 1 · 날짜를 yyyy-MM-dd 로 다시 보냄/);
  const failed = srcs.locator('[data-source="onbid_lease"]');
  assert.match(await failed.innerText(), /온비드 공고\(차세대\): 실패 — 활용신청 필요/);
  assert.match(await failed.getAttribute('class'), /text-red-700/, '실패 원천은 빨간 줄');
  const keys = srcs.locator('[data-source="lh_bid"] details');
  assert.match(await keys.locator('summary').innerText(), /첫 줄 칸 이름 12개\(값 없이\)/);
  await keys.locator('summary').click();
  assert.match(await keys.getByTestId('sales-collector-keys').innerText(), /bidnmKor.*zoneRstrct1/);
  assert.equal(await owner.getByTestId('sales-collectors').getByTestId('sales-collector-alerts').count(), 1, '수집기 칸에도 같은 띠');
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${SHOTS}/246-sales-collector-sources.png` });
}
