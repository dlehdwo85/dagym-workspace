// 대표 10/20 17:00 (#109) AI 비서 영상 첨부: 영상 100MB 조각 업로드(자료실·업무 첨부·메신저) + 프레임·음성 → '영상 요약 + 할 일 제안'(가짜 Anthropic·가짜 STT) + AI 비서 첨부 시 글자 요약만 전달
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64').toString('base64');
const WAV = (() => { const len = 16000; const b = Buffer.alloc(44 + len * 2); b.write('RIFF', 0); b.writeUInt32LE(36 + len * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(len * 2, 40); return b; })();

async function upLib(c, name, mime, data, extra = {}) {
  const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder: 'AI 요청 첨부', tags: ['AI 첨부'], purpose: 'ai_attach', ...extra });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
  await c.ok('POST', `/api/library/${init.id}/complete`);
  return init.id;
}

before(async () => {
  await resetDb(); await ensureTls();
  fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('#109 영상 조각 업로드', () => {
  test('자료실: 영상은 100MB 까지(그 외 50MB) · 20MB 넘으면 8MB 조각 목록 → 조각 올리고 complete(uploadId) 로 합침', async () => {
    const big = 60 * 1024 * 1024;
    assert.equal((await ctx.owner.req('POST', '/api/library', { fileName: '큰 문서.pdf', mimeType: 'application/pdf', size: big, folder: '일반' })).status, 400, '문서는 50MB 까지');
    assert.equal((await ctx.owner.req('POST', '/api/library', { fileName: '긴 영상.mp4', mimeType: 'video/mp4', size: 101 * 1024 * 1024, folder: '일반' })).status, 400, '영상도 100MB 까지');
    const init = await ctx.owner.ok('POST', '/api/library', { fileName: '현장 영상.mp4', mimeType: 'video/mp4', size: big, folder: '일반' });
    assert.ok(init.upload.multipart, '조각 업로드 대상');
    assert.equal(init.upload.multipart.parts.length, 8, '60MB / 8MB = 8조각');
    assert.equal(init.upload.multipart.partSize, 8 * 1024 * 1024);
    // 조각을 작은 내용으로 차례로 올린다(로컬 저장소는 크기를 검사하지 않음)
    for (const p of init.upload.multipart.parts) {
      const r = await fetch(BASE + p.url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: Buffer.from(`part${p.n}|`) });
      assert.equal(r.status, 200, `조각 ${p.n}`);
    }
    assert.equal((await ctx.owner.req('POST', `/api/library/${init.id}/complete`, { uploadId: 'local-999' })).status, 400, '잘못된 uploadId');
    const done = await ctx.owner.ok('POST', `/api/library/${init.id}/complete`, { uploadId: init.upload.multipart.uploadId });
    assert.equal(done.ok, true);
    const [f] = await sql`select size_bytes, upload_status from library_files where id = ${init.id}`;
    assert.equal(f.upload_status, 'ready'); assert.equal(Number(f.size_bytes), 'part1|part2|part3|part4|part5|part6|part7|part8|'.length, '조각이 순서대로 합쳐짐');
    const dl = await fetch(`${BASE}/api/library/${init.id}/download?inline=1`, { headers: { cookie: ctx.owner.cookie } });
    assert.match(await dl.text(), /^part1\|part2\|/);
  });
  test('업무 첨부·메신저도 같은 조각 업로드(uploadId 로 합침)', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '영상 첨부 업무', assigneeId: ctx.ownerId })).id;
    const a = await ctx.owner.ok('POST', '/api/attachments', { taskId: t, kind: 'file', fileName: '시공 영상.mov', mimeType: 'video/quicktime', size: 30 * 1024 * 1024 });
    assert.equal(a.upload.multipart.parts.length, 4);
    for (const p of a.upload.multipart.parts) await fetch(BASE + p.url, { method: 'PUT', headers: { 'content-type': 'video/quicktime' }, body: Buffer.from('x') });
    assert.equal((await ctx.owner.ok('POST', `/api/attachments/${a.id}/complete`, { uploadId: a.upload.multipart.uploadId })).ok, true);
    assert.equal(Number((await sql`select size_bytes from attachments where id = ${a.id}`)[0].size_bytes), 4);
    assert.equal((await ctx.owner.req('POST', '/api/attachments', { taskId: t, kind: 'file', fileName: '큰 사진.png', mimeType: 'image/png', size: 60 * 1024 * 1024 })).status, 400, '사진은 50MB 까지');
    const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    const ft = await ctx.owner.ok('POST', `/api/chat/rooms/${room}/files`, { fileName: '회의 영상.mp4', mime: 'video/mp4', size: 25 * 1024 * 1024 });
    assert.equal(ft.upload.multipart.parts.length, 4);
    for (const p of ft.upload.multipart.parts) await fetch(BASE + p.url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: Buffer.from('ab') });
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${room}/messages`, { body: '', file: { key: ft.key, name: '회의 영상.mp4', mime: 'video/mp4', size: 8 } })).status, 400, '합치기 전엔 파일이 없음');
    const m = await ctx.owner.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '', file: { key: ft.key, name: '회의 영상.mp4', mime: 'video/mp4', size: 8, uploadId: ft.upload.multipart.uploadId } });
    assert.ok(m.id);
    assert.equal((await ctx.owner.ok('GET', `/api/chat/rooms/${room}`)).messages.find((x) => x.id === m.id).file_mime, 'video/mp4');
  });
});

describe('#109 영상 요약 + 할 일 제안', () => {
  let video;
  test('프레임 + 음성 파일 → STT(가짜) → 요약 JSON → 영상 파일 meta.video_digest·본문 저장, 음성 파일은 지움, 사용량 stt·video 기록', async () => {
    video = await upLib(ctx.owner, '강남점 현장.mp4', 'video/mp4', Buffer.from('fake-video'), { folder: '일반', tags: [], purpose: undefined });
    const audio = await upLib(ctx.owner, '영상 음성.wav', 'audio/wav', WAV, { tags: ['영상 음성'] });
    await queue([say(JSON.stringify({ summary: '강남점 간판이 낡아 교체가 필요하고, 전단지 초안 일정을 이야기했습니다.', scenes: [{ t: 0, text: '건물 외관·간판' }, { t: 12, text: '입구 전단 진열대' }],
      todos: [{ title: '강남점 간판 교체 견적', detail: '다음 주 수요일까지 견적 2곳', due: null }, { title: '전단지 초안 검토', detail: '금요일에 대표 확인', due: null }], review: [] }))]);
    const n0 = (await fakeState()).openai.length;
    const r = await ctx.owner.ok('POST', '/api/ai/video-digest', { fileId: video, duration: 24, frames: [{ t: 0, data: JPEG }, { t: 12, data: JPEG }], audioFileId: audio });
    assert.equal(r.digest.frames, 2); assert.match(r.digest.transcript, /간판 교체 견적/); assert.equal(r.digest.todos.length, 2);
    assert.match(r.text, /\[영상 요약: 강남점 현장\]/); assert.match(r.text, /할 일 후보:\n- 강남점 간판 교체 견적/); assert.match(r.text, /\[음성 녹취\]/);
    const st = await fakeState();
    assert.equal(st.openai.length - n0, 1, 'STT 1번'); assert.equal(st.openai.at(-1).kind, 'transcription');
    const req = st.anthropic.at(-1).body;
    assert.equal(req.messages[0].content.filter((b) => b.type === 'image').length, 2, '프레임 2장이 이미지 블록으로');
    assert.match(req.messages[0].content.at(-1).text, /\[음성 녹취\]/);
    const [f] = await sql`select meta, text_content from library_files where id = ${video}`;
    assert.equal(f.meta.video_digest.frames, 2); assert.match(f.text_content, /영상 요약/);
    assert.ok((await sql`select deleted_at from library_files where id = ${audio}`)[0].deleted_at, '음성 파일은 쓰고 지움');
    const u = await sql`select purpose, cost_usd::float8 cost from ai_usage where purpose in ('stt', 'video') order by purpose`;
    assert.deepEqual(u.map((x) => x.purpose), ['stt', 'video']); assert.ok(u[0].cost > 0, 'STT 원가(분당)');
  });
  test('AI 비서에 영상을 첨부하면 영상 대신 글자 요약만 들어간다', async () => {
    await queue([say('영상 요약을 바탕으로 업무 2건을 제안드립니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '첨부한 영상을 요약하고 할 일을 제안해 줘', fileIds: [video] });
    assert.match(r.reply, /업무 2건/);
    const req = (await fakeState()).anthropic.at(-1).body;
    const content = req.messages.at(-1).content;
    assert.ok(!content.some((b) => b.type === 'image'), '영상·프레임을 다시 보내지 않음');
    assert.ok(content.some((b) => b.type === 'text' && /\[첨부 자료: 강남점 현장\][\s\S]*\[영상 요약/.test(b.text)), '글자 요약만');
  });
  test('프레임만(음성 없음)·검토 모드 → review 의견, 영상 아닌 파일 400, 남의 회사 파일 404, 직원도 자기 영상은 가능', async () => {
    await queue([say(JSON.stringify({ summary: '릴스 시안: 15초 안에 간판·내부 소개.', scenes: [{ t: 0, text: '오프닝' }], todos: [], review: ['자막 "할인률" → "할인율" 오타', '첫 3초 훅이 약함'] }))]);
    const r = await ctx.owner.ok('POST', '/api/ai/video-digest', { fileId: video, frames: [{ t: 0, data: JPEG }], mode: 'review' });
    assert.equal(r.digest.review.length, 2); assert.equal(r.digest.transcript, null); assert.match(r.text, /검토 의견:\n- 자막/);
    const doc = await upLib(ctx.owner, '메모.txt', 'text/plain', Buffer.from('메모'));
    assert.equal((await ctx.owner.req('POST', '/api/ai/video-digest', { fileId: doc, frames: [{ t: 0, data: JPEG }] })).status, 400);
    assert.equal((await ctx.owner.req('POST', '/api/ai/video-digest', { fileId: video })).status, 400, '프레임도 음성도 없음');
    assert.equal((await ctx.owner.req('POST', '/api/ai/video-digest', { fileId: '00000000-0000-0000-0000-00000000dead', frames: [{ t: 0, data: JPEG }] })).status, 404);
    const mine = await upLib(ctx.staffA.client, '직원 영상.mp4', 'video/mp4', Buffer.from('v'), { folder: '일반', tags: [], purpose: undefined });
    await queue([say(JSON.stringify({ summary: '직원 영상 요약', scenes: [], todos: [], review: [] }))]);
    assert.equal((await ctx.staffA.client.ok('POST', '/api/ai/video-digest', { fileId: mine, frames: [{ t: 0, data: JPEG }] })).digest.summary, '직원 영상 요약');
  });
});
