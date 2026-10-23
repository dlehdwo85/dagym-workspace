// #516 승인 대기 시안 없음(대표 10/23 23:50): 자동 제작 피드·스토리는 서버가 시안을 그려 붙인 뒤 승인 대기(크레딧 0, 이미지 제작 카드 없음) — 릴스는 영상 카드 + '영상 시안 제작 중'
// · 시안 없이 걸린 자동 글 = 정기 실행이 그려 붙여 v2 재승인(사람이 수정 요청한 것은 그대로) · [지금 만들기] API · 시안 붙이면 '시안 없음' 줄 지움
// · 승인 마감이 지난 미승인 자동 글 = 다음 슬롯으로 미루고 알림(최대 3번, 그다음 정리) · 글만 승인 막기
// 구조 시험(가짜 AI·시험 저장소) — 운영 사진 고르기·그림 품질은 실제 화면에서 확인
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const kstYmd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
const kstHm = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(d));
async function libFile(owner, data, name, space = 'marketing') {
  const [u] = await sql`select tenant from users where id = ${owner}`;
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source)
    values (${u.tenant}, ${space}, '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${owner}, 'ready', 'upload') returning id`;
  const key = `lib/${u.tenant}/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
async function dims(fileId) {
  const res = await fetch(`${BASE}/api/library/${fileId}/download?inline=1`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
  assert.equal(res.status, 200);
  const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  return `${m.width}x${m.height}`;
}
/** 시안 없이 승인 대기에 걸린 자동 제작 글(운영 10/24 상황) — 이미지 제작 카드 열림 */
async function stuck(title, { channel = 'instagram', kind = 'feed', status = 'pending', at = new Date(Date.now() + 2 * 86400e3), issues = [], brand = P.brand } = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values ('default', ${title}, ${channel}, ${kind}, ${at}, ${status}, 1, ${ctx.ownerId}, true, now(), ${brand}, ${sql.json({ passed: !issues.length, issues, report: { v: 1 } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${`${title}\n가을 운동을 시작하기 좋은 때입니다.`}, ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  await sql`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status) values ('default', ${c.id}, 1, 'image', '실사', 0, 'open')`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, c.scheduled_at, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id;
  P.other = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '바디랩' })).id;
  P.plain = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '워크인' })).id; // 자기 사진 없음 → 브랜드 색 바탕
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 플랫폼', products: '커뮤니티 예약·관리' });
  await sql`update mkt_brands set color = '#0F766E' where id = ${P.brand}`;
  const jpg = (r, g, b) => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  // 사진 고르기: 같은 브랜드 사진(이름) > 다른 브랜드 사진(−10) — 다른 브랜드 사진을 더 최근에 올려도 고르지 않음
  P.photo = await libFile(ctx.ownerId, await jpg(30, 120, 110), '하이링크 커뮤니티 라운지.jpg');
  P.wrong = await libFile(ctx.ownerId, await jpg(200, 40, 40), '바디랩 운동 사진.jpg');
  await libFile(ctx.ownerId, await jpg(10, 10, 10), '업무 공간 사진.jpg', 'work'); // 마케팅 공간 밖 사진은 안 씀
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('자동 제작: 피드·스토리는 서버가 시안을 그려 붙인 뒤 승인 대기(크레딧 0·제작 카드 없음) · 릴스는 영상 카드 + 시안 없음 줄', async () => {
  const rule = (kind, postTime) => ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind, weekdays: [0, 1, 2, 3, 4, 5, 6], postTime });
  const [feed, story, reels] = [await rule('feed', '23:00'), await rule('story', '22:00'), await rule('reels', '21:00')];
  for (const r of [feed, story, reels]) {
    const [c] = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 1`;
    await sql`update mkt_contents set produce_at = now() where id = ${c.id}`;
    await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${r.id} and id <> ${c.id}`;
    r.c = c.id;
  }
  const draft = say({ title: '커뮤니티 예약 한 번에', body: '입주민 예약 문의, 아직 전화로 받으세요?\n하이링크로 한 화면에서 정리하세요.', brief: '라운지 실사' });
  await ctl({ anthropicReset: true, anthropicQueue: [draft, draft, draft] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal(run.produced.filter((p) => !p.error).length, 3, JSON.stringify(run.produced));
  for (const [r, size] of [[feed, '1080x1350'], [story, '1080x1920']]) {
    const c = await cur(r.c);
    assert.equal(c.status, 'pending', JSON.stringify(c.quality));
    assert.equal(c.media_ids.length, 1, '시안 1장');
    assert.equal(c.quality.visual.by, 'server');
    assert.match(c.note, /시안 서버 그리기\(사진: 하이링크 커뮤니티 라운지\.jpg\)/, '같은 브랜드 사진(다른 브랜드·업무 공간 사진은 안 씀)');
    const [f] = await sql`select folder, space, source, mime_type, tags, meta from library_files where id = ${c.media_ids[0]}`;
    assert.deepEqual([f.folder, f.space, f.source, f.mime_type, f.tags, f.meta.photoId], ['마케팅/자동 시안', 'marketing', 'ai', 'image/jpeg', ['자동 시안', '하이링크'], P.photo]);
    assert.equal(await dims(c.media_ids[0]), size, '피드 4:5 · 스토리 9:16');
    assert.equal((await sql`select count(*)::int n from mkt_production_requests where content_id = ${r.c} and kind = 'image'`)[0].n, 0, '이미지 제작 카드 없음');
    assert.equal((await sql`select credits::float8 c from mkt_credit_ledger where content_id = ${r.c} and kind = 'generate_image'`)[0].c, 0, '원장: 서버 그리기 0크레딧');
  }
  const rc = await cur(reels.c);
  assert.deepEqual([rc.status, rc.media_ids.length], ['changes', 0], '영상은 붙기 전까지 승인 대기로 안 올림');
  assert.ok(rc.quality.issues.some((x) => x.startsWith('영상 시안 제작 중')), JSON.stringify(rc.quality));
  assert.equal((await sql`select count(*)::int n from mkt_production_requests where content_id = ${reels.c} and kind = 'video'`)[0].n, 1, '영상 제작 카드');
  // 영상이 붙으면(제작 카드 완료 = 새 버전) '영상 시안 제작 중' 줄이 지워지고 승인 대기
  const vid = await libFile(ctx.ownerId, Buffer.from('fake-mp4'), '릴스.mp4');
  await sql`update library_files set mime_type = 'video/mp4' where id = ${vid}`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${reels.c}/versions`, { body: '릴스 본문', mediaIds: [vid] });
  const rv = await cur(reels.c);
  assert.equal(rv.status, 'pending');
  assert.ok(!(rv.quality?.issues ?? []).some((x) => x.startsWith('영상 시안 제작 중')), JSON.stringify(rv.quality));
  // 서버가 그린 시안: 승인 가능 · [AI 이미지로 다시] = 수정 요청(사진 재생성 → 제작 카드, 크레딧)
  const fc = await cur(feed.c);
  const d = await ctx.owner.ok('POST', `/api/marketing/contents/${feed.c}/decide`, { version: fc.current_version, decision: 'changes', comment: 'AI 이미지로 다시 만들어 주세요(사진 재생성)' });
  assert.equal(d.revision.kind, 'regen_image');
  assert.equal((await sql`select est_credits::float8 e from mkt_production_requests where content_id = ${feed.c} and kind = 'regen_image'`)[0].e, 6.5);
  const sc = await cur(story.c);
  await ctx.owner.ok('POST', `/api/marketing/contents/${story.c}/decide`, { version: sc.current_version, decision: 'approve' });
});

test('시안 없이 걸린 자동 글: 정기 실행이 그려 붙여 v2 재승인 · 사람이 수정 요청한 것·영상·블로그는 그대로 · 글만 승인 막기', async () => {
  const a = await stuck('하이링크 단지 소식');
  const b = await stuck('하이링크 스토리 소식', { kind: 'story', status: 'changes', issues: ['시안 이미지 없음 — 승인함에서 [지금 만들기]'] });
  const human = await stuck('사람이 고치라고 한 글');
  await sql`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${human}, 1, 'changes', '문구 다시', ${ctx.ownerId})`;
  await sql`update mkt_contents set status = 'changes' where id = ${human}`;
  const reel = await stuck('릴스 대기', { kind: 'reels' });
  const fb = await stuck('페이스북 소식', { channel: 'facebook', brand: P.other });
  const plain = await stuck('워크인 소식', { brand: P.plain });
  // 글만 있으면 승인 안 됨(스레드만 글로 승인)
  const no = await ctx.owner.req('POST', `/api/marketing/contents/${a}/decide`, { version: 1, decision: 'approve' });
  assert.equal(no.status, 400); assert.match(no.body.error.message, /시안 이미지가 없어/);
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.deepEqual(run.visuals.filter((x) => x.error), [], JSON.stringify(run.visuals));
  for (const id of [a, b, fb, plain]) {
    const c = await cur(id);
    assert.deepEqual([c.status, c.current_version, c.media_ids.length], ['pending', 2, 1], `${id} ${JSON.stringify(c.quality)}`);
    assert.equal(c.quality.visual.by, 'server'); assert.equal(c.quality.report.v, 2, '품질 보고서도 새 버전으로');
    assert.match(c.note, /^시안 자동 그리기\(서버·크레딧 0\)/);
    assert.equal((await sql`select status from mkt_production_requests where content_id = ${id} and kind = 'image'`)[0].status, 'canceled', '열린 이미지 카드 = 서버 그리기로 대체');
    assert.ok((await sql`select 1 from notifications where entity_id = ${id} and title = ${`시안을 붙여 다시 올렸습니다(v2): ${(await sql`select title from mkt_contents where id = ${id}`)[0].title}`}`).length);
  }
  assert.deepEqual((await cur(b)).quality.issues, [], '시안 없음 줄만 있던 글 → 줄 지우고 승인 대기');
  assert.match((await cur(fb)).note, /사진: 바디랩 운동 사진\.jpg/, '브랜드마다 자기 사진');
  assert.match((await cur(plain)).note, /브랜드 색 바탕$/, '자기 사진이 없으면(다른 브랜드 사진 −10) 브랜드 색 바탕');
  assert.equal(await dims((await cur(b)).media_ids[0]), '1080x1920');
  for (const id of [human, reel]) assert.deepEqual([(await cur(id)).current_version, (await cur(id)).media_ids.length], [1, 0], '사람 수정 요청·영상은 건드리지 않음');
  // 한 번 붙이면 다시 그리지 않음
  assert.deepEqual((await ctx.owner.ok('POST', '/api/marketing/auto/run', {})).visuals, []);
  await ctx.owner.ok('POST', `/api/marketing/contents/${a}/decide`, { version: 2, decision: 'approve' });
});

test('[지금 만들기]: 그 자리에서 그려 새 버전 · 이미 있으면·영상·블로그 400 · 공간 밖 404 · 사람이 사진을 붙이면 시안 없음 줄 지움', async () => {
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '손으로 만든 인스타 글', channel: 'instagram', brandId: P.brand, body: '라운지 예약을 한 화면에서', mediaIds: [] });
  assert.equal((await ctx.staffB.client.req('POST', `/api/marketing/contents/${m.id}/visual`, {})).status, 404, '공간 밖');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/contents/00000000-0000-0000-0000-000000000000/visual', {})).status, 404);
  const r = await ctx.staffA.client.ok('POST', `/api/marketing/contents/${m.id}/visual`, {});
  assert.deepEqual([r.version, r.status, r.photo], [2, 'pending', '하이링크 커뮤니티 라운지.jpg']);
  const c = await cur(m.id);
  assert.deepEqual([c.media_ids, c.note], [[r.fileId], `시안 그리기(서버·크레딧 0) — ${(await sql`select name from users where id = ${ctx.staffA.id}`)[0].name} · 사진: 하이링크 커뮤니티 라운지.jpg`]);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.visual_now' and target_id = ${m.id}`).length, '감사 기록');
  const again = await ctx.owner.req('POST', `/api/marketing/contents/${m.id}/visual`, {});
  assert.equal(again.status, 400); assert.match(again.body.error.message, /이미 시안이 있습니다/);
  const reel = await stuck('릴스 지금 만들기', { kind: 'reels' });
  assert.match((await ctx.owner.req('POST', `/api/marketing/contents/${reel}/visual`, {})).body.error.message, /영상 시안은 서버가 그리지 않습니다/);
  const blog = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '블로그 글', channel: 'blog', body: '본문', mediaIds: [] });
  assert.match((await ctx.owner.req('POST', `/api/marketing/contents/${blog.id}/visual`, {})).body.error.message, /블로그는 표지/);
  // 사람이 사진을 붙인 새 버전: '시안 없음' 줄만 있었으면 검사 결과 비움, 다른 줄은 남김 · 서버 그림 표시(visual)는 다른 사진이면 지움
  const s = await stuck('수정 요청 대기', { status: 'changes', issues: ['시안 이미지 없음 — 승인함에서 [지금 만들기]', '채우지 않은 자리표시'] });
  await sql`update mkt_contents set quality = quality || ${sql.json({ visual: { by: 'server', fileId: P.wrong } })} where id = ${s}`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${s}/versions`, { body: '고친 본문', mediaIds: [P.photo] });
  const sq = (await cur(s)).quality;
  assert.deepEqual([sq.issues, sq.visual], [['채우지 않은 자리표시'], undefined]);
});

test('승인 마감 지난 미승인 자동 글: 다음 슬롯(같은 시각, 같은 브랜드·채널 글이 있는 날은 건너뜀)으로 미루고 알림 · 3번 미루면 정리', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { approvalHour: 9 });
  await sql`update mkt_contents set status = 'canceled' where brand_id = ${P.plain}`; // 앞 시험의 워크인 글이 빈 날을 막지 않게
  const at = new Date(Date.now() - 20 * 3600e3); // 20시간 전 게시 예정 = 그날 09:00 마감은 언제 돌려도 지남
  const id = await stuck('마감 지난 글', { at, brand: P.plain });
  // 다음 날은 같은 브랜드·채널·형식 글이 이미 있음(또는 마감 1시간 안) → 그다음 날로
  const busy = await stuck('그날 이미 있는 글', { at: new Date(at.getTime() + 86400e3), brand: P.plain });
  await sql`update mkt_versions set media_ids = ${[P.photo]} where content_id = ${busy}`; // 이 글은 시안 있음(정기 실행이 건드리지 않게)
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.notEqual(c.status, 'canceled');
  const want = new Date(at.getTime() + 2 * 86400e3);
  assert.deepEqual([kstYmd(c.scheduled_at), kstHm(c.scheduled_at)], [kstYmd(want), kstHm(at)], '이틀 뒤 같은 시각');
  assert.deepEqual([c.quality.moved, c.quality.movedFrom], [1, at.toISOString()]);
  const [n] = await sql`select title, body from notifications where entity_id = ${id} and title like '승인 마감이 지나 다음 슬롯으로 미뤘습니다%'`;
  assert.ok(n, '승인자 알림'); assert.match(n.body, /게시 · 승인 마감/);
  // 이미 3번 미룬 글은 더 미루지 않고 정리(예전처럼 '마감 지남'만 반복해 보이지 않게)
  await sql`update mkt_contents set scheduled_at = ${at}, quality = quality || '{"moved": 3}'::jsonb where id = ${id}`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await cur(id)).status, 'canceled');
});
