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
  // 로컬 10/24 08:15: 시안 바탕은 고른 사진(태그 '글자없음'·'마케팅/시안 바탕…' 폴더)만 — 없으면 브랜드 색
  await sql`update library_files set tags = ${['글자없음']} where id in (${P.photo}, ${P.wrong})`;
  await libFile(ctx.ownerId, await jpg(10, 10, 10), '업무 공간 사진.jpg', 'work'); // 마케팅 공간 밖 사진은 안 씀
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('자동 제작: 피드·스토리는 서버가 시안을 그려 붙인 뒤 승인 대기(크레딧 0·제작 카드 없음) · 릴스는 영상 카드 + 시안 없음 줄', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { videoPause: false }); // 요청 C: 영상 자동 제작은 기본 중단 — 이 시험은 릴스 제작 카드 흐름을 보므로 켬
  const rule = (kind, postTime) => ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind, weekdays: [0, 1, 2, 3, 4, 5, 6], postTime });
  const [feed, story, reels] = [await rule('feed', '23:00'), await rule('story', '22:00'), await rule('reels', '21:00')];
  for (const r of [feed, story, reels]) {
    const [c] = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 1`;
    await sql`update mkt_contents set produce_at = now() where id = ${c.id}`;
    await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${r.id} and id <> ${c.id}`;
    r.c = c.id;
  }
  const draft = say({ title: '커뮤니티 예약 한 번에', body: '입주민 예약 문의, 아직 전화로 받으세요?\n하이링크로 한 화면에서 정리하세요.\n스티커 제안: 투표 — 전화 예약 vs 앱 예약', brief: '라운지 실사' });
  await ctl({ anthropicReset: true, anthropicQueue: [draft, draft, draft] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal(run.produced.filter((p) => !p.error).length, 3, JSON.stringify(run.produced));
  const covers = [];
  for (const [r, size] of [[feed, '1080x1350'], [story, '1080x1920']]) {
    const c = await cur(r.c);
    assert.equal(c.status, 'pending', JSON.stringify(c.quality));
    assert.ok(c.media_ids.length >= 3, `요청 C: 표지 + 장(${c.media_ids.length}장)`);
    assert.equal(c.quality.visual.by, 'server');
    // 같은 브랜드 사진(다른 브랜드·업무 공간 사진은 안 씀) — 188차(#695 같은 브랜드 가까운 글끼리 같은 사진 금지): 라운지 사진은 먼저 만든 글 하나만, 다른 글은 남은 사진이 없어 브랜드 색 바탕
    assert.match(c.note, /시안 서버 그리기\((사진: 하이링크 커뮤니티 라운지\.jpg|브랜드 색 바탕)\)/, c.note);
    const [f] = await sql`select folder, space, source, mime_type, tags, meta from library_files where id = ${c.media_ids[0]}`;
    assert.deepEqual([f.folder, f.space, f.source, f.mime_type, f.tags], ['마케팅/자동 시안', 'marketing', 'ai', 'image/jpeg', ['자동 시안', '하이링크']]);
    covers.push(f.meta.photoId ?? null);
    assert.equal(await dims(c.media_ids[0]), size, '피드 4:5 · 스토리 9:16');
    assert.equal((await sql`select count(*)::int n from mkt_production_requests where content_id = ${r.c} and kind = 'image'`)[0].n, 0, '이미지 제작 카드 없음');
    assert.equal((await sql`select credits::float8 c from mkt_credit_ledger where content_id = ${r.c} and kind = 'generate_image'`)[0].c, 0, '원장: 서버 그리기 0크레딧');
  }
  assert.deepEqual(covers.filter(Boolean), [P.photo], `라운지 사진은 한 글만: ${JSON.stringify(covers)}`);
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
    assert.deepEqual([c.status, c.current_version], ['pending', 2], `${id} ${JSON.stringify(c.quality)}`); assert.ok(c.media_ids.length >= 3, `요청 C: 표지 + 장(${c.media_ids.length}장)`);
    assert.equal(c.quality.visual.by, 'server'); assert.equal(c.quality.report.v, 2, '품질 보고서도 새 버전으로');
    assert.match(c.note, /^시안 자동 그리기\(서버·크레딧 0\)/);
    assert.equal((await sql`select status from mkt_production_requests where content_id = ${id} and kind = 'image'`)[0].status, 'canceled', '열린 이미지 카드 = 서버 그리기로 대체');
    assert.ok((await sql`select 1 from notifications where entity_id = ${id} and title = ${`시안을 붙여 다시 올렸습니다(v2): ${(await sql`select title from mkt_contents where id = ${id}`)[0].title}`}`).length);
  }
  assert.deepEqual((await cur(b)).quality.issues, [], '시안 없음 줄만 있던 글 → 줄 지우고 승인 대기');
  assert.match((await cur(fb)).note, /사진: 바디랩 운동 사진\.jpg/, '브랜드마다 자기 사진');
  assert.match((await cur(plain)).note, /브랜드 색 바탕( · 카드 \d장(\(실사 \d장 · 후보 \d+장\))?)?$/, '자기 사진이 없으면(다른 브랜드 사진 −10) 브랜드 색 바탕');
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
  // 188차(#695): 라운지 사진은 가까운 같은 브랜드 글(자동 제작)이 이미 써서 안 씀 → 새로 올린 예약 데스크 사진으로 그림
  P.photo2 = await libFile(ctx.ownerId, await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 40, g: 110, b: 100 } } }).jpeg().toBuffer(), '하이링크 라운지 예약 데스크.jpg');
  await sql`update library_files set tags = ${['글자없음']} where id = ${P.photo2}`;
  const r = await ctx.staffA.client.ok('POST', `/api/marketing/contents/${m.id}/visual`, {});
  assert.deepEqual([r.version, r.status, r.photo], [2, 'pending', '하이링크 라운지 예약 데스크.jpg']);
  const c = await cur(m.id);
  assert.deepEqual([c.media_ids, c.note], [[r.fileId], `시안 그리기(서버·크레딧 0) — ${(await sql`select name from users where id = ${ctx.staffA.id}`)[0].name} · 사진: 하이링크 라운지 예약 데스크.jpg`]);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.visual_now' and target_id = ${m.id}`).length, '감사 기록');
  const again = await ctx.owner.req('POST', `/api/marketing/contents/${m.id}/visual`, {});
  assert.equal(again.status, 400); assert.match(again.body.error.message, /이미 시안이 있습니다/);
  const reel = await stuck('릴스 지금 만들기', { kind: 'reels' });
  assert.match((await ctx.owner.req('POST', `/api/marketing/contents/${reel}/visual`, {})).body.error.message, /영상 시안은 서버가 그리지 않습니다/);
  // #516 후속 (c): 블로그도 [지금 만들기] — 대표 이미지(정사각) + 본문 실사 1장 → '표지+본문' 줄이 지워지고 승인 대기
  //  188차: 앞뒤 2일 다른 브랜드 글이 쓴 사진(라운지·예약 데스크·바디랩)은 안 씀 → 본문 사진은 새로 올린 브랜드 없는 실사(표지 바탕으로는 안 고른 사진 = 표지는 브랜드 색)
  await libFile(ctx.ownerId, await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 150, g: 140, b: 120 } } }).jpeg().toBuffer(), '라운지 창가 자리.jpg');
  const blog = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '블로그 글', channel: 'blog', body: '본문', mediaIds: [] });
  const bv = await ctx.owner.ok('POST', `/api/marketing/contents/${blog.id}/visual`, {});
  const bc = await cur(blog.id);
  assert.deepEqual([bv.status, bc.status, bc.media_ids.length, bc.quality.issues], ['pending', 'pending', 2, []], JSON.stringify(bc));
  assert.equal(await dims(bc.media_ids[0]), '1080x1080');
  assert.match(bc.note, / · 본문 사진: .+\.jpg$/);
  // 사람이 사진을 붙인 새 버전: '시안 없음' 줄만 있었으면 검사 결과 비움, 다른 줄은 남김 · 서버 그림 표시(visual)는 다른 사진이면 지움
  const s = await stuck('수정 요청 대기', { status: 'changes', issues: ['시안 이미지 없음 — 승인함에서 [지금 만들기]', '채우지 않은 자리표시'] });
  await sql`update mkt_contents set quality = quality || ${sql.json({ visual: { by: 'server', fileId: P.wrong } })} where id = ${s}`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${s}/versions`, { body: '고친 본문', mediaIds: [P.photo] });
  const sq = (await cur(s)).quality;
  assert.deepEqual([sq.issues, sq.visual], [['채우지 않은 자리표시'], undefined]);
});

test('승인 마감 지난 미승인 자동 글: 다음 슬롯(같은 시각, 같은 브랜드·채널·형식 글이 2건 찬 날은 건너뜀)으로 미루고 알림 · 옮길 날짜가 없으면 취소 대신 미뤄진 글([날짜 골라 다시 올리기]·[버리기]) · 10/24 09시 취소분 1회 복구', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { approvalHour: 9 });
  await sql`update mkt_contents set status = 'canceled' where brand_id = ${P.plain}`; // 앞 시험의 워크인 글이 빈 날을 막지 않게
  const at = new Date(Date.now() - 20 * 3600e3); // 20시간 전 게시 예정 = 그날 09:00 마감은 언제 돌려도 지남
  const id = await stuck('마감 지난 글', { at, brand: P.plain });
  // 다음 날은 같은 브랜드·채널·형식 글이 이미 2건(#540 하루 2건까지 — 또는 마감 1시간 안) → 그다음 날로
  const busy = await stuck('그날 이미 있는 글', { at: new Date(at.getTime() + 86400e3), brand: P.plain, status: 'approved' });
  const busy2 = await stuck('그날 이미 있는 둘째 글', { at: new Date(at.getTime() + 86400e3), brand: P.plain, status: 'approved' });
  await sql`update mkt_versions set media_ids = ${[P.photo]} where content_id in ${sql([busy, busy2])}`; // 이 글들은 시안 있음·승인됨(정기 실행이 건드리지 않게)
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.notEqual(c.status, 'canceled');
  const want = new Date(at.getTime() + 2 * 86400e3);
  assert.deepEqual([kstYmd(c.scheduled_at), kstHm(c.scheduled_at)], [kstYmd(want), kstHm(at)], '이틀 뒤 같은 시각');
  assert.deepEqual([c.quality.moved, c.quality.movedFrom], [1, at.toISOString()]);
  const [n] = await sql`select title, body from notifications where entity_id = ${id} and title like '승인 마감이 지나 다음 슬롯으로 미뤘습니다%'`;
  assert.ok(n, '승인자 알림'); assert.match(n.body, /게시 · 승인 마감/);
  // 이미 3번 미룬(=옮길 날짜가 없는) 글은 취소하지 않고 '미뤄진 글'(보류·날짜 비움) — 로컬 10/24 09:00 '대표는 미룸으로 알았는데 취소됨'
  await sql`update mkt_contents set scheduled_at = ${at}, quality = quality || '{"moved": 3}'::jsonb where id = ${id}`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const p = await cur(id);
  assert.deepEqual([p.status, p.scheduled_at, p.quality.postponed?.from], ['hold', null, at.toISOString()]);
  assert.ok((await sql`select 1 from notifications where entity_id = ${id} and title like '옮길 날짜가 없어%'`).length, '승인자 알림(취소 아님)');
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.ok(list.contents.some((x) => x.id === id && x.status === 'hold' && x.quality?.postponed), '승인함 목록에 미뤄진 글');
  // [날짜 골라 다시 올리기]: 관리자만 · 그날 승인 마감이 지난 날짜는 400 · 뒤 날짜는 그 시각 승인 대기로(미룸 횟수 초기화)
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/contents/${id}/postponed`, { action: 'discard' })).status, 403);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${id}/postponed`, { action: 'reschedule', date: kstYmd(Date.now() - 86400e3), time: '10:00' })).status, 400);
  const day = kstYmd(Date.now() + 3 * 86400e3);
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/postponed`, { action: 'reschedule', date: day, time: '11:30' });
  assert.equal(r.status, 'pending');
  const q = await cur(id);
  assert.deepEqual([q.status, kstYmd(q.scheduled_at), kstHm(q.scheduled_at), q.quality.postponed, q.quality.moved, q.quality.rescheduled?.from], ['pending', day, '11:30', undefined, undefined, at.toISOString()]);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${id}/postponed`, { action: 'discard' })).status, 400, '미뤄진 글이 아니면 거절');
  // [버리기] = 취소
  await sql`update mkt_contents set status = 'hold', scheduled_at = null, quality = quality || ${sql.json({ postponed: { from: at.toISOString() } })} where id = ${id}`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${id}/postponed`, { action: 'discard' });
  assert.equal((await cur(id)).status, 'canceled');
  // 1회 복구: 10/24 09시 정리에서 '옮길 날짜 없음'으로 취소된 시안 있는 자동 글 → 미뤄진 글(그 시각 밖·시안 없는 글은 그대로)
  const gone = await stuck('9시에 취소된 글', { at, brand: P.plain });
  const old = await stuck('예전에 취소된 글', { at, brand: P.plain });
  const bare = await stuck('시안 없는 취소 글', { at, brand: P.plain });
  await sql`update mkt_versions set media_ids = ${[P.photo]} where content_id in ${sql([gone, old])}`;
  await sql`update mkt_contents set status = 'canceled', quality = quality || '{"expired": true}'::jsonb, updated_at = '2026-10-24T09:05:00+09:00' where id in ${sql([gone, bare])}`;
  await sql`update mkt_contents set status = 'canceled', quality = quality || '{"expired": true}'::jsonb, updated_at = '2026-10-23T09:05:00+09:00' where id = ${old}`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const g = await cur(gone);
  assert.deepEqual([g.status, g.scheduled_at, g.quality.expired, g.quality.postponed?.restored, new Date(g.quality.postponed?.from).toISOString()], ['hold', null, undefined, true, at.toISOString()]);
  assert.deepEqual([(await cur(old)).status, (await cur(bare)).status], ['canceled', 'canceled']);
});

test('#540 같은 브랜드 하루 2건(대표 10/24): 같은 브랜드·채널·형식은 하루 2건까지 · 같은 시각·3시간 안 금지 · 같은 주제·같은 시안 금지 — 다음 슬롯·미뤄진 글 다시 올리기·캘린더 옮기기', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { approvalHour: 9 });
  await sql`update mkt_contents set status = 'canceled' where brand_id = ${P.plain}`;
  const day = (n) => kstYmd(Date.now() + n * 86400e3);
  const at = (n, hm) => new Date(`${day(n)}T${hm}:00+09:00`);
  /** 그날 이미 있는(승인된) 같은 브랜드·채널·형식 글 */
  const fixed = async (title, when, { media = [], ...o } = {}) => { const id = await stuck(title, { at: when, brand: P.plain, status: 'approved', ...o }); await sql`update mkt_versions set media_ids = ${media} where content_id = ${id}`; return id; };
  /** 미뤄진 글(보류·날짜 비움) */
  const postponed = async (title, { media = [], ...o } = {}) => {
    const id = await stuck(title, { at: at(-1, '10:00'), brand: P.plain, ...o });
    await sql`update mkt_versions set media_ids = ${media} where content_id = ${id}`;
    await sql`update mkt_contents set status = 'hold', scheduled_at = null, quality = quality || ${sql.json({ postponed: { from: at(-1, '10:00').toISOString(), status: 'pending' } })} where id = ${id}`;
    return id;
  };
  const again = (id, date, time) => ctx.owner.req('POST', `/api/marketing/contents/${id}/postponed`, { action: 'reschedule', date, time });

  // ① 다음 슬롯(정기 실행): 오늘은 같은 형식 글 2건으로 참(또는 승인 마감 지남) · 내일 10:00 에 1건 → 내일 13:00(원래 시각 10:00 에서 3시간 뒤, 그날 둘째 글)
  const moved = await stuck('마감 지난 미승인 글', { at: at(-1, '10:00'), brand: P.plain });
  await fixed('오늘 첫 글', at(0, '10:00')); await fixed('오늘 둘째 글', at(0, '15:00'));
  await fixed('내일 아침 글', at(1, '10:00'));
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const m = await cur(moved);
  assert.deepEqual([kstYmd(m.scheduled_at), kstHm(m.scheduled_at), m.quality.moved], [day(1), '13:00', 1], '내일, 원래 시각에서 3시간 뒤');

  // ② 미뤄진 글 [날짜 골라 다시 올리기]: 같은 시각·3시간 안은 400 + 그날 넣을 수 있는 시각 안내 · 13:00 은 됨(그날 둘째) · 2건 차면 400 · 다른 채널·형식은 따로 셈
  await fixed('사흘 뒤 아침 글', at(3, '10:00'));
  const p1 = await postponed('미뤄진 글 하나');
  const same = await again(p1, day(3), '10:00');
  assert.equal(same.status, 400);
  assert.equal(same.body.error.message, '그 시각(10:00)에 같은 브랜드·채널·형식 글이 이미 있습니다 — 그날은 13:00에 넣을 수 있습니다');
  const near = await again(p1, day(3), '11:30');
  assert.equal(near.status, 400);
  assert.equal(near.body.error.message, "같은 브랜드·채널·형식 글(10:00 '사흘 뒤 아침 글')과 3시간 넘게 띄워야 합니다 — 그날은 14:30에 넣을 수 있습니다");
  const ok1 = await ctx.owner.ok('POST', `/api/marketing/contents/${p1}/postponed`, { action: 'reschedule', date: day(3), time: '13:00' });
  assert.deepEqual([ok1.status, ok1.sameDay], ['pending', 1]);
  const full = await again(await postponed('미뤄진 글 둘'), day(3), '17:00');
  assert.equal(full.status, 400);
  assert.equal(full.body.error.message, '그날 같은 브랜드·채널·형식 글이 이미 2건입니다(하루 2건까지) — 그날은 더 넣을 수 없습니다. 다른 날을 골라 주세요');
  assert.equal((await again(await postponed('미뤄진 블로그 글', { channel: 'blog', kind: 'blog' }), day(3), '10:00')).status, 200, '블로그는 인스타 피드와 따로 셈');
  // 같은 주제(만든 글 제목이 같음 — [시험]·띄어쓰기·문장부호 무시)·같은 시안(같은 사진 파일)은 3시간 넘게 떨어져도 그날은 안 됨
  await fixed('가을 운동 시작 가이드', at(4, '10:00'));
  const topic = await again(await postponed('[시험] 가을 운동, 시작 가이드!'), day(4), '15:00');
  assert.equal(topic.status, 400);
  assert.equal(topic.body.error.message, "그날 같은 주제의 글('가을 운동 시작 가이드')이 있습니다 — 그날은 더 넣을 수 없습니다. 다른 날을 골라 주세요");
  await fixed('겨울 회원 모집', at(5, '10:00'), { media: [P.photo] });
  const pv = await postponed('봄맞이 이벤트 안내', { media: [P.photo] });
  const vis = await again(pv, day(5), '15:00');
  assert.equal(vis.status, 400);
  assert.match(vis.body.error.message, /^그날 같은 시안\(같은 사진\)을 쓴 글\('겨울 회원 모집'\)이 있습니다 — /);
  assert.equal((await again(pv, day(6), '15:00')).status, 200, '다른 날이면 됨');

  // ③ 캘린더 옮기기(게시 시각 PATCH)도 같은 검사 — 안 되면 그날 넣을 수 있는 시각 안내 · 3시간 넘게 떨어진 시각은 됨 · 시각을 안 바꾸는 수정(브랜드 바로잡기)은 검사 안 함
  const mv = await fixed('옮길 글', at(7, '10:00'));
  await fixed('그날 저녁 글', at(8, '18:00'));
  const bad = await ctx.owner.req('PATCH', `/api/marketing/contents/${mv}`, { scheduledAt: at(8, '16:00').toISOString() });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.message, "같은 브랜드·채널·형식 글(18:00 '그날 저녁 글')과 3시간 넘게 띄워야 합니다 — 그날은 13:00에 넣을 수 있습니다");
  const good = await ctx.owner.ok('PATCH', `/api/marketing/contents/${mv}`, { scheduledAt: at(8, '13:00').toISOString() });
  assert.equal(new Date(good.scheduledAt).toISOString(), at(8, '13:00').toISOString());
  await ctx.owner.ok('PATCH', `/api/marketing/contents/${mv}`, { brandId: P.plain, scheduledAt: at(8, '13:00').toISOString() });

  // ④ 대표 10/24 ③ '하루 2건 = 브랜드 × 채널 × 형식마다 각각 2건': 규칙이 칸을 만들 때도 — 같은 형식 규칙 4개(10:00·11:30·15:00·19:00) → 10:00·15:00 만(11:30 은 3시간 안, 19:00 은 셋째), 릴스는 따로 셈
  const b2 = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하루 2건 브랜드' })).id;
  await ctx.owner.ok('PUT', '/api/marketing/auto', { videoPause: false }); // 릴스 칸도 세어 보는 시험
  const dow = new Date(`${day(3)}T12:00:00+09:00`).getUTCDay();
  const rule = (kind, postTime) => ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: b2, channel: 'instagram', kind, weekdays: [dow], postTime });
  for (const t of ['10:00', '11:30', '15:00', '19:00']) await rule('feed', t);
  await rule('reels', '10:00');
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const slots = await sql`select kind, to_char(scheduled_at at time zone 'Asia/Seoul', 'HH24:MI') hm from mkt_contents where brand_id = ${b2} and status <> 'canceled'
    and (scheduled_at at time zone 'Asia/Seoul')::date = ${day(3)}::date order by kind, scheduled_at`;
  assert.deepEqual(slots.map((x) => `${x.kind} ${x.hm}`), ['feed 10:00', 'feed 15:00', 'reels 10:00']);
  await sql`update mkt_rules set active = false where brand_id = ${b2}`; await sql`update mkt_contents set status = 'canceled' where brand_id = ${b2}`;
});

test('#516 후속(로컬 10/24 07:35 글자 겹침): 글자 든 그래픽(썸네일·핀·쇼츠·문장 이름·카드뉴스 폴더)은 바탕으로 안 씀 · 예전 규칙 시안은 정기 실행이 다시 그림(실사는 그대로) · [다시 그리기(무료)]', async () => {
  const jpg = (r, g, b) => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  const dg = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await sql`update mkt_brands set color = '#1D4ED8' where id = ${dg}`;
  const real = await libFile(ctx.ownerId, await jpg(90, 90, 60), '다짐 실제 운영 현장 사진.jpg'); // 먼저 올림(같은 점수면 최근 것이 이기던 예전 규칙에서는 뒤로 밀림)
  await sql`update library_files set folder = '마케팅/시안 바탕(글자 없는 사진)' where id = ${real}`; // 고른 바탕 사진
  const untagged = await libFile(ctx.ownerId, await jpg(60, 60, 60), '다짐 헬스장 사진.jpg'); // 실사 이름이어도 고르지 않은 사진은 바탕으로 안 씀
  const g = {};
  for (const [k, name] of [['thumb', 'dg-1022-shorts-thumb.jpg'], ['pin', 'dagym-pin-2.png'], ['sentence', '관리사무소는 무엇을 받아 보나요?'], ['card', '다짐 카드 1.jpg']]) {
    g[k] = await libFile(ctx.ownerId, await jpg(250, 250, 250), name);
    await sql`update library_files set tags = ${['다짐']}, folder = ${k === 'card' ? '마케팅/카드뉴스' : '마케팅/사진'} where id = ${g[k]}`;
  }
  // ① 새로 그릴 때: 그래픽 4장은 빼고 실사
  const a = await stuck('다짐 가을 소식', { brand: dg });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const ac = await cur(a);
  assert.match(ac.note, /사진: 다짐 실제 운영 현장 사진\.jpg · 카드 3장\(실사 0장 · 후보 0장\)$/, ac.note); // 180차: 바탕 사진은 고른 1장뿐(표지에 씀) → 장 후보 0장
  assert.deepEqual([ac.quality.visual.rv, ac.quality.visual.photoId, ac.quality.visual.tried], [3, real, [real]]);
  assert.ok(untagged);
  // ② 예전 규칙(rv 없음)으로 그래픽 위에 그린 승인 전 시안 → 정기 실행이 다시 그림 · 실사였던 것은 그대로 · 사람이 수정 요청한 것은 안 건드림
  const old = async (title, photoId, { decided = false } = {}) => {
    const drawn = await libFile(ctx.ownerId, await jpg(20, 20, 20), `${title}_피드.jpg`);
    await sql`update library_files set folder = '마케팅/자동 시안', source = 'ai', meta = ${sql.json({ photoId })} where id = ${drawn}`;
    const id = await stuck(title, { brand: dg });
    await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${id}, 2, ${`${title}\n가을 운동을 시작하기 좋은 때입니다.`}, ${[drawn]}, '시안 자동 그리기(서버·크레딧 0)', ${ctx.ownerId})`;
    await sql`update mkt_contents set current_version = 2, quality = ${sql.json({ passed: true, issues: [], visual: { by: 'server', fileId: drawn, at: new Date().toISOString() } })} where id = ${id}`;
    if (decided) { await sql`insert into mkt_decisions (content_id, version, decision, comment, decided_by) values (${id}, 2, 'changes', '문구 다시', ${ctx.ownerId})`; await sql`update mkt_contents set status = 'changes' where id = ${id}`; }
    return { id, drawn };
  };
  const bad = await old('다짐 겹친 시안', g.thumb);
  const sentence = await old('다짐 문장 바탕 시안', g.sentence);
  const fine = await old('다짐 실사 바탕 시안', real);
  const human = await old('다짐 사람이 고치라는 시안', g.pin, { decided: true });
  // 188차(#695 같은 브랜드 가까운 글끼리 같은 사진 금지): 고른 바탕 사진 '실제 운영 현장'은 ①의 글이 이미 씀 → 먼저 다시 그리는 글(bad)은 둘째 고른 사진, 다음 글(sentence)은 남은 사진이 없어 브랜드 색 바탕
  const real2 = await libFile(ctx.ownerId, await jpg(100, 95, 70), '다짐 운영 현장 둘째 사진.jpg');
  await sql`update library_files set folder = '마케팅/시안 바탕(글자 없는 사진)' where id = ${real2}`;
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.deepEqual(run.redraws.filter((x) => x.error), [], JSON.stringify(run.redraws));
  for (const [o, photo, title, was] of [[bad, real2, '사진: 다짐 운영 현장 둘째 사진\\.jpg', g.thumb], [sentence, null, '브랜드 색 바탕', g.sentence]]) {
    const c = await cur(o.id);
    assert.deepEqual([c.status, c.current_version, c.media_ids.length], ['pending', 3, 3], JSON.stringify(c.quality)); // 요청 C: 표지 1장뿐이던 예전 글은 다시 그릴 때 장도 붙임(표지 + 2)
    assert.notEqual(c.media_ids[0], o.drawn);
    assert.match(c.note, new RegExp(`^시안 다시 그리기\\(바탕 = 브랜드 색 또는 고른 사진·서버·크레딧 0\\) — ${title} · 카드 3장\\(실사 0장 · 후보 0장\\)$`), c.note);
    assert.equal(c.quality.visual.rv, 3); assert.equal(c.quality.visual.photoId, photo);
    assert.deepEqual(c.quality.visual.tried, photo ? [was, photo] : [was], JSON.stringify(c.quality.visual));
    assert.ok((await sql`select 1 from notifications where entity_id = ${o.id} and title like '시안을 다시 그렸습니다(v3)%'`).length, '승인자 알림');
    assert.equal((await sql`select credits::float8 c from mkt_credit_ledger where content_id = ${o.id} and version = 3`)[0].c, 0, '무료');
  }
  const fc = await cur(fine.id);
  assert.deepEqual([fc.current_version, fc.media_ids[0], fc.quality.visual.rv, fc.quality.visual.photoId], [2, fine.drawn, 4, real], '고른 사진 바탕은 그대로(표시만 — 282차 #818 ⑤ 흔들림 검사까지 끝낸 표시 4)');
  assert.deepEqual([(await cur(human.id)).current_version, (await cur(human.id)).quality.visual.rv], [2, undefined], '사람이 수정 요청한 버전은 그대로');
  assert.deepEqual((await ctx.owner.ok('POST', '/api/marketing/auto/run', {})).redraws, [], '한 번만');
  // ③ [브랜드 색으로 다시 그리기](로컬 08:15 (c)): 사진 없이 브랜드 색 바탕 · 새 버전 · 감사
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${bad.id}/visual`, { redraw: true });
  assert.deepEqual([r.version, r.status, r.photo], [4, 'pending', null]);
  const rc = await cur(bad.id);
  assert.match(rc.note, /^시안 다시 그리기\(서버·크레딧 0\) — .+ · 브랜드 색 바탕$/);
  assert.equal(rc.quality.visual.photoId, null);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.visual_redraw' and target_id = ${bad.id}`).length);
  // 직접 붙인 시안·승인한 글은 안 됨
  await ctx.owner.ok('POST', `/api/marketing/contents/${fine.id}/versions`, { body: '사람이 사진을 붙인 본문', mediaIds: [real] });
  const no = await ctx.owner.req('POST', `/api/marketing/contents/${fine.id}/visual`, { redraw: true });
  assert.equal(no.status, 400); assert.match(no.body.error.message, /서버가 그린 시안만 다시 그릴 수 있습니다/);
  await ctx.owner.ok('POST', `/api/marketing/contents/${sentence.id}/decide`, { version: 3, decision: 'approve' });
  assert.match((await ctx.owner.req('POST', `/api/marketing/contents/${sentence.id}/visual`, { redraw: true })).body.error.message, /승인한 콘텐츠입니다/);
});

test('#516 후속 (c) 블로그 자동 글: 대표 이미지(1080×1080, 브랜드 색) + 본문 실사 1장 → 승인 대기 · 본문에 쓸 실사가 없으면 표지만 붙이고 수정 요청에서 기다림 · [브랜드 색으로 다시 그리기]는 대표 이미지만', async () => {
  const jpg = (r, g, b) => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  const bl = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '블로그브랜드' })).id;
  const rule = '블로그는 표지 1장 + 본문 사진 1장 이상을 붙여야 승인 요청됩니다';
  const one = await stuck('블로그브랜드 글 하나', { channel: 'blog', kind: 'blog', status: 'changes', issues: [rule], brand: bl });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c1 = await cur(one);
  assert.deepEqual([c1.status, c1.current_version, c1.media_ids.length, c1.quality.issues], ['pending', 2, 4, []], '요청 C: 본문에 쓸 실사 없음 → 표지 + 도표형 카드 3장 → 승인 대기');
  assert.match(c1.note, /브랜드 색 바탕 · 도표형 카드 3장$/);
  assert.equal(await dims(c1.media_ids[1]), '1080x1080', '도표형 카드는 정사각');
  assert.equal(await dims(c1.media_ids[0]), '1080x1080');
  const p1 = await libFile(ctx.ownerId, await jpg(70, 110, 90), '블로그브랜드 현장 사진 1.jpg');
  const two = await stuck('블로그브랜드 글 둘', { channel: 'blog', kind: 'blog', status: 'changes', issues: [rule], brand: bl });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c2 = await cur(two);
  assert.deepEqual([c2.status, c2.media_ids.length, c2.quality.issues, c2.quality.visual.bodyIds[0], c2.quality.visual.bodyIds.length, c2.quality.visual.photoId], ['pending', 4, [], p1, 3, null], JSON.stringify(c2.quality));
  assert.match(c2.note, /브랜드 색 바탕 · 본문 사진: 블로그브랜드 현장 사진 1\.jpg · 도표형 카드 2장$/, '바탕은 브랜드 색(고른 사진 아님), 본문은 실사 1장 + 카드 2장');
  assert.ok((await sql`select 1 from notifications where entity_id = ${two} and title like '시안을 붙여 다시 올렸습니다(v2)%'`).length);
  // [브랜드 색으로 다시 그리기]: 대표 이미지만 바꾸고 본문 사진은 그대로
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${two}/visual`, { redraw: true });
  const c3 = await cur(two);
  assert.deepEqual([r.version, c3.media_ids.length, c3.media_ids[1], c3.status], [3, 4, p1, 'pending']);
  assert.notEqual(c3.media_ids[0], c2.media_ids[0]);
  await ctx.owner.ok('POST', `/api/marketing/contents/${two}/decide`, { version: 3, decision: 'approve' });
});
