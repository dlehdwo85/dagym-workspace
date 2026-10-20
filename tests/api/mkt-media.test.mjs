// 대표 10/21 02:00 핫픽스: 영상 시안 — 목록 media_info(mime), 상세 media 는 media_ids 순서, 홈 썸네일은 이미지 우선 + mime, 영상 inline 내려받기, M1 릴스 = 영상 1개 + 표지(표지를 사진으로 올리지 않음)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
async function upload(name, mime, bytes) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: bytes.length, folder: '마케팅' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: bytes });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}

test('영상 시안: media_info·상세 순서·홈 썸네일 이미지 우선·영상 inline', async () => {
  const mp4 = await upload('릴스.mp4', 'video/mp4', Buffer.from('mp4-bytes'));
  const jpg = await upload('릴스-thumb.jpg', 'image/jpeg', Buffer.from('jpg-bytes'));
  const { id } = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '가을 릴스', channel: 'instagram', scheduledAt: new Date(Date.now() + 2 * 864e5).toISOString(), body: '릴스 캡션', mediaIds: [mp4, jpg] }); // 승인 마감(그날 승인 시각) 전이어야 홈 '승인할 것'에 보임
  await sql`update mkt_contents set kind = 'reels' where id = ${id}`;
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  const row = list.contents.find((c) => c.id === id);
  assert.deepEqual(row.media_info.map((m) => [m.id, m.mime]), [[mp4, 'video/mp4'], [jpg, 'image/jpeg']], 'media_ids 순서 + mime');
  // 상세 media 도 media_ids 순서(로컬 02:10: 전엔 생성순)
  await ctx.owner.ok('POST', `/api/marketing/contents/${id}/versions`, { body: '릴스 캡션 v2', mediaIds: [jpg, mp4] });
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.deepEqual(d.media.map((m) => m.id), [jpg, mp4]); assert.equal(d.media[1].mime_type, 'video/mp4');
  // 홈: 썸네일은 이미지 우선 + mime
  const h = await ctx.owner.ok('GET', '/api/marketing/home');
  const a = h.approve.find((c) => c.id === id);
  assert.ok(a, '승인 대기 카드'); assert.equal(a.media, jpg); assert.equal(a.mediaMime, 'image/jpeg');
  // 영상 inline 내려받기(브라우저 재생용) — 로컬 저장소는 inline=1 이 주소에 남음
  const r = await ctx.owner.get(`/api/library/${mp4}/download?inline=1`);
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /inline=1/);
});
