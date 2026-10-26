// V41 4-2 마케팅 공간: 켜기 → 개요 카드 → 승인 대기에서 새 콘텐츠(시안 없음) → 상세에서 승인하면 거절 안내 → 수정 요청(이유) →
// 캘린더에 칩 → 전화 문의 추가 → [영업 리드로] → 업무 보기 링크 → 끄기
import assert from 'node:assert/strict';
export async function marketing({ owner, BASE, sql, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 전체 실행에서 앞 단계가 남긴 공간 자동 이동(router.replace)과 겹치면 goto 가 ERR_ABORTED → 한 번 더
  for (let k = 0; k < 2; k++) { try { await owner.goto(`${BASE}/admin/users`); break; } catch (e) { if (k) throw e; await owner.waitForTimeout(800); } }
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-marketing').click();
  await owner.getByTestId('space-tabs').waitFor();
  await owner.goto(`${BASE}/s/marketing`);
  await owner.getByTestId('space-home-marketing').waitFor();
  // 로컬 10/19(대표): 홈 — 연결 0개면 '채널 연결 3단계'(계정 있나요? → 없으면 만들기 → [연결]), ① 승인 ② 게시 일정 ③ 성과 ④ 채널, 운영실 버튼 없음
  await owner.getByTestId('mkt-channel-setup').waitFor();
  assert.equal(await owner.getByTestId('marketing-open').count(), 0, '예전 운영실로 가는 버튼 없음');
  await owner.getByTestId('mkt-channel-setup').getByTestId('setup-channel').filter({ hasText: '네이버 검색광고' }).click();
  await owner.getByTestId('setup-no').click();
  assert.equal(await owner.getByTestId('setup-signup').getAttribute('target'), '_blank');
  await owner.getByTestId('home-connect-ads_naver').click();
  await owner.getByTestId('naver-form').waitFor(); // 연결 계정 화면으로 가지 않고 홈에서 바로 입력 창
  await owner.keyboard.press('Escape');
  for (const id of ['mkt-home-now', 'mkt-home-week', 'mkt-home-perf', 'mkt-home-channels']) await owner.getByTestId(id).waitFor();
  assert.equal(await owner.getByTestId('mkt-channel-dot').count(), 8);
  assert.equal(await owner.locator('aside a[aria-current="page"]').first().innerText(), '홈');
  // ⑥ 마케팅 홈 디벨롭(대표 승인 10/20 오후): AI 비서 입력창(라벨 'AI 비서') → 숫자 4칸 → 승인 3 → AI 작업 큐 → 이번 주 7칸 → 성과·광고 → 최근·제안 → 채널. ⚙ 카드 구성으로 끄기·순서
  await owner.getByTestId('mkt-home-chat').waitFor();
  assert.equal(await owner.getByTestId('mkt-home-ask').getAttribute('aria-label'), 'AI 마케터'); // 대표 10/21 12:20: 마케팅 = AI 마케터
  assert.equal(await owner.getByTestId('mkt-kpi').count(), 4);
  assert.equal(await owner.getByTestId('mkt-week-day').count(), 7);
  for (const id of ['mkt-home-queue', 'mkt-home-ads', 'mkt-home-recent', 'mkt-home-suggest']) await owner.getByTestId(id).waitFor();
  await owner.getByTestId('mkt-home-config').click();
  await owner.getByTestId('mkt-card-recent').uncheck();
  await owner.getByTestId('mkt-cards-save').click();
  await owner.getByTestId('mkt-home-recent').waitFor({ state: 'detached' });
  await owner.getByTestId('mkt-home-config').click();
  await owner.getByTestId('mkt-card-recent').check();
  await owner.getByTestId('mkt-cards-save').click();
  await owner.getByTestId('mkt-home-recent').waitFor();
  await owner.setViewportSize({ width: 390, height: 800 });
  await owner.getByTestId('mkt-home-chat').waitFor();
  assert.ok((await owner.getByTestId('mkt-home-kpi').boundingBox()).y > (await owner.getByTestId('mkt-home-chat').boundingBox()).y, '앱: 입력창 → 숫자 순서 한 열');
  assert.equal(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, '가로 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/145-mkt-home-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing`);
  await owner.screenshot({ path: `${SHOTS}/146-mkt-home.png` });
  assert.equal(await owner.evaluate(() => document.documentElement.dataset.space), 'marketing', '공간 강조색 = 마케팅 보라(버튼·모달 공통)');
  await owner.getByRole('link', { name: '승인함' }).first().click(); // #481: 메뉴 이름 '승인함'
  await owner.waitForURL(/\/s\/marketing\/approvals$/);
  if (await owner.getByTestId('ai-ask').count()) assert.equal(await owner.getByTestId('ai-ask').innerText(), 'AI에게 요청', '대표 10/20 5): 콘텐츠 목록 상단 AI 요청 진입점'); // AI 켜진 회사만
  await owner.getByTestId('mkt-new-open').click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  await owner.getByTestId('mkt-title').fill('E2E 가을 행사 게시물');
  await owner.getByTestId('mkt-date').fill(today);
  await owner.getByTestId('mkt-body').fill('가을 행사 안내 캡션');
  await owner.getByTestId('mkt-save').click();
  // 운영실 규칙: 오늘 10:00 게시는 09:00 마감 — 시험 시각이 09시 넘으면 '마감 지남' 접힌 묶음에 있음(빨간 테두리·숫자에서 뺌)
  await owner.getByTestId('mkt-approvals').getByText('E2E 가을 행사 게시물').first().waitFor({ state: 'attached' });
  if (await owner.getByTestId('mkt-late').count()) {
    await owner.getByTestId('mkt-late').locator(':scope > summary').click();
    assert.equal(await owner.getByTestId('mkt-late').getByTestId('approval-card').first().getAttribute('data-late'), 'true');
  }
  await owner.getByTestId('mkt-row').filter({ hasText: 'E2E 가을 행사 게시물' }).click();
  await owner.getByTestId('mkt-decide').waitFor();
  await owner.getByTestId('mkt-approve').click();
  await owner.getByText(/시안/).first().waitFor();
  assert.equal(await owner.getByTestId('mkt-status').textContent(), '승인 대기', '시안 없으면 승인 안 됨');
  await owner.getByLabel('결정 메모').fill('사진을 넣어 주세요');
  await owner.getByTestId('mkt-changes').click();
  await owner.getByTestId('mkt-status').filter({ hasText: '수정 요청' }).waitFor();
  await owner.keyboard.press('Escape');
  await owner.goto(`${BASE}/s/marketing/calendar`);
  // 대표 10/20 16:10 (#105): 주 보기 기본 — 오늘 열 강조, 브랜드 행 × 요일 7열, 카드(상태·시각), [옮기기] 상자로 날짜·시각 이동(같은 주 안에서) → 월 보기 전환
  await owner.getByTestId('mkt-week').waitFor();
  assert.equal(await owner.getByTestId(`mkt-week-col-${today}`).getAttribute('data-today'), '1', '오늘 열 강조');
  const card = owner.getByTestId('mkt-week-card').filter({ hasText: 'E2E 가을 행사 게시물' }).first();
  await card.waitFor();
  assert.equal(await card.getAttribute('data-status'), 'changes');
  const dow = new Date(`${today}T12:00:00+09:00`).getUTCDay(); const delta = dow === 6 ? -1 : 1;
  const target = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.parse(`${today}T12:00:00+09:00`) + delta * 864e5));
  await card.getByTestId('mkt-card-move').click();
  await owner.getByTestId('mkt-move-date').fill(target); await owner.getByTestId('mkt-move-time').fill('14:30');
  await owner.getByTestId('mkt-move-save').click();
  const moved = owner.locator(`[data-testid^="mkt-week-cell-"][data-testid$="-${target}"]`).getByTestId('mkt-week-card').filter({ hasText: 'E2E 가을 행사 게시물' }).first();
  await moved.waitFor();
  assert.match(await moved.innerText(), /14:30/);
  // 채널 행·브랜드 필터·휴대폰 가로 스크롤 폭
  await owner.getByTestId('mkt-cal-axis-channel').click();
  await owner.getByTestId('mkt-week-row-instagram').waitFor();
  await owner.getByTestId('mkt-cal-axis-brand').click();
  await owner.screenshot({ path: `${SHOTS}/181-mkt-calendar-week.png` });
  // 되돌리기(다른 단계가 오늘 날짜 기준) → 월 보기
  await moved.getByTestId('mkt-card-move').click();
  await owner.getByTestId('mkt-move-date').fill(today); await owner.getByTestId('mkt-move-save').click();
  await owner.locator(`[data-testid^="mkt-week-cell-"][data-testid$="-${today}"]`).getByTestId('mkt-week-card').filter({ hasText: 'E2E 가을 행사 게시물' }).first().waitFor();
  await owner.getByTestId('mkt-cal-view-month').click();
  const d = Number(today.slice(8));
  await owner.getByTestId(`mkt-day-${d}`).getByText('E2E 가을 행사 게시물').waitFor();
  await owner.getByTestId('mkt-cal-view-week').click(); // 기본값(주)으로 되돌림(localStorage)
  await owner.goto(`${BASE}/s/marketing/calls`);
  // 로컬 검수 10/17: 하위 메뉴에 있으면 공간 첫 화면(현황)은 같이 강조하지 않음 — 강조는 하나
  await owner.getByTestId('call-phone').waitFor();
  assert.deepEqual(await owner.locator('aside a[aria-current="page"]').allInnerTexts(), ['전화 문의']);
  // 대표 지적(10/18): 공간 메뉴 아래 '공통'(업무·캘린더·메시지·자료실·AI 비서), 공통 메뉴로 가도 마케팅 공간 유지
  await owner.getByTestId('nav-common').waitFor();
  await owner.locator('aside').getByRole('link', { name: '업무', exact: true }).click();
  await owner.waitForURL(/\/tasks/);
  assert.equal(await owner.locator('.app-shell').getAttribute('data-space'), 'marketing');
  await owner.goto(`${BASE}/s/marketing/calls`);
  await owner.getByTestId('call-phone').waitFor();
  await owner.getByTestId('call-phone').fill('010-2222-3333');
  await owner.getByTestId('call-add').click();
  await owner.getByTestId('call-row').filter({ hasText: '010-2222-3333' }).getByTestId('call-convert').click();
  await owner.getByTestId('call-row').filter({ hasText: '010-2222-3333' }).getByRole('link', { name: '영업 업무 보기' }).waitFor();
  // 광고 성과(연결 전): 카드 4·빈 안내·네이버 연결 창(관리자)
  await owner.goto(`${BASE}/s/marketing/ads`);
  await owner.getByTestId('ads-card').first().waitFor();
  assert.equal(await owner.getByTestId('ads-card').count(), 4);
  await owner.getByText('광고 계정을 연결하면 매일 아침 성과가 들어옵니다').waitFor();
  // 대표 10/21 06:30 ①: 월별 보기 기본(월 선택·전월 대비) + AI 마케터 월 분석 블록 → [승인 요청 카드로 보내기] → 승인함 링크
  assert.ok(await owner.getByTestId('ads-month').inputValue(), '이달이 기본');
  await owner.getByTestId('ads-by-provider').waitFor(); await owner.getByTestId('ads-by-brand').waitFor();
  await owner.getByTestId('ads-analysis-run').click();
  await owner.getByTestId('ads-analysis-proposals').waitFor();
  assert.equal(await owner.getByTestId('ads-analysis-proposals').locator('li').count(), 3, '다음 달 제안 3개');
  await owner.screenshot({ path: `${SHOTS}/173-mkt-ads-month.png`, fullPage: true });
  await owner.getByTestId('ads-analysis-card').click();
  await owner.getByTestId('ads-analysis-card-link').waitFor();
  await owner.getByTestId('ads-report-link').waitFor();
  await sql`update mkt_proposals set status = 'rejected', decision_note = 'E2E 정리' where kind = 'analysis' and body->>'adsMonth' is not null`; // 운영실 단계가 빈 보드에서 시작하도록
  // 대표 10/20 14:10 ③: 브랜드·매체 필터·CSV·캠페인 추이·날짜 라벨 — 최근 7일로 바꾸면 '이전 7일 대비'
  await owner.getByTestId('ads-filters').waitFor(); await owner.getByTestId('ads-csv').waitFor();
  await owner.getByTestId('ads-provider-naver').click(); await owner.getByTestId('ads-by-provider').waitFor();
  await owner.getByTestId('ads-provider-all').click();
  await owner.getByTestId('ads-days-7').click(); await owner.getByText('이전 기간(', { exact: false }).first().waitFor(); // 머리줄 '이전 기간(…) 대비' — 숫자가 없어도 보임
  // ① 사이트별 집계 화면(메뉴 '성과' 묶음) — 요약·표·비콘 안내
  await owner.locator('aside').getByRole('link', { name: '사이트별 집계' }).click();
  await owner.getByTestId('mkt-sites').waitFor(); await owner.getByTestId('sites-summary').waitFor(); await owner.getByTestId('sites-snippet').waitFor();
  await owner.getByTestId('sites-table').waitFor(); // 브랜드가 없으면 빈 표(브랜드 줄은 브랜드를 만든 뒤)
  await owner.screenshot({ path: `${SHOTS}/174-mkt-sites.png`, fullPage: true });
  // 로컬 10/23 보안: 안내에 연동 토큰을 브라우저에 넣는 예시가 없어야(서버 경유 + 공개 키만)
  await owner.getByTestId('sites-snippet').locator('summary').click();
  await owner.getByTestId('sites-token-warn').waitFor();
  const guide = await owner.getByTestId('sites-snippet').innerText();
  assert.ok(!/\?k=/.test(guide) && !guide.includes('연동토큰'), '브라우저 코드에 연동 토큰 자리 없음');
  assert.match(await owner.getByTestId('sites-server-code').innerText(), /Bearer \$\{process\.env\.WORKIN_INQUIRY_TOKEN\}/);
  await owner.locator('aside').getByRole('link', { name: '광고 성과' }).click(); await owner.getByTestId('mkt-ads').waitFor(); // 원래 흐름으로
  await owner.getByTestId('ads-days-7').click();
  await owner.getByText('최근 7일', { exact: true }).first().waitFor();
  // 로컬 검수 10/19 → #481(대표 10/23): 사이드바 묶음 계획·제작·게시·성과·설정 · 계정 연결은 게시 › 연결 계정
  assert.deepEqual(await owner.locator('aside').getByTestId('nav-group').allInnerTexts(), ['계획', '제작', '게시', '성과', '설정']);
  await owner.getByTestId('ads-accounts-link').getByRole('link', { name: /연결 계정/ }).click();
  await owner.getByTestId('mkt-connections').waitFor();
  // ⑤-2(대표 10/19): 채널마다 사용·[연결] 하나, 심사 전에는 게시 도우미
  const igRow = owner.getByTestId('publish-channel').and(owner.locator('[data-channel="instagram"]'));
  await igRow.getByTestId('publish-channel-mode').filter({ hasText: '게시 도우미' }).waitFor();
  await igRow.getByTestId('publish-connect-instagram').waitFor();
  await owner.getByTestId('meta-precheck').waitFor();
  // 대표(첫 설치 계정)는 플랫폼 관리자 → 콘솔 등록 값이 보임(고객 회사 관리자에게는 숨김 — API 시험)
  await owner.getByTestId('ads-callbacks').getByText(/\/api\/marketing\/ads\/callback\/meta/).waitFor({ state: 'attached' });
  await owner.getByTestId('ads-callbacks-meta').getByText(/\/api\/marketing\/publish\/callback\/meta/).waitFor({ state: 'attached' }); // 로컬 10/23 #448: Meta OAuth 리디렉션 URI 두 개 다
  for (const re of [/\/api\/marketing\/publish\/callback\/meta/, /\/api\/marketing\/ads\/callback\/meta/]) await owner.getByTestId('publish-tech-oauth').getByText(re).waitFor({ state: 'attached' });
  await owner.getByTestId('publish-tech').getByText(/\/api\/marketing\/publish\/meta\/data-deletion/).waitFor({ state: 'attached' });
  const thRow = owner.getByTestId('publish-channel').and(owner.locator('[data-channel="threads"]'));
  await thRow.getByTestId('publish-channel-mode').filter({ hasText: '꺼짐' }).waitFor();
  await thRow.getByTestId('publish-channel-toggle').check();
  await thRow.getByTestId('publish-channel-mode').filter({ hasText: '게시 도우미' }).waitFor();
  await thRow.getByTestId('publish-channel-toggle').uncheck();
  // 이전 요청 기록(관리자, 옛 이름 운영실 기록): 설정 묶음 메뉴 → 빈 안내
  await owner.locator('aside').getByRole('link', { name: '이전 요청 기록' }).click();
  await owner.getByTestId('ops-history').getByText('옮겨 온 기록이 없습니다').waitFor();
  await owner.goBack(); await owner.getByTestId('mkt-connections').waitFor();
  // #481: 제작의뢰실은 메뉴로(주소 ?tab=studio 그대로) — 누르면 자동 제작 화면의 제작의뢰실 탭
  await owner.locator('aside').getByRole('link', { name: '제작의뢰실' }).click();
  await owner.waitForURL(/\/s\/marketing\/automation\?tab=studio$/);
  await owner.getByRole('heading', { level: 1, name: '제작의뢰실' }).waitFor();
  assert.equal(await owner.locator('aside').getByRole('link', { name: '제작의뢰실' }).getAttribute('aria-current'), 'page', '제작의뢰실 메뉴 강조');
  assert.equal(await owner.locator('aside').getByRole('link', { name: '자동 제작', exact: true }).getAttribute('aria-current'), null, '탭을 보는 동안 자동 제작은 강조 안 됨');
  await owner.locator('aside').getByRole('link', { name: '자동 제작', exact: true }).click();
  await owner.waitForURL(/\/s\/marketing\/automation$/);
  assert.equal(await owner.locator('aside').getByRole('link', { name: '자동 제작', exact: true }).getAttribute('aria-current'), 'page', '주소 칸만 바뀌어도 강조가 따라감');
  // V44 ① 광고 운영: 상한 없으면 안내 → 상한 저장 → 막대 표시(네이버 계정 없으면 새 세팅안 잠김)
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('ad-cap-required').waitFor();
  await owner.getByTestId('ad-cap-input').fill('500000');
  await owner.getByTestId('ad-cap-save').click();
  await owner.getByTestId('ad-cap').getByText('500,000원').waitFor();
  assert.equal(await owner.getByTestId('ad-plan-new').isDisabled(), true);
  await owner.goto(`${BASE}/s/marketing/connections`); await owner.getByTestId('mkt-connections').waitFor();
  await owner.getByTestId('ads-add-naver').click();
  await owner.getByTestId('naver-form').waitFor();
  assert.equal(await owner.getByTestId('naver-steps').locator('li').count(), 3);
  assert.equal(await owner.getByTestId('naver-open-api').getAttribute('target'), '_blank');
  await owner.keyboard.press('Escape');
  // V41 4-3 자동 제작: 사용량 카드 4·요금제 3·규칙 추가(화·목 10:00)
  await owner.goto(`${BASE}/s/marketing/automation`);
  await owner.getByTestId('auto-usage').first().waitFor();
  assert.equal(await owner.getByTestId('auto-usage').count(), 5);
  await owner.getByTestId('auto-plan-standard').waitFor();
  await owner.getByTestId('auto-production').waitFor(); // #103 이번 달 남은 제작(요금제 전에는 안내 문구)
  // 대표 10/24 추가 ①: 우리 회사(본사 조직)는 자동 제작 글을 최상 모델로(193) — 모델·원고 1건 원가 한 줄
  assert.match(await owner.getByTestId('auto-write-model').innerText(), /^글 모델: 최상 모델 \(.+\) · 원고 1건 약 [\d,]+원 — 운영사가 이 회사에 정한 값/);
  await owner.getByTestId('auto-brand-name').fill('E2E 시험 브랜드');
  await owner.getByTestId('auto-brand-add').click();
  await owner.getByTestId('auto-brands').getByText('E2E 시험 브랜드', { exact: true }).waitFor();
  await owner.getByTestId('auto-rule-add').click();
  await owner.getByTestId('auto-rule').first().waitFor();
  // 로컬 검수 10/18 ②: 자동 제작 시안(시험·수정 요청 상태)도 승인 대기에서 눌러 본문·결정 화면이 열림
  const [{ tenant, created_by }] = await sql`select tenant, created_by from mkt_rules limit 1`;
  const [ac] = await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produced_at, is_test, quality)
    values (${tenant}, '[시험] E2E 자동 시안', 'instagram', now() + interval '3 days', 'changes', 1, ${created_by}, 'feed', true, now(), true, ${sql.json({ passed: false, issues: ['채우지 않은 자리표시'], brief: '실사' })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${ac.id}, 1, '자동 본문', ${[]}, 'AI 자동 제작', ${created_by})`;
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-waiting').locator(':scope > summary').click(); // 수정 요청·보류는 '새 버전 기다림' 접힌 묶음(승인 숫자에서 뺌)
  // 대표 재지적 10/20 18:45: 시안 없는 카드에도 회색 '시안 제작 중' 자리 + 본문 [더보기] 글자 버튼, 상세 첫 화면에 게시 화면 미리보기
  const acCard = owner.getByTestId('approval-card').filter({ hasText: 'E2E 자동 시안' });
  await acCard.getByTestId('approval-no-media').waitFor();
  assert.match(await acCard.getByTestId('approval-body-more').innerText(), /더보기/);
  await acCard.getByTestId('approval-body-more').click();
  assert.match(await acCard.getByTestId('approval-body-more').innerText(), /접기/);
  await owner.getByTestId('mkt-row').filter({ hasText: 'E2E 자동 시안' }).click();
  await owner.getByTestId('mkt-preview').getByText('시안 제작 중').waitFor();
  await owner.getByTestId('mkt-detail').getByText('자동 본문').first().waitFor();
  await owner.getByTestId('mkt-decide').waitFor();
  await owner.keyboard.press('Escape');
  // ⑤-1 게시 도우미: 승인된 시험 블로그 글(사진 없음)에도 보임 — 복사·글쓰기 열기·위험 고지
  const [bc] = await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, approved_version, created_by, is_test)
    values (${tenant}, '[시험] E2E 블로그', 'blog', now() + interval '2 days', 'approved', 1, 1, ${created_by}, true) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${bc.id}, 1, '첫 문단', ${[]}, ${created_by})`;
  await owner.goto(`${BASE}/s/marketing/approvals?c=${bc.id}`);
  await owner.getByTestId('publish-helper').waitFor();
  await owner.getByTestId('ph-open-naver').waitFor();
  await owner.getByTestId('ph-risk').waitFor();
  await owner.getByTestId('ph-copy-body').waitFor();
  await owner.keyboard.press('Escape');
  // 상용화 ⑧ 월간 보고(관리자 메뉴): 카드 6·PDF 저장 버튼
  await owner.locator('aside').getByRole('link', { name: '월간 보고' }).click();
  await owner.getByTestId('mkt-report').waitFor();
  assert.equal(await owner.getByTestId('report-card').count(), 10); // 대표 10/20 20:00 ③: 매출 실적·계약 등록·CAC·ROI 4칸 추가
  await owner.getByTestId('report-print').waitFor();
  // 원래대로
  await owner.evaluate(() => localStorage.setItem('wos_space', 'work'));
  await owner.goto(`${BASE}/admin/users`);
  // 대표 10/20 15:00 (#100) 담당자 지정 탭: 영업 원천 '기본' 행에 주 담당 저장 → '지정됨' → 지우기
  await owner.getByTestId('tab-assignees').click();
  const ruleRow = owner.getByTestId('assignee-sales_source').getByTestId('assignee-row').first();
  await ruleRow.getByTestId('assignee-primary').selectOption({ index: 1 });
  await ruleRow.getByTestId('assignee-save').click();
  await owner.getByTestId('assignee-sales_source').getByTestId('assignee-row').first().getByTestId('assignee-set').waitFor();
  await owner.screenshot({ path: `${SHOTS}/182-assignee-rules.png`, fullPage: true });
  await owner.getByTestId('assignee-sales_source').getByTestId('assignee-row').first().getByTestId('assignee-clear').click();
  await owner.getByTestId('assignee-sales_source').getByTestId('assignee-row').first().getByTestId('assignee-set').waitFor({ state: 'detached' });
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-marketing').click();
  await owner.getByTestId('space-tabs').waitFor({ state: 'detached' });
}
