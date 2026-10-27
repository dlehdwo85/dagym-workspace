// 187차 ⑦ 이번 달 만든 영상 다시 합성(로컬 10/26 16:45 '크레딧 쓴 영상 11편은 새 영상 방식으로 보완'): 제작의뢰실 위 상자(원래 영상·계획·자막 줄·끝 화면 전화)
// → [다시 합성] → 다시 합성됨·승인함 링크·의뢰 카드 '기존 영상 다시 합성' → 휴대폰 폭. 가짜 서버 구조 시험(생성 호출 없음) — 운영 영상으로 확인한 것이 아님
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
const mp4 = (sec, w, h) => spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=24:d=${sec}`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 64 << 20 }).stdout;
async function eventually(fn, n = 50) { for (let i = 0; i < n; i++) { if (await fn()) return; await new Promise((ok) => setTimeout(ok, 200)); } assert.fail('시간 안에 바뀌지 않음'); }

export async function mktVideoReuse({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const upload = async (name, mime, data, folder) => {
    const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder, space: 'marketing' });
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`); return lf.id;
  };
  const [br] = await sql`select id, facts from mkt_brands where tenant = 'default' and name = 'E2E 워크인'`;
  const brand = br?.id ?? (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 워크인' })).id;
  const facts0 = br?.facts ?? null;
  await sql`update mkt_brands set facts = coalesce(facts, '{}'::jsonb) || ${sql.json({ phone: '1600-1234' })} where id = ${brand}`;
  // 10/25 전면 정리로 보관한 한 편짜리 릴스(제작 요청 카드로 붙인 영상 흉내) + 이번 달 영상 원장 줄
  const file = await upload('E2E 한 편짜리 릴스.mp4', 'video/mp4', mp4(5, 1080, 1920), '마케팅');
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by, quality)
    values ('default', ${brand}, 'E2E 릴스 · 한 편짜리 영상', 'instagram', 'reels', 'canceled', 2, ${ctx.ownerId},
      ${sql.json({ archived_from: 'pending', archived_at: new Date().toISOString(), archived_reason: 'E2E 보관', archived_by: ctx.ownerId, script: ['퇴근 전 10분 정리', '할 일은 한 화면에서'] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, '퇴근 전 10분 정리 #워크인', ${[]}, ${ctx.ownerId}), (${c.id}, 2, '퇴근 전 10분 정리 #워크인', ${[file]}, ${ctx.ownerId})`;
  await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values ('default', ${c.id}, 2, 'generate_video', 6.5, '제작 요청 완료', ${ctx.ownerId}, 'E2E 릴스 · 한 편짜리 영상')`;
  try {
    await owner.goto(`${BASE}/s/marketing/automation?tab=studio`);
    const box = owner.getByTestId('studio-reuse'); await box.waitFor();
    assert.equal(await box.evaluate((el) => el.open), true, '다시 합성할 영상이 있으면 펼쳐 둠');
    const row = box.getByTestId('reuse-row').filter({ hasText: 'E2E 릴스 · 한 편짜리 영상' });
    assert.deepEqual([await row.getAttribute('data-status'), await row.getAttribute('data-plan')], ['ready', 'clip']);
    assert.match(await row.getByTestId('reuse-plan').innerText(), /한 편을 장면 2개로 나눠 자막 한 줄씩 · 길이는 합성 때 맞춤/);
    assert.equal(await row.getByTestId('reuse-lines').innerText(), '자막: 퇴근 전 10분 정리 / 할 일은 한 화면에서');
    assert.match(await row.innerText(), /6\.5크레딧 · 끝 화면 '문의 1600-1234'/, '끝 화면 = 홈페이지 주소 대신 브랜드 전화');
    // 앞 단계(#454)에서 장면별로 만든 영상이 있으면 '장면 그대로' 계획
    const v2 = box.locator('[data-testid=reuse-row][data-plan=scenes]');
    if (await v2.count()) assert.match(await v2.first().getByTestId('reuse-plan').innerText(), /장면 4개를 그대로 다시 합성 · 약 14\.8초/);
    assert.equal(await box.getByTestId('reuse-no-narration').count(), 1, '내레이션 키가 없으면 자막만이라고 안내');
    await box.screenshot({ path: `${SHOTS}/529-studio-reuse.png` });
    // [다시 합성] → (시험 서버는 그 자리에서 합성) → 다시 합성됨 · 승인함 링크 · 의뢰 카드
    await row.getByTestId('reuse-start').click();
    await owner.getByText('1편 다시 합성을 시작했습니다 — 끝나면 새 버전으로 승인함에 올라갑니다').first().waitFor({ timeout: 90_000 });
    await eventually(async () => (await row.getAttribute('data-status')) === 'done');
    assert.equal(await row.getByTestId('reuse-open').getAttribute('href'), `/s/marketing/approvals?c=${c.id}`);
    const card = owner.getByTestId('studio-brief').filter({ has: owner.getByTestId('studio-reuse-chip') }).filter({ hasText: 'E2E 릴스 · 한 편짜리 영상' });
    await card.waitFor(); assert.equal(await card.getAttribute('data-status'), 'review');
    const pv = card.getByTestId('studio-video'); await pv.getByTestId('studio-video-file').waitFor();
    assert.match(await pv.innerText(), /이미 만든 영상을 새로 만들지 않고 다시 합성합니다\(생성 크레딧 0\)/);
    assert.equal(await pv.getByTestId('studio-scene').count(), 2, '5초 원본 → 장면 2개');
    assert.equal(await card.getByTestId('studio-prompt').count(), 0, '다시 합성 의뢰는 생성 프롬프트 칸 없음');
    assert.doesNotMatch(await card.innerText(), /예상 0/, '생성 크레딧 0 은 예상 칸에 안 씀');
    const [cc] = await sql`select status, current_version, quality from mkt_contents where id = ${c.id}`;
    assert.deepEqual([cc.status, cc.current_version, 'archived_from' in cc.quality], ['pending', 3, false], '새 버전 승인 대기 · 보관 표시 지움');
    assert.equal((await sql`select count(*)::int n from mkt_credit_ledger where content_id = ${c.id}`)[0].n, 1, '크레딧 원장 그대로');
    await card.screenshot({ path: `${SHOTS}/530-studio-reuse-done.png` });
    // 휴대폰 폭: 가로 넘침 없음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/marketing/automation?tab=studio`); await owner.getByTestId('studio-reuse').waitFor();
    await owner.getByTestId('studio-reuse').evaluate((el) => { el.open = true; });
    const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
    await owner.getByTestId('studio-reuse').screenshot({ path: `${SHOTS}/531-studio-reuse-390.png` });
  } finally {
    // 정리: 뒤 단계(승인함 건수 등)에 영향 없게 시험 글은 휴지통으로, 브랜드 사실 카드는 원래대로
    await sql`update mkt_contents set deleted_at = now() where id = ${c.id}`;
    await sql`update mkt_brands set facts = ${facts0 ? sql.json(facts0) : null} where id = ${brand}`;
    await owner.setViewportSize({ width: 1366, height: 900 });
  }
}
