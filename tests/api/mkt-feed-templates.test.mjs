// #544 브랜드 키트 '피드 틀'(대표 10/24 '바디랩 표지가 다 똑같다 · 바탕 글자 위에 또 글자 · 브랜드별 레퍼런스와 비교해 개선한 뒤 승인 다시'):
// 키트 저장·검증·바탕 색 출처(한 곳) · 미리보기(틀마다 한 장, 관리자만) · 자동 제작이 틀을 돌려 씀(가까운 3개와 다른 틀) · 틀을 고르면 초안 보관 풀림
// · AI 시안 칸(card) — 금액은 재료에 있는 것만 · [다른 틀로 다시 그리기] · 글만 고친 수정본은 같은 틀 · 사진 틀은 '시안 바탕' 사진만(4분할 = 4장)
// 구조 시험(가짜 AI·시험 저장소) — 그림 모양은 미리보기·운영 화면에서
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
const FEED = { style: 'trust', templates: ['title', 'list', 'statement', 'report', 'price'], palette: { bg: '#152037', accent: '#f0b038' }, header: '시험 머리줄', contact: '상담 1234-5678 · example.co.kr', kicker: '운영 기록' };
async function libFile(data, name, tags = ['글자없음']) {
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${tags}) returning id`;
  const key = `lib/default/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
const card = (extra = {}) => ({ kicker: '운영 기록', points: ['출입 기록 자동 정리', '시설 예약 한 화면', '공지 읽음 확인'], left: '', right: '', keyword: '', period: '', prices: [{ label: '3개월', value: '19만원' }, { label: '6개월', value: '33만원' }, { label: '1개월', value: '87만원' }], ...extra });
const cur = async (id) => (await sql`select c.status, c.current_version, c.quality, c.scheduled_at, v.media_ids, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', leadDays: 7, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: true });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '피드시험' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 운영 대행', products: '운영 대행 3개월 19만원, 6개월 33만원' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('키트 피드 틀: 검증·저장(카탈로그 순서·대문자) · 바탕 색 출처 한 곳(피드 틀) · 미리보기(관리자만·틀마다 540×675)', async () => {
  let v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(v.feedCatalog.templates.length, 13); assert.equal(v.feedCatalog.styles.length, 4); // #262 노트북 화면형 추가
  assert.deepEqual(v.feedCatalog.styles.find((s) => s.id === 'trust').templates, ['title', 'list', 'photo_fade', 'grid4']);
  let b = v.brands.find((x) => x.id === P.brand);
  assert.equal(b.draw.from, null, '색을 아무 데도 안 정하면 출처 없음(진한 남색)');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { feed: { templates: ['nope'] } })).status, 400, '없는 틀');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { feed: { palette: { bg: 'navy' } } })).status, 400, '색은 #RRGGBB');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { feed: FEED })).status, 403, '키트는 관리자');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { feed: { ...FEED, templates: ['price', 'title', 'list', 'title', 'statement', 'report'] } });
  v = await ctx.owner.ok('GET', '/api/marketing/auto'); b = v.brands.find((x) => x.id === P.brand);
  assert.deepEqual(b.feed.templates, ['title', 'list', 'price', 'statement', 'report'], '중복 없이 카탈로그 순서');
  assert.deepEqual([b.feed.palette.bg, b.feed.palette.accent, b.feed.header, b.feed.contact], ['#152037', '#F0B038', '시험 머리줄', '상담 1234-5678 · example.co.kr']);
  assert.deepEqual(b.draw, { color: '#152037', from: 'feed' }, '그림·프롬프트 바탕 색 = 피드 틀 바탕');
  // 미리보기: 직원 403 · 고른 틀만 · 모두 보기 12장(사진·화면이 없으면 회색 자리 + 안내)
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, {})).status, 403);
  const pv = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, {});
  assert.deepEqual(pv.images.map((i) => i.template), ['title', 'list', 'price', 'statement', 'report']);
  assert.equal(pv.color.from, 'feed');
  const all = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, { all: true, feed: { templates: [] } });
  assert.equal(all.images.length, 13); // #262 노트북 화면형 추가
  const m = await sharp(Buffer.from(all.images[0].src.replace(/^data:image\/jpeg;base64,/, ''), 'base64')).metadata();
  assert.deepEqual([m.format, m.width, m.height], ['jpeg', 540, 675]);
  assert.match(all.images.find((i) => i.template === 'photo_fade').note, /시안 바탕\(글자 없는 사진\)/, '사진 자리 안내');
  assert.match(all.images.find((i) => i.template === 'phone').note, /영상 화면 캡처/);
  assert.equal(all.images.find((i) => i.template === 'title').note, null);
  // '영상 화면 캡처'에 올린 화면이 휴대폰 틀 안에 — 세로 캡처는 폭에 맞춰 위에서부터(양옆 빨간 띠가 잘리지 않고 보임)
  const shot = await sharp({ create: { width: 390, height: 664, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="390" height="664"><rect width="14" height="664" fill="#DC2626"/><rect x="376" width="14" height="664" fill="#DC2626"/></svg>'), left: 0, top: 0 }]).png().toBuffer();
  const cap = await libFile(shot, '앱 홈 화면.png', []);
  await sql`update library_files set folder = '마케팅/영상 화면 캡처', mime_type = 'image/png' where id = ${cap}`;
  const ph = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, { feed: { templates: ['phone'] } });
  assert.deepEqual(ph.images.map((i) => [i.template, i.note]), [['phone', null]], '화면이 있으면 회색 자리 안내 없음');
  const { data, info } = await sharp(Buffer.from(ph.images[0].src.replace(/^data:image\/jpeg;base64,/, ''), 'base64')).raw().toBuffer({ resolveWithObject: true });
  let red = 0; for (let k = 0; k < data.length; k += info.channels) if (data[k] > 170 && data[k + 1] < 90 && data[k + 2] < 90) red++;
  assert.ok(red > 1500, `캡처 양옆이 보임(빨간 점 ${red})`);
  // #262(대표 10/25 ④): 노트북 화면형 — 세로 캡처만 있으면 'PC(가로) 화면' 안내(회색 자리), 가로 캡처를 올리면 노트북 틀 안에(위 빨간 띠가 보임) · 휴대폰 틀은 가로 캡처가 더 최근이어도 세로 캡처를 먼저 씀
  const lp0 = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, { feed: { templates: ['laptop'] } });
  assert.match(lp0.images[0].note ?? '', /PC\(가로\) 화면/, JSON.stringify(lp0.images.map((i) => [i.template, i.note])));
  const wide = await sharp({ create: { width: 1366, height: 768, channels: 3, background: '#FFFFFF' } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1366" height="768"><rect width="1366" height="60" fill="#DC2626"/></svg>'), left: 0, top: 0 }]).png().toBuffer();
  const capW = await libFile(wide, 'PC 홈 화면.png', []);
  await sql`update library_files set folder = '마케팅/영상 화면 캡처', mime_type = 'image/png' where id = ${capW}`;
  const lp = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, { feed: { templates: ['laptop'] } });
  assert.deepEqual(lp.images.map((i) => [i.template, i.note]), [['laptop', null]], '가로 캡처가 있으면 안내 없음');
  const reds = async (src) => { const { data, info } = await sharp(Buffer.from(src.replace(/^data:image\/jpeg;base64,/, ''), 'base64')).raw().toBuffer({ resolveWithObject: true }); let n = 0; for (let k = 0; k < data.length; k += info.channels) if (data[k] > 170 && data[k + 1] < 90 && data[k + 2] < 90) n++; return n; };
  assert.ok((await reds(lp.images[0].src)) > 800, `노트북 화면 위쪽 빨간 띠가 보임(빨간 점 ${await reds(lp.images[0].src)})`);
  const ph2 = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${P.brand}/feed-preview`, { feed: { templates: ['phone'] } });
  assert.ok((await reds(ph2.images[0].src)) > 1500, `휴대폰 틀 = 세로 캡처(양옆 빨간 띠, 빨간 점 ${await reds(ph2.images[0].src)})`);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/auto/brands/00000000-0000-0000-0000-000000000000/feed-preview', {})).status, 404);
});

test('자동 제작: 틀을 고른 브랜드는 초안 보관 없이 승인 대기 · 가까운 3개와 다른 틀 · AI 칸 저장(재료에 없는 금액 뺌) · 글만 고친 수정본 = 같은 틀 · [다른 틀로 다시 그리기]', async () => {
  const rule = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '운영 대행' });
  // #235 ⓓ 가까운 날 같은 글은 올리기 전 검사가 막으므로 글마다 다른 본문
  const NEWS = [['관리사무소 일, 이렇게 줄였습니다', '출입 기록이 자동으로 정리됩니다.'], ['경비실 교대가 가벼워졌습니다', '순찰 기록을 휴대폰으로 남깁니다.'], ['주차 민원이 절반으로', '방문 차량 등록을 미리 받습니다.'],
    ['공지 읽음을 한눈에', '동별로 확인한 세대를 셉니다.'], ['시설 예약을 휴대폰으로', '독서실 좌석을 주민이 직접 고릅니다.'], ['야간 순찰 기록 정리', '사진과 시각이 함께 남습니다.']];
  await ctl({ anthropicReset: true, anthropicQueue: Array.from({ length: 6 }, (_, i) => say({ title: `운영 소식 ${i + 1}`, body: NEWS[i].join('\n'), brief: '', why: '', hooks: [], keyword: '', card: card() })) });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.length >= 4 && run.produced.every((r) => !r.held), JSON.stringify(run.produced));
  const sent = JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
  assert.ok(sent.includes('"card"') && sent.includes('시안 그림 칸'), 'AI 에게 시안 칸(card)을 함께 받음');
  const made = await sql`select id, status, quality from mkt_contents where rule_id = ${rule.id} and produced_at is not null order by scheduled_at`;
  const ts = made.map((c) => c.quality.visual?.template);
  assert.ok(made.every((c) => c.status === 'pending'), '피드 틀 = 템플릿 준비 → 승인 대기');
  // 295차 #835: 목록·가격(도표) 틀이 될 때는 단색 틀(제목형·큰 글씨·리포트)을 표지로 쓰지 않음 — 쓸 틀이 2종이면 바로 앞 글과만 다르게
  assert.ok(ts.every((t) => ['list', 'price'].includes(t)), `단색 틀 안 씀: ${ts.join(',')}`);
  for (let i = 1; i < ts.length; i++) assert.notEqual(ts[i], ts[i - 1], `바로 앞 글과 다른 틀: ${ts.join(',')}`);
  const c0 = made[0];
  assert.deepEqual(c0.quality.card.prices, [{ label: '3개월', value: '19만원' }, { label: '6개월', value: '33만원' }], '재료에 없는 금액(87만원)은 뺌');
  assert.deepEqual(c0.quality.card.points, ['출입 기록 자동 정리', '시설 예약 한 화면', '공지 읽음 확인']);
  const [lib] = await sql`select description, meta from library_files where id = ${(await cur(c0.id)).media_ids[0]}`;
  assert.equal(lib.meta.template, c0.quality.visual.template); assert.match(lib.description, /틀: /);
  assert.match((await cur(c0.id)).note, /시안 서버 그리기\(틀: /);
  // 글만 고친 수정본(#545) = 같은 틀
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '운영 소식 1', body: '관리사무소 일, 반으로\n출입 기록이 자동으로 정리됩니다.', brief: '', why: '', hooks: [], keyword: '', card: card({ kicker: '이번 주' }) })] });
  const d1 = await ctx.owner.ok('POST', `/api/marketing/contents/${c0.id}/decide`, { version: 1, decision: 'changes', comment: '첫 줄을 더 짧게' });
  assert.equal(d1.revision.version, 2);
  const r1 = await cur(c0.id);
  assert.equal(r1.quality.visual.template, c0.quality.visual.template, '글만 고치면 같은 틀');
  assert.equal(r1.quality.card.kicker, '', '187차 ⑤: 키트 머리말(운영 기록)을 채운 브랜드는 고정 — AI 머리말(이번 주)은 쓰지 않음');
  // [다른 틀로 다시 그리기] = 지금 틀은 빼고
  const rd = await ctx.owner.ok('POST', `/api/marketing/contents/${c0.id}/visual`, { redraw: true });
  const r2 = await cur(c0.id);
  assert.equal(rd.version, 3); assert.ok(rd.template, '틀 이름'); assert.notEqual(r2.quality.visual.template, r1.quality.visual.template, '다른 틀');
  assert.equal(r2.status, 'pending');
  // 승인함 카드: 피드 틀 브랜드 표시
  const card0 = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.find((c) => c.id === c0.id);
  assert.equal(card0.brand_templates, true);
});

test('사진 틀: 시안 바탕 사진만(글자 든 그림 빼고) · 4분할 = 4장 · 사진을 바꾸라면 사진 틀은 그대로 새 사진 · 초안 보관 글은 [새 틀로 다시 그리기] 뒤에도 보관', async () => {
  const jpg = (r, g, b) => sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  P.photos = [];
  for (const [i, n] of ['피드시험 라운지', '피드시험 독서실', '피드시험 헬스장', '피드시험 카페', '피드시험 현관'].entries()) P.photos.push(await libFile(await jpg(40 + i * 30, 90, 120), `${n}.jpg`));
  P.graphic = await libFile(await jpg(200, 40, 40), '피드시험 이벤트 포스터.jpg', []); // 글자 든 그래픽(태그 없음) = 바탕으로 안 씀
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { feed: { ...FEED, templates: ['photo_fade', 'grid4'] } });
  const [c] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values ('default', '피드시험 사진 글', 'instagram', 'feed', now() + interval '9 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${P.brand}, ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, '라운지가 이렇게 바뀌었습니다\n주민 모임이 늘었습니다.', ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  const mk = await ctx.owner.ok('POST', `/api/marketing/contents/${c.id}/visual`, {});
  const q1 = (await cur(c.id)).quality.visual;
  assert.ok(['photo_fade', 'grid4'].includes(q1.template), q1.template); assert.ok(mk.template);
  const used = q1.template === 'grid4' ? q1.photoIds : [q1.photoId];
  assert.ok(used.length === (q1.template === 'grid4' ? 4 : 1) && used.every((id) => P.photos.includes(id)), '시안 바탕 사진만');
  assert.ok(!used.includes(P.graphic), '글자 든 그림은 바탕으로 안 씀');
  // 사진을 바꾸라면: 사진 틀은 그대로, 써 본 사진은 빼고
  const d = await ctx.owner.ok('POST', `/api/marketing/contents/${c.id}/decide`, { version: 2, decision: 'changes', comment: '사진을 다시 만들어 주세요' });
  assert.equal(d.revision.kind, 'visual');
  const q2 = (await cur(c.id)).quality.visual;
  assert.equal(q2.template, q1.template, '사진 틀은 그대로');
  if (q1.template === 'photo_fade') assert.notEqual(q2.photoId, q1.photoId, '새 사진');
  // 초안 보관 글: [새 틀로 다시 그리기] 뒤에도 보관(승인함에 저절로 안 올라감)
  const [h] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values ('default', '피드시험 보관 글', 'instagram', 'feed', now() + interval '10 days', 'draft', 1, ${ctx.ownerId}, true, now(), ${P.brand}, ${sql.json({ passed: true, issues: [], held: { at: new Date().toISOString(), reason: 'template' } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${h.id}, 1, '현관 출입이 빨라졌습니다\n주민 반응이 좋습니다.', ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  const old = await ctx.owner.ok('POST', `/api/marketing/contents/${h.id}/visual`, {}).catch(() => null); // 시안 없는 보관 글이면 먼저 그림
  assert.ok(old?.version);
  const rr = await ctx.owner.ok('POST', `/api/marketing/contents/${h.id}/visual`, { redraw: true });
  const hq = await cur(h.id);
  assert.equal(hq.status, 'draft'); assert.ok(hq.quality.held, '보관 그대로'); assert.ok(hq.quality.visual.template && rr.template);
});
