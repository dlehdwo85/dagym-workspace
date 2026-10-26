// 187차 ⑦ 이번 달 만든 영상 다시 합성(로컬 10/26 16:45 '크레딧 쓴 영상 11편은 새 영상 방식으로 보완') — 구조 시험.
// 가짜 Higgsfield(작은 진짜 mp4)·가짜 TTS(사인파 mp3)·가짜 AI. 다시 합성은 생성 호출이 없어야 하고 크레딧 원장도 그대로 — 실제 운영 영상 합성 확인이 아님.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle, fakeMp3 } from '../fake-google.mjs';
import { forbidden } from '../customerWords.mjs';

let srv, ctx, sql, fake; const P = {};
const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const st = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const png = (w, h) => spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=s=${w}x${h}:d=1`, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', 'pipe:1'], { maxBuffer: 32 << 20 }).stdout;
/** 한 편짜리 영상(의뢰 1차·제작 요청 카드로 붙인 영상 흉내) — 소리 있는 작은 mp4 */
const mp4 = (sec, w, h) => spawnSync(FF, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${w}x${h}:r=24:d=${sec}`, '-f', 'lavfi', '-i', `sine=f=330:d=${sec}`,
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 64 << 20 }).stdout;
async function upload(name, mime, data, folder) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder, space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
async function probe(fileId) {
  const [f] = await sql`select storage_key, mime_type, meta, tags from library_files where id = ${fileId}`;
  const r = spawnSync(FF, ['-hide_banner', '-i', join(tmpdir(), 'workos-test', 'uploads', f.storage_key)], { encoding: 'utf8' });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr); const v = /Video:[^\n]*?(\d{3,4})x(\d{3,4})/.exec(r.stderr);
  return { mime: f.mime_type, meta: f.meta, tags: f.tags, duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, w: v ? +v[1] : null, h: v ? +v[2] : null, audio: /Audio: aac/.test(r.stderr) };
}
const list = () => ctx.owner.ok('GET', '/api/marketing/studio/reuse');
const row = async (ledgerId) => (await list()).rows.find((r) => r.ledgerId === ledgerId);
const ledgerCount = async () => (await sql`select count(*)::int n from mkt_credit_ledger where kind = 'generate_video'`)[0].n;
const ARCHIVED = { archived_from: 'pending', archived_at: '2026-10-25T13:20:00.000Z', archived_reason: '대표 10/25 22:20 전면 정리' };
/** 원장 줄 하나 붙은 한 편짜리 영상 글: v1 본문만 → v2 영상(원장 버전 = 영상 버전, 의뢰 1차·제작 요청 카드와 같은 모양) */
async function seedClip(title, fileId, o = {}) {
  const quality = { ...(o.status && o.status !== 'canceled' ? {} : { ...ARCHIVED, archived_by: ctx.ownerId }), ...(o.script ? { script: o.script } : {}) };
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by, quality, deleted_at)
    values ('default', ${P.brand}, ${title}, 'instagram', 'reels', ${o.status ?? 'canceled'}, 2, ${ctx.ownerId}, ${sql.json(quality)}, ${o.deleted ? new Date() : null}) returning id`;
  const body = o.body ?? '퇴근 전 10분, 오늘 할 일을 한 화면에서 정리하세요.\n승인도 휴대폰에서 끝납니다.\n#워크인 #업무관리';
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, ${body}, ${[]}, ${ctx.ownerId}), (${c.id}, 2, ${body}, ${[fileId]}, ${ctx.ownerId})`;
  const [l] = await sql`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title, created_at)
    values ('default', ${c.id}, 2, 'generate_video', 6.5, '제작 요청 완료', ${ctx.ownerId}, ${title}, ${o.at ?? new Date()}) returning id`;
  return { content: c.id, ledger: Number(l.id) };
}
const scenesAi = (capId) => say({ promptEn: 'A warm Korean office story: an operations manager finishes the day calmly with one app.', negativeEn: 'english signage', summaryKo: '퇴근 전 10분',
  caption: '퇴근 10분 전, 할 일이 한 화면에', refMediaIds: [], character: 'a Korean woman in her early 30s, navy blazer', look: 'warm late-afternoon light',
  scenes: [{ line: '퇴근 10분 전, 오늘 할 일이 한 화면에', visualEn: 'Medium close-up at a bright Seoul office desk, slow push-in.', seconds: 4, screenMediaId: '', device: 'none' },
    { line: '팀원이 무엇을 하는지 바로 보여요', visualEn: 'Soft background: a tidy desk by the window.', seconds: 4, screenMediaId: capId, device: 'phone' },
    { line: '승인도 휴대폰에서 끝', visualEn: 'Close-up of a thumb tapping a phone, screen glow only.', seconds: 3, screenMediaId: '', device: 'none' },
    { line: '오늘도 제시간에 퇴근', visualEn: 'Wide shot, she leaves the office smiling at golden hour.', seconds: 3, screenMediaId: '', device: 'none' }],
  endCard: { headline: '일은 한 화면에서', cta: '14일 무료 체험' }, bgmId: '' });
const qaOk = () => say({ scenes: [1, 2, 3, 4].map((scene) => ({ scene, foreignText: false, nonKorean: false, westernSetting: false, broken: false, issues: [] })) });

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '워크인' })).id;
  // 끝 화면 CTA 가 홈페이지 주소면 브랜드 사실 카드 전화로 바뀌어야(결정 15-15)
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { headline: '일은 한 화면에서', cta: 'www.work-in.dev' }, facts: { phone: '1600-1234' } });
  P.cap = await upload('홈 화면 캡처.png', 'image/png', png(1170, 2532), '영상 화면 캡처');
  P.bgm = await upload('밝은 피아노.mp3', 'audio/mpeg', fakeMp3(20, 262), '영상 배경음');
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf` });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
  await ctx.owner.ok('PUT', '/api/platform/tts', { provider: 'openai', apiKey: 'test-tts-key', base: `${FAKE}/openai/v1` });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('목록: 이번 달 영상 원장 줄만 · 장면별 영상(v2)은 장면 그대로 · 한 편짜리는 나눠 자막 · 게시됨·휴지통·파일 없음은 못 함 · 관리자만 · 모델·외부 서비스 이름 없음', async () => {
  // ① 장면별로 만든 영상(v2) → 승인 대기 → 10/25 전면 정리로 보관
  await ctl({ hfReset: true, hfPolls: 0, hfMode: null, ttsReset: true, anthropicReset: true, anthropicQueue: [scenesAi(P.cap), qaOk()] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'awareness', message: '퇴근 전 10분 정리', quantity: 1 });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  let b; for (let i = 0; i < 40 && b?.status !== 'review'; i++) { b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r.id); if (b?.status !== 'review') await new Promise((ok) => setTimeout(ok, 300)); }
  assert.equal(b.status, 'review'); P.v2Content = b.content_id; P.v2File = b.result.mediaIds[0];
  await sql`update mkt_contents set status = 'canceled', quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ ...ARCHIVED, archived_by: ctx.ownerId })} where id = ${P.v2Content}`;
  P.v2Ledger = Number((await sql`select id from mkt_credit_ledger where content_id = ${P.v2Content}`)[0].id);
  // ② 한 편짜리 6초 영상(릴스 대본 칸 3줄) · ③ 게시됨 · ④ 영상 파일 지움 · ⑤ 휴지통 · ⑥ 지난달(목록에 없음)
  P.clipFile = await upload('릴스 시안 1.mp4', 'video/mp4', mp4(6, 1080, 1920), '마케팅');
  P.clip = await seedClip('릴스 · 한 편짜리 영상', P.clipFile, { script: ['퇴근 전 10분 정리', '할 일은 한 화면에서', '오늘도 제시간에 퇴근'] });
  P.pub = await seedClip('릴스 · 게시된 영상', await upload('게시 영상.mp4', 'video/mp4', mp4(4, 1080, 1920), '마케팅'), { status: 'published' });
  const goneFile = await upload('지운 영상.mp4', 'video/mp4', mp4(4, 1080, 1920), '마케팅');
  P.gone = await seedClip('릴스 · 파일 지운 영상', goneFile); await sql`update library_files set deleted_at = now() where id = ${goneFile}`;
  P.trash = await seedClip('릴스 · 휴지통 영상', await upload('휴지통 영상.mp4', 'video/mp4', mp4(4, 1080, 1920), '마케팅'), { deleted: true });
  const [{ m }] = await sql`select (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '1 hour' as m`;
  P.old = await seedClip('릴스 · 지난달 영상', await upload('지난달 영상.mp4', 'video/mp4', mp4(4, 1080, 1920), '마케팅'), { at: m });

  const v = await list();
  assert.deepEqual(v.rows.map((x) => x.ledgerId).sort(), [P.v2Ledger, P.clip.ledger, P.pub.ledger, P.gone.ledger, P.trash.ledger].sort(), '지난달 원장 줄은 없음');
  const by = Object.fromEntries(v.rows.map((x) => [x.ledgerId, x]));
  const a = by[P.v2Ledger];
  assert.deepEqual([a.status, a.plan, a.scenes, a.seconds, a.videos, a.fileId], ['ready', 'scenes', 4, 14.8, 1, P.v2File]);
  assert.deepEqual(a.lines, ['퇴근 10분 전, 오늘 할 일이 한 화면에', '팀원이 무엇을 하는지 바로 보여요', '승인도 휴대폰에서 끝', '오늘도 제시간에 퇴근']);
  assert.equal(a.endCta, '문의 1600-1234', '끝 화면 = 홈페이지 주소 대신 브랜드 전화');
  const c = by[P.clip.ledger];
  assert.deepEqual([c.status, c.plan, c.scenes, c.seconds, c.fileId], ['ready', 'clip', 3, null, P.clipFile], '길이를 모르면 합성 때 맞춤(대본 3줄 = 장면 3개 어림)');
  assert.deepEqual(c.lines, ['퇴근 전 10분 정리', '할 일은 한 화면에서', '오늘도 제시간에 퇴근'], '릴스 대본(컷) 칸이 자막');
  assert.deepEqual([by[P.pub.ledger].status, by[P.gone.ledger].status, by[P.trash.ledger].status], ['published', 'missing', 'deleted']);
  assert.equal(v.ready, 2); assert.equal(v.narration, true); assert.equal(v.bgm, 1);
  assert.deepEqual(forbidden(JSON.stringify(v)), [], '모델·외부 서비스·원가·달러 낱말 없음');
  // 관리자만 — 직원은 못 봄·못 시작
  for (const [m2, body] of [['GET', undefined], ['POST', { ledgerIds: [P.clip.ledger] }]]) {
    const res = await ctx.staffA.client.req(m2, '/api/marketing/studio/reuse', body);
    assert.ok([403, 404].includes(res.status), `직원 ${m2} ${res.status}`); assert.equal(res.body?.rows, undefined);
  }
  assert.equal((await ctx.owner.req('POST', '/api/marketing/studio/reuse', { ledgerIds: [] })).status, 400);
});

test('다시 합성: 생성 호출 0·크레딧 원장 그대로 → 장면 그대로(v2 14.8초)·한 편 나누기(6초 → 장면 2개·8.0초) → 새 버전 승인 대기·보관 표시 지움 · 끝 화면 전화 · 다시 누르면 건너뜀', async () => {
  const s0 = await st(); const hf0 = s0.hf.length; const led0 = await ledgerCount();
  await ctl({ ttsReset: true, anthropicReset: true, anthropicQueue: [] });
  const out = await ctx.owner.ok('POST', '/api/marketing/studio/reuse', { ledgerIds: [P.v2Ledger, P.clip.ledger, P.pub.ledger] });
  assert.equal(out.started, 2); assert.deepEqual(out.skipped.map((x) => x.ledgerId), [P.pub.ledger]); assert.match(out.skipped[0].reason, /게시/);
  const s1 = await st();
  assert.equal(s1.hf.length, hf0, '영상 생성 호출 없음'); assert.equal(await ledgerCount(), led0, '크레딧 원장 그대로');
  assert.equal(s1.tts.length, 4 + 2, '내레이션 = v2 장면 대사 4줄 + 나눈 장면 2줄');
  const briefs = await sql`select id, status, est_credits, content_id, result from mkt_briefs where id = any(${out.briefIds}::uuid[])`;
  for (const x of briefs) { assert.equal(x.status, 'review', JSON.stringify(x.result).slice(0, 400)); assert.equal(Number(x.est_credits), 0); assert.equal(x.result.provider, 'reuse'); }
  const bv2 = briefs.find((x) => x.content_id === P.v2Content); const bclip = briefs.find((x) => x.content_id === P.clip.content);
  // v2: 같은 장면 클립으로 다시(자막·내레이션·끝 화면 전화·배경음)
  const f2 = await probe(bv2.result.mediaIds[0]);
  assert.deepEqual([f2.w, f2.h, f2.audio], [1080, 1920, true]); assert.ok(Math.abs(f2.duration - 14.8) < 0.3, `길이 ${f2.duration}`);
  assert.deepEqual([f2.meta.video.reuse.ledger, f2.meta.video.reuse.from, f2.meta.video.narration], [String(P.v2Ledger), P.v2File, 'openai']); assert.ok(f2.tags.includes('다시 합성'));
  assert.ok(bv2.result.notes.some((n) => n.includes('끝 화면 주소 대신 전화번호(1600-1234)')), bv2.result.notes.join(' / '));
  // 한 편짜리: 6초 → 장면 2개(대본 앞 2줄, 2.5초에 하나) · 원본 비율 그대로 · 8.0초(6 − 끝 화면 겹침 0.5 + 2.5)
  const sc = bclip.result.variants[0].scenes;
  assert.deepEqual(sc.map((x) => x.line), ['퇴근 전 10분 정리', '할 일은 한 화면에서']);
  const near = (a, b) => Math.abs(a - b) < 0.06; // 시험 영상은 소리 끝맺음 때문에 6.02초 안팎
  assert.ok(near(sc[0].start, 0) && near(sc[1].start, 2.8) && near(sc[0].seconds, 3.2) && near(sc[1].seconds, 3.2), JSON.stringify(sc.map((x) => [x.start, x.seconds])));
  assert.ok(near(sc[1].start + sc[1].seconds, sc[0].seconds * 2 - 0.4), '장면 사이 0.4초가 원본의 같은 구간(끊김 없음)');
  const fc = await probe(bclip.result.mediaIds[0]);
  assert.deepEqual([fc.w, fc.h, fc.audio], [1080, 1920, true]); assert.ok(Math.abs(fc.duration - 8.0) < 0.3, `길이 ${fc.duration}`);
  assert.equal(fc.meta.video.reuse.from, P.clipFile);
  // 글: 새 버전 = 승인 대기 · 본문은 지금 글 그대로 · 보관 표시 지움 · 정직한 버전 메모(모델 이름 없음)
  for (const [cid, ver] of [[P.v2Content, 3], [P.clip.content, 3]]) {
    const [cc] = await sql`select c.status, c.current_version, c.quality, v.note, v.media_ids, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${cid}`;
    assert.deepEqual([cc.status, cc.current_version, 'archived_from' in cc.quality, cc.quality.reused.version], ['pending', ver, false, ver]);
    assert.match(cc.note, /^기존 영상 새 방식으로 다시 합성\(생성 크레딧 0\) · 자막·끝 화면 전화·내레이션·배경음$/);
    assert.deepEqual(forbidden(cc.note), []);
  }
  const [cb] = await sql`select v.body from mkt_versions v where v.content_id = ${P.clip.content} and v.version = 3`; assert.match(cb.body, /^퇴근 전 10분, 오늘 할 일을/);
  // 목록: 다시 합성됨 · 다시 눌러도 같은 영상을 두 번 만들지 않음
  assert.deepEqual([(await row(P.v2Ledger)).status, (await row(P.clip.ledger)).status], ['done', 'done']);
  const again = await ctx.owner.ok('POST', '/api/marketing/studio/reuse', { ledgerIds: [P.v2Ledger, P.clip.ledger] });
  assert.equal(again.started, 0); assert.deepEqual(again.skipped.map((x) => x.reason), ['이미 다시 합성함', '이미 다시 합성함']);
  // 제작의뢰실 의뢰 목록: '기존 영상 다시 합성' 진행 요약
  const sv = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === bclip.id);
  assert.deepEqual([sv.progress.reuse, sv.progress.stage, sv.progress.variants[0].scenes.map((x) => x.seconds)], [true, 'done', [3.2, 3.2]]);
  const [au] = await sql`select detail from audit_logs where action = 'mkt.video_reuse' order by created_at desc limit 1`; assert.equal(au.detail.started, 0);
});

test('네 편 이상은 처음 3편만 바로, 나머지는 정기 실행이 이어받음 · 가로 영상은 가로로 · 원본을 못 읽으면 두 번 시도 뒤 실패 → 목록 [다시 시도]', async () => {
  const ids = [];
  for (const [k, w, h] of [[1, 1080, 1920], [2, 1080, 1920], [3, 1920, 1080], [4, 1080, 1920]]) ids.push((await seedClip(`릴스 · 묶음 ${k}`, await upload(`묶음 ${k}.mp4`, 'video/mp4', mp4(5, w, h), '마케팅'), { body: `묶음 ${k}번 영상 한 줄 자막입니다.` })).ledger);
  // 저장소에 원본이 없는 영상(파일 줄만 있음)
  const [bad] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, storage_key, upload_status, source, created_by)
    values ('default', 'marketing', '마케팅', '사라진 원본.mp4', '사라진 원본.mp4', 'video/mp4', 1000, ${'lib/default/missing/none.mp4'}, 'ready', 'user', ${ctx.ownerId}) returning id`;
  const broken = (await seedClip('릴스 · 원본 사라짐', bad.id)).ledger;
  const out = await ctx.owner.ok('POST', '/api/marketing/studio/reuse', { ledgerIds: [...ids, broken] });
  assert.equal(out.started, 5);
  const stat = async () => Object.fromEntries((await sql`select result->'reuse'->>'ledger' as l, status from mkt_briefs where id = any(${out.briefIds}::uuid[])`).map((x) => [Number(x.l), x.status]));
  let s = await stat();
  assert.deepEqual(ids.slice(0, 3).map((l) => s[l]), ['review', 'review', 'review'], '처음 3편은 바로');
  assert.deepEqual([s[ids[3]], s[broken]], ['generating', 'generating'], '나머지는 정기 실행 몫');
  const t1 = await tick(); assert.equal(t1.detail.mktRender.kicked, 2);
  s = await stat(); assert.equal(s[ids[3]], 'review'); assert.equal(s[broken], 'generating', '원본을 못 읽으면 한 번 더');
  await tick(); s = await stat(); assert.equal(s[broken], 'failed', '두 번 실패하면 실패');
  const [wide] = await sql`select result->'mediaIds'->>0 as f from mkt_briefs where result->'reuse'->>'ledger' = ${String(ids[2])}`;
  const fw = await probe(wide.f); assert.deepEqual([fw.w, fw.h], [1920, 1080], '가로 원본 = 가로 영상'); assert.ok(Math.abs(fw.duration - 7.0) < 0.3, `길이 ${fw.duration}`);
  const rb = await row(broken);
  assert.equal(rb.status, 'failed'); assert.match(rb.reason, /^지난번 실패: /); assert.deepEqual(forbidden(rb.reason), []);
  // 실패한 다시 합성 의뢰 카드에서 [생성]·[AI 다시 쓰기]는 막힘(크레딧이 드는 생성으로 새지 않게) — 취소만
  const [fb] = await sql`select id from mkt_briefs where result->'reuse'->>'ledger' = ${String(broken)} and status = 'failed'`;
  const hf0 = (await st()).hf.length;
  for (const action of ['generate', 'prompt']) {
    const res = await ctx.owner.req('PATCH', `/api/marketing/studio/${fb.id}`, { action });
    assert.equal(res.status, 400, action); assert.match(res.body.error.message, /다시 합성 의뢰는 고치거나 새로 생성할 수 없습니다/);
  }
  assert.equal((await st()).hf.length, hf0, '생성 호출 없음');
  const retry = await ctx.owner.ok('POST', '/api/marketing/studio/reuse', { ledgerIds: [broken] });
  assert.equal(retry.started, 1, '실패한 줄은 다시 시도할 수 있음');
});
