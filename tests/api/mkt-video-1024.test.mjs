// 398차 #1024(대표 11/13 "마케팅 영상 수준이 너무 낮습니다 — 사진이 깨져 있거나 흔들려 있고, 자막은 내용 퀄리티도 떨어지고 일찍 끊어져서 뒤에는 영상만 나오고 …
// 무조건 실사 사용하지 않아도 된다니까요?"): 사진 영상 새 기준 —
//  자막 = 영상 대본 줄을 영상 전체 길이에(훅 → … → 행동 권유, 전화번호만 있는 첫 줄·제목 되풀이·같은 줄 빼기) · 겹쳐 넘기는 구간엔 글자 없음 ·
//  실사는 품질 통과한 것만(저해상·하얗게 날아감·너무 어두움 — 뺀 이유 기록) · 없으면 브랜드 색 그래픽 카드 + 큰 글자 · 이 브랜드 화면 캡처는 휴대폰 틀로 ·
//  렌더 뒤 검사(자막 덮임·자막 없는 구간·글자 크기·끝 카드 글자) 통과해야 승인함 · 승인함의 옛 기준 영상은 정기 실행이 한 번씩 다시 만듦
// (구조 시험 — 운영 화질·걸리는 시간은 운영 확인 몫)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { BASE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
async function upload(name, data, folder = '마케팅/현장 사진', mime = 'image/jpeg') {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder, space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
const pic = (w, h, fill, k = 1) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${fill}"/>${fill === '#ffffff' || fill === '#050505' ? '' : Array.from({ length: 10 }, (_, i) => `<rect x="${(w / 10) * i + 10}" y="${(h / 5) * ((i * k) % 4) + 20}" width="${w / 14}" height="${h / 7}" fill="#fff" opacity="0.75"/><circle cx="${(w / 10) * i + 40}" cy="${h * 0.8}" r="${h / 16}" fill="#123" opacity="0.7"/>`).join('')}</svg>`)).jpeg({ quality: 90 }).toBuffer();
async function probe(fileId) {
  const [f] = await sql`select storage_key from library_files where id = ${fileId}`;
  const r = spawnSync(FF, ['-hide_banner', '-i', join(tmpdir(), 'workos-test', 'uploads', f.storage_key)], { encoding: 'utf8' });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr); const v = /Video:[^\n]*?(\d{3,4})x(\d{3,4})/.exec(r.stderr);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, w: v ? +v[1] : null, h: v ? +v[2] : null };
}
const TITLE = '이사 나간 세대, 헬스장 명단은 누가 지울까요?';
const SCRIPT = ['문의 1555-2564', TITLE, '이사 나간 세대 헬스장 명단은 누가 지울까요', '관리실이 엑셀로 하나씩 지우던 일', '전출 처리와 함께 출입 권한이 자동으로 꺼집니다', '명단 정리, 이제 따로 하지 않아도 됩니다'];
async function content(kind, o = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by, quality)
    values ('default', ${P.brand}, ${o.title ?? TITLE}, 'youtube', ${kind}, 'pending', 1, ${ctx.ownerId}, ${sql.json(o.script === null ? {} : { script: o.script ?? SCRIPT })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, ${o.body ?? `${TITLE}\n문의 1555-2564\n#하이링크`}, ${[]}, ${ctx.ownerId})`;
  return c.id;
}

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { headline: '하이링크' }, facts: { phone: '1555-2564' } });
  P.good = [await upload('하이링크 출입 1.jpg', await pic(1600, 1200, 'rgb(30,120,160)', 1)), await upload('하이링크 출입 2.jpg', await pic(1400, 2100, 'rgb(60,140,90)', 3))];
  P.low = await upload('하이링크 작은 사진.jpg', await pic(400, 300, 'rgb(90,90,150)'));
  P.white = await upload('하이링크 날아간 사진.jpg', await pic(1600, 1200, '#ffffff'));
  P.dark = await upload('하이링크 어두운 사진.jpg', await pic(1600, 1200, '#050505'));
  P.cap = await upload('하이링크 앱 화면.png', await sharp(await pic(1080, 2200, 'rgb(240,244,248)', 2)).png().toBuffer(), '마케팅/영상 화면 캡처/하이링크', 'image/png');
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('대본 줄 정리(순수 함수): 훅 맨 앞 · 전화번호만 있는 줄은 맨 뒤 행동 권유로 · 제목 되풀이·같은 말 줄 빼기 · 줄 수 4~7 · 대본 검사', async () => {
  const S = await import('../../src/lib/video/slidePlan.ts');
  const a = S.slideScript({ title: TITLE, body: '', script: SCRIPT, phone: '1555-2564' });
  assert.equal(a.from, 'script');
  assert.equal(a.lines[0], TITLE.length <= 30 ? TITLE : a.lines[0], '훅(질문)이 첫 줄');
  assert.ok(S.sameLine(a.lines[0], TITLE));
  assert.equal(a.lines.filter((l) => S.sameLine(l, TITLE)).length, 1, `제목은 한 번만: ${a.lines.join(' / ')}`);
  assert.equal(a.lines[a.lines.length - 1], '지금 문의하세요 1555-2564', '마지막 = 행동 권유');
  assert.ok(!a.lines.slice(0, -1).some((l) => /1555-2564/.test(l)), '전화번호는 맨 뒤에만');
  assert.ok(a.lines.length >= 4 && a.lines.length <= 7, String(a.lines.length));
  assert.deepEqual(S.scriptIssues(a.lines, TITLE), []);
  // 대본이 없으면 글 문장으로 — 제목(질문)을 훅으로, 끝은 권유
  const b = S.slideScript({ title: '아침 운동, 어디서 하세요?', body: '아침 7시, 문을 열면 가장 먼저 반겨 주는 곳.\n깨끗한 운동 공간에서 하루를 시작하세요.\n상담은 전화로 편하게 받습니다.\n#다짐', script: [], phone: '' });
  assert.equal(b.from, 'body'); assert.equal(b.lines[0], '아침 운동, 어디서 하세요?'); assert.match(b.lines[b.lines.length - 1], /상담/);
  // 전화·권유 문구가 없으면 지어내지 않고 채널 공통 권유로 끝냄
  const c2 = S.slideScript({ title: '출입 명단, 아직 손으로 지우세요?', body: '', script: ['출입 명단, 아직 손으로 지우세요?', '이사 가면 권한이 자동으로 꺼집니다', '관리실은 한 화면에서 확인만'], phone: '' });
  assert.equal(c2.lines[c2.lines.length - 1], '자세한 내용은 프로필에서 확인해 보세요'); assert.deepEqual(S.scriptIssues(c2.lines, '출입 명단, 아직 손으로 지우세요?'), []);
  // 검사: 전화번호 첫 줄·줄 모자람·제목 되풀이·같은 말
  const bad = S.scriptIssues(['문의 1555-2564', TITLE, TITLE], TITLE).join(' | ');
  assert.match(bad, /줄뿐/); assert.match(bad, /전화번호/); assert.match(bad, /되풀이/);
  // 렌더 뒤 검사
  const ok = { lines: a.lines, title: TITLE, cover: 0.8, maxGap: 0.5, subPct: 5.6, endPct: 9.5, photos: 1, cards: 3, screens: 1 };
  assert.deepEqual(S.slideChecks(ok).fails, []);
  const f = S.slideChecks({ ...ok, cover: 0.4, maxGap: 2.6, subPct: 3, endPct: 6.8 }).fails.join(' | ');
  for (const re of [/자막 없는 구간 2.6초/, /40%만 덮음/, /자막 글자가 작음/, /끝 카드 글자가 작음/]) assert.match(f, re);
  // 그래픽 카드 · 사진 거름(해상도·노출)
  const meta = await sharp(await S.cardPng({ w: 1080, h: 1920 }, '#0F766E', 1)).metadata(); assert.deepEqual([meta.width, meta.height, meta.format], [1080, 1920, 'png']);
  const d = { w: 1080, h: 1920 };
  const g1 = await S.gatePhoto(await pic(1600, 1200, 'rgb(30,120,160)'), d); assert.deepEqual([g1.ok, g1.mode], [true, 'contain'], '가로 사진 = 전체를 보이게');
  const g2 = await S.gatePhoto(await pic(1400, 2100, 'rgb(60,140,90)'), d); assert.deepEqual([g2.ok, g2.mode], [true, 'cover']);
  assert.match((await S.gatePhoto(await pic(400, 300, 'rgb(90,90,150)'), d)).why, /저해상/);
  assert.match((await S.gatePhoto(await pic(1600, 1200, '#ffffff'), d)).why, /하얗게/);
  assert.match((await S.gatePhoto(await pic(1600, 1200, '#050505'), d)).why, /어두움/);
});

test('사진 영상: 자막이 영상 전체에(훅 → 권유) · 실사는 품질 통과한 것만(뺀 이유 기록) · 화면 캡처는 휴대폰 틀 · 첫·끝 장면 그래픽 카드 · 렌더 뒤 검사 통과', async () => {
  const id = await content('shorts');
  const r = await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: id, photoIds: [...P.good, P.low, P.white, P.dark] });
  const [b] = await sql`select status, error, result from mkt_briefs where id = ${r.briefId}`;
  assert.equal(b.status, 'review', b.error ?? JSON.stringify(b.result?.errors));
  const v = b.result.variants[0]; const sc = v.scenes;
  assert.equal(b.result.reuse.gen, 3);
  assert.ok(sc.length >= 4 && sc.every((x) => x.line.trim()), `장면마다 자막: ${sc.map((x) => x.line).join(' / ')}`);
  assert.ok(/[?？]$/.test(sc[0].line), `첫 장면 = 훅: ${sc[0].line}`); assert.equal(sc[sc.length - 1].line, '지금 문의하세요 1555-2564');
  assert.deepEqual([sc[0].mode, sc[0].big, sc[sc.length - 1].mode, sc[sc.length - 1].big], ['card', true, 'card', true], '첫·끝 = 그래픽 카드 큰 글자');
  assert.ok(sc.some((x) => x.screen?.mediaId === P.cap && x.mode === 'card'), '이 브랜드 화면 캡처 장면');
  const used = sc.filter((x) => x.key).length; assert.ok(used >= 1 && used <= 2, `통과한 실사만: ${used}`);
  assert.deepEqual(b.result.reuse.photos.every((x) => P.good.includes(x)), true);
  const why = Object.fromEntries(b.result.reuse.gated.map((g) => [g.id, g.why]));
  assert.match(why[P.low], /저해상/); assert.match(why[P.white], /하얗게/); assert.match(why[P.dark], /어두움/);
  assert.deepEqual(v.slide.fails, [], JSON.stringify(v.slide));
  assert.ok(v.slide.cover >= 0.72 && v.slide.maxGap <= 1.5 && v.slide.endPct >= 8 && v.slide.subPct >= 4.6, JSON.stringify(v.slide));
  const [ver] = await sql`select media_ids, note from mkt_versions where content_id = ${id} and version = 2`;
  assert.match(ver.note, /^그래픽·사진 영상\(장면 \d개 — 그래픽 카드 \d · 화면 캡처 1 · 품질 통과 실사 [12] · 생성 비용 0\) · 자막·끝 화면 전화/);
  const p = await probe(ver.media_ids[0]); assert.deepEqual([p.w, p.h], [1080, 1920]);
  const want = sc.reduce((a, x) => a + x.seconds, 0) - 0.4 * (sc.length - 1) - 0.5 + 2.5;
  assert.ok(Math.abs(p.duration - want) < 0.8, `길이 ${p.duration} ≈ ${want}`);
});

test('실사가 하나도 없어도 만듦(그래픽 카드만) · 대본·글이 모자라면 만들지 않음(자막 없는 영상 없음)', async () => {
  const id = await content('reels', { title: '관리비 고지서, 헬스장 이용료는 어떻게 넣나요?', script: ['관리비 고지서에 헬스장 이용료를 따로 적고 계신가요?', '하이링크는 이용 기록을 관리비에 자동으로 넘깁니다', '엑셀 정리 없이 한 번에 끝납니다', '도입 상담은 전화로 받습니다'] });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio/slideshow', { contentId: id, photoIds: [P.low, P.white, P.dark] });
  const [b] = await sql`select status, error, result from mkt_briefs where id = ${r.briefId}`;
  assert.equal(b.status, 'review', b.error ?? '');
  const sc = b.result.variants[0].scenes;
  assert.equal(sc.filter((x) => x.key).length, 0, '품질 미달 실사는 안 씀'); assert.ok(sc.every((x) => x.mode === 'card'));
  assert.deepEqual(b.result.variants[0].slide.fails, []);
  const none = await content('shorts', { title: '하이링크', script: null, body: '#하이링크' });
  const e = await ctx.owner.req('POST', '/api/marketing/studio/slideshow', { contentId: none });
  assert.equal(e.status, 400); assert.match(e.body.error.message, /대본이 \d줄뿐/);
});

test('정기 실행: 승인함의 옛 기준 자동 사진 영상은 새 기준으로 한 번 다시 만들어 그 판에 바꿔 붙임(상태 그대로 · 글마다 한 번)', async () => {
  const id = await content('shorts');
  const old = await upload('옛 영상.mp4', Buffer.from('old-video'), '마케팅', 'video/mp4');
  await sql`update mkt_versions set media_ids = ${[old]} where content_id = ${id} and version = 1`;
  await sql`insert into mkt_briefs (tenant, brand_id, channel, kind, purpose, message, refs, quantity, status, prompt, content_id, est_credits, result, created_by, mode)
    values ('default', ${P.brand}, 'youtube', 'shorts', 'awareness', ${TITLE}, ${sql.json({ slideshow: true })}, 1, 'review', ${sql.json({ caption: '', source: 'slideshow' })}, ${id}, 0,
      ${sql.json({ provider: 'slideshow', pipeline: 'v2', stage: 'done', variants: [], mediaIds: [old], reuse: { slideshow: true, auto: true, version: 1, photos: [] } })}, ${ctx.ownerId}, 'content')`;
  const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
  const d = (await r.json()).detail ?? {};
  assert.equal(d.mktVideoRemake?.started, 1, JSON.stringify(d.mktVideoRemake));
  for (let i = 0; i < 60; i++) { const [x] = await sql`select status from mkt_briefs where content_id = ${id} and result->'reuse'->>'replace' = 'true'`; if (x?.status === 'review' || x?.status === 'failed') break; await new Promise((f) => setTimeout(f, 1000)); }
  const [nb] = await sql`select status, error, result from mkt_briefs where content_id = ${id} and result->'reuse'->>'replace' = 'true'`;
  assert.equal(nb.status, 'review', nb.error ?? '');
  const [c] = await sql`select status, current_version, quality from mkt_contents where id = ${id}`;
  assert.deepEqual([c.status, c.current_version, c.quality.videoRemake.gen], ['pending', 1, 3], '같은 판 · 상태 그대로');
  const [ver] = await sql`select media_ids, note from mkt_versions where content_id = ${id} and version = 1`;
  assert.ok(ver.media_ids.length === 1 && ver.media_ids[0] !== old, '새 영상으로 바꿔 붙임'); assert.match(ver.note, /새 기준으로 다시 만든 영상/);
  const d2 = (await (await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } })).json()).detail ?? {};
  assert.equal(d2.mktVideoRemake?.started ?? 0, 0, '글마다 한 번');
});
