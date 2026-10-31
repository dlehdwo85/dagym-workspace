// 대표 10/24 추가 ②(로컬 #574): 입찰 같은 제목 — 취소 공고는 원 공고 카드에 '취소'·'M/D 취소 공고', K-apt 재게시는 한 장 '2회 게시(…)'
// → 취소 카드 [취소 확인 · 대상 아님으로](사유) → 전체 탭에서 빠짐 → [대상 아님 n건] 탭(누가·언제·사유) → [되돌리기] → 다시 전체 탭 · 상세 상태 버튼 '대상아님'도 사유를 묻고 [되돌리기]
import assert from 'node:assert/strict';

export async function bidGroups({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const ids = ['E2E-GRP-G1', 'E2E-GRP-G2', 'E2E-GRP-K1', 'E2E-GRP-K2'];
  await sql`delete from sales_src_rows where src_id = any(${ids})`;
  await sql`delete from sales_work_records where ref_id = any(${ids})`;
  const put = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, related: true, fit_business: '다짐', notice_kind: 'new', current_status: '진행중', ...row })})`;
  const SCREEN = 'E2E 묶음 복지관 스크린골프 장비구입 및 설치';
  await put(ids[0], { source_type: 'g2b_bid', source_external_id: 'E2EGRP0001-000', title: SCREEN, issuer: 'E2E시 복지관', posted_date: ymd(-3), first_seen_at: `${ymd(-3)}T09:00:00+09:00`, deadline_at: `${ymd(5)}T10:00:00+09:00` });
  await put(ids[1], { source_type: 'g2b_bid', source_external_id: 'E2EGRP0001-001', title: `[취소공고] ${SCREEN}`, issuer: 'E2E시 복지관', posted_date: ymd(-1), first_seen_at: `${ymd(-1)}T09:00:00+09:00`, deadline_at: `${ymd(5)}T10:00:00+09:00`, notice_kind: 'cancel', current_status: '취소' });
  const CMTY = 'E2E 묶음 커뮤니티센터 통합관리시스템 유지관리 업체 선정';
  await put(ids[2], { source_type: 'kapt_bid', source_external_id: ids[2], title: CMTY, issuer: 'E2E 아파트', posted_date: ymd(-4), first_seen_at: `${ymd(-4)}T09:00:00+09:00`, deadline_at: `${ymd(10)}T17:00:00+09:00` });
  await put(ids[3], { source_type: 'kapt_bid', source_external_id: ids[3], title: CMTY, issuer: 'E2E 아파트', posted_date: ymd(-2), first_seen_at: `${ymd(-2)}T09:00:00+09:00`, deadline_at: `${ymd(10)}T17:00:00+09:00` });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/sales/bids?tab=all&q=${encodeURIComponent('E2E 묶음')}`);
  const list = owner.getByTestId('sales-bids');
  const screen = list.getByTestId('sales-bid').filter({ hasText: '스크린골프' });
  const cmty = list.getByTestId('sales-bid').filter({ hasText: '커뮤니티센터 통합관리' }); await cmty.first().waitFor();
  assert.equal(await cmty.count(), 1, 'K-apt 재게시 한 장');
  assert.equal(await cmty.getByTestId('bid-history-posts').innerText(), `2회 게시(${md(ymd(-4))}·${md(ymd(-2))})`);
  assert.equal(await screen.count(), 0, '278차 #830: 취소 공고는 전체 탭에서 빠짐');
  await list.getByTestId('sales-bids-tab-canceled').click(); await screen.first().waitFor();
  assert.equal(await screen.count(), 1, '취소 공고는 따로 카드로 안 나옴');
  assert.equal(await screen.getByTestId('bid-status').innerText(), '취소');
  assert.equal(await screen.getByTestId('bid-history-cancel').innerText(), `${md(ymd(-1))} 취소 공고`);
  assert.equal(await screen.getByTestId('sales-handoff').count(), 0, '취소 공고는 [넘기기] 대신 [대상 아님으로]');
  await owner.screenshot({ path: `${SHOTS}/256-bid-groups.png` });
  // 취소 카드 → [대상 아님으로](사유) → 전체 탭에서 빠짐
  await screen.getByTestId('bid-skip-open').click();
  await screen.getByTestId('bid-skip-reason-input').fill('취소 공고 확인');
  await screen.getByTestId('bid-skip-go').click();
  await owner.getByText('대상 아님으로 넘겼습니다').first().waitFor();
  await screen.waitFor({ state: 'detached' });
  // [대상 아님 n건] 탭: 누가·언제·사유 → [되돌리기]
  const tab = list.getByTestId('sales-bids-tab-skip');
  assert.match(await tab.innerText(), /^대상 아님 \d+건$/);
  await tab.click();
  const sk = list.getByTestId('sales-bid').filter({ hasText: '스크린골프' }); await sk.waitFor();
  const [{ name }] = await sql`select name from users where id = ${ctx.ownerId}`;
  const line = await sk.getByTestId('bid-skip').innerText();
  assert.ok(line.includes('대상 아님') && line.includes(name), line);
  assert.equal(await sk.getByTestId('bid-skip-reason').innerText(), '· 사유: 취소 공고 확인');
  await owner.screenshot({ path: `${SHOTS}/257-bid-skip-tab.png` });
  await sk.getByTestId('bid-skip-restore').click();
  await owner.getByText('되돌렸습니다').first().waitFor();
  await sk.waitFor({ state: 'detached' });
  await list.getByTestId('sales-bids-tab-canceled').click(); // 되돌리면 다시 '취소된 공고' 탭
  await list.getByTestId('sales-bid').filter({ hasText: '스크린골프' }).waitFor();
  await list.getByTestId('sales-bids-tab-all').click(); await cmty.first().waitFor();
  // 상세 상태 버튼 '대상아님' = 사유를 묻고 넘김 → [되돌리기]
  await cmty.getByTestId('bid-open').click();
  const panel = owner.getByTestId('work-panel'); await panel.waitFor();
  await panel.getByTestId('work-status-대상아님').click();
  await panel.getByTestId('work-skip-reason').fill('우리 업종 아님');
  await panel.getByTestId('work-skip-go').click();
  await panel.getByTestId('work-skipped').waitFor();
  let w = null; // 화면은 누르자마자 바뀌므로 저장은 기록으로 확인
  for (let k = 0; k < 40 && w?.status !== '대상아님'; k++) { [w] = await sql`select status, data from sales_work_records where tenant = 'default' and ref_id = ${ids[3]}`; if (w?.status !== '대상아님') await owner.waitForTimeout(250); }
  assert.deepEqual([w.status, w.data.skip_reason], ['대상아님', '우리 업종 아님'], '카드 = 가장 최근 게시(진행 기록 없음)');
  await panel.getByTestId('work-restore').click();
  await owner.getByText("되돌렸습니다 — '미검토'").first().waitFor();
  assert.equal((await sql`select status from sales_work_records where tenant = 'default' and ref_id = ${ids[3]}`)[0].status, '미검토');
  await owner.keyboard.press('Escape');
  // 휴대폰: 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/sales/bids?tab=all&q=${encodeURIComponent('E2E 묶음')}`);
  await owner.getByTestId('bid-history').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
