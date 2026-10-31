// 188차(대표 #685 '폴더명 말고 모든 사진·영상 · 실사 보정 시도 없음' · #695 '되도록 모든 화면에 실사, 겹치지 않게' · #621 '그냥 쓰지 말고 보정 · 시안 기록에 어떤 사진·왜·보정'):
// ① 사진 후보 = 자료실 전체(공간·폴더 무관) — 기밀 폴더·격리 팀·AI 비서 첨부는 빼고, 마케팅 공간 밖 사진은 AI 설명이 실사·얼굴 없음일 때만
// ② 카드뉴스 모든 장 실사(행동 장 빼고) ③ 서버 보정(밝기·확대·선명) 기록 + 상세 '사진 기록' ④ 겹침 금지(같은 브랜드 가까운 12개 글 · 다른 브랜드 앞뒤 2일)
// ⑤ 자료실 영상 → 장면 사진 2~3장(ffmpeg) + 사진 AI 설명 + 영상 설명(#619) — 구조 시험(가짜 AI·시험 저장소). 실제 사진·영상 품질은 운영에서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = { kicker: '소식', kickerAlts: [], points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '', scene: '', tags: [], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', pose: 'none', facing: 'none', light: 'bright', ...o });
/** 위·아래 두 띠 사진 — 줄여도 밝기 폭(표준편차)이 남아 보정 판단을 시험할 수 있음(한 색 사진은 보정하지 않음) */
const bands = (w, h, top, bottom) => sharp({ create: { width: w, height: h, channels: 3, background: { r: bottom, g: bottom, b: bottom } } })
  .composite([{ input: { create: { width: w, height: Math.floor(h / 2), channels: 3, background: { r: top, g: top, b: top } } }, left: 0, top: 0 }]).jpeg({ quality: 95 }).toBuffer();
const normal = () => bands(1200, 1500, 80, 200); // 평균 140·폭 60 → 보정 없음
async function lib(name, data, { space = 'marketing', folder = '마케팅/사진', vision = null, source = 'upload', by = null, mime = 'image/jpeg', tags = [] } = {}) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
    values ('default', ${space}, ${folder}, ${name}, ${name}, ${mime}, ${data.length}, ${by ?? ctx.ownerId}, 'ready', ${source}, ${tags}, ${vision ? sql.json(vision) : null}) returning id`;
  const key = `lib/default/${f.id}/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
async function slot(brand, title, { kind = 'feed', at }) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${brand}, ${title}, 'instagram', ${at}, 'draft', 0, ${ctx.ownerId}, ${kind}, true, now(), false, ${[]}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.quality, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const used = (c) => [c.quality.visual.photoId, ...(c.quality.visual.photoIds ?? []), ...(c.quality.pages ?? []).map((p) => p.photoId)].filter(Boolean);
const day = (n, h = 0) => new Date(Date.now() + n * 864e5 + h * 3600e3);
/** 원고(가짜 AI) 하나 넣고 [지금 실행] — 앞서 남은 칸은 미뤄 둠 */
async function produce(id, title, slides) {
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where tenant = 'default' and status = 'draft' and produced_at is null and id <> ${id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title, body: `${title}\n가볍게 들러 보세요.\n문의 032-111-2222`, brief: '', why: '', hooks: [], keyword: '', card: CARD, slides })] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === id && !p.error), JSON.stringify(run.produced));
  return cur(id);
}
const SLIDES = (cover) => [{ role: 'cover', title: cover, body: '' }, { role: 'problem', title: '탈의실 사물함 부족', body: '퇴근 시간마다 자리가 없어요' }, { role: 'solution', title: '샤워실 새 단장', body: '물줄기가 세졌어요' },
  { role: 'proof', title: '창고 정리로 넓어진 공간', body: '기구 사이가 넓어졌어요' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }];

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3, autoHold: false });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '실사브랜드' })).id;
  P.other = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '옆브랜드' })).id;
  // 288차 #814-2: 기본은 '이 브랜드 사진만'(이름 없는 사진 안 씀 — mkt-brand-photo-814 시험) — 이 시험은 188차 후보 규칙(공간 밖·기밀·격리·얼굴)을 보려고 예전 방식(any)으로
  for (const b of [P.brand, P.other]) await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b}`, { intro: '동네 운동 공간', products: '1개월 회원권', facts: { phone: '032-111-2222' }, video: { photoSource: 'any' } });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('188차 ①②③ 후보 = 자료실 전체(공간 밖 실사 포함·기밀 폴더·격리 팀·AI 첨부·얼굴·설명 전 제외) · 행동 장 빼고 모든 장 실사 · 보정 기록 · 사진 기록', async () => {
  P.cover = await lib('실사브랜드 매장 전경.jpg', await normal(), { vision: V({ caption: '매장 전경', tags: ['매장', '전경'] }) });
  P.dark = await lib('실사브랜드 탈의실.jpg', await bands(1200, 1500, 25, 125), { vision: V({ caption: '탈의실 사물함', tags: ['탈의실', '사물함'], light: 'normal' }) }); // 평균 75 → 밝기 보정
  P.small = await lib('실사브랜드 샤워실.jpg', await bands(400, 500, 80, 200), { vision: V({ caption: '샤워실', tags: ['샤워실'] }) }); // 칸(1080×1350)보다 2.7배 작음 → 확대·선명
  P.work = await lib('창고 정리 현장.jpg', await normal(), { space: 'work', folder: '운영/현장', vision: V({ caption: '창고 선반 정리', tags: ['창고', '선반'] }) }); // 업무 공간 실사(브랜드 이름 없음 → 낱말이 맞는 장에만)
  // 빼야 하는 사진 — 모두 '창고' 낱말이 있어 넣으면 4장(창고 정리)에 잡힐 사진들
  const face = await lib('창고 직원.jpg', await normal(), { space: 'work', folder: '운영/현장', vision: V({ caption: '창고 직원', tags: ['창고'], faces: true, people: 1 }) });
  const nodesc = await lib('창고 사진.jpg', await normal(), { space: 'work', folder: '운영/현장' }); // AI 설명 전 — 공간 밖은 안 씀
  await sql`insert into library_folder_security (tenant, folder, security) values ('default', '인사', 'confidential')`;
  const conf = await lib('창고 행사.jpg', await normal(), { space: 'work', folder: '인사/행사', vision: V({ tags: ['창고'] }) }); // 상위 폴더 '인사' 가 기밀
  const [team] = await sql`insert into teams (tenant, name, kind, isolated) values ('default', '격리팀', 'team', true) returning id`;
  await sql`insert into team_members (team_id, user_id) values (${team.id}, ${ctx.staffB.id})`;
  const iso = await lib('창고 격리팀.jpg', await normal(), { space: 'work', folder: '운영/현장', by: ctx.staffB.id, vision: V({ tags: ['창고'] }) });
  const chat = await lib('창고 대화 첨부.jpg', await normal(), { space: 'work', folder: '', source: 'ai_attach', vision: V({ tags: ['창고'] }) });
  const id = await slot(P.brand, '실사브랜드 매장 둘러보기', { at: day(3) });
  const c = await produce(id, '매장 둘러보기', SLIDES('매장 둘러보기'));
  P.a = id;
  assert.equal(c.media_ids.length, 5, JSON.stringify(c.quality));
  assert.equal(c.quality.visual.photoId, P.cover, JSON.stringify(c.quality.visual));
  // ② 행동 장(마지막)만 빼고 모든 장 실사 — 그 장 글과 낱말이 맞는 사진(업무 공간 실사 포함)
  assert.deepEqual(c.quality.pages.map((p) => p.photoId ?? null), [P.dark, P.small, P.work, null], JSON.stringify(c.quality.pages));
  assert.ok(!c.quality.pages.some((p) => [face, nodesc, conf, iso, chat].includes(p.photoId)), '얼굴·설명 전·기밀 폴더·격리 팀·AI 첨부 사진은 안 씀');
  // ③ 보정: 어두운 사진 = 밝기 · 작은 사진 = 확대·선명 · 보통 사진 = 없음 → 노트 '보정 2장'
  assert.deepEqual(c.quality.pages.map((p) => p.fix ?? null), [['밝기'], ['확대', '선명'], null, null]);
  assert.equal(c.quality.visual.fix, undefined, '표지(보통 사진)는 보정 없음');
  assert.match(c.note, /카드 5장\(실사 3장 · 후보 3장 · 보정 2장\)$/, c.note);
  const [d2] = await sql`select description, meta from library_files where id = ${c.media_ids[1]}`;
  assert.match(d2.description, /사진: 실사브랜드 탈의실\.jpg\(보정: 밝기\)/);
  assert.deepEqual(d2.meta.fix, ['밝기']);
  // 보정한 사진이 실제로 밝아졌는지: 그린 장의 위쪽(사진 어두운 띠 자리) 밝기가 원본 어두운 띠(25)보다 높음
  const slide = await readFile(path.join(tmpdir(), 'workos-test', 'uploads', (await sql`select storage_key from library_files where id = ${c.media_ids[1]}`)[0].storage_key));
  const top = await sharp(slide).extract({ left: 400, top: 380, width: 280, height: 120 }).greyscale().stats();
  assert.ok(top.channels[0].mean > 28, `밝기 보정 뒤 위쪽 평균 ${top.channels[0].mean}(보정 전 사진 띠 25)`);
  // 사진 기록(상세): 표지·장마다 사진·까닭·보정 · 행동 장 = 글자만
  const det = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  const rec = det.photoRecord;
  assert.deepEqual(rec.map((r) => [r.where, r.id]), [['표지', P.cover], ['2장', P.dark], ['3장', P.small], ['4장', P.work], ['5장', null]], JSON.stringify(rec));
  assert.deepEqual([rec[1].fix, rec[2].fix, rec[3].space, rec[3].folder], [['밝기'], ['확대', '선명'], 'work', '운영/현장']);
  assert.match(rec[0].why, /표지 바탕/); assert.match(rec[3].why, /낱말이 맞는/); assert.match(rec[4].why, /행동 장/);
  // 사진 AI 설명 화면: 공간 밖 실사도 목록·숫자에(빼는 사진은 목록에도 없음) · 판정 고치기도 됨, 기밀 폴더 사진은 404
  const view = await ctx.owner.ok('GET', '/api/marketing/photos');
  const it = Object.fromEntries(view.items.map((x) => [x.id, x]));
  assert.ok(it[P.work] && it[P.work].space === 'work' && it[P.work].cover, JSON.stringify(it[P.work]));
  assert.ok(it[face] && !it[face].cover && !it[face].body, '얼굴 보이는 공간 밖 사진 = 쓰지 않음');
  assert.ok(it[nodesc] && !it[nodesc].body, '설명 전 공간 밖 사진 = 아직 안 씀');
  for (const x of [conf, iso, chat]) assert.equal(it[x], undefined, `빼는 사진이 목록에 있음 ${x}`);
  assert.equal(view.outside, 3, `공간 밖 사진(업무 실사·얼굴·설명 전) ${view.outside}`);
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/photos/${conf}`, { text: 'skip' })).status, 404);
  assert.deepEqual((await ctx.owner.ok('PATCH', `/api/marketing/photos/${nodesc}`, { text: 'skip' })).tags, ['쓰지않음']);
});

test('188차 ④ 겹침 금지 — 같은 브랜드 가까운 글은 표지·장 사진을 다시 안 씀 · 다른 브랜드는 앞뒤 2일 글만 · 먼 다른 브랜드 글은 씀', async () => {
  const a = await cur(P.a);
  const aUsed = used(a);
  assert.equal(aUsed.length, 4);
  P.locker2 = await lib('실사브랜드 탈의실 2.jpg', await normal(), { vision: V({ caption: '새 사물함', tags: ['탈의실', '사물함'] }) });
  P.shower2 = await lib('실사브랜드 샤워실 2.jpg', await normal(), { vision: V({ caption: '샤워 부스', tags: ['샤워실'] }) });
  // 같은 브랜드·3시간 뒤 글: 같은 장 글이어도 앞 글이 쓴 사진(표지·탈의실·샤워실·창고)은 안 씀 → 새 사진만, 남는 장은 색 바탕
  const b = await produce(await slot(P.brand, '실사브랜드 매장 다시 보기', { at: day(3, 3) }), '매장 다시 보기', SLIDES('매장 다시 보기'));
  const bUsed = used(b);
  assert.ok(bUsed.length >= 2, JSON.stringify(b.quality));
  assert.deepEqual(bUsed.filter((x) => aUsed.includes(x)), [], `가까운 같은 브랜드 글과 겹침: ${JSON.stringify(b.quality)}`);
  assert.ok(bUsed.includes(P.locker2) && bUsed.includes(P.shower2), JSON.stringify(b.quality));
  // 다른 브랜드·하루 뒤 글: 앞 글의 업무 공간 실사(창고)는 앞뒤 2일 안이라 안 씀 → 새 창고 사진
  P.work2 = await lib('창고 새 선반.jpg', await normal(), { space: 'work', folder: '운영/현장', vision: V({ caption: '창고 새 선반', tags: ['창고', '선반'] }) });
  P.gate = await lib('옆브랜드 입구.jpg', await normal(), { vision: V({ caption: '입구', tags: ['입구'] }) }); // 옆브랜드 표지(브랜드 사진이 먼저)
  const c = await produce(await slot(P.other, '옆브랜드 공간 소식', { at: day(4) }), '공간 소식', SLIDES('공간 소식'));
  assert.equal(c.quality.pages[2].photoId, P.work2, JSON.stringify(c.quality.pages));
  assert.ok(!used(c).includes(P.work), '다른 브랜드라도 앞뒤 2일 안 글의 사진은 안 씀');
  assert.equal(c.quality.visual.photoId, P.gate);
  // 다른 브랜드·일주일 뒤 글: 같은 브랜드 가까운 글(위 글)이 쓴 표지·새 창고 사진은 빼고, 먼 다른 브랜드 글의 창고 사진은 다시 씀
  P.counter = await lib('옆브랜드 카운터.jpg', await normal(), { vision: V({ caption: '안내 카운터', tags: ['카운터'] }) });
  const d = await produce(await slot(P.other, '옆브랜드 다음 주 소식', { at: day(10) }), '다음 주 소식', SLIDES('다음 주 소식'));
  assert.equal(d.quality.visual.photoId, P.counter, '같은 브랜드 가까운 글의 표지(입구)는 다시 안 씀');
  assert.equal(d.quality.pages[2].photoId, P.work, JSON.stringify(d.quality.pages));
});

test('188차 ⑤ 영상 장면: 자료실 영상 → 장면 사진 3장(2초·가운데·끝 무렵) + AI 설명 + 영상 설명 · AI 영상 건너뜀 · 깨진 영상 실패 기록 · 관리자만 · 장면 사진도 시안 실사 후보', async () => {
  const dir = path.join(tmpdir(), 'workos-test', 'scenes-src'); await mkdir(dir, { recursive: true });
  const mp4 = path.join(dir, 'clip.mp4');
  execFileSync(path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=9:size=640x360:rate=10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', mp4]);
  const data = await readFile(mp4);
  const vid = await lib('실사브랜드 현장 릴스 원본.mp4', data, { space: 'work', folder: '현장/영상', mime: 'video/mp4', tags: ['실사브랜드'] }); // 이름에 '릴스' — 장면 사진은 이름 규칙이 아니라 AI 설명으로 판정
  const ai = await lib('AI 생성 홍보 영상.mp4', data, { folder: '마케팅', mime: 'video/mp4' });
  const bad = await lib('깨진 영상.mp4', Buffer.from('not a video'), { folder: '마케팅', mime: 'video/mp4' });
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/photos/scenes', {})).status, 403, '관리자만');
  const before = (await ctx.owner.ok('GET', '/api/marketing/photos')).videos;
  assert.deepEqual([before.total, before.pending, before.done], [3, 3, 0]);
  await ctl({ anthropicReset: true });
  const r = await ctx.owner.ok('POST', '/api/marketing/photos/scenes', {});
  assert.deepEqual([r.done, r.skipped, r.failed, r.frames, r.described, r.left], [1, 1, 1, 3, 3, 1], JSON.stringify(r));
  const frames = await sql`select id, title, folder, space, source, mime_type, tags, meta, vision, description from library_files where source = 'video_frame' and deleted_at is null order by (meta->'video'->>'at')::numeric`;
  assert.equal(frames.length, 3);
  assert.deepEqual(frames.map((f) => f.meta.video.at), [2, 4.5, 7.4], '9초 영상 → 2초·가운데·82%');
  for (const f of frames) {
    assert.deepEqual([f.folder, f.space, f.mime_type, f.meta.video.id], ['마케팅/영상 장면', 'marketing', 'image/jpeg', vid]);
    assert.ok(f.tags.includes('영상 장면') && f.tags.includes('실사브랜드'), JSON.stringify(f.tags));
    assert.equal(f.vision.caption, '실내를 찍은 사진'); assert.equal(f.description, '실내를 찍은 사진');
  }
  assert.match(frames[0].title, /^실사브랜드 현장 릴스 원본 — 장면 1\(0:02\)$/);
  const [v] = await sql`select meta, description from library_files where id = ${vid}`;
  assert.deepEqual([v.meta.scenes.frames.length, v.description], [3, '영상 장면: 실내를 찍은 사진'], '#619 영상 설명 = 장면 설명');
  const [va] = await sql`select meta from library_files where id = ${ai}`; assert.match(va.meta.scenes.skipped, /AI 생성/);
  const [vb] = await sql`select meta from library_files where id = ${bad}`; assert.equal(vb.meta.scenes.tries, 1); assert.ok(vb.meta.scenes.error, JSON.stringify(vb.meta));
  const view = await ctx.owner.ok('GET', '/api/marketing/photos');
  assert.deepEqual([view.videos.total, view.videos.done, view.videos.failed, view.videos.skipped, view.videos.frames, view.videos.pending, view.scenes], [3, 1, 1, 1, 3, 0, 3]);
  assert.ok(view.items.filter((x) => x.scene).every((x) => x.space === 'marketing'));
  // 장면 사진이 바탕 실사로 판정되면(글자 없음) 장 사진으로 씀 — 노트 '영상 장면 1장'·장 기록 scene
  await sql`update library_files set vision = ${sql.json(V({ caption: '현장 작업 장면', tags: ['현장', '작업'] }))} where id = ${frames[1].id}`;
  const door = await lib('실사브랜드 입구.jpg', await normal(), { vision: V({ caption: '입구', tags: ['입구'] }) }); // 표지는 이 사진(장면 사진은 장에)
  const slides = [{ role: 'cover', title: '이번 주 소식', body: '' }, { role: 'problem', title: '현장 작업 모습', body: '안전하게 작업합니다' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }];
  const c = await produce(await slot(P.brand, '실사브랜드 이번 주 소식', { at: day(20) }), '이번 주 소식', slides);
  assert.equal(c.quality.visual.photoId, door, JSON.stringify(c.quality.visual));
  assert.equal(c.quality.pages[0].photoId, frames[1].id, JSON.stringify(c.quality.pages));
  assert.equal(c.quality.pages[0].scene, true);
  assert.match(c.note, /영상 장면 1장/, c.note);
  // 원본 영상을 지우면 그 장면 사진은 후보·목록에서 빠짐
  await sql`update library_files set deleted_at = now() where id = ${vid}`;
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/photos')).scenes, 0);
});
