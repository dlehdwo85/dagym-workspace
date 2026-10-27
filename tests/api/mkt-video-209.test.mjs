// 209차 #666 영상 선행 조건 코드(VIDEO_RESUME_PREREQS §2 의 1·5·7) — 구조 시험(가짜 Higgsfield·가짜 AI, 실제 생성 호출 없음).
// ① 광고 문법(훅 정면 → 상황 → 해결(실제 화면) → 결과 정면 미소) ⑤ 출연진 고정(주인공 사진 → 장면 첫 사진 → 이미지→영상) ⑦ 하이링크 검수 기준(정면 컷·실제 화면·어두운 장면·자막 크기·끝 화면)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle, fakeMp3 } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const st = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const png = (w, h) => spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=${w}x${h}:d=1`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], { maxBuffer: 32 << 20 }).stdout;
async function upload(name, mime, data, folder) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder, space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
async function waitStatus(id, want, n = 60) {
  let b;
  for (let i = 0; i < n; i++) { b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === id); if (b?.status === want) return b; await new Promise((ok) => setTimeout(ok, 300)); }
  throw new Error(`의뢰가 ${want} 가 되지 않음: ${b?.status} ${JSON.stringify(b?.progress ?? b?.result ?? {}).slice(0, 900)}`);
}
/** AI 장면 설계 — beat 순서를 일부러 섞고(정리되는지), 실제 화면은 안 고름(브랜드 폴더 캡처로 채워지는지) */
const plan = (beats) => say({ promptEn: 'A calm Korean office story.', negativeEn: 'english signage', summaryKo: '퇴근 전 10분', caption: '퇴근 10분 전, 할 일이 한 화면에', refMediaIds: [],
  fields: { who: 'a Korean woman', where: 'Seoul office', action: 'checks phone', emotion: 'from tense to relieved', lens: '35mm', angle: 'eye-level', movement: 'slow push-in', light: 'daylight', props: ['phone'] },
  character: 'AI 가 쓴 출연진', look: 'bright daylight, clean teal accents',
  scenes: beats.map((beat, k) => ({ beat, line: ['퇴근 10분 전, 할 일 정리 끝났나요?', '팀원 일을 하나씩 물어보던 날', '이제 한 화면에서 바로 확인', '오늘도 제시간에 퇴근'][k], visualEn: `Shot ${k + 1}: she works at a bright Seoul office desk.`, seconds: k < 2 ? 4 : 3, screenMediaId: '', device: 'none' })),
  endCard: { headline: '일은 한 화면에서', cta: '' }, bgmId: '' }); // CTA 를 비우면 끝 화면에 브랜드 사실 카드 전화(결정 15-15)
const qa = (rows) => say({ scenes: rows.map(([scene, front]) => ({ scene, foreignText: false, nonKorean: false, westernSetting: false, broken: false, frontFace: !!front, issues: [] })) });
async function models(fn) { const s = await ctx.owner.ok('GET', '/api/platform/higgsfield'); await ctx.owner.ok('PUT', '/api/platform/higgsfield', { models: fn(s.models) }); }
const I2V = 'kling-video/v3.0-turbo/image-to-video';

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '워크인' })).id;
  P.plain = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  P.logo = await upload('워크인 로고.png', 'image/png', png(600, 200), '마케팅');
  P.cast = await upload('주인공.png', 'image/png', png(600, 800), '마케팅');
  P.cap = await upload('홈 화면.png', 'image/png', png(1170, 2532), '영상 화면 캡처/워크인');
  P.mp3 = await upload('효과음.mp3', 'audio/mpeg', fakeMp3(2, 330), '마케팅');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { logoFileId: P.logo, headline: '일은 한 화면에서' }, facts: { phone: '02-1234-5678' } });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf` });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('브랜드 키트 주인공: 실존 인물은 광고 사용 동의 표시가 있어야(동의 시각·사람 기록) · 사진 파일만 · 묘사만 고쳐도 동의 기록 그대로', async () => {
  const patch = (video) => ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video });
  const r1 = await patch({ castFileId: P.cast, castKind: 'real' });
  assert.equal(r1.status, 400); assert.match(r1.body.error.message, /동의/);
  const r2 = await patch({ castFileId: P.mp3, castKind: 'generated' });
  assert.equal(r2.status, 400); assert.match(r2.body.error.message, /사진 파일만/);
  assert.equal((await patch({ castFileId: '00000000-0000-4000-8000-000000000000', castKind: 'generated' })).status, 400, '다른 회사·없는 파일');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { castFileId: P.cast, castKind: 'real', castConsent: true } });
  const [b] = await sql`select video from mkt_brands where id = ${P.brand}`;
  assert.deepEqual([b.video.castFileId, b.video.castKind, !!b.video.castConsentAt, b.video.castConsentBy, 'castConsent' in b.video, b.video.logoFileId], [P.cast, 'real', true, ctx.ownerId, false, P.logo]);
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { castEn: 'a Korean woman in her early 30s, short black hair, navy cardigan' } });
  const [b2] = await sql`select video from mkt_brands where id = ${P.brand}`;
  assert.deepEqual([b2.video.castConsentAt, b2.video.castKind, b2.video.castEn], [b.video.castConsentAt, 'real', 'a Korean woman in her early 30s, short black hair, navy cardigan']);
});

test('① 광고 문법 + ⑤ 출연진 고정: 장면 순서 훅→해결→상황→결과로 정리·브랜드 폴더 캡처를 해결 장면에 → 주인공 사진 1번 올림 → 장면마다 첫 사진(참고 사진) → 그 사진으로 이미지→영상 → 검수 기준 통과', async () => {
  await models((ms) => [...ms.map((m) => (m.id === 'higgsfield-ai/soul/v2/standard' ? { ...m, ref: 'image_url' } : m)), { id: I2V, kind: 'video', name: 'Kling 3 Turbo 이미지→영상', credits: 80, usd: 0.12, enabled: true, ref: 'image_url' }]);
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null, anthropicReset: true, anthropicQueue: [plan(['hook', 'solution', 'situation', 'hook']), qa([[1, true], [2, false], [3, false], [4, true]])] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'awareness', message: '퇴근 전 10분, 할 일 정리', quantity: 1 });
  const sys = JSON.stringify((await st()).anthropic.at(-1)?.body ?? {});
  assert.ok(sys.includes('광고 문법') && sys.includes('hook') && sys.includes('주인공 정면') && sys.includes('a Korean woman in her early 30s'), '광고 문법·주인공 묘사가 장면 설계 지시에');
  assert.deepEqual(r.prompt.scenes.map((x) => x.beat), ['hook', 'solution', 'situation', 'result'], '첫 = 훅, 끝 = 결과');
  assert.deepEqual([r.prompt.scenes[1].screen?.mediaId, r.prompt.scenes.filter((x) => x.screen).length], [P.cap, 1], '실제 화면이 없으면 이 브랜드 폴더 캡처를 해결 장면에');
  assert.equal(r.prompt.character, 'a Korean woman in her early 30s, short black hair, navy cardigan', '브랜드 키트 주인공 묘사가 우선');
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const b = await waitStatus(r.id, 'review');
  const s = await st();
  const imgs = s.hf.filter((h) => h.path === 'higgsfield-ai/soul/v2/standard'); const vids = s.hf.filter((h) => h.path === I2V);
  assert.deepEqual([imgs.length, vids.length, s.hf.length], [4, 4, 8], '장면마다 첫 사진 1장 + 영상 1편');
  assert.equal(s.hfUploads.length, 5, '주인공 사진 1번 + 첫 사진 4장을 올림(생성 서비스가 읽을 주소)');
  for (const h of imgs) { assert.match(h.body.image_url, /\/hf-files\//); assert.match(h.body.prompt, /person in the reference photo/); assert.equal(h.body.aspect_ratio, '9:16'); }
  assert.ok(imgs.every((h) => h.body.image_url === imgs[0].body.image_url), '모든 장면이 같은 주인공 사진');
  assert.match(imgs[0].body.prompt, /Beat: opening hook/); assert.match(imgs[3].body.prompt, /Beat: result/); assert.match(imgs[1].body.prompt, /OFF or flat mid-grey/);
  for (const h of vids) { assert.match(h.body.image_url, /\/hf-files\//); assert.notEqual(h.body.image_url, imgs[0].body.image_url, '영상은 장면 첫 사진에서'); assert.match(h.body.prompt, /^Animate this exact frame/); }
  const pr = b.progress;
  assert.equal(pr.cast, 'ref');
  assert.deepEqual(pr.variants[0].scenes.map((x) => [x.beat, x.kf, x.status]), [['hook', 'completed', 'completed'], ['solution', 'completed', 'completed'], ['situation', 'completed', 'completed'], ['result', 'completed', 'completed']]);
  assert.deepEqual([pr.checks.front, pr.checks.screens, pr.checks.dark, pr.checks.end, pr.checks.fails], [{ n: 2, need: 2, known: true }, { n: 1, need: 1 }, 0, { logo: true, headline: true, phone: true }, []]);
  assert.ok(pr.checks.subPct >= 5 && pr.checks.subPct <= 8, `자막 ${pr.checks.subPct}%`);
  const keys = b.result.variants[0].scenes.map((x) => x.kf.key);
  assert.ok(keys.every((k) => /^render\/default\/.+-kf1\.jpg$/.test(k)), '첫 사진은 저장소에(사람 검수용, 자료실엔 안 늘어놓음)');
  const [c] = await sql`select rationale from mkt_contents where id = ${b.content_id}`;
  assert.deepEqual([c.rationale.qa.needsHuman, c.rationale.qa.checks.screens.n], [false, 1]);
  const [led] = await sql`select credits, note from mkt_credit_ledger where content_id = ${b.content_id} and kind = 'generate_video'`;
  assert.match(led.note, /출연진 첫 사진 4장/); assert.ok(Number(led.credits) > 80, '첫 사진 크레딧도 셈');
  P.withCast = r.id;
});

test('⑦ 검수 기준: 어두운 장면은 밝게 다시 만들고 · 정면 컷 1/2 · 실제 화면 0곳 · 끝 화면 로고·전화 없음 → 승인함 사람 검수 필요(이유) · 주인공 사진 없으면 알림', async () => {
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null, hfDarkNext: 1, anthropicReset: true, anthropicQueue: [plan(['hook', 'situation', 'solution', 'result']), qa([[1, true], [2, false], [3, false], [4, false]]), qa([[1, true]])] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.plain, kind: 'reels', purpose: 'awareness', message: '다짐 시험 영상', quantity: 1 });
  assert.equal(r.prompt.scenes.filter((x) => x.screen).length, 0, '다른 브랜드 폴더 캡처는 안 씀');
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const b = await waitStatus(r.id, 'review');
  const s = await st();
  assert.deepEqual([s.hf.length, s.hfUploads.length], [5, 0], '글로 만드는 영상 4 + 어두운 장면 1번 다시, 올린 사진 없음');
  assert.ok(s.hf.every((h) => h.path === 'kling-video/v3.0-turbo/text-to-video'), '출연진 고정이 아니면 글로 만드는 모델(이미지→영상 모델은 안 씀)');
  assert.match(s.hf[4].body.prompt, /Fix from the previous attempt: bright natural daylight/);
  const pr = b.progress;
  assert.equal(pr.cast, 'text'); assert.equal(pr.variants[0].scenes[0].regens, 1);
  assert.equal(pr.checks.dark, 0, '다시 만든 뒤에는 밝음');
  assert.match(pr.notes.join(' / '), /브랜드 키트에 주인공 사진이 없어/);
  const [c] = await sql`select rationale, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${b.content_id}`;
  const issues = c.rationale.qa.issues.join(' / ');
  assert.equal(c.rationale.qa.needsHuman, true);
  assert.match(issues, /주인공 정면 컷 1\/2/); assert.match(issues, /실제 화면 0곳/); assert.match(issues, /끝 화면에 로고·전화번호 없음/);
  assert.match(c.note, /사람 검수 필요 3곳/);
  assert.deepEqual(pr.review, [], '장면 검수는 다 통과(기준 미달만)');
  assert.equal(pr.checkFails.length, 3);
});

test('⑤ 주인공 사진은 있지만 이미지→영상 모델이 없으면 글 묘사로(알림) · 첫 사진이 두 번 안 되면 그 장면만 글 묘사로 한 번 더', async () => {
  await models((ms) => ms.map((m) => (m.id === I2V ? { ...m, enabled: false } : m)));
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null, anthropicReset: true, anthropicQueue: [] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'inquiry', message: '모델 없음 시험', quantity: 1 });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const b = await waitStatus(r.id, 'review');
  const s = await st();
  assert.deepEqual([s.hfUploads.length, s.hf.filter((h) => h.path !== 'kling-video/v3.0-turbo/text-to-video').length], [0, 0], '사진 안 올리고 글로만');
  assert.equal(b.progress.cast, 'text'); assert.match(b.progress.notes.join(' / '), /출연진 고정을 아직 쓸 수 없어 글 묘사로만/);
  assert.ok(!JSON.stringify(b.progress.notes).includes('image-to-video'), '알림에 모델 이름 없음');
  // 첫 사진이 계속 거절(nsfw) → 첫 사진 2번 → 그 장면만 글 묘사 1번 → 그것도 거절 → 실패
  await models((ms) => ms.map((m) => (m.id === I2V ? { ...m, enabled: true } : m)));
  await ctl({ hfReset: true, hfPolls: 0, hfMode: 'nsfw', anthropicReset: true, anthropicQueue: [] });
  const r2 = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'inquiry', message: '첫 사진 실패 시험', quantity: 1 });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r2.id}`, { action: 'generate' });
  const b2 = await waitStatus(r2.id, 'failed');
  const s2 = await st();
  assert.equal(s2.hf.filter((h) => h.path === 'higgsfield-ai/soul/v2/standard').length, 8, '장면 4개 × 첫 사진 2번');
  assert.equal(s2.hf.filter((h) => h.path === 'kling-video/v3.0-turbo/text-to-video').length, 4, '장면마다 글 묘사로 1번');
  assert.match((b2.result.notes ?? []).join(' / '), /장면 1은 출연진을 맞춘 첫 사진이 안 돼 글 묘사로/);
  await ctl({ hfMode: null });
});
