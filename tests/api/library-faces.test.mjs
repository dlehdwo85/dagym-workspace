// #615 ④(대표 10/25, 로컬 18:00 클라우드 요청 ④): 얼굴이 나온 실사 사진(AI 설명 faces=true)을 홍보 글에 쓸 때 촬영·게시 동의 경고 —
// 자료실 목록(vision.faces) · 승인함 카드(media_info[].faces) · 콘텐츠 상세(media[].faces) 가 같은 표시를 준다. 경고 문구 자체는 화면(E2E)에서.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, br;
const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
async function libFile(name, vision) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', 1234, ${ctx.ownerId}, 'ready', 'upload', ${[]}, ${sql.json(vision)}) returning id`;
  return f.id;
}

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  br = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '얼굴짐' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('자료실 목록 vision.faces · 승인함 카드 media_info[].faces · 콘텐츠 상세 media[].faces', async () => {
  const face = await libFile('회원 운동 사진.jpg', V({ caption: '회원이 운동하는 사진', people: 2, faces: true }));
  const clean = await libFile('빈 헬스장.jpg', V({ caption: '빈 헬스장' }));
  const lib = await ctx.owner.ok('GET', '/api/library?space=marketing');
  const row = (id) => lib.files.find((f) => f.id === id);
  assert.equal(row(face).vision.faces, true, '자료실 목록에 faces');
  assert.equal(row(clean).vision.faces, false);
  const c = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '얼굴 사진 든 글', channel: 'instagram', brandId: br.id, body: '회원님과 함께한 운동 시간', mediaIds: [face, clean] });
  const list = await ctx.owner.ok('GET', '/api/marketing/contents');
  const item = list.contents.find((x) => x.id === c.id);
  assert.ok(item, '목록에 있음');
  assert.deepEqual(item.media_info.map((m) => [m.id, m.faces]), [[face, true], [clean, false]], '카드 media_info 에 faces');
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${c.id}`);
  assert.deepEqual(d.media.map((m) => [m.id, m.faces]), [[face, true], [clean, false]], '상세 media 에 faces');
  // 얼굴 없는 사진만 붙은 글은 faces 전부 false
  const c2 = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '빈 헬스장 글', channel: 'instagram', brandId: br.id, body: '새 기구 들어왔어요', mediaIds: [clean] });
  const d2 = await ctx.owner.ok('GET', `/api/marketing/contents/${c2.id}`);
  assert.ok(d2.media.every((m) => m.faces === false));
});
