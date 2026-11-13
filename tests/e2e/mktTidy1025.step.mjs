// 400차 #1025(대표 11/13 "한눈에 보기 쉽게" · 노트북 검수 "자동 제작 15,276px · 승인함 알림 카드 4번 반복"):
// 자동 제작 = 보기(현황 / 게시 규칙 / 브랜드 키트 / 설정 / 기록 / 전체) · 개발 이력 문구 없음
// 승인함 운영 제안 = 같은 신호 알림은 한 장('같은 알림 n건 묶음'), 같은 종류의 다른 알림은 [같은 종류 알림 n건 더 보기]로 접힘
import assert from 'node:assert/strict';

export async function mktTidy1025({ owner, ctx, sql, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const made = [];
  const ins = async (title, signal, daysAgo) => made.push((await sql`insert into mkt_proposals (tenant, kind, title, summary, body, source, month, created_at)
    values ('default', 'alert', ${title}, 'E2E 요약', ${sql.json({ signal, level: 'warn', items: [{ title: '제안 조치', detail: '톤 맞춰 다시 만들기' }], rationale: 'E2E 근거' })}, 'template', '2026-11', now() - ${`${daysAgo} days`}::interval) returning id`)[0].id);
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    // ── 자동 제작: 보기 나눔
    await owner.goto(`${BASE}/s/marketing/automation`);
    await owner.getByTestId('auto-views').waitFor();
    assert.equal(await owner.getByTestId('auto-view-now').getAttribute('aria-selected'), 'true', '처음은 현황');
    await owner.getByTestId('auto-usage').first().waitFor();
    assert.equal(await owner.getByTestId('auto-rules').count() + await owner.getByTestId('auto-brands').count() + await owner.getByTestId('auto-schedule').count(), 0, '현황에는 규칙·브랜드 키트·설정 없음');
    const hNow = await owner.evaluate(() => document.scrollingElement.scrollHeight);
    await owner.getByTestId('auto-view-rules').click(); await owner.waitForURL(/automation\?view=rules/); await owner.getByTestId('auto-rules').waitFor();
    assert.equal(await owner.getByTestId('auto-usage').count(), 0);
    await owner.getByTestId('auto-view-brands').click(); await owner.getByTestId('auto-brands').waitFor();
    await owner.getByTestId('auto-view-settings').click(); await owner.getByTestId('auto-schedule').waitFor(); await owner.getByTestId('auto-archive').waitFor();
    await owner.getByTestId('auto-view-log').click(); await owner.getByText('크레딧 원장(최근 30건)').waitFor();
    await owner.getByTestId('auto-view-all').click(); await owner.waitForURL(/view=all/);
    await owner.getByTestId('auto-rules').waitFor(); await owner.getByTestId('auto-brands').waitFor(); await owner.getByTestId('auto-usage').first().waitFor();
    const all = await owner.getByTestId('mkt-automation').innerText();
    assert.ok(!/대표 \d{1,2}\/\d{1,2}/.test(all), `화면에 개발 이력 문구가 남아 있음: ${(all.match(/.{0,20}대표 \d{1,2}\/\d{1,2}.{0,30}/) ?? [''])[0]}`);
    const hAll = await owner.evaluate(() => document.scrollingElement.scrollHeight);
    assert.ok(hNow < hAll * 0.6, `현황 보기(${hNow}px)가 전체(${hAll}px)보다 훨씬 짧아야 함`);
    // 제작의뢰실·카드뉴스 탭에는 보기 줄 없음
    await owner.goto(`${BASE}/s/marketing/automation?tab=studio`); await owner.getByRole('heading', { name: '제작의뢰실' }).waitFor();
    assert.equal(await owner.getByTestId('auto-views').count(), 0);

    // ── 승인함 운영 제안: 같은 알림 묶음
    await ins('E2E 피드 톤 불일치 — 가나 (일관성 40점)', 'feed_tone:e2e-a', 7); await ins('E2E 피드 톤 불일치 — 가나 (일관성 41점)', 'feed_tone:e2e-a', 4);
    await ins('E2E 피드 톤 불일치 — 가나 (일관성 42점)', 'feed_tone:e2e-a', 0); await ins('E2E 피드 톤 불일치 — 다라 (일관성 30점)', 'feed_tone:e2e-b', 1);
    await owner.goto(`${BASE}/s/marketing/approvals?tab=proposals`);
    const g = owner.locator('[data-testid="ops-alert-group"][data-signal="feed_tone"]'); await g.waitFor();
    assert.equal(await g.getAttribute('data-count'), '2', '같은 신호 3장은 1장으로 → 종류 묶음 안에 2장(가나·다라)');
    const top = g.getByTestId('ops-card').first();
    assert.match(await top.getByTestId('ops-card-title').innerText(), /가나 \(일관성 42점\)/, '가장 최근 카드');
    assert.equal(await top.getByTestId('ops-card-same').innerText(), '같은 알림 3건 묶음');
    const more = g.getByTestId('ops-alert-more');
    assert.match(await more.locator('summary').innerText(), /같은 종류 알림 1건 더 보기/);
    assert.equal(await more.getByTestId('ops-card').first().isVisible(), false, '나머지는 접힘');
    await more.locator('summary').click();
    assert.match(await more.getByTestId('ops-card-title').first().innerText(), /다라/);
    // [승인] → 묶인 옛 카드도 함께 닫힘(대기에서 사라짐)
    await top.getByTestId('ops-approve').click();
    await owner.waitForFunction(() => !document.querySelector('[data-testid="ops-card-same"]'), null, { timeout: 15000 });
    const left = await sql`select status from mkt_proposals where id = any(${made}::uuid[]) order by created_at`;
    assert.deepEqual(left.map((r) => r.status), ['done', 'done', 'pending', 'approved'], '옛 2장 닫힘 · 다라는 대기 · 최근 것 승인');
  } finally {
    if (made.length) { await sql`delete from tasks where title like '[마케팅] E2E 피드 톤 불일치%'`.catch(() => {}); await sql`delete from mkt_proposals where id = any(${made}::uuid[])`; }
  }
}
