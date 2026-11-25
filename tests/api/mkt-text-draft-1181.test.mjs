// #1181-2(대표 11/26 '워크인 승인함 4건이 아니라 3건으로 보였다'): 시안 승인 규칙
// ① 기타(파워링크·광고 문구 — 그림이 필요 없는 글)는 글 시안만으로 승인 ② 인스타 광고형은 그대로 그림이 있어야 승인
// ③ 블로그(사진 없음)는 수정 요청 칸에 '사진 필요' 사유로 — 화면 위쪽 '사진 필요 n건' 줄이 이 사유를 읽음(photoNeeded)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const make = (o) => ctx.owner.ok('POST', '/api/marketing/contents', { body: '첫 문장입니다.\n두 번째 문장입니다.', mediaIds: [], ...o });
const approve = (id) => ctx.owner.req('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' });

test('기타(광고 문구)는 글만으로 승인 · 인스타 광고형은 그림 필요 · 블로그는 사진 필요(수정 요청 칸)', async () => {
  const ad = await make({ title: '파워링크 문구 시안', channel: 'other', mode: 'ad', body: '사무실 일정 관리, 한 화면에서.\n14일 무료 체험.' });
  const [a] = await sql`select status from mkt_contents where id = ${ad.id}`;
  assert.equal(a.status, 'pending', '기타 글은 바로 승인 대기');
  const ok = await approve(ad.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await sql`select status from mkt_contents where id = ${ad.id}`)[0].status, 'approved');

  const ig = await make({ title: '인스타 광고 글만', channel: 'instagram', mode: 'ad' });
  const no = await approve(ig.id);
  assert.equal(no.status, 400, '인스타 광고형은 그림이 있어야 승인');
  assert.match(no.body.error.message, /시안 이미지가 없어/);

  const th = await make({ title: '스레드 글', channel: 'threads' });
  assert.equal((await approve(th.id)).status, 200, '스레드는 예전처럼 글만으로 승인');

  const blog = await make({ title: '블로그 사진 없음', channel: 'blog' });
  const [b] = await sql`select status, quality from mkt_contents where id = ${blog.id}`;
  assert.equal(b.status, 'changes', '블로그는 사진이 모자라면 수정 요청 칸');
  assert.match(b.quality.issues[0], /블로그는 표지 1장 \+ 본문 사진 1장 이상을 붙여야 승인 요청됩니다/, '화면 사진 필요 줄이 읽는 사유(mktMediaRules.BLOG_PHOTO_RULE)와 같은 글');

  const list = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents;
  const row = list.find((c) => c.id === blog.id);
  assert.ok(row && row.status === 'changes' && Array.isArray(row.quality?.issues), '승인함 목록이 사진 필요 판단에 쓸 사유(quality.issues)를 함께 줌');
});
