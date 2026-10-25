// #509·#510(대표 10/23 17:30): 당일 공고 메일 — 데이터 설정에서 받는 주소 직접 추가(칩·형식 확인)·보낸 사람 이름·발송 경로 안내 → [오늘 메일 미리보기](680px 표, 휴대폰 폭 넘침 없음) → 메일 제목 링크(?id=)로 공고 상세 바로 열림
import assert from 'node:assert/strict';

export async function digestMail({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const id = '00000000-0000-4000-8000-0000005100e2';
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`delete from sales_src_rows where src_id = ${id}`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, source_type: 'g2b_bid', source_external_id: 'E2E510-001',
    source_url: 'https://www.g2b.go.kr/link/E2E510', title: 'E2E 시험구 국민체육센터 헬스장 위탁운영 용역', issuer: '경기도 시험시', region: '-', fit_business: '다짐', related: true, classification: '즉시 검토',
    notice_kind: 'new', current_status: '공고중', estimated_amount: 0, deadline_at: `${ymd(4)}T17:00:00+09:00`, posted_date: ymd(0), first_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() })}, 'workin')`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/sales/sources`);
  const box = owner.getByTestId('sales-bid-prefs'); await box.waitFor();
  // 받는 주소 직접 추가: 형식 틀리면 안내, 맞으면 칩
  await box.getByTestId('prefs-email-input').fill('메일아님');
  await box.getByTestId('prefs-email-add').click();
  await owner.getByTestId('toast').filter({ hasText: '메일 주소 형식이 아닙니다' }).waitFor();
  await box.getByTestId('prefs-email-input').fill('Office@E2E.test');
  await box.getByTestId('prefs-email-add').click();
  await box.getByTestId('prefs-email-chip').filter({ hasText: 'office@e2e.test' }).waitFor();
  assert.equal(await box.getByTestId('prefs-email-input').inputValue(), '', '추가하면 입력칸 비움');
  await box.getByTestId('prefs-from-name').fill('시험 영업실');
  await box.getByTestId('prefs-save').click();
  await owner.getByTestId('toast').filter({ hasText: '저장했습니다' }).first().waitFor();
  await owner.waitForFunction(() => document.querySelector('[data-testid="prefs-from-name"]')?.value === '시험 영업실');
  const route = box.getByTestId('prefs-mail-route'); await route.waitFor();
  assert.ok((await route.innerText()).length > 10, '발송 경로 안내 한 줄');
  const p = await ctx.owner.ok('GET', '/api/sales/digest/prefs');
  assert.deepEqual([p.prefs.digest_emails, p.prefs.digest_from_name], [['office@e2e.test'], '시험 영업실']);
  await box.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/218-digest-prefs.png`, clip: await box.boundingBox() });
  // 미리보기(보내지 않음): 같은 로그인으로 새 탭
  const [pv] = await Promise.all([owner.context().waitForEvent('page'), box.getByTestId('prefs-preview').click()]);
  await pv.waitForLoadState();
  await pv.setViewportSize({ width: 760, height: 900 });
  await pv.locator('[data-digest-section="now"]').waitFor();
  assert.match(await pv.title(), /^\[시험 영업실\] \d+\/\d+\(.\) 오늘 입찰 \d+건/);
  const item = pv.locator('[data-digest-item]').filter({ hasText: 'E2E 시험구 국민체육센터' });
  assert.match(await item.innerText(), /경기도 시험시 · 경기 · 추정가격 미공개/);
  assert.match(await item.innerText(), /D-4/);
  await pv.screenshot({ path: `${SHOTS}/218-digest-mail.png`, fullPage: true });
  await pv.setViewportSize({ width: 390, height: 844 });
  assert.ok(await pv.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭에서 가로로 넘치지 않음');
  await pv.screenshot({ path: `${SHOTS}/218-digest-mail-390.png`, fullPage: true });
  // 메일 제목 링크 = 워크인 공고 상세
  const href = await item.locator('a').filter({ hasText: 'E2E 시험구 국민체육센터' }).getAttribute('href');
  assert.ok(href.endsWith(`/s/sales/hub?tab=bids&bt=all&id=${id}`), href); // #611: 입찰·공고 화면은 허브 입찰 탭으로
  await pv.close();
  await owner.goto(`${BASE}/s/sales/bids?tab=all&id=${id}`); // 옛 주소(이미 보낸 메일) → 허브 입찰 탭으로 넘김
  await owner.waitForURL(/\/s\/sales\/hub\?tab=bids&bt=all&id=/);
  await owner.getByTestId('bid-detail').waitFor();
  await owner.getByRole('dialog').getByText('E2E 시험구 국민체육센터 헬스장 위탁운영 용역').first().waitFor();
  // #535: 링크로 연 상세의 닫기 = ?id 만 지우고 목록에 남음 → 목록에서 다시 열면 ?id= 기록 → 뒤로가기는 상세만 닫힘
  const qs = () => new URL(owner.url()).searchParams;
  await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await owner.getByTestId('bid-detail').waitFor({ state: 'hidden' });
  await owner.waitForFunction(() => !new URL(location.href).searchParams.has('id'));
  assert.equal(new URL(owner.url()).pathname, '/s/sales/hub');
  await owner.getByTestId('bid-open').filter({ hasText: 'E2E 시험구 국민체육센터' }).first().click();
  await owner.getByTestId('bid-detail').waitFor();
  assert.equal(qs().get('id'), String(id), '목록에서 연 상세는 ?id= 기록');
  await owner.goBack();
  await owner.getByTestId('bid-detail').waitFor({ state: 'hidden' });
  assert.deepEqual([new URL(owner.url()).pathname, qs().get('id'), qs().get('bt')], ['/s/sales/hub', null, 'all'], '뒤로가기 = 공고 상세만 닫힘(허브 입찰 탭 그대로)');
  // 되돌림
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestEmails: [], digestFromName: null });
  await sql`delete from sales_src_rows where src_id = ${id}`;
}
