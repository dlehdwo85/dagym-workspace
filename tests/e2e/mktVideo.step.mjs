// #454 영상 제작 파이프라인 v2: 플랫폼 운영 '영상 내레이션(TTS)' 카드(연결 시험) → 브랜드 키트 '영상 끝 화면·자막'(CTA·한 줄) → 제작의뢰실 릴스(준비 상태 줄)
// → [생성] → 장면 칩(실제 화면·검수 ✓) → 승인 대기 + 완성 영상 → 휴대폰 폭. 가짜 Higgsfield(작은 진짜 mp4)·가짜 TTS·가짜 AI = 구조 시험
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fakeMp3 } from '../fake-google.mjs';

const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
const png = (w, h) => spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=${w}x${h}:d=1`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], { maxBuffer: 32 << 20 }).stdout;
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });

export async function mktVideo({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const upload = async (name, mime, data, folder) => {
    const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder, space: 'marketing' });
    await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`); return lf.id;
  };
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 플랫폼 운영: 내레이션 공급자(시험은 가짜 OpenAI 형식 주소)
  await ctx.owner.ok('PUT', '/api/platform/tts', { provider: 'openai', apiKey: 'test-tts-key', base: `${FAKE}/openai/v1` });
  await owner.goto(`${BASE}/platform`);
  const tts = owner.getByTestId('platform-tts'); await tts.waitFor();
  await tts.getByTestId('tts-state').getByText('켜짐 · OpenAI').waitFor();
  await tts.getByTestId('tts-test').click();
  await tts.getByTestId('tts-test-result').getByText(/연결됨/).waitFor();
  await tts.screenshot({ path: `${SHOTS}/210-platform-tts.png` });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf` });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
  // 브랜드·자료실(로고·실제 화면 캡처·배경음)
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 워크인' })).id;
  const logo = await upload('E2E 워크인 로고.png', 'image/png', png(600, 200), '마케팅');
  const cap = await upload('E2E 홈 화면 캡처.png', 'image/png', png(1170, 2532), '영상 화면 캡처');
  await upload('E2E 밝은 피아노.mp3', 'audio/mpeg', fakeMp3(20, 262), '영상 배경음');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${brand}`, { video: { logoFileId: logo, endColor: '#0F766E' } });
  // 브랜드 키트 화면: 끝 화면 한 줄·CTA
  await owner.goto(`${BASE}/s/marketing/automation`);
  const kit = owner.getByTestId('brand-video-E2E 워크인'); await kit.waitFor();
  await kit.getByTestId('brand-video-headline').fill('일은 한 화면에서'); await kit.getByTestId('brand-video-headline').blur();
  await owner.getByText('영상 키트를 저장했습니다').first().waitFor();
  await kit.getByTestId('brand-video-cta').fill('14일 무료 체험 · work-in.dev'); await kit.getByTestId('brand-video-cta').blur();
  await assertEventually(async () => (await sql`select video from mkt_brands where id = ${brand}`)[0].video.cta === '14일 무료 체험 · work-in.dev');
  assert.deepEqual((await sql`select video from mkt_brands where id = ${brand}`)[0].video, { logoFileId: logo, endColor: '#0F766E', headline: '일은 한 화면에서', cta: '14일 무료 체험 · work-in.dev' });
  await kit.screenshot({ path: `${SHOTS}/211-brand-video-kit.png` });
  // 제작의뢰실: 릴스 → 준비 상태 줄 → 의뢰(가짜 AI 장면 설계) → [생성](가짜 검수 통과) → 승인 대기 + 완성 영상
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null, ttsReset: true, anthropicReset: true, anthropicQueue: [say({ promptEn: 'A calm Korean office story about finishing the day with one app.', negativeEn: 'english signage', summaryKo: '퇴근 전 10분', caption: '퇴근 10분 전, 할 일이 한 화면에', refMediaIds: [],
    character: 'a Korean woman in her early 30s, navy blazer', look: 'warm late-afternoon light',
    scenes: [{ line: '퇴근 10분 전, 오늘 할 일이 한 화면에', visualEn: 'Medium close-up at a bright Seoul office desk, slow push-in.', seconds: 4, screenMediaId: '', device: 'none' },
      { line: '팀원이 무엇을 하는지 바로 보여요', visualEn: 'Soft background: a tidy desk by the window.', seconds: 4, screenMediaId: cap, device: 'phone' },
      { line: '승인도 휴대폰에서 끝', visualEn: 'Close-up of a thumb tapping a phone, screen glow only.', seconds: 3, screenMediaId: '', device: 'none' },
      { line: '오늘도 제시간에 퇴근', visualEn: 'Wide shot, she leaves the office smiling at golden hour.', seconds: 3, screenMediaId: '', device: 'none' }],
    endCard: { headline: '일은 한 화면에서', cta: '14일 무료 체험' }, bgmId: '' }),
  say({ scenes: [1, 2, 3, 4].map((scene) => ({ scene, foreignText: false, nonKorean: false, westernSetting: false, broken: false, issues: [] })) })] });
  await owner.goto(`${BASE}/s/marketing/automation?tab=studio`);
  await owner.getByTestId('mkt-studio').waitFor();
  await owner.getByTestId('studio-brand').selectOption({ label: 'E2E 워크인' });
  await owner.getByTestId('studio-kind').selectOption('reels');
  await owner.getByTestId('studio-video-ready').getByText(/내레이션 OpenAI · 실제 화면 캡처 1장/).waitFor();
  await owner.getByTestId('studio-message').fill('E2E 퇴근 전 10분 릴스');
  await owner.getByTestId('studio-submit').click();
  const card = owner.getByTestId('studio-brief').filter({ hasText: 'E2E 퇴근 전 10분 릴스' }); await card.waitFor();
  await card.getByTestId('studio-generate').click();
  for (let i = 0; i < 60 && (await card.getAttribute('data-status')) !== 'review'; i++) {
    await owner.waitForTimeout(1000);
    if (i % 3 === 2) { const b = card.getByRole('button', { name: '상태 확인' }); if (await b.count()) await b.first().click().catch(() => {}); }
  }
  assert.equal(await card.getAttribute('data-status'), 'review', '승인 대기');
  const v = card.getByTestId('studio-video'); await v.waitFor();
  assert.equal(await v.getAttribute('data-stage'), 'done');
  const chips = v.getByTestId('studio-scene'); assert.equal(await chips.count(), 4);
  assert.match(await chips.nth(1).innerText(), /실제 화면[\s\S]*검수 ✓/);
  await v.getByTestId('studio-video-file').waitFor();
  assert.equal(await v.getByTestId('studio-review').count(), 0, '검수 통과 → 사람 검수 줄 없음');
  await card.screenshot({ path: `${SHOTS}/212-studio-video.png` });
  // 휴대폰 폭: 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/automation?tab=studio`); await owner.getByTestId('studio-video').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리: 다음 단계들이 제작 요청 카드 경로를 쓰도록 연동 끔
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: false });
  await ctx.owner.ok('PUT', '/api/platform/tts', { provider: null });
}
async function assertEventually(fn, n = 30) { for (let i = 0; i < n; i++) { if (await fn()) return; await new Promise((ok) => setTimeout(ok, 200)); } assert.fail('시간 안에 저장되지 않음'); }
