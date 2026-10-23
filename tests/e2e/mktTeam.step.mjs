// #499-7 AI 마케팅팀: 사이드바 'AI 마케팅팀' → 역할 7개 카드(기획 담당 꺼짐) → 켜기 → [오늘 주제 받기](3안·형식·근거·첫 문장 점수) → 반려(사유 칩)
// → 채택(카드뉴스) → 디자인 담당이 만드는 중 → 그려서 승인 대기([열기] = 승인함) → 기억시키기(대표 메모) · 휴대폰 폭
// 가짜 AI 응답(구조 시험) — 실제 주제·카드뉴스 품질은 tests/api/mkt-team.test.mjs·로컬 확인
import assert from 'node:assert/strict';
import { FAKE } from '../helpers.mjs';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const IDEAS = { ideas: [
  { title: '직영 vs 위탁, 우리 단지엔?', hook: '커뮤니티 운영, 직영과 위탁 중 무엇이 맞을까요?', format: 'carousel', pattern: 'vs', product: '커뮤니티 위탁 운영', angle: '입주 앞둔 단지 관리소장', basis: [{ kind: 'season', text: '연말 재계약 시즌' }, { kind: 'competitor', text: '질문형 첫 문장이 많음' }] },
  { title: '입주 3개월 전 체크리스트', hook: '입주가 3개월 남았는데 운영사가 아직 없나요?', format: 'reels', pattern: '', product: '커뮤니티 위탁 운영', angle: '신축 입주 준비 담당', basis: [{ kind: 'goal', text: '신축 문의 늘리기' }] },
  { title: '헬스장 강사가 자주 바뀌는 이유', hook: '강사가 또 바뀌었다는 민원, 이번 달 몇 번째인가요?', format: 'feed', pattern: '', product: '피트니스', angle: '운영 중 단지', basis: [{ kind: 'recent', text: '최근 게시와 겹치지 않음' }] }] };
const SLIDES = [
  { kind: 'cover', title: '직영 vs 위탁,\n우리 단지엔?', body: '입주 3개월 전 가장 많이 받는 질문', rows: [], imagePlan: '단지 커뮤니티 실내 사진' },
  { kind: 'body', title: '같은 시설인데 왜 다를까', body: '운영 방식에 따라\n민원과 비용이 달라져요.', rows: [], imagePlan: '운영 데스크 사진' },
  { kind: 'body', title: '직영의 특징', body: '관리사무소가 직접 인력을 뽑아요.\n결정은 빠르지만 부담이 커요.', rows: [], imagePlan: '' },
  { kind: 'body', title: '위탁 운영의 특징', body: '운영사가 인력과 프로그램을 맡아요.\n관리사무소 일이 줄어요.', rows: [], imagePlan: '' },
  { kind: 'table', title: '유형별 추천', body: '', rows: [['단지 유형', '추천'], ['인력 여유 있음', '직영'], ['인력 부족', '위탁 운영']], imagePlan: '' },
  { kind: 'cta', title: "댓글에 '비교표' 남기면 보내 드려요", body: '도움이 됐다면 저장·팔로우', rows: [], imagePlan: '' }];
const queue = (q) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: q }) });

export async function mktTeam({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 팀 브랜드' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${brand}`, { intro: '아파트 커뮤니티 위탁 운영', products: '커뮤니티 운영·피트니스' });
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'brands', brandIds: [brand] }); // 앞 단계 브랜드는 빼고 이 브랜드만
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/ops`);
  await owner.locator('aside').getByRole('link', { name: 'AI 마케팅팀' }).click();
  await owner.waitForURL(/\/s\/marketing\/team$/);
  const team = owner.getByTestId('team'); await team.getByTestId('team-role').nth(6).waitFor(); // 불러온 뒤
  assert.equal(await team.getByTestId('team-role').count(), 7);
  const planner = team.locator('[data-testid=team-role][data-role=planner]');
  assert.equal(await planner.getAttribute('data-on'), '0', '기획 담당은 기본 꺼짐');
  assert.equal(await team.locator('[data-testid=team-role][data-role=budget] [data-testid=team-role-state]').innerText(), '항상');
  await team.getByTestId('team-ideas-empty').waitFor();
  await planner.getByTestId('team-role-toggle').click();
  await owner.getByText('기획 담당을 켰습니다').waitFor();
  await team.locator('[data-testid=team-role][data-role=planner][data-on="1"]').waitFor();
  // 오늘 주제 받기 → 3안
  await queue([say(IDEAS)]);
  await team.getByTestId('team-ideas-run').click();
  await owner.getByText('오늘 주제 3개를 받았습니다').waitFor();
  const ideas = team.getByTestId('team-idea');
  await ideas.nth(2).waitFor();
  assert.deepEqual(await ideas.evaluateAll((els) => els.map((e) => e.getAttribute('data-format'))), ['carousel', 'reels', 'feed']);
  assert.equal(await ideas.first().getByTestId('team-idea-title').innerText(), '직영 vs 위탁, 우리 단지엔?');
  assert.match(await ideas.first().getByTestId('team-idea-basis').innerText(), /시즌\s*연말 재계약 시즌/);
  await owner.screenshot({ path: `${SHOTS}/234-team-ideas.png` });
  // 반려(사유 칩)
  const feed = ideas.nth(2);
  await feed.getByTestId('team-idea-reject').click();
  await feed.getByRole('button', { name: '시기가 아님' }).click();
  assert.equal(await feed.getByTestId('team-idea-reject-note').inputValue(), '시기가 아님');
  await feed.getByTestId('team-idea-reject-go').click();
  await owner.getByText('반려했습니다 — 사유는 기획 담당이 기억합니다').waitFor();
  await team.locator('[data-testid=team-idea][data-format=feed][data-status=rejected]').waitFor();
  // 채택(카드뉴스) → 디자인 담당 → 그려서 승인 대기
  await queue([say({ slides: SLIDES, caption: "직영 vs 위탁, 우리 단지엔?\n\n세 가지만 비교해 보세요.\n\n댓글에 '비교표' 남기면 보내 드려요.", keyword: '비교표' })]);
  await ideas.first().getByTestId('team-idea-adopt').click();
  await owner.getByText('채택했습니다 — 디자인 담당이 만드는 중입니다').waitFor();
  const res = team.locator('[data-testid=team-idea][data-format=carousel] [data-testid=team-idea-result][data-status=done]');
  await res.waitFor({ timeout: 60_000 });
  assert.match(await res.innerText(), /카드뉴스 6장을 그려 승인 대기로 보냈습니다/);
  assert.equal(await res.getByTestId('team-idea-open').getAttribute('href'), '/s/marketing/approvals');
  // 기억시키기(기획 담당 대표 메모) → 기억 목록(채택·반려 + 메모)
  await planner.getByTestId('team-role-memory').locator('summary').click();
  await planner.getByTestId('team-memory-input').fill("'관리비' 대신 '운영비'라고 씁니다");
  await planner.getByTestId('team-memory-brand').selectOption(brand);
  await planner.getByTestId('team-memory-add').click();
  await owner.getByText('기획 담당이 기억합니다').waitFor();
  await planner.locator('[data-testid=team-memory-item][data-kind=note]').waitFor();
  assert.deepEqual((await planner.getByTestId('team-memory-item').evaluateAll((els) => els.map((e) => e.getAttribute('data-kind')))).sort(), ['adopt', 'note', 'reject']);
  await planner.getByTestId('team-role-records').locator('summary').click();
  await team.getByTestId('team-roles').screenshot({ path: `${SHOTS}/235-team-roles.png` });
  // 휴대폰 폭
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/team`);
  await owner.getByTestId('team-idea').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.screenshot({ path: `${SHOTS}/236-team-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리(뒤 단계의 승인함 건수·정기 점검에 섞이지 않게)
  const [c] = await sql`select content_id from mkt_carousels where brand_id = ${brand} and content_id is not null`;
  if (c) await sql`delete from mkt_contents where id = ${c.content_id}`;
  await sql`delete from mkt_carousels where brand_id = ${brand}`;
  await sql`delete from mkt_briefs where brand_id = ${brand}`;
  await sql`delete from mkt_team_ideas where brand_id = ${brand}`;
  await sql`delete from mkt_team_memory where tenant = (select tenant from mkt_brands where id = ${brand})`;
  await sql`delete from mkt_team_roles where tenant = (select tenant from mkt_brands where id = ${brand})`;
}
