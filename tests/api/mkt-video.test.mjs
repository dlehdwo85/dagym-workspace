// #454 영상 제작 파이프라인 v2 — 구조 시험(가짜 Higgsfield 가 작은 진짜 mp4, 가짜 TTS 가 사인파 mp3, 가짜 AI). 실제 Kling·TTS 연동 완료가 아님.
// 장면별 생성(3~5초·한국인·글자 금지 프롬프트) → 비전 검수(걸린 장면 1번 다시) → 서버 ffmpeg 합성(자막·내레이션·배경음·실제 화면·끝 화면) → 자료실 mp4 → 새 버전 → 승인 대기
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
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
/** 자료실 파일 → ffmpeg 머리말(길이·크기·소리) */
async function probe(fileId) {
  const [f] = await sql`select storage_key, mime_type, meta from library_files where id = ${fileId}`;
  const r = spawnSync(FF, ['-hide_banner', '-i', join(tmpdir(), 'workos-test', 'uploads', f.storage_key)], { encoding: 'utf8' });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr); const v = /Video:[^\n]*?(\d{3,4})x(\d{3,4})/.exec(r.stderr);
  return { mime: f.mime_type, meta: f.meta, duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, w: v ? +v[1] : null, h: v ? +v[2] : null, audio: /Audio: aac/.test(r.stderr) };
}
async function waitStatus(id, want, n = 40) {
  let b;
  for (let i = 0; i < n; i++) { b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === id); if (b?.status === want) return b; await new Promise((ok) => setTimeout(ok, 300)); }
  throw new Error(`의뢰가 ${want} 가 되지 않음: ${b?.status} ${JSON.stringify(b?.progress ?? b?.result ?? {}).slice(0, 600)}`);
}
const scenesAi = (capId, bgmId) => say({ promptEn: 'A warm Korean office story: an operations manager finishes the day calmly with one app.', negativeEn: 'english signage, western houses',
  summaryKo: '퇴근 전 10분을 보여 줍니다', caption: '퇴근 10분 전, 할 일이 한 화면에\n대행사 없이 직접', refMediaIds: [],
  character: 'a Korean woman in her early 30s, shoulder-length black hair, navy blazer', look: 'warm late-afternoon light, clean teal accents',
  scenes: [{ line: '퇴근 10분 전, 오늘 할 일이 한 화면에', visualEn: 'Medium close-up, she exhales at her desk in a bright Seoul office, slow push-in.', seconds: 4, screenMediaId: '', device: 'none' },
    { line: '팀원이 무엇을 하는지 바로 보여요', visualEn: 'Soft background: a tidy desk by the window, gentle parallax.', seconds: 4, screenMediaId: capId, device: 'phone' },
    { line: '승인도 휴대폰에서 끝', visualEn: 'Close-up of her thumb tapping a phone, screen glow only, shallow depth of field.', seconds: 3, screenMediaId: '', device: 'none' },
    { line: '오늘도 제시간에 퇴근', visualEn: 'Wide shot, she leaves the office smiling, golden hour street of Seoul.', seconds: 3, screenMediaId: 'not-a-capture', device: 'laptop' }],
  endCard: { headline: '일은 한 화면에서', cta: 'AI 가 쓴 CTA' }, bgmId });
// 209차: frontFace(주인공 정면) — 첫·마지막 장면은 정면(광고 문법 검수 기준 2/2)
const qa = (rows) => say({ scenes: rows.map(([scene, flag]) => ({ scene, foreignText: flag === 'text', nonKorean: flag === 'person', westernSetting: false, broken: false, frontFace: scene === 1 || scene === 4, issues: flag ? ['간판에 영어 글자'] : [] })) });

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '워크인' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { facts: { phone: '02-1234-5678' } }); // 끝 화면 전화(209차 검수 기준)
  P.logo = await upload('워크인 로고.png', 'image/png', png(600, 200), '마케팅');
  P.cap = await upload('홈 화면 캡처.png', 'image/png', png(1170, 2532), '영상 화면 캡처');
  P.bgm = await upload('밝은 피아노.mp3', 'audio/mpeg', fakeMp3(20, 262), '영상 배경음');
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf` });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('TTS 설정: 플랫폼 운영자만(직원 404) · 키는 응답에 안 나옴(암호화) · 연결 시험 = 목록 조회(과금 없음) · 공급자 바꾸면 키 지움', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/tts')).status, 404);
  const s0 = await ctx.owner.ok('GET', '/api/platform/tts');
  assert.deepEqual([s0.provider, s0.ready, 'apiKey' in s0], [null, false, false]);
  const s1 = await ctx.owner.ok('PUT', '/api/platform/tts', { provider: 'openai', apiKey: 'test-tts-key', base: `${FAKE}/openai/v1` });
  assert.deepEqual([s1.provider, s1.hasKey, s1.ready, s1.voice, s1.model, 'apiKey' in s1], ['openai', true, true, 'nova', 'gpt-4o-mini-tts', false]);
  const [row] = await sql`select value from app_settings where key = 'tts'`; assert.ok(row.value.keyEnc && !JSON.stringify(row.value).includes('test-tts-key'), '암호화 보관');
  const t = await ctx.owner.ok('POST', '/api/platform/tts'); assert.equal(t.ok, true, t.message);
  assert.equal((await st()).tts.length, 0, '연결 시험은 합성하지 않음');
  const s2 = await ctx.owner.ok('PUT', '/api/platform/tts', { provider: 'clova' });
  assert.deepEqual([s2.provider, s2.hasKey, s2.ready, s2.voice], ['clova', false, false, 'nara'], '공급자를 바꾸면 키를 지움');
  await ctx.owner.ok('PUT', '/api/platform/tts', { provider: 'openai', apiKey: 'test-tts-key', base: `${FAKE}/openai/v1` });
  const [a] = await sql`select detail from audit_logs where action = 'platform.tts.settings' order by created_at desc limit 1`; assert.equal(a.detail.key, 'set');
});

test('브랜드 영상 키트(로고·끝 화면 한 줄·CTA·배경색) · 다른 회사·기밀 파일은 400 · 제작의뢰실에 준비 상태(내레이션·캡처·배경음)', async () => {
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { logoFileId: P.logo, headline: '일은 한 화면에서', cta: '14일 무료 체험 · work-in.dev', endColor: '#0F766E' } });
  const [b] = await sql`select video from mkt_brands where id = ${P.brand}`;
  assert.deepEqual([b.video.logoFileId, b.video.cta, b.video.endColor], [P.logo, '14일 무료 체험 · work-in.dev', '#0F766E']);
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { headline: '일은 한 화면에서' } });
  assert.equal((await sql`select video from mkt_brands where id = ${P.brand}`)[0].video.logoFileId, P.logo, '일부만 보내도 나머지는 그대로(합침)');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { logoFileId: '00000000-0000-4000-8000-000000000000' } })).status, 400);
  const v = (await ctx.owner.ok('GET', '/api/marketing/studio')).video;
  assert.deepEqual([v.tts.ready, v.tts.provider, v.captures, v.bgm], [true, 'OpenAI', 1, 1]);
});

test('영상 v2: AI 장면 설계(한국인·글자 금지·장면 3~5초·캡처·배경음) → 장면 4개 따로 생성 → 검수에 걸린 장면 2 한 번 다시 → 합성 → 자료실 mp4(1080×1920·약 15초·소리) → 새 버전·승인 대기', async () => {
  await ctl({ hfReset: true, hfPolls: 1, hfMode: null, ttsReset: true, anthropicReset: true, anthropicQueue: [scenesAi(P.cap, P.bgm), qa([[1, null], [2, 'text'], [3, null], [4, null]]), qa([[2, null]])] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'awareness', message: '퇴근 전 10분, 오늘 할 일 정리', quantity: 1 });
  const sys = JSON.stringify((await st()).anthropic.at(-1)?.body ?? {});
  assert.ok(sys.includes('국내 대기업') && sys.includes('한국인') && sys.includes('글자를 넣지 않음') && sys.includes(P.cap) && sys.includes(P.bgm) && sys.includes('14일 무료 체험'), '대기업 광고 수준·한국인·글자 금지·캡처·배경음·키트 CTA 가 프롬프트에');
  assert.equal(r.prompt.scenes.length, 4); assert.equal(r.prompt.scenes[1].screen.mediaId, P.cap); assert.equal(r.prompt.scenes[3].screen, null, '목록에 없는 캡처 id 는 버림');
  assert.equal(r.prompt.endCard.cta, '14일 무료 체험 · work-in.dev', '브랜드 키트 CTA 가 AI 안보다 우선'); assert.equal(r.prompt.bgmId, P.bgm);
  P.v = r.id;
  const g = await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  assert.ok(['generating', 'review'].includes(g.status), JSON.stringify(g));
  const b = await waitStatus(r.id, 'review');
  const s = await st();
  assert.equal(s.hf.length, 5, '장면 4개 + 검수에 걸린 장면 1개 다시');
  assert.deepEqual(s.hf.slice(0, 4).map((h) => h.body.duration), [4, 4, 3, 3]);
  for (const h of s.hf) { assert.equal(h.path, 'kling-video/v3.0-turbo/text-to-video'); assert.equal(h.body.aspect_ratio, '9:16'); assert.match(h.body.prompt, /No text anywhere in frame/); assert.match(h.body.prompt, /all people are Korean/); assert.match(h.body.prompt, /Cast: a Korean woman/); }
  assert.match(s.hf[4].body.prompt, /Fix from the previous attempt: remove every visible letter/, '검수에서 걸린 점을 고쳐 다시');
  assert.match(s.hf[1].body.prompt, /background plate/, '실제 화면을 얹는 장면은 배경 지시');
  assert.equal(s.tts.length, 4, '장면 대사 4줄 내레이션'); assert.equal(s.tts[0].voice, 'nova'); assert.match(s.tts[0].instructions, /한국어 광고 내레이션/);
  const pr = b.progress;
  assert.deepEqual([pr.stage, pr.review.length, pr.variants[0].scenes[1].regens, pr.variants[0].scenes[1].qa.ok], ['done', 0, 1, true]);
  assert.equal(pr.audio.narration, 'openai'); assert.equal(pr.audio.bgm, '밝은 피아노');
  const f = await probe(b.result.mediaIds[0]);
  assert.deepEqual([f.mime, f.w, f.h, f.audio], ['video/mp4', 1080, 1920, true]);
  assert.ok(Math.abs(f.duration - 14.8) < 0.3, `길이 ${f.duration}`); // 4+4+3+3 − 겹침 0.4×3 − 0.5 + 끝 화면 2.5
  assert.deepEqual([f.meta.video.pipeline, f.meta.video.narration, f.meta.video.bgm, f.meta.video.font], ['v2', 'openai', '밝은 피아노', 'Noto Sans KR']);
  const [c] = await sql`select c.current_version, c.rationale, v.media_ids, v.note from mkt_briefs b join mkt_contents c on c.id = b.content_id join mkt_versions v on v.content_id = c.id and v.version = c.current_version where b.id = ${r.id}`;
  assert.deepEqual([c.current_version, c.media_ids], [2, b.result.mediaIds]); assert.match(c.note, /AI 검수 통과/); assert.equal(c.rationale.qa.needsHuman, false);
  const [led] = await sql`select credits, note from mkt_credit_ledger where content_id = ${b.content_id} and kind = 'generate_video'`;
  assert.match(led.note, /생성 18초\(다시 만든 4초 포함\)/); assert.ok(Number(led.credits) > 80, '다시 만든 장면만큼 더 셈');
  const keys = await sql`select count(*)::int n from library_files where tenant = 'default' and folder = '마케팅' and mime_type = 'video/mp4' and deleted_at is null`;
  assert.equal(keys[0].n, 1, '장면 클립은 자료실에 늘어놓지 않고 완성본 1개만');
});

test('내레이션 키·배경음 없으면 자막만 · AI 검수를 못 하면 사람 검수 필요(승인 카드) · 장면 생성이 두 번 실패하면 그 편은 실패', async () => {
  await ctx.owner.ok('PUT', '/api/platform/tts', { provider: null });
  await sql`update library_files set deleted_at = now() where id = ${P.bgm}`;
  await ctl({ hfReset: true, hfPolls: 0, ttsReset: true, anthropicReset: true, anthropicQueue: [] }); // AI 답 없음 → 기본 장면·검수 실패
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'shorts', purpose: 'inquiry', message: '쇼츠 시험 메시지', quantity: 1 });
  assert.equal(r.prompt.source, 'template');
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const b = await waitStatus(r.id, 'review');
  assert.equal((await st()).tts.length, 0);
  const notes = b.progress.notes.join(' / ');
  assert.match(notes, /내레이션 키 필요/); assert.match(notes, /배경음 없음/);
  assert.equal(b.progress.review.length, 4, '검수 못 한 장면 4개 = 사람 검수');
  const [c] = await sql`select rationale from mkt_contents where id = ${b.content_id}`; assert.equal(c.rationale.qa.needsHuman, true);
  const f = await probe(b.result.mediaIds[0]); assert.equal(f.audio, true, '소리 없어도 무음 트랙');
  // 장면 생성 실패(검수 거절) → 한 번 다시 → 또 실패 → 실패
  await ctl({ hfReset: true, hfPolls: 0, hfMode: 'nsfw', anthropicReset: true, anthropicQueue: [] });
  const r2 = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'inquiry', message: '실패 시험', quantity: 1 });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r2.id}`, { action: 'generate' });
  const b2 = await waitStatus(r2.id, 'failed');
  assert.match(b2.error, /생성 실패/); assert.equal((await st()).hf.length, 8, '장면 4개 × (처음 + 한 번 다시)');
  await ctl({ hfMode: null });
});

test('합성 함수(/api/marketing/studio/render)는 CRON_SECRET 없으면 401 · 정기 실행 단계 mktRender', async () => {
  assert.equal((await fetch(`${BASE}/api/marketing/studio/render`, { method: 'POST' })).status, 401);
  assert.equal((await fetch(`${BASE}/api/marketing/studio/render`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret', 'content-type': 'application/json' }, body: '{}' })).status, 202);
  const t = await tick(); assert.deepEqual(t.detail.mktRender, { kicked: 0 }, '기다리는 합성 없음');
});

test('#539 구글 음성(Cloud Text-to-Speech, 대표 10/24): 키는 x-goog-api-key 헤더 · 기본 음성 ko-KR-Neural2-A(모델 칸 없음) · 연결 시험 = 한국어 음성 목록(합성 안 함) · 목록에 없는 음성·틀린 키는 알아듣게 · 영상 내레이션이 구글로', async () => {
  const s = await ctx.owner.ok('PUT', '/api/platform/tts', { provider: 'google', apiKey: 'test-gtts-key', base: `${FAKE}/google-tts/v1` });
  assert.deepEqual([s.provider, s.ready, s.voice, s.model, s.providers.google.label, 'apiKey' in s], ['google', true, 'ko-KR-Neural2-A', '', '구글 클라우드 TTS', false]);
  await ctl({ ttsReset: true });
  assert.deepEqual(await ctx.owner.ok('POST', '/api/platform/tts').then((r) => [r.ok, r.message]), [true, "연결됨 — 한국어 음성 4개 중 'ko-KR-Neural2-A' 사용"]);
  assert.equal((await st()).tts.length, 0, '연결 시험은 합성하지 않음(과금 없음)');
  await ctx.owner.ok('PUT', '/api/platform/tts', { voice: 'ko-KR-Wavenet-Z' });
  const nv = await ctx.owner.ok('POST', '/api/platform/tts');
  assert.deepEqual([nv.ok, nv.message], [false, "키는 맞지만 음성 이름 'ko-KR-Wavenet-Z'이(가) ko-KR 목록에 없습니다 — 예: ko-KR-Neural2-A · ko-KR-Neural2-B · ko-KR-Neural2-C"]);
  await ctx.owner.ok('PUT', '/api/platform/tts', { voice: 'ko-KR-Chirp3-HD-Kore', apiKey: 'wrong-key' });
  const wk = await ctx.owner.ok('POST', '/api/platform/tts');
  assert.equal(wk.ok, false); assert.match(wk.message, /^HTTP 400 키가 맞지 않습니다 · API key not valid/);
  const sv = await ctx.owner.ok('PUT', '/api/platform/tts', { apiKey: 'test-gtts-key' });
  assert.deepEqual([sv.voice, sv.ready], ['ko-KR-Chirp3-HD-Kore', true], '키만 바꾸면 고른 음성은 그대로');
  // 영상 내레이션 = 구글 합성(MP3·ko-KR·고른 음성) — 장면 대사 4줄
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null, ttsReset: true, anthropicReset: true, anthropicQueue: [scenesAi(P.cap, P.bgm), qa([[1, null], [2, null], [3, null], [4, null]])] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'awareness', message: '구글 음성 내레이션 시험', quantity: 1 });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const b = await waitStatus(r.id, 'review');
  const tts = (await st()).tts;
  assert.equal(tts.length, 4, '장면 대사 4줄');
  assert.deepEqual([tts[0].provider, tts[0].voice, tts[0].languageCode, tts[0].encoding, tts[0].input], ['google', 'ko-KR-Chirp3-HD-Kore', 'ko-KR', 'MP3', '퇴근 10분 전, 오늘 할 일이 한 화면에']);
  assert.equal(b.progress.audio.narration, 'google');
  assert.equal((await probe(b.result.mediaIds[0])).audio, true, '소리 있는 mp4');
});
