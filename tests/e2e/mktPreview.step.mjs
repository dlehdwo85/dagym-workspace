// #497 R06 '실제 게시 화면처럼': 콘텐츠 상세 미리보기가 채널마다 실제 틀 — 인스타 피드(3장 옆으로 넘기기·n/N·점·2번째 장 보임·해시태그 색·♡ 💬 ✈ 저장)
// · 페이스북(글 위·사진 격자 큰 1 + 작은 2) · 릴스(세로·오른쪽 아이콘 줄·팔로우·음악) · 스레드(옆으로 넘기는 사진 2장) · 블로그(제목·작성자·문단 사이 사진) · 유튜브(16:9·구독) · 휴대폰 손가락 넘기기
// · 프로필 이름 = 연결한 게시 계정(브랜드 계정 먼저) · 승인함 카드 [게시 화면으로 보기](같은 틀)
import assert from 'node:assert/strict';

export async function mktPreview({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 미리보기 브랜드' })).id;
  await sql`update mkt_brands set color = '#0F766E' where id = ${brand}`;
  const { PNG } = await import('./png.mjs');
  const up = async (k, buf) => {
    const lf = await ctx.owner.ok('POST', '/api/library', { fileName: `E2E 미리보기 ${k}.png`, mimeType: 'image/png', size: buf.length, folder: '마케팅', space: 'marketing' });
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: { ...lf.upload.headers, 'content-length': String(buf.length) }, body: buf });
    await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`); return lf.id;
  };
  const media = [];
  for (const [k, col] of [[1, [124, 58, 237]], [2, [37, 99, 235]], [3, [15, 118, 110]]]) media.push(await up(k, PNG(400, 500, col)));
  const mk = async (title, channel, body, mediaIds, kind) => {
    const r = await ctx.owner.ok('POST', '/api/marketing/contents', { title, channel, brandId: brand, body, mediaIds });
    if (kind) await sql`update mkt_contents set kind = ${kind} where id = ${r.id}`;
    return r.id;
  };
  const BODY = '입주 3개월 전, 커뮤니티 운영사 정하셨나요?\n\n운영 방식에 따라 민원과 비용이 달라져요. 세 가지만 확인해 보세요.\n\n#커뮤니티 #아파트';
  const ids = {
    ig: await mk('E2E 미리보기 인스타', 'instagram', BODY, media),
    fb: await mk('E2E 미리보기 페이스북', 'facebook', BODY, media),
    reels: await mk('E2E 미리보기 릴스', 'instagram', BODY, [media[0]], 'reels'),
    th: await mk('E2E 미리보기 스레드', 'threads', '운영사 고를 때 세 가지만 보세요.', media.slice(0, 2)),
    blog: await mk('E2E 미리보기 블로그 — 직영과 위탁 비교', 'blog', '첫 문단입니다.\n\n둘째 문단입니다.\n\n셋째 문단입니다.\n\n넷째 문단입니다.', media),
    yt: await mk('E2E 미리보기 유튜브 영상', 'youtube', '영상 설명입니다. #커뮤니티', [media[0]]),
  };
  const open = async (id, kind) => {
    await owner.goto(`${BASE}/s/marketing/approvals?c=${id}`);
    const pv = owner.getByTestId('mkt-preview'); await pv.waitFor();
    assert.equal(await pv.getAttribute('data-kind'), kind);
    return pv;
  };
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 프로필 이름 = 연결한 게시 계정 @아이디 — 브랜드 계정이 공용 계정보다 먼저(이름순으로는 공용이 앞)
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${brand}`;
  await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, brand_id) values (${tenant}, 'meta_ig', 'e2e-preview-ig', '@e2e_preview', ${brand})`;
  await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, shared) values (${tenant}, 'meta_ig', 'e2e-preview-shared', '@aaa_shared', true)`;
  // 인스타 피드: 3장 → 다음 → 2/3, 2번째 장이 틀 안에 보이고 그림이 실제로 그려짐
  let pv = await open(ids.ig, 'instagram');
  assert.equal(await pv.locator('b').first().innerText(), 'e2e_preview');
  assert.equal(await pv.getByTestId('mkt-preview-slides').getAttribute('data-count'), '3');
  assert.equal(await pv.getByTestId('mkt-preview-counter').innerText(), '1/3');
  assert.equal(await pv.getByTestId('mkt-preview-dots').locator('span').count(), 3);
  await pv.getByTestId('mkt-preview-next').click();
  await pv.getByTestId('mkt-preview-counter').filter({ hasText: '2/3' }).waitFor();
  await owner.waitForFunction(() => { const el = document.querySelector('[data-testid=mkt-preview-slides]'); const s = el?.children[1]; return !!el && !!s && Math.abs(s.getBoundingClientRect().left - el.getBoundingClientRect().left) < 2; });
  assert.ok(await pv.getByTestId('mkt-preview-slide').nth(1).locator('img').evaluate((img) => img.complete && img.naturalWidth > 0), '2번째 장 그림이 보임');
  assert.equal(await pv.getByTestId('mkt-preview-actions').locator('svg').count(), 4);
  // 글: 접힌 상태는 첫 줄 끝에 '... 더 보기'(말줄임 한 번) → 누르면 해시태그까지 · 접기
  const cap = pv.locator('p', { has: owner.getByTestId('mkt-preview-more') });
  assert.equal(await cap.innerText(), 'e2e_preview 입주 3개월 전, 커뮤니티 운영사 정하셨나요? ... 더 보기');
  assert.equal(await pv.locator('span.text-sky-800').count(), 0);
  await pv.screenshot({ path: `${SHOTS}/237-preview-instagram.png` });
  await pv.getByTestId('mkt-preview-more').click();
  await pv.locator('span.text-sky-800', { hasText: '#커뮤니티' }).waitFor();
  assert.equal(await pv.getByTestId('mkt-preview-more').innerText(), '접기');
  // 승인함 카드에서도 같은 틀 — 기본 접힘 → [게시 화면으로 보기] → 3장·계정 이름 → 접기
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-approvable-count').waitFor();
  if (await owner.getByTestId('mkt-more').isVisible()) await owner.getByTestId('mkt-more').click(); // 처음엔 3건만 — 인스타는 맨 먼저 만들어 목록 끝
  const card = owner.getByTestId('approval-card').filter({ hasText: 'E2E 미리보기 인스타' });
  assert.equal(await card.getByTestId('mkt-preview').count(), 0);
  await card.getByTestId('approval-look').click();
  const cpv = card.getByTestId('mkt-preview');
  assert.equal(await cpv.getAttribute('data-kind'), 'instagram');
  assert.equal(await cpv.getByTestId('mkt-preview-slides').getAttribute('data-count'), '3');
  assert.equal(await cpv.locator('b').first().innerText(), 'e2e_preview');
  await owner.setViewportSize({ width: 1366, height: 1300 }); // 카드 전체가 한 화면에(위 고정 머리줄에 안 가리게)
  await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: `${SHOTS}/240-preview-card.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await card.getByTestId('approval-look').click();
  assert.equal(await card.getByTestId('mkt-preview').count(), 0);
  await sql`delete from mkt_publish_accounts where tenant = ${tenant} and external_id in ('e2e-preview-ig', 'e2e-preview-shared')`;
  // 인스타처럼 첫 사진 비율이 모든 장의 틀(정사각 첫 장 → 1:1, 4:5 둘째 장도 같은 높이)
  const sq = await mk('E2E 미리보기 정사각', 'instagram', '정사각 사진이 첫 장', [await up('정사각', PNG(400, 400, [234, 88, 12])), media[1]]);
  pv = await open(sq, 'instagram');
  await owner.waitForFunction(() => { const r = document.querySelector('[data-testid=mkt-preview-slide]')?.getBoundingClientRect(); return !!r && r.height > 0 && Math.abs(r.width / r.height - 1) < 0.02; });
  const [h0, h1] = await pv.getByTestId('mkt-preview-slide').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  assert.equal(h0, h1, '둘째 장도 첫 장 비율');
  // 페이스북: 글이 위, 사진 격자(큰 1 + 작은 2)
  pv = await open(ids.fb, 'facebook');
  assert.equal(await pv.getByTestId('mkt-preview-grid').locator('img').count(), 3);
  assert.ok(await pv.evaluate((el) => { const t = el.querySelector('p'); const g = el.querySelector('[data-testid=mkt-preview-grid]'); return !!t && !!g && t.getBoundingClientRect().top < g.getBoundingClientRect().top; }), '글이 사진보다 위');
  await pv.screenshot({ path: `${SHOTS}/238-preview-facebook.png` });
  // 릴스: 세로·오른쪽 아이콘 줄·팔로우·오리지널 오디오
  pv = await open(ids.reels, 'reels');
  await pv.getByTestId('mkt-preview-side').waitFor();
  await pv.getByText('팔로우').waitFor(); await pv.getByText(/오리지널 오디오/).waitFor();
  await pv.screenshot({ path: `${SHOTS}/239-preview-reels.png` });
  // 스레드: 사진 2장 옆으로
  pv = await open(ids.th, 'threads');
  assert.equal(await pv.getByTestId('mkt-preview-slides').getAttribute('data-count'), '2');
  // 블로그: 제목·작성자·표지 + 문단 사이 사진(3장 모두)
  pv = await open(ids.blog, 'blog');
  await pv.getByText('E2E 미리보기 블로그 — 직영과 위탁 비교').waitFor();
  assert.equal(await pv.locator('img[alt="표지"]').count(), 1);
  assert.equal(await pv.locator('img[alt^="본문 사진"]').count(), 2);
  // 유튜브: 16:9 · 구독
  pv = await open(ids.yt, 'youtube');
  await pv.getByText('구독').waitFor();
  // 휴대폰: 손가락으로 넘기기(가로 스크롤) → n/N 따라감 · 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  pv = await open(ids.ig, 'instagram');
  await pv.getByTestId('mkt-preview-slides').evaluate((el) => el.scrollTo({ left: el.clientWidth * 2 }));
  await pv.getByTestId('mkt-preview-counter').filter({ hasText: '3/3' }).waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리(뒤 단계 승인함 건수에 섞이지 않게)
  await sql`delete from mkt_contents where brand_id = ${brand}`;
}
