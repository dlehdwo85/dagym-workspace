// 210차 #619 자료실 자동 분류 고도화 — 영상은 화면이 뽑은 장면 사진 2장, 사진은 AI 사진 설명, 큰 사진은 줄여서, 브랜드 이름·다른 표기는 단서·태그로,
// AI 확신 0.7 미만만 '정리 필요', 사람이 [정리 맞음](빈 PATCH)으로 확인하면 빠짐
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { bootstrap, resetDb, startServer, testDb, BASE, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into mkt_brands (tenant, name, facts) values ('default', '바른숲', ${sql.json({ aliases: ['BRSP'] })}), ('default', '새봄', ${sql.json({})})`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const organized = (folder, confidence = 0.9, tags = ['시험']) => ({ content: [{ type: 'text', text: JSON.stringify({ folder, tags, title: '', summary: '시험 파일', confidence, security: 'internal' }) }], stop_reason: 'end_turn' });
/** 마지막 AI 정리 요청 — 이미지 블록과 안내 글 */
async function lastAsk() {
  const st = await (await fetch(FAKE + '/__state')).json();
  const content = st.anthropic.at(-1).body.messages[0].content;
  return { images: content.filter((b) => b.type === 'image'), info: content.find((b) => b.type === 'text').text };
}
async function up(name, mime, data, body = {}) {
  const init = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder: '' });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  return { id: init.id, done: await ctx.owner.ok('POST', `/api/library/${init.id}/complete`, body) };
}
const row = async (id) => (await sql`select folder, tags, needs_review, ai_confidence from library_files where id = ${id}`)[0];

describe('210차 #619 자료실 자동 분류 고도화', () => {
  test('영상: 화면이 보낸 장면 사진 2장이 AI 에 가고 안내 줄이 붙음 · 영상이 아니거나 형식이 틀리면 사진 없이 정리', async () => {
    const shot = (await sharp({ create: { width: 64, height: 36, channels: 3, background: '#4a7' } }).jpeg().toBuffer()).toString('base64');
    await queue([organized('마케팅/현장 영상')]);
    const v = await up('현장_촬영.mp4', 'video/mp4', Buffer.from('fake-mp4'), { frames: [shot, shot] });
    assert.equal(v.done.organized.by, 'ai');
    let a = await lastAsk();
    assert.equal(a.images.length, 2, '장면 사진 2장');
    assert.ok(a.images.every((b) => b.source.media_type === 'image/jpeg' && b.source.data === shot));
    assert.match(a.info, /영상 장면 사진 2장/);
    await queue([organized('운영/메모')]);
    await up('메모.txt', 'text/plain', Buffer.from('회의 메모'), { frames: [shot] });
    a = await lastAsk();
    assert.equal(a.images.length, 0, '영상이 아니면 장면 사진은 버림'); assert.doesNotMatch(a.info, /영상 장면 사진/);
    await queue([organized('마케팅/현장 영상')]);
    const bad = await up('현장_2.mp4', 'video/mp4', Buffer.from('fake-mp4-2'), { frames: ['<script>'] });
    assert.equal(bad.done.organized.by, 'ai', '형식이 틀린 사진은 버리고 정리는 진행');
    assert.equal((await lastAsk()).images.length, 0);
    // 다시 정리에도 같은 길
    await queue([organized('마케팅/현장 영상')]);
    await ctx.owner.ok('POST', `/api/library/${v.id}/organize`, { action: 'redo', frames: [shot] });
    assert.equal((await lastAsk()).images.length, 1);
    // 화면이 장면 사진을 못 보내면(저장소 주소를 못 읽음·전체 정리) 이미 뽑아 둔 장면 사진(188차)의 AI 설명으로
    await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision, meta)
      values ('default', 'marketing', '마케팅/영상 장면', '현장 — 장면 1', '현장_장면1.jpg', 'image/jpeg', 100, ${ctx.ownerId}, 'ready', 'video_frame', ${[]},
        ${sql.json({ v: 1, caption: '회원이 러닝머신에서 달리는 모습', tags: ['러닝머신'] })}, ${sql.json({ video: { id: v.id, at: 2 } })})`;
    await queue([organized('마케팅/현장 영상')]);
    await ctx.owner.ok('POST', `/api/library/${v.id}/organize`, { action: 'redo' });
    a = await lastAsk();
    assert.equal(a.images.length, 0); assert.match(a.info, /영상 장면 설명\(AI\): 회원이 러닝머신에서 달리는 모습/);
  });

  test('사진: AI 사진 설명이 있으면 정리 안내에 넣음', async () => {
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
      values ('default', 'work', '', 'IMG_0412', 'IMG_0412.jpg', 'image/jpeg', 1234, ${ctx.ownerId}, 'ready', 'upload', ${[]},
        ${sql.json({ v: 1, caption: '체육관 안에서 단체 수업을 하는 모습', scene: '실내 체육관', tags: ['단체 수업', '실내'], kind: 'photo', people: 6, faces: true, quality: 'good' })}) returning id`;
    await queue([organized('현장/수업 사진')]);
    await ctx.owner.ok('POST', `/api/library/${f.id}/organize`, { action: 'redo' });
    const a = await lastAsk();
    assert.match(a.info, /사진 설명\(AI\): 체육관 안에서 단체 수업을 하는 모습 — 실내 체육관 \[단체 수업,실내\]/);
  });

  test('큰 사진(3.5MB 넘음)은 버리지 않고 1568px JPEG 로 줄여서 보냄', async () => {
    const W = 1800;
    const png = await sharp(randomBytes(W * W * 3), { raw: { width: W, height: W, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
    assert.ok(png.length > 3_500_000, `시험 사진 크기 ${png.length}`);
    await queue([organized('현장/사진')]);
    await up('큰사진.png', 'image/png', png);
    const a = await lastAsk();
    assert.equal(a.images.length, 1); assert.equal(a.images[0].source.media_type, 'image/jpeg');
    const m = await sharp(Buffer.from(a.images[0].source.data, 'base64')).metadata();
    assert.equal(m.format, 'jpeg'); assert.ok(m.width <= 1568 && m.height <= 1568, `${m.width}x${m.height}`);
  });

  test('브랜드 규칙표: 이름·다른 표기가 파일 이름에 있으면 단서 + 태그 (영문은 낱말 경계, 두 글자 한글은 앞뒤 한글 없을 때만)', async () => {
    await queue([organized('마케팅/전단', 0.9, ['전단'])]);
    const a = await up('BRSP_가을전단.txt', 'text/plain', Buffer.from('가을 행사 안내'));
    assert.match((await lastAsk()).info, /브랜드 단서: 바른숲/);
    assert.ok((await row(a.id)).tags.includes('바른숲'), '브랜드 이름 태그');
    await queue([organized('운영/메모')]);
    const b = await up('brspx_notes.txt', 'text/plain', Buffer.from('메모'));
    assert.doesNotMatch((await lastAsk()).info, /브랜드 단서/); assert.ok(!(await row(b.id)).tags.includes('바른숲'), '영문 낱말 일부는 아님');
    await queue([organized('마케팅/포스터')]);
    const c = await up('새봄_포스터.txt', 'text/plain', Buffer.from('포스터'));
    assert.ok((await row(c.id)).tags.includes('새봄'));
    await queue([organized('운영/메모')]);
    const d = await up('올해새봄맞이.txt', 'text/plain', Buffer.from('계획'));
    assert.ok(!(await row(d.id)).tags.includes('새봄'), '두 글자 한글은 다른 낱말 속이면 아님');
    // AI 가 꺼져 파일명 규칙으로 정리돼도 브랜드 태그는 붙음
    await queue([{ content: [{ type: 'text', text: 'JSON 아님' }], stop_reason: 'end_turn' }]);
    const e = await up('BRSP-소개서.txt', 'text/plain', Buffer.from('소개'));
    assert.equal(e.done.organized.by, 'rule'); assert.ok((await row(e.id)).tags.includes('바른숲'));
  });

  test('확신 0.7 미만만 정리 필요 → [정리 맞음](빈 PATCH)으로 확인하면 빠짐', async () => {
    await queue([organized('운영/보고', 0.65)]);
    const low = await up('주간보고_초안.txt', 'text/plain', Buffer.from('주간 보고'));
    assert.equal(low.done.organized.needsReview, true); assert.equal((await row(low.id)).needs_review, true);
    await queue([organized('운영/보고', 0.75)]);
    const ok = await up('주간보고_최종.txt', 'text/plain', Buffer.from('주간 보고 최종'));
    assert.equal(ok.done.organized.needsReview, false); assert.equal((await row(ok.id)).needs_review, false);
    const before = await ctx.owner.ok('GET', '/api/library?review=1');
    assert.ok(before.files.some((f) => f.id === low.id)); assert.ok(!before.files.some((f) => f.id === ok.id));
    const rules = (await sql`select count(*)::int n from library_rules`)[0].n;
    await ctx.owner.ok('PATCH', `/api/library/${low.id}`, {});
    const r = await row(low.id);
    assert.equal(r.needs_review, false); assert.equal(r.folder, '운영/보고', '폴더 그대로');
    const after = await ctx.owner.ok('GET', '/api/library?review=1');
    assert.equal(after.review, before.review - 1); assert.ok(!after.files.some((f) => f.id === low.id));
    assert.equal((await sql`select count(*)::int n from library_rules`)[0].n, rules, '그대로 확인은 고친 예시가 아님');
  });
});
