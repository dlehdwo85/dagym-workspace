// 요청 C(대표 10/25 22:20 #644~#646, MARKETING_REWORK §3-1~3-6): 피드 = 카드뉴스 3~5장(원고 slides, 없으면 본문 줄로) · 스토리 = 3~5프레임 · 블로그 = 표지 + 본문 3장(실사가 모자라면 도표형 카드)
// · 사진 수 미달이면 승인함 대신 수정 요청·승인 400 · 캡션 가독성(한 문장 한 줄·해시태그 맨 아래) · 수정본은 장도 다시 그리고 원래 게시일 유지(마감 지났으면 다음 슬롯 + 원래 m/d → m/d)
// · 릴스·쇼츠·생성 영상 자동 제작 중단(video_pause 기본 켬) · 사진 게시물(photo) 규칙 · 브랜드별 시안 세트 API(관리자)
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
const CARD = { kicker: '소식', points: [], left: '', right: '', keyword: '', period: '', prices: [] };
const PHONE = '032-111-2222';
async function dims(fileId) {
  const res = await fetch(`${BASE}/api/library/${fileId}/download?inline=1`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
  assert.equal(res.status, 200);
  const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
  return `${m.width}x${m.height}`;
}
async function libFile(owner, data, name) {
  const [u] = await sql`select tenant from users where id = ${owner}`;
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source)
    values (${u.tenant}, 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${owner}, 'ready', 'upload') returning id`;
  const key = `lib/${u.tenant}/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
/** 정기 칸 하나(규칙 없이, 지금 제작) — [지금 실행]이 바로 만든다 */
async function slot(title, { channel = 'instagram', kind = 'feed', at = new Date(Date.now() + 2 * 86400e3), cross = ['facebook'] } = {}) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode)
    values ('default', ${P.brand}, ${title}, ${channel}, ${at}, 'draft', 0, ${ctx.ownerId}, ${kind}, true, now(), false, ${cross}, 'content') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, c.scheduled_at, c.kind, v.media_ids, v.body, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const meta = async (fileId) => (await sql`select meta, folder from library_files where id = ${fileId}`)[0];

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '카드브랜드' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '송도 동네 헬스장', products: '1개월 회원권, 처음 상담', facts: { phone: PHONE } });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('피드 = 카드뉴스: 원고 slides(표지 + 4장) → 표지 뒤 4장을 서버가 그려 5장 · 자료실 쪽수·역할 · 캡션은 한 문장 한 줄·해시태그 맨 아래 · 승인됨', async () => {
  const id = await slot('카드브랜드 가을 운동');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 운동 시작', body: '가을엔 운동 시작하기 좋습니다. 아침 공기가 상쾌하고 땀도 덜 납니다.\n#헬스 #가을운동\n등록하면 첫 달 안내를 드립니다.\n문의 032-111-2222', brief: '실사', why: '', hooks: [], keyword: '송도 헬스장', card: CARD,
    slides: [{ role: 'cover', title: '가을 운동 시작', body: '' }, { role: 'problem', title: '운동, 자꾸 미루게 되죠', body: '아침엔 춥고\n저녁엔 피곤하고' }, { role: 'solution', title: '가볍게 30분부터', body: '기구 안내와 처음 상담' }, { role: 'proof', title: '처음 오신 분 안내가 있습니다', body: '' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }] })] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.some((p) => p.id === id && !p.error), JSON.stringify(run.produced));
  const c = await cur(id);
  assert.equal(c.status, 'pending', JSON.stringify(c.quality));
  assert.equal(c.media_ids.length, 5, '표지 1 + 장 4');
  assert.deepEqual(c.quality.pages.map((p) => p.role), ['problem', 'solution', 'proof', 'cta'], '표지 역할은 빼고 저장');
  assert.equal(c.quality.pages[0].body, '아침엔 춥고\n저녁엔 피곤하고');
  assert.equal(await dims(c.media_ids[1]), '1080x1350');
  const m2 = await meta(c.media_ids[1]); const m5 = await meta(c.media_ids[4]);
  assert.deepEqual([m2.folder, m2.meta.page, m2.meta.of, m2.meta.role, m2.meta.contentId], ['마케팅/자동 시안', 2, 5, 'problem', id]);
  assert.deepEqual([m5.meta.page, m5.meta.role], [5, 'cta']);
  assert.match(c.note, /시안 서버 그리기\(.*\) · 카드 5장$/);
  // 요청 C §3-4 캡션 가독성: 한 문장이 끝나면 줄바꿈 · 문단 3줄 · 해시태그는 맨 아래 한 줄
  assert.equal(c.body, '가을엔 운동 시작하기 좋습니다.\n아침 공기가 상쾌하고 땀도 덜 납니다.\n등록하면 첫 달 안내를 드립니다.\n\n문의 032-111-2222\n\n#헬스 #가을운동');
  assert.equal((await sql`select count(*)::int n from mkt_production_requests where content_id = ${id} and kind = 'image'`)[0].n, 0, '이미지 제작 카드 없음');
  await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' });
  // 승인함 카드에는 장 전체(media_ids)와 소유자 표시
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.equal(list.isOwner, true, '대표(회사 소유자) = 두 단추 화면');
  assert.equal(list.contents.find((x) => x.id === id).media_ids.length, 5);
});

test('스토리 = 프레임: frames 3개(첫 프레임 = 표지) → 표지 1920 + 프레임 2장(1080×1920) · 3장 승인 가능', async () => {
  const id = await slot('카드브랜드 스토리 질문', { kind: 'story', at: new Date(Date.now() + 2 * 86400e3 + 3600e3) });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '운동 시작했나요', body: '요즘 운동 시작하셨나요?\n스티커 제안: 투표 — 아침 / 저녁', brief: '', why: '', hooks: [], keyword: '송도', card: CARD,
    frames: [{ title: '요즘 운동 시작하셨나요?', body: '' }, { title: '아침 30분이면 충분해요', body: '기구 안내부터' }, { title: '궁금하면 물어보세요', body: '문의 032-111-2222' }] })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.equal(c.status, 'pending', JSON.stringify(c.quality));
  assert.equal(c.media_ids.length, 3, '표지 + 프레임 2(첫 프레임은 표지라 뺌)');
  assert.deepEqual(c.quality.pages.map((p) => [p.role, p.title]), [['frame', '아침 30분이면 충분해요'], ['frame', '궁금하면 물어보세요']]);
  for (const m of c.media_ids) assert.equal(await dims(m), '1080x1920');
  assert.match(c.note, /프레임 3장$/);
  assert.match(c.body, /^요즘 운동 시작하셨나요\?\n스티커 제안: /, '스티커 줄은 그대로');
});

test('원고에 장이 없으면 본문 줄로 채움(표지 포함 3장) · 수정 요청 → 글이 바뀌면 장 다시 그림 · 승인 마감 지난 글은 다음 슬롯 + 원래 m/d → m/d', async () => {
  const id = await slot('카드브랜드 주차 안내', { at: new Date(Date.now() + 2 * 86400e3 + 2 * 3600e3) });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '주차 안내', body: '동네 헬스장 주차 안내입니다.\n처음 오시면 기구 사용법을 알려 드립니다.\n주차는 지하 1층에 하시면 됩니다.', brief: '', why: '', hooks: [], keyword: '', card: CARD })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c1 = await cur(id);
  assert.equal(c1.status, 'pending', JSON.stringify(c1.quality));
  assert.equal(c1.media_ids.length, 3, '표지 + 본문 줄 1장 + 행동 장');
  assert.deepEqual(c1.quality.pages.map((p) => p.role), ['solution', 'cta']);
  assert.equal(c1.quality.pages[0].title, '처음 오시면 기구 사용법을 알려 드립니다.', '첫 줄(훅)은 표지라 둘째 줄부터');
  assert.equal(c1.quality.pages[1].body, `문의 ${PHONE}`, '행동 장 = 사실 카드 연락처');
  // 승인 마감이 지난 뒤 수정 요청 → AI 수정본(새 slides) → 장 다시 그림 · 원래 게시 시각은 지났으니 다음 슬롯(#540)으로 옮기고 '원래 m/d → m/d'
  const from = new Date(Date.now() - 2 * 86400e3); // 승인 마감 = 게시일 09:00 → 이틀 전 글이면 시험 시각과 상관없이 마감이 지남(CI 01시·09시 전 실행에서도)
  await sql`update mkt_contents set scheduled_at = ${from} where id = ${id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '주차 안내', body: '동네 헬스장 새 주차 안내입니다.\n처음 오시면 기구 사용법을 알려 드립니다.\n주차는 지하 1층에 하시면 됩니다.', brief: '', why: '', hooks: [], keyword: '', card: CARD,
    slides: [{ role: 'problem', title: '주차 자리 찾기 어렵죠', body: '' }, { role: 'solution', title: '지하 1층에 세우세요', body: '입구 왼쪽 경사로' }, { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }] })] });
  const d = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'changes', comment: '첫 줄을 새 안내로' });
  assert.deepEqual([d.revision.version, d.revision.parts], [2, ['text', 'visual']]);
  assert.ok(d.revision.rescheduled?.to, JSON.stringify(d.revision));
  const c2 = await cur(id);
  assert.equal(c2.status, 'pending', JSON.stringify(c2.quality));
  assert.equal(c2.media_ids.length, 4, '표지 + 새 slides 3장');
  assert.deepEqual(c2.quality.pages.map((p) => p.role), ['problem', 'solution', 'cta']);
  assert.ok(c2.media_ids.every((m) => !c1.media_ids.includes(m)), '글이 바뀌면 표지·장 모두 새로');
  assert.ok(new Date(c2.scheduled_at).getTime() > Date.now(), '다음 슬롯으로');
  assert.equal(new Date(c2.quality.rescheduled.from).getTime(), from.getTime());
  assert.equal(new Date(c2.quality.rescheduled.to).getTime(), new Date(c2.scheduled_at).getTime());
  assert.equal(c2.quality.moved, 1);
  const card = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.find((x) => x.id === id);
  assert.ok(card.quality.rescheduled && !card.late, '승인함 카드: 원래 m/d → m/d 배지(마감 지남 아님)');
  // 사진만 바꾸기 → 표지만 새로, 장은 그대로(AI 호출 없음)
  const n0 = fake.state.anthropic.length;
  const d2 = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 2, decision: 'changes', comment: '사진을 다시 만들어 주세요' });
  assert.equal(d2.revision.version, 3);
  const c3 = await cur(id);
  assert.deepEqual(c3.media_ids.slice(1), c2.media_ids.slice(1), '장은 그대로');
  assert.notEqual(c3.media_ids[0], c2.media_ids[0]);
  assert.equal(fake.state.anthropic.length, n0);
});

test('블로그: 본문 실사 0장 → 표지 + 도표형 카드 3장(1080×1080) = 4장 · 자동 글 규칙 = 표지 + 3장', async () => {
  const id = await slot('카드브랜드 첫 방문 안내', { channel: 'blog', kind: 'blog', cross: [] });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '송도 헬스장 첫 방문 안내', body: '■ 첫 방문\n처음 오시면 상담부터 합니다.\n\n■ 준비물\n운동복과 실내화만 챙기세요.\n\n■ 주차\n지하 1층에 세우면 됩니다.', brief: '', why: '', hooks: [], keyword: '송도 헬스장', card: CARD, persona: '처음 오는 사람', subKeywords: ['준비물'] })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.equal(c.media_ids.length, 4, JSON.stringify(c.quality));
  assert.ok(!c.quality.issues.some((x) => /블로그는 표지 1장/.test(x)), `사진 수 규칙 줄 없음: ${c.quality.issues.join(' · ')}`);
  assert.equal(await dims(c.media_ids[1]), '1080x1080');
  assert.deepEqual([(await meta(c.media_ids[1])).meta.kind, (await meta(c.media_ids[3])).meta.page], ['blog_card', 3]);
  assert.match(c.note, /도표형 카드 3장$/);
  // 승인 가능(글 품질 검사에 걸린 것은 수정 요청 상태라 승인 대신 규칙 줄만 확인)
  if (c.status === 'pending') await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' });
});

test('사진 수 미달 승인 차단(자동 글만): 피드 표지 1장 → 400 · 사람이 쓴 글은 1장이어도 승인', async () => {
  const img = await libFile(ctx.ownerId, await sharp({ create: { width: 1080, height: 1350, channels: 3, background: '#334155' } }).jpeg().toBuffer(), '표지만.jpg');
  const [a] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values ('default', ${P.brand}, '표지만 있는 자동 피드', 'instagram', 'feed', now() + interval '2 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${a.id}, 1, '표지만', ${[img]}, 'AI 자동 제작', ${ctx.ownerId})`;
  const no = await ctx.owner.req('POST', `/api/marketing/contents/${a.id}/decide`, { version: 1, decision: 'approve' });
  assert.equal(no.status, 400); assert.match(no.body.error.message, /피드는 카드뉴스 3~5장\(표지 포함\)이 붙어야 승인 요청됩니다 — 지금 1장/);
  // 정기 실행이 장을 채워 주지는 않음(이미 시안이 있는 글) — 사람이 [수정 요청]으로 다시 만들게
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '사람이 올린 피드', channel: 'instagram', brandId: P.brand, body: '손으로 쓴 글', mediaIds: [img] });
  await ctx.owner.ok('POST', `/api/marketing/contents/${m.id}/decide`, { version: 1, decision: 'approve' });
  // 자동 스토리 2장 → 400 · 스레드는 글만으로 승인(규칙 없음)
  const [s] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values ('default', ${P.brand}, '두 장 자동 스토리', 'instagram', 'story', now() + interval '2 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${s.id}, 1, '스토리', ${[img, img]}, 'AI 자동 제작', ${ctx.ownerId})`;
  assert.match((await ctx.owner.req('POST', `/api/marketing/contents/${s.id}/decide`, { version: 1, decision: 'approve' })).body.error.message, /스토리는 3~5프레임/);
});

test('영상 자동 제작 중단(video_pause 기본 켬): 릴스 규칙은 칸 0 · 끄면 칸 생김 · 사진 게시물(photo) 규칙 허용', async () => {
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(v.settings.video_pause, true, '기본 켬(마이그레이션 205)');
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'reels', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '12:00' });
  assert.equal(r.planned, 0, '영상 칸은 만들지 않음');
  const p = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'photo', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '15:00' });
  assert.ok(p.planned >= 13, '사진 게시물 칸은 만듦');
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${p.id}`; // 이 시험에서 제작하지 않음
  await ctx.owner.ok('PUT', '/api/marketing/auto', { videoPause: false, leadDays: 0 });
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.video_resume'`).length, '감사 기록');
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.planned >= 13, `끄면 릴스 칸 생김(${run.planned})`);
  await ctx.owner.ok('PUT', '/api/marketing/auto', { videoPause: true, leadDays: 3 });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).settings.video_pause, true);
  await sql`update mkt_rules set active = false where id in (${r.id}, ${p.id})`;
});

test('시안 세트 API: 브랜드별 내일 피드·스토리 + 블로그 1건을 바로 제작 → 승인함(카드뉴스·프레임·표지+3장) · 관리자만', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/auto/sample', {})).status, 403, '관리자만');
  const bodies = ['헬스장 겨울 준비 안내입니다.\n난방을 새로 점검했습니다.\n따뜻하게 운동하세요.', '겨울에도 운동하시나요?\n스티커 제안: 질문 — 겨울 운동 고민', '■ 겨울 운동\n몸을 먼저 데우세요.\n\n■ 복장\n얇게 여러 겹 입으세요.\n\n■ 시간\n저녁이 덜 춥습니다.'];
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '겨울 준비', body: bodies[0], brief: '', why: '', hooks: [], keyword: '', card: CARD }), say({ title: '겨울 운동', body: bodies[1], brief: '', why: '', hooks: [], keyword: '', card: CARD }),
    say({ title: '송도 헬스장 겨울 운동', body: bodies[2], brief: '', why: '', hooks: [], keyword: '송도 헬스장', card: CARD, persona: '겨울에 운동 시작하는 사람', subKeywords: ['복장'] })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/brands', { name: '세트제외 시험', testMode: true }); // 로컬 10/26: 시험 브랜드는 브랜드를 고르지 않은 세트에서 빠짐
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/sample', { blogBrandIds: [P.brand] });
  assert.deepEqual(r.contents.map((c) => c.kind).sort(), ['blog', 'feed', 'story']);
  assert.ok(r.contents.every((c) => c.brand === '카드브랜드'), `시험 브랜드 제외: ${JSON.stringify(r.contents.map((c) => c.brand))}`);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.sample_set'`).length);
  const ids = r.contents.map((c) => c.id);
  let rows;
  for (let k = 0; k < 240; k++) { rows = await sql`select id, kind, status, produced_at from mkt_contents where id = any(${ids}::uuid[])`; if (rows.every((x) => x.produced_at)) break; await new Promise((res) => setTimeout(res, 500)); }
  assert.ok(rows.every((x) => x.produced_at), `응답 뒤 제작: ${JSON.stringify(rows)}`);
  for (const row of rows) {
    const c = await cur(row.id);
    const min = row.kind === 'blog' ? 4 : 3;
    assert.ok(c.media_ids.length >= min, `${row.kind}: ${c.media_ids.length}장 ≥ ${min} — ${JSON.stringify(c.quality?.issues)}`);
    assert.ok(!(c.quality.issues ?? []).some((x) => /붙어야 승인 요청됩니다/.test(x)), `사진 수 규칙 통과: ${row.kind}`);
  }
  const [feed] = await sql`select title, scheduled_at, cross_channels, auto from mkt_contents where id = ${rows.find((x) => x.kind === 'feed').id}`;
  assert.deepEqual([feed.title, feed.cross_channels, feed.auto], ['겨울 준비', ['facebook'], true], '제작되면 제목은 원고 제목 · 페북 함께 · 자동 글 규칙');
  assert.ok(new Date(feed.scheduled_at).getTime() > Date.now(), '내일 게시');
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.sample_set'`).length);
});
