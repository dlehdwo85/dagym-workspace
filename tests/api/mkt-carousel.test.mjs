// #499-5 카드뉴스 장별 생성기: [주제 후보 받기](AI 4유형·훅 점수 / AI 실패 → 기본 주제) · [장별 문구 만들기](AI → 표지·CTA 보정 / AI 실패 → 빈 틀 {{ }})
// · 고치기(표지·CTA·표 줄·사진은 이미지만) · 미리보기 PNG 1080×1350 · 그리기 → 자료실 마케팅/카드뉴스 JPEG + 인스타 승인 대기(사진 n장 = 캐러셀) · 다시 그리기 → 새 버전
// · 자리표시·금지어·빈 본문 막기 · AI 로 고치기 · 취소(만든 사람·관리자) · 공간 밖·다른 회사 404
// 가짜 AI 응답 = 구조 시험(실제 문구 품질·인스타 실제 게시는 확인 못함)
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
const lastAi = () => JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
const TOPICS = [{ pattern: 'vs', topic: '위탁 운영 vs 직영, 우리 단지엔?', why: '둘 중 고르는 비교는 저장이 잘 됨', a: '위탁 운영', b: '직영' },
  { pattern: 'howto', topic: '커뮤니티 운영사, 실패 없이 고르는 법 3가지', why: '방법 N가지', a: '', b: '' },
  { pattern: 'types', topic: '우리 단지에 맞는 운영 방식은?', why: '내 경우 찾기', a: '', b: '' },
  { pattern: 'checklist', topic: '입주 전 커뮤니티 점검 5가지', why: '저장해 두고 봄', a: '', b: '' }, { pattern: 'bogus', topic: '빼야 함', why: '', a: '', b: '' }];
const SLIDES = [
  { kind: 'cover', title: '위탁 운영 vs 직영,\n우리 단지엔?', body: '입주 3개월 전 가장 많이 받는 질문', rows: [], imagePlan: '단지 커뮤니티 실내 사진' },
  { kind: 'body', title: '같은 커뮤니티인데 왜 다를까', body: '시설은 같아도 운영 방식에 따라\n민원·비용이 달라져요.', rows: [], imagePlan: '운영 데스크 사진' },
  { kind: 'body', title: '직영의 특징', body: '관리사무소가 직접 인력을 뽑아요.\n결정은 빠르지만 부담이 커요.', rows: [], imagePlan: '관리사무소 사진' },
  { kind: 'body', title: '위탁 운영의 특징', body: '운영사가 인력·프로그램을 맡아요.\n운영 경험 {{운영 단지 수}}곳', rows: [], imagePlan: '' },
  { kind: 'table', title: '유형별 추천', body: '', rows: [['단지 유형', '추천'], ['500세대 미만', '직영'], ['500세대 이상', '위탁 운영']], imagePlan: '무시' },
  { kind: 'table', title: '줄 없는 표', body: '', rows: [], imagePlan: '' },
  { kind: 'cta', title: "댓글에 '비교표' 남기면 보내 드려요", body: '도움이 됐다면 저장·팔로우', rows: [], imagePlan: '무시' }];
const CAPTION = "위탁 운영 vs 직영, 우리 단지엔?\n\n세 가지만 비교해 보세요.\n\n댓글에 '비교표' 남기면 보내 드려요.\n#커뮤니티운영 #아파트";
async function png(client, p) {
  const res = await fetch(BASE + p, { headers: { cookie: client.cookie, origin: BASE } });
  return { status: res.status, type: res.headers.get('content-type'), buf: Buffer.from(await res.arrayBuffer()) };
}
const size = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) }); // PNG IHDR
/** 자료실 파일 한 줄(시험 저장소에 바로 씀) */
async function libFile(owner, mime, data, name) {
  const [u] = await sql`select tenant from users where id = ${owner}`;
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source)
    values (${u.tenant}, 'marketing', '마케팅', ${name}, ${name}, ${mime}, ${data.length}, ${owner}, 'ready', 'upload') returning id`;
  const key = `lib/${u.tenant}/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 위탁 운영', products: '커뮤니티 운영·피트니스·GX' });
  await sql`update mkt_brands set banned_words = '{최고}', color = '#0F766E' where id = ${P.brand}`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('[주제 후보 받기]: AI 4유형(유형마다 하나·이상한 유형 뺌·훅 점수) · 재료(브랜드·금지어) · AI 실패 → 기본 주제 4개 · 공간 밖 404', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ topics: TOPICS })] });
  const r = await ctx.staffA.client.ok('POST', '/api/marketing/carousels/topics', { brandId: P.brand, product: '커뮤니티 위탁 운영', audience: '입주 앞둔 단지' });
  assert.equal(r.source, 'ai');
  assert.deepEqual(r.topics.map((t) => t.pattern), ['vs', 'howto', 'types', 'checklist']);
  assert.ok(r.topics.every((t) => Number.isInteger(t.score)), '훅 점수');
  assert.deepEqual([r.topics[0].a, r.topics[0].b], ['위탁 운영', '직영']);
  assert.match(lastAi(), /카드뉴스\(캐러셀\) 주제 후보/); assert.match(lastAi(), /브랜드: 다짐/); assert.match(lastAi(), /금지어\(쓰지 않음\): 최고/); assert.match(lastAi(), /대상: 입주 앞둔 단지/);
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const f = await ctx.staffA.client.ok('POST', '/api/marketing/carousels/topics', { brandId: P.brand, product: '커뮤니티 위탁 운영', a: '직접 운영', b: '위탁 운영' });
  assert.equal(f.source, 'template'); assert.ok(f.aiError, 'AI 실패 사유');
  assert.deepEqual(f.topics.map((t) => t.topic), ['직접 운영 vs 위탁 운영, 무엇이 맞을까?', '커뮤니티 위탁 운영, 실패 없이 고르는 법 3가지', '나에게 맞는 커뮤니티 위탁 운영은? 유형별 추천', '커뮤니티 위탁 운영을 정하기 전 꼭 확인할 5가지']);
  assert.equal((await ctx.staffB.client.post('/api/marketing/carousels/topics', { product: '커뮤니티 위탁 운영' })).status, 404, '마케팅 공간 밖은 404');
  assert.equal((await ctx.staffA.client.post('/api/marketing/carousels/topics', { brandId: '00000000-0000-0000-0000-00000000dead', product: '커뮤니티 위탁 운영' })).status, 404, '없는 브랜드·다른 회사 브랜드');
});

test('[장별 문구 만들기](직원) → 표지·CTA 보정·줄 없는 표 → 본문 · 키워드 우선 · 자리표시 표시 · 미리보기 PNG 1080×1350 · 고치기 검증 → 그리기 → 자료실 JPEG + 인스타 승인 대기 → 다시 그리기 = 새 버전', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ slides: SLIDES, caption: CAPTION, keyword: '체크' })] });
  const { item, aiError } = await ctx.staffA.client.ok('POST', '/api/marketing/carousels', { brandId: P.brand, product: '커뮤니티 위탁 운영', topic: '위탁 운영 vs 직영, 우리 단지엔?', pattern: 'vs', a: '위탁 운영', b: '직영', keyword: '비교표', template: 'box' });
  assert.equal(aiError, null);
  assert.deepEqual({ source: item.source, status: item.status, keyword: item.keyword, kinds: item.slides.map((s) => s.kind), cta: item.slides.at(-1).imagePlan, brand: item.brand_name },
    { source: 'ai', status: 'draft', keyword: '비교표', kinds: ['cover', 'body', 'body', 'body', 'table', 'body', 'cta'], cta: '', brand: '다짐' });
  assert.equal(item.slides[4].imagePlan, '', '표 장에는 사진 계획 없음');
  assert.deepEqual(item.check.placeholders, [4], '4장에 {{ }}'); assert.deepEqual(item.check.banned, []); assert.ok(Number.isInteger(item.check.score.score));
  assert.match(lastAi(), /카드뉴스\(캐러셀\) 장별 문구/); assert.match(lastAi(), /A vs B 비교/); assert.match(lastAi(), /댓글 키워드: 비교표/); assert.match(lastAi(), /콘텐츠형\(참여\)/);
  const view = await ctx.staffA.client.ok('GET', '/api/marketing/carousels');
  assert.equal(view.items[0].id, item.id); assert.deepEqual(Object.keys(view.templates), ['box', 'clean', 'bold']); assert.equal(view.brands.find((b) => b.id === P.brand).color, '#0F766E');
  // 미리보기: 서버가 그린 그림 그대로
  const p1 = await png(ctx.staffA.client, `/api/marketing/carousels/${item.id}/slides/1`);
  assert.equal(p1.status, 200); assert.equal(p1.type, 'image/png'); assert.equal(p1.buf.subarray(1, 4).toString(), 'PNG'); assert.deepEqual(size(p1.buf), { w: 1080, h: 1350 });
  assert.deepEqual(size((await png(ctx.staffA.client, `/api/marketing/carousels/${item.id}/slides/5`)).buf), { w: 1080, h: 1350 }, '표 장');
  assert.equal((await png(ctx.staffA.client, `/api/marketing/carousels/${item.id}/slides/8`)).status, 404);
  assert.equal((await png(ctx.staffA.client, `/api/marketing/carousels/${item.id}/slides/0`)).status, 404);
  assert.equal((await png(ctx.staffB.client, `/api/marketing/carousels/${item.id}/slides/1`)).status, 404, '공간 밖');
  // 자리표시가 남아 있으면 그리지 않음
  const ph = await ctx.staffA.client.post(`/api/marketing/carousels/${item.id}/render`, {});
  assert.equal(ph.status, 400); assert.match(ph.body.error.message, /4장/);
  // 고치기 검증
  const slides = item.slides.map((s) => ({ kind: s.kind, title: s.title, body: s.body, rows: s.rows, imagePlan: s.imagePlan, imageId: s.imageId }));
  const bad = async (b, re) => { const r = await ctx.staffA.client.patch(`/api/marketing/carousels/${item.id}`, { action: 'save', ...b }); assert.equal(r.status, 400, JSON.stringify(r.body)); assert.match(r.body.error.message, re); };
  await bad({ slides: [slides[1], ...slides.slice(2)] }, /첫 장은 표지/);
  await bad({ slides: slides.slice(0, -1) }, /마지막 장\(CTA\)/);
  await bad({ slides: [slides[0], { ...slides[4], rows: [] }, slides.at(-1)] }, /줄이 없습니다/);
  const pdf = await libFile(ctx.staffA.id, 'application/pdf', Buffer.from('%PDF-1.4'), 'doc.pdf');
  await bad({ slides: slides.map((s, k) => (k === 1 ? { ...s, imageId: pdf } : s)) }, /사진이 아닌 자료/);
  const secret = await libFile(ctx.staffA.id, 'image/png', await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000000' } }).png().toBuffer(), 'secret.png');
  await sql`update library_files set security = 'confidential', security_confirmed = true where id = ${secret}`;
  await bad({ slides: slides.map((s, k) => (k === 1 ? { ...s, imageId: secret } : s)) }, /기밀 자료는 카드뉴스/);
  const photo = await libFile(ctx.staffA.id, 'image/jpeg', await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer(), 'lounge.jpg');
  const fixed = slides.map((s, k) => (k === 3 ? { ...s, body: '운영사가 인력·프로그램을 맡아요.\n운영비 구조를 미리 비교하세요.' } : k === 0 || k === 2 ? { ...s, imageId: photo } : k === 4 ? { ...s, imageId: photo } : s));
  const saved = (await ctx.staffA.client.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'save', slides: fixed, template: 'clean', keyword: "'비교표'" })).item;
  assert.deepEqual({ ph: saved.check.placeholders, tpl: saved.template, kw: saved.keyword, photos: saved.slides.map((s) => s.imageId), title: saved.photos[photo] },
    { ph: [], tpl: 'clean', kw: '비교표', photos: [photo, null, photo, null, null, null, null], title: 'lounge.jpg' }, '표 장에는 사진을 두지 않음');
  assert.deepEqual(size((await png(ctx.staffA.client, `/api/marketing/carousels/${item.id}/slides/1`)).buf), { w: 1080, h: 1350 }, '사진 넣은 표지');
  // 그리기 → 자료실 + 승인 대기
  const r = await ctx.staffA.client.ok('POST', `/api/marketing/carousels/${item.id}/render`, {});
  assert.equal(r.version, 1); assert.equal(r.mediaIds.length, 7); assert.equal(r.item.status, 'sent'); assert.equal(r.item.content_id, r.contentId);
  const files = await sql`select mime_type, folder, space, tags, size_bytes, title from library_files where id = any(${r.mediaIds}::uuid[]) order by title`;
  assert.ok(files.every((f) => f.mime_type === 'image/jpeg' && f.folder === '마케팅/카드뉴스' && f.space === 'marketing' && f.tags.includes('카드뉴스') && f.size_bytes > 10000), JSON.stringify(files));
  assert.equal(files[0].title, '위탁 운영 vs 직영, 우리 단지엔? 1/7');
  const [c] = await sql`select c.channel, c.kind, c.status, c.mode, c.brand_id, c.title, v.media_ids, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${r.contentId}`;
  assert.deepEqual({ channel: c.channel, kind: c.kind, status: c.status, mode: c.mode, brand: c.brand_id, n: c.media_ids.length, body: c.body },
    { channel: 'instagram', kind: 'feed', status: 'pending', mode: 'content', brand: P.brand, n: 7, body: CAPTION });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.contents >= 1, true, '승인함에 콘텐츠');
  // 다시 그리기 = 같은 콘텐츠의 새 버전(재승인)
  await ctx.staffA.client.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'save', caption: `${CAPTION}\n#카드뉴스` });
  const r2 = await ctx.staffA.client.ok('POST', `/api/marketing/carousels/${item.id}/render`, {});
  assert.deepEqual([r2.contentId, r2.version], [r.contentId, 2]);
  assert.equal((await ctx.staffA.client.patch(`/api/marketing/carousels/${item.id}`, { action: 'cancel' })).status, 400, '보낸 카드뉴스는 승인함에서');
  // 다른 회사 카드뉴스 = 없는 것처럼
  await sql`insert into tenants (id, name) values ('t_car', '남의회사') on conflict do nothing`;
  const [o] = await sql`insert into mkt_carousels (tenant, product, topic, slides) values ('t_car', 'x', '남의 주제', ${sql.json(SLIDES.slice(0, 2))}) returning id`;
  assert.equal((await ctx.owner.patch(`/api/marketing/carousels/${o.id}`, { action: 'save', caption: 'x' })).status, 404);
  assert.equal((await png(ctx.owner, `/api/marketing/carousels/${o.id}/slides/1`)).status, 404);
  assert.equal((await ctx.owner.post(`/api/marketing/carousels/${o.id}/render`, {})).status, 404);
});

test('AI 실패 → 빈 틀(유형별 6장·{{ }}) · 금지어·빈 본문은 그리기 전 막음 · AI 로 고치기(사진 자리 유지·반영 요약) · AI 꺼짐/실패 땐 고치기 거절 · 취소(만든 사람·관리자)', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const { item, aiError } = await ctx.staffA.client.ok('POST', '/api/marketing/carousels', { brandId: P.brand, product: '커뮤니티 위탁 운영', topic: '입주 전 커뮤니티 점검 5가지', pattern: 'checklist' });
  assert.equal(item.source, 'template'); assert.ok(aiError);
  assert.deepEqual(item.slides.map((s) => s.kind), ['cover', 'body', 'body', 'body', 'table', 'cta']);
  assert.equal(item.slides.at(-1).title, "댓글에 '자료' 남겨 주세요"); assert.equal(item.slides.at(-1).body, '자료를 보내 드려요\n도움이 됐다면 저장·팔로우');
  assert.deepEqual(item.check.placeholders, [2, 3, 4, 5]);
  // 채운 뒤 금지어·빈 본문
  const filled = item.slides.map((s) => ({ ...s, title: s.title.replace(/\{\{[^}]*\}\}/g, '점검'), body: s.body.replace(/\{\{[^}]*\}\}/g, '확인'), rows: s.rows.map((r) => r.map((c) => c.replace(/\{\{[^}]*\}\}/g, '항목'))) }));
  await ctx.staffA.client.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'save', slides: filled.map((s, k) => (k === 1 ? { ...s, body: '최고의 운영을 위해' } : s)) });
  const b = await ctx.staffA.client.post(`/api/marketing/carousels/${item.id}/render`, {});
  assert.equal(b.status, 400); assert.match(b.body.error.message, /금지어가 들어 있습니다: 최고/);
  await ctx.staffA.client.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'save', slides: filled, caption: '' });
  assert.match((await ctx.staffA.client.post(`/api/marketing/carousels/${item.id}/render`, {})).body.error.message, /인스타 본문/);
  // AI 로 고치기: 사진 자리(장 번호)는 그대로
  const photo = await libFile(ctx.staffA.id, 'image/png', await sharp({ create: { width: 400, height: 400, channels: 3, background: '#cccccc' } }).png().toBuffer(), 'desk.png');
  await ctx.staffA.client.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'save', slides: filled.map((s, k) => (k === 1 ? { ...s, imageId: photo } : s)), caption: '점검 5가지\n\n댓글에 자료' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ slides: SLIDES.filter((s) => s.kind !== 'table'), caption: '고친 본문', keyword: '점검표', changes: '표지를 짧게 → 질문형으로' })] });
  const rw = await ctx.staffA.client.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'rewrite', note: '표지를 더 짧게' });
  assert.equal(rw.changes, '표지를 짧게 → 질문형으로'); assert.equal(rw.item.input.changes, '표지를 짧게 → 질문형으로');
  assert.equal(rw.item.slides[1].imageId, photo, '2장 사진 유지'); assert.equal(rw.item.caption, '고친 본문'); assert.equal(rw.item.keyword, '점검표');
  assert.match(lastAi(), /\[지금 안\]/); assert.match(lastAi(), /\[수정 요청\] 표지를 더 짧게/);
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const rf = await ctx.staffA.client.patch(`/api/marketing/carousels/${item.id}`, { action: 'rewrite', note: '다시' });
  assert.equal(rf.status, 400); assert.match(rf.body.error.message, /AI 로 고치지 못했습니다/);
  assert.equal((await ctx.staffA.client.patch(`/api/marketing/carousels/${item.id}`, { action: 'rewrite', note: 'x' })).status, 400, '두 글자 이상');
  // 취소: 만든 사람·관리자
  await ctl({ anthropicReset: true, anthropicQueue: [say({ slides: SLIDES, caption: CAPTION, keyword: '비교표' })] });
  const mine = (await ctx.owner.ok('POST', '/api/marketing/carousels', { product: '커뮤니티 위탁 운영', topic: '대표가 만든 카드뉴스', pattern: 'vs' })).item;
  assert.equal((await ctx.staffA.client.patch(`/api/marketing/carousels/${mine.id}`, { action: 'cancel' })).status, 403, '남이 만든 초안');
  assert.equal((await ctx.owner.ok('PATCH', `/api/marketing/carousels/${item.id}`, { action: 'cancel' })).item.status, 'canceled', '관리자는 직원 초안도');
  assert.equal((await ctx.staffA.client.patch(`/api/marketing/carousels/${item.id}`, { action: 'save', caption: 'x' })).status, 400, '취소한 것은 못 고침');
});
