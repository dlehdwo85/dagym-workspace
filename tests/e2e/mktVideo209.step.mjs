// 209차 #666 영상 선행 조건: 브랜드 키트 '주인공'(실존 인물은 광고 사용 동의를 표시해야 사진을 고를 수 있음) → 제작의뢰실 릴스(가짜 Higgsfield·가짜 AI)
// → 출연진 고정(장면 첫 사진 → 이미지→영상) · 장면 칩에 광고 문법 자리(훅·상황·해결·결과) · 검수 기준 칩 5개 통과 → 휴대폰 폭. 구조 시험(실제 생성 호출 없음)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
const png = (w, h) => spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=${w}x${h}:d=1`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], { maxBuffer: 32 << 20 }).stdout;
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const I2V = 'kling-video/v3.0-turbo/image-to-video';

export async function mktVideo209({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const upload = async (name, mime, data, folder) => {
    const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder, space: 'marketing' });
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`); return lf.id;
  };
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf` });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
  const before = (await ctx.owner.ok('GET', '/api/platform/higgsfield')).models;
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { models: [...before.filter((m) => m.id !== I2V).map((m) => (m.id === 'higgsfield-ai/soul/v2/standard' ? { ...m, ref: 'image_url' } : m)), { id: I2V, kind: 'video', name: 'Kling 3 Turbo 이미지→영상', credits: 80, usd: 0.12, enabled: true, ref: 'image_url' }] });
  try {
    const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E209 브랜드' })).id;
    const logo = await upload('E2E209 로고.png', 'image/png', png(600, 200), '마케팅');
    await upload('E2E209 주인공.png', 'image/png', png(600, 800), '마케팅');
    const cap = await upload('E2E209 앱 화면.png', 'image/png', png(1170, 2532), '영상 화면 캡처/E2E209 브랜드');
    await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${brand}`, { video: { logoFileId: logo, headline: '한 화면에서 끝' }, facts: { phone: '02-555-0209' } });
    // 브랜드 키트: 실존 인물 → 동의 표시 전에는 사진 고르기 없음 → 동의 → 자료실에서 주인공 사진 → '실존 인물 · 광고 사용 동의 날짜'
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/marketing/automation`);
    const castBox = owner.getByTestId('brand-video-E2E209 브랜드').getByTestId('brand-video-cast'); await castBox.waitFor();
    await castBox.getByTestId('brand-video-cast-kind').selectOption('real');
    assert.equal(await castBox.getByTestId('media-pick').count(), 0, '동의 표시 전에는 사진을 고를 수 없음');
    await castBox.getByTestId('brand-video-cast-consent').check();
    await castBox.getByTestId('media-pick-open').click();
    await castBox.getByLabel('시안 검색').fill('E2E209 주인공'); await castBox.getByLabel('시안 검색').press('Enter');
    await castBox.getByRole('button', { name: 'E2E209 주인공' }).first().click();
    await castBox.getByTestId('brand-video-cast-kind-label').getByText(/실존 인물 · 광고 사용 동의 \d{4}-\d{2}-\d{2}/).waitFor();
    await castBox.getByTestId('brand-video-cast-en').fill('a Korean man in his 40s, short hair, grey knit');
    await castBox.getByTestId('brand-video-cast-en').blur();
    for (let i = 0; i < 30 && (await sql`select video->>'castEn' as v from mkt_brands where id = ${brand}`)[0].v !== 'a Korean man in his 40s, short hair, grey knit'; i++) await owner.waitForTimeout(200);
    const [kit] = await sql`select video from mkt_brands where id = ${brand}`;
    assert.deepEqual([kit.video.castKind, !!kit.video.castConsentAt, kit.video.castEn], ['real', true, 'a Korean man in his 40s, short hair, grey knit']);
    await owner.getByTestId('brand-video-E2E209 브랜드').screenshot({ path: `${SHOTS}/554-brand-video-cast.png` });
    // 제작의뢰실: 출연진 고정 릴스(AI 는 장면 자리를 섞어 줌 → 훅·해결·상황·결과로 정리, 실제 화면은 브랜드 폴더 캡처)
    await ctl({ hfReset: true, hfPolls: 0, hfMode: null, ttsReset: true, anthropicReset: true, anthropicQueue: [
      say({ promptEn: 'A calm Korean office story.', negativeEn: 'english signage', summaryKo: '퇴근 전 10분', caption: '퇴근 10분 전, 할 일이 한 화면에', refMediaIds: [],
        fields: { who: 'a Korean man', where: 'Seoul office', action: 'checks phone', emotion: 'from tense to relieved', lens: '35mm', angle: 'eye-level', movement: 'slow push-in', light: 'daylight', props: ['phone'] },
        character: 'AI', look: 'bright daylight', endCard: { headline: '한 화면에서 끝', cta: '' }, bgmId: '',
        scenes: ['hook', 'solution', 'situation', 'hook'].map((beat, k) => ({ beat, line: ['오늘 할 일, 어디 적어 두셨어요?', '이제 한 화면에서 바로 확인', '팀원 일을 하나씩 묻던 날', '오늘도 제시간에 퇴근'][k], visualEn: `Shot ${k + 1} in a bright Seoul office.`, seconds: k < 2 ? 4 : 3, screenMediaId: '', device: 'none' })) }),
      say({ scenes: [1, 2, 3, 4].map((scene) => ({ scene, foreignText: false, nonKorean: false, westernSetting: false, broken: false, frontFace: scene === 1 || scene === 4, issues: [] })) })] });
    const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: brand, kind: 'reels', purpose: 'awareness', message: 'E2E209 출연진 고정 릴스', quantity: 1 });
    assert.equal(r.prompt.scenes[1].screen?.mediaId, cap);
    await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
    await owner.goto(`${BASE}/s/marketing/automation?tab=studio`);
    const card = owner.getByTestId('studio-brief').filter({ hasText: 'E2E209 출연진 고정 릴스' }); await card.waitFor();
    for (let i = 0; i < 60 && (await card.getAttribute('data-status')) !== 'review'; i++) {
      await owner.waitForTimeout(1000);
      if (i % 3 === 2) { const b = card.getByRole('button', { name: '상태 확인' }); if (await b.count()) await b.first().click().catch(() => {}); }
    }
    assert.equal(await card.getAttribute('data-status'), 'review', '승인 대기');
    const v = card.getByTestId('studio-video'); await v.waitFor();
    await v.getByTestId('studio-cast').getByText('출연진 고정').waitFor();
    const chips = v.getByTestId('studio-scene');
    assert.deepEqual(await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-beat'))), ['hook', 'solution', 'situation', 'result']);
    assert.match(await chips.nth(0).innerText(), /장면 1 훅/); assert.match(await chips.nth(1).innerText(), /장면 2 해결[\s\S]*실제 화면/); assert.match(await chips.nth(3).innerText(), /장면 4 결과/);
    assert.deepEqual(await v.getByTestId('studio-checks').locator('[data-ok]').evaluateAll((els) => els.map((e) => e.getAttribute('data-ok'))), ['true', 'true', 'true', 'true', 'true']);
    assert.equal(await v.getByTestId('studio-review').count(), 0);
    assert.deepEqual(await card.getByTestId('quality-timing-beat').allInnerTexts(), ['훅', '해결', '상황', '결과'], '장면 구성표에도 광고 문법 자리');
    await v.getByTestId('studio-video-file').waitFor();
    await card.screenshot({ path: `${SHOTS}/555-studio-video-checks.png` });
    // 휴대폰 폭: 가로 넘침 없음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/marketing/automation?tab=studio`); await owner.getByTestId('studio-checks').first().waitFor();
    const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('PUT', '/api/platform/higgsfield', { models: before }).catch(() => {});
    await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: false }).catch(() => {});
  }
}
