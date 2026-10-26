// 190차(대표 #689 '브랜드 키트를 AI 마케터가 자동 제작하는 버튼'): 브랜드 키트 [AI로 채우기]
// 권한·재료 없음 · 재료(회사 소개·회사 정보·게시 글·마케팅 공간 문서·사진 설명·로고) → AI 초안 · 사실 칸 대조(재료에 없는 값은 뺌) ·
// 기밀·업무 공간 문서는 AI 에 안 감 · 메일 주소 가림 · 다른 브랜드 이름 거름 · 색(로고·지금 색·AI) · 저장 안 함 → [고른 칸 저장] 감사 기록
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
async function lib(name, data, { space = 'marketing', folder = '마케팅/사진', vision = null, mime = 'image/jpeg', tags = [], text = null, security = 'internal' } = {}) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision, text_content, security)
    values ('default', ${space}, ${folder}, ${name}, ${name}, ${mime}, ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${tags}, ${vision ? sql.json(vision) : null}, ${text}, ${security}) returning id`;
  const key = `lib/default/${f.id}/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
const near = (hex, want, tol = 4) => !!hex && [1, 3, 5].every((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(want.slice(i, i + 2), 16)) <= tol);
const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '', scene: '', tags: [], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const ANSWER = {
  intro: '다짐은 아파트 단지 안 피트니스를 운영합니다. 입주민이 가까운 곳에서 운동을 이어 가도록 돕습니다. 회원 1,200명이 함께합니다.',
  products: ['월 회원권 55,000원', 'PT 상담', '하이링크 앱으로 예약'], tone: '친근한 존댓말',
  voice: { topics: '입주민 운동 습관', audience: '아파트 입주민', offer: '단지 안 피트니스', phrases: ['같이 해요'], avoid: ['역대급'], formality: 'polite', emoji: 'few', emojis: ['💪'] },
  bannedWords: ['역대급', '최고'],
  facts: { phone: '02-1234-5678', link: 'https://pf.kakao.com/_fake', website: 'dagym.example', address: '서울시 강남구 테헤란로 1', hours: '06:00~23:00', prices: '월 회원권 55,000원',
    numbers: '회원 1,200명 — 자체 집계', aliases: ['DAGYM', 'DZ'], keywords: ['강남 헬스장', '부산 헬스장'] },
  topics: ['퇴근 후 20분, 단지 헬스장 루틴', '하이링크 앱 소개', '처음 오는 입주민 안내', '퇴근 후 20분, 단지 헬스장 루틴'],
  style: 'trust', color: '#123456', kickers: ['입주민 운동 노트', '하이링크 소식', '오늘의 1분', '운동 습관 Q&A'],
};
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  P.other = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('권한·재료: 직원 403 · 공간 밖 404 · 없는 브랜드 404 · 재료가 하나도 없으면 400(AI 안 부름)', async () => {
  await sql`update tenants set ai_business = null, ai_customers = null where id = 'default'`;
  const url = `/api/marketing/auto/brands/${P.brand}/kit-draft`;
  assert.equal((await ctx.staffA.client.req('POST', url, {})).status, 403);
  assert.equal((await ctx.staffB.client.req('POST', url, {})).status, 404, '마케팅 공간 밖');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/auto/brands/00000000-0000-4000-8000-000000000000/kit-draft', {})).status, 404);
  const n = fake.state.anthropic.length;
  const r = await ctx.owner.req('POST', url, {});
  assert.equal(r.status, 400); assert.match(JSON.stringify(r.body ?? r.json ?? {}), /재료가 없습니다/);
  assert.equal(fake.state.anthropic.length, n, '재료가 없으면 AI 를 부르지 않음');
});

test('초안: 재료 → AI 한 번 · 사실 칸은 재료에 있는 값만(뺀 것 안내) · 숫자·다른 브랜드 문장 뺌 · 기밀·업무 공간 문서 안 감 · 메일 가림 · 로고 색 · 저장 안 함', async () => {
  await sql`update tenants set ai_business = '아파트 커뮤니티 시설 위탁 운영', ai_customers = '아파트 입주민·관리사무소' where id = 'default'`;
  await sql`insert into company_profiles (tenant, key, name, phone, address, website, is_default) values ('default', 'dagym', '다짐', '02-1234-5678', '서울시 강남구 테헤란로 1', 'https://dagym.example', true)`;
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '단지 헬스장 새 기구', channel: 'instagram', brandId: P.brand, body: '이번 주 새 기구가 들어왔어요. 같이 해요!\n상담 02-1234-5678', mediaIds: [] });
  await sql`update mkt_contents set status = 'published', published_at = now() where id = ${m.id}`;
  P.doc = await lib('다짐 소개서.pdf', Buffer.from('pdf'), { mime: 'application/pdf', folder: '마케팅/소개', text: 'DAGYM 다짐 피트니스 소개. 월 회원권 55,000원. 운영 시간 06:00~23:00. 담당 manager@dagym.example' });
  await lib('다짐 단가표(기밀).pdf', Buffer.from('pdf'), { mime: 'application/pdf', folder: '마케팅/소개', text: '다짐 SECRET-PRICE 99,999원', security: 'confidential' });
  await lib('다짐 업무 메모.pdf', Buffer.from('pdf'), { mime: 'application/pdf', space: 'work', folder: '업무', text: '다짐 WORK-ONLY 메모' });
  const jpg = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
  await lib('다짐 로비.jpg', jpg, { tags: ['다짐'], vision: V({ caption: '밝은 단지 피트니스 로비', tags: ['로비'] }) });
  const png = await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: { create: { width: 140, height: 140, channels: 4, background: { r: 15, g: 118, b: 110, alpha: 1 } } }, left: 30, top: 30 }]).png().toBuffer();
  const logo = await lib('다짐 로고.png', png, { mime: 'image/png', folder: '마케팅/로고' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { logoFileId: logo } });

  await ctl({ anthropicReset: true, anthropicQueue: [say(ANSWER)] });
  const n = fake.state.anthropic.length;
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/kit-draft`, {});
  assert.equal(fake.state.anthropic.length, n + 1, 'AI 요청 1회');
  const sent = JSON.stringify(fake.state.anthropic.at(-1).body);
  assert.ok(sent.includes('다짐 소개서') && sent.includes('55,000원') && sent.includes('[메일]'), '마케팅 공간 문서가 재료로(메일은 가림)');
  assert.ok(!sent.includes('manager@dagym.example') && !sent.includes('SECRET-PRICE') && !sent.includes('WORK-ONLY'), '메일 주소·기밀 문서·업무 공간 문서는 AI 에 안 감');
  assert.ok(sent.includes('밝은 단지 피트니스 로비') && sent.includes('상담 02-1234-5678') && sent.includes('아파트 커뮤니티 시설 위탁 운영'), '사진 설명·게시 글·회사 소개');
  const d = r.draft;
  assert.equal(d.intro, '다짐은 아파트 단지 안 피트니스를 운영합니다. 입주민이 가까운 곳에서 운동을 이어 가도록 돕습니다.', '재료에 없는 숫자(1,200명) 문장은 뺌');
  assert.equal(d.products, '월 회원권 55,000원\nPT 상담', '다른 브랜드 이름이 든 줄은 뺌');
  assert.deepEqual(d.facts, { phone: '02-1234-5678', website: 'dagym.example', address: '서울시 강남구 테헤란로 1', hours: '06:00~23:00', prices: '월 회원권 55,000원', aliases: ['DAGYM'], keywords: ['강남 헬스장'] });
  assert.ok(r.dropped.some((x) => x.startsWith('상담·예약 링크')) && r.dropped.some((x) => x.startsWith('숫자·근거')) && r.dropped.some((x) => x.startsWith('다른 이름 1개'))
    && r.dropped.some((x) => x.startsWith('검색 키워드 1개')) && r.dropped.some((x) => x.startsWith('소개 —')) && r.dropped.some((x) => x.startsWith('주력 상품 —')), JSON.stringify(r.dropped));
  assert.deepEqual(d.topics, ['퇴근 후 20분, 단지 헬스장 루틴', '처음 오는 입주민 안내'], '다른 브랜드·중복 주제 뺌');
  assert.deepEqual(d.kickers, ['입주민 운동 노트', '운동 습관 Q&A'], '다른 브랜드·숫자 머리말 뺌');
  assert.ok(d.bannedWords.includes('역대급') && d.bannedWords.includes('최고') && d.bannedWords.includes('보장') && new Set(d.bannedWords).size === d.bannedWords.length);
  assert.deepEqual([d.voice.audience, d.voice.formality, d.voice.emojis], ['아파트 입주민', 'polite', ['💪']]);
  assert.deepEqual(d.feed, { style: 'trust', templates: ['title', 'list', 'photo_fade', 'grid4'] });
  assert.ok(d.color.from === 'logo' && near(d.color.hex, '#0F766E'), `로고에서 뽑은 색 ${JSON.stringify(d.color)}`);
  assert.deepEqual([r.sources.company, r.sources.profiles, r.sources.posts, r.sources.docs.map((x) => x.title), r.sources.photos, r.sources.logo], [true, 1, 1, ['다짐 소개서.pdf'], 1, true]);
  const [b] = await sql`select intro, facts, topic_pool, feed from mkt_brands where id = ${P.brand}`;
  assert.deepEqual([b.intro, b.topic_pool ?? []], [null, []], '초안은 저장하지 않음');
  P.draft = d;
});

test('[고른 칸 저장]: 고른 칸만 바뀜 · 사실 카드 합치기 · 주제 풀 더하기 · 틀·바탕 색 · 감사 기록 · 색 출처(지금 색·AI)', async () => {
  const d = P.draft;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { facts: { hours: '평일 06:00~23:00' }, topicPool: ['기존 주제 하나'] });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, {
    intro: d.intro, facts: { hours: '평일 06:00~23:00', phone: d.facts.phone, address: d.facts.address }, topicPool: ['기존 주제 하나', ...d.topics],
    feed: { style: d.feed.style, templates: d.feed.templates, palette: { bg: d.color.hex }, header: null, contact: null, kicker: d.kickers[0] }, aiFill: ['intro', 'facts.phone', 'facts.address', 'topicPool', 'feed', 'color', 'kicker'] });
  const [b] = await sql`select intro, tone, facts, topic_pool, feed from mkt_brands where id = ${P.brand}`;
  assert.equal(b.intro, d.intro); assert.equal(b.tone, null, '고르지 않은 칸은 그대로');
  assert.deepEqual([b.facts.hours, b.facts.phone, b.facts.address], ['평일 06:00~23:00', '02-1234-5678', '서울시 강남구 테헤란로 1'], '이미 적힌 칸은 그대로 두고 합침');
  assert.deepEqual(b.topic_pool, ['기존 주제 하나', '퇴근 후 20분, 단지 헬스장 루틴', '처음 오는 입주민 안내']);
  assert.deepEqual([b.feed.style, b.feed.templates, b.feed.palette.bg, b.feed.kicker], ['trust', ['title', 'list', 'photo_fade', 'grid4'], d.color.hex, '입주민 운동 노트']);
  const [a] = await sql`select actor_id, target_id, detail from audit_logs where action = 'mkt.brand_kit_ai' order by id desc limit 1`;
  assert.deepEqual([a.actor_id, a.target_id, a.detail.fields.length], [ctx.ownerId, P.brand, 7], '감사 기록(고른 칸 이름)');
  // 지금 정한 색(피드 틀 바탕)이 있으면 그대로 · 로고·브랜드 색이 없으면 AI 제안(진한 색만)
  await ctl({ anthropicReset: true, anthropicQueue: [say(ANSWER)] });
  assert.deepEqual((await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/kit-draft`, {})).draft.color, { hex: d.color.hex, from: 'current' });
  const nb = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '바디랩' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${nb}`, { intro: '바디랩은 동네 운동 공간입니다.' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ ...ANSWER, color: '#123456' })] });
  assert.deepEqual((await ctx.owner.ok('POST', `/api/marketing/auto/brands/${nb}/kit-draft`, {})).draft.color, { hex: '#123456', from: 'ai' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ ...ANSWER, color: '#FAFAFA' })] });
  assert.deepEqual((await ctx.owner.ok('POST', `/api/marketing/auto/brands/${nb}/kit-draft`, {})).draft.color, { hex: null, from: null }, '흰 글자가 안 읽히는 밝은 색은 제안하지 않음');
});
