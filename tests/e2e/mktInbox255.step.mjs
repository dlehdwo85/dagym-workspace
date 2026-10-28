// 255차 #791·#792(로컬 10/29 01:45 대표 '승인 대기가 안 올라온다 · 수정 요청을 남기면 최상 모델이 시안을 만들어 승인함에'):
// 승인함 — 게시일 지난 승인 대기가 '게시일 지남' 띠와 함께 승인할 시안에 → [승인] = 가장 가까운 빈 게시 칸으로 · 영상 다시 만들기 비용 카드([승인하고 제작 요청]·[이미지 카드뉴스로 바꿔 만들기])
// · 처리 안 된 수정 요청 [AI 수정본 만들기] → 수정본 · 휴대폰 폭(390) 넘침 없음 (가짜 AI 구조 시험)
import assert from 'node:assert/strict';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '소식', kickerAlts: [], points: [], left: '', right: '', keyword: '', period: '', prices: [] };

export async function mktInbox255({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 255 브랜드' })).id;
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${brand}`;
  const add = async (title, o) => {
    const [c] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, brand_id, mode)
      values (${tenant}, ${title}, ${o.channel}, ${o.kind ?? null}, now() + make_interval(days => ${o.days}), ${o.status}, 1, ${ctx.ownerId}, false, ${brand}, 'content') returning id`;
    await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${'원래 글입니다.\n두 번째 줄입니다.'}, '{}', '사람이 씀', ${ctx.ownerId})`;
    return c.id;
  };
  const late = await add('E2E 255 게시일 지난 글', { channel: 'threads', days: -3, status: 'pending' });
  const reels = await add('E2E 255 협업툴 릴스', { channel: 'instagram', kind: 'reels', days: 2, status: 'pending' });
  await sql`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status, reason)
    values (${tenant}, ${reels}, 1, 'regen_video', '외국 사람·공사현장 배경 → 한국 사무실·협업툴 화면', 15, 'needs_approval', '다시 만들기 약 15크레딧(약 645~1,050원) · 이번 달 남은 영상 0편 · 재생성 10회 — 승인하면 제작')`;
  const old = await add('E2E 255 예전 수정 요청 글', { channel: 'threads', days: 4, status: 'changes' });
  await sql`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${old}, 1, 'changes', '문장을 더 짧게', ${ctx.ownerId})`;

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-approvable-count').waitFor();
  const tabs = owner.getByTestId('mkt-brand-tabs');
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^E2E 255 브랜드/ }).click();
  const card = (t) => owner.getByTestId('approval-card').filter({ hasText: t }).first();
  // ① 게시일 지난 승인 대기 = 승인할 시안(예전에는 접힌 '마감 지남' 칸·버튼 없음)
  await card('E2E 255 게시일 지난 글').getByTestId('approval-late-band').waitFor();
  assert.match(await card('E2E 255 게시일 지난 글').getByTestId('approval-late-band').innerText(), /^게시일 지남\(원래 .+\) — 승인하면 가장 가까운 빈 게시 칸으로 옮겨 게시합니다$/);
  assert.equal(await card('E2E 255 게시일 지난 글').getByTestId('approval-late-chip').innerText(), '게시일 지남');
  assert.equal(await owner.getByTestId('mkt-late').count(), 0, "접힌 '마감 지남' 칸 없음");
  await card('E2E 255 게시일 지난 글').screenshot({ path: `${SHOTS}/602-approval-late.png` });
  await card('E2E 255 게시일 지난 글').getByTestId('card-approve').click();
  await owner.getByText(/^승인했습니다 — 게시일이 지나 .+ 게시로 옮겼습니다$/).waitFor({ timeout: 15000 });
  const [a] = await sql`select status, scheduled_at from mkt_contents where id = ${late}`;
  assert.equal(a.status, 'approved'); assert.ok(new Date(a.scheduled_at).getTime() > Date.now());
  // ② 영상 다시 만들기 비용 카드 — 이유(크레딧·원·남은 수) · [승인하고 제작 요청] · [이미지 카드뉴스로 바꿔 만들기 · 0크레딧]
  const rc = card('E2E 255 협업툴 릴스');
  await rc.getByTestId('approval-regen-ask').waitFor();
  assert.equal(await rc.getByTestId('approval-regen-reason').innerText(), '다시 만들기 약 15크레딧(약 645~1,050원) · 이번 달 남은 영상 0편 · 재생성 10회 — 승인하면 제작');
  assert.equal(await rc.getByTestId('approval-regen-approve').innerText(), '승인하고 제작 요청 · 약 15크레딧');
  assert.equal(await rc.getByTestId('approval-to-cards').innerText(), '이미지 카드뉴스로 바꿔 만들기 · 0크레딧');
  await rc.screenshot({ path: `${SHOTS}/603-approval-regen-ask.png` });
  await rc.getByTestId('approval-regen-approve').click();
  await owner.getByText('제작을 승인했습니다 — 다시 만든 영상·이미지가 붙으면 승인 요청이 옵니다').waitFor({ timeout: 15000 });
  assert.equal((await sql`select status from mkt_production_requests where content_id = ${reels}`)[0].status, 'open');
  // ③ 처리 안 된 수정 요청 [AI 수정본 만들기] → 수정본 v2 가 승인할 시안으로
  await owner.getByTestId('mkt-waiting').locator(':scope > summary').click();
  const oc = card('E2E 255 예전 수정 요청 글');
  await oc.getByTestId('approval-revise-pending').waitFor();
  assert.match(await oc.getByTestId('approval-revise-pending').innerText(), /수정 요청이 아직 AI 수정본으로 만들어지지 않았습니다 — "문장을 더 짧게"/);
  await oc.screenshot({ path: `${SHOTS}/604-approval-revise-pending.png` });
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [say({ title: 'E2E 255 예전 수정 요청 글', body: '짧게 고친 글.\n두 번째 줄.', brief: '', why: '', hooks: [], keyword: '', card: CARD })] }) });
  await oc.getByTestId('approval-revise-now').click();
  await owner.getByText(/^AI 가 고쳐 다시 올렸습니다 — 수정본 v2/).waitFor({ timeout: 30000 });
  assert.equal((await sql`select status, current_version from mkt_contents where id = ${old}`)[0].current_version, 2);
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 넘침 없음');
  await owner.setViewportSize({ width: 1280, height: 900 });
}
