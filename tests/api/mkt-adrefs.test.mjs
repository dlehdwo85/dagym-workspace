// #499-6 경쟁 광고 보관함: 넣기(링크·대본·영상 + 음성 받아쓰기 → 음성 파일 지움·비용 기록)·첫 문장 훅 유형(규칙)·링크로 매체·필수(링크/영상/대본 중 하나)·영상·이미지만·공간 밖/다른 회사 404
// · 고치기·빼기 = 넣은 사람·관리자, ★ = 누구나 · [AI 분석](뼈대·제안·각도, 실패 400) · [공통 구조 분석](우리 재료·대본 3안 광고형 점수 / AI 실패 → 숫자 정리) · 주간 분석(3개부터·한 주 한 번·승인자 알림)
// 가짜 AI·가짜 받아쓰기 = 구조 시험(실제 분석 품질은 확인 못함)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const lastAi = () => JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - n * 864e5));
const TRANSCRIPT = '입주 앞둔 단지, 커뮤니티 운영사 아직 못 정하셨나요? 무료 운영 진단 받아 보세요. 양식에 단지명만 남기세요.';
async function libFile(owner, mime, data, name) {
  const [u] = await sql`select tenant from users where id = ${owner}`;
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source)
    values (${u.tenant}, 'marketing', '마케팅/경쟁 광고', ${name}, ${name}, ${mime}, ${data.length}, ${owner}, 'ready', 'ai_attach') returning id`;
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
  await sql`update mkt_brands set banned_words = '{최고}' where id = ${P.brand}`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('넣기: 링크+대본(Meta·질문형·n일째) · 첫 문장만(가격·상황극·비교·숫자·공감·기타) · 링크만(인스타) · 영상+음성 받아쓰기(음성 지움·비용) · 필수·형식·공간 밖·다른 회사 브랜드', async () => {
  const add = (b) => ctx.staffA.client.ok('POST', '/api/marketing/adrefs', { advertiser: '경쟁사', ...b });
  const a = (await add({ advertiser: '경쟁사A', url: 'https://www.facebook.com/ads/library/?id=123', format: 'video', startedOn: daysAgo(45), variants: 4, transcript: TRANSCRIPT, brandId: P.brand })).item;
  P.a = a.id;
  assert.deepEqual({ platform: a.platform, hook: a.hook, type: a.hook_type, days: a.days, variants: a.variants, brand: a.brand_name },
    { platform: 'meta', hook: '입주 앞둔 단지, 커뮤니티 운영사 아직 못 정하셨나요?', type: 'question', days: 45, variants: 4, brand: '다짐' });
  const types = {};
  for (const [hook, want] of [['월 9,900원으로 커뮤니티 운영 끝', 'price'], ['"소장님, 헬스장 강사 또 그만뒀대요"', 'skit'], ['직영 vs 위탁, 비용 차이 정리', 'compare'],
    ['운영사 고를 때 3가지만 보세요', 'number'], ['운영사 바꾸는 거 막막하죠', 'empathy'], ['우리 단지 커뮤니티가 달라졌어요', 'other']]) {
    const it = (await add({ hook, format: 'image', startedOn: daysAgo(3) })).item; types[hook] = it.hook_type; assert.equal(it.hook_type, want, hook);
    if (want === 'price') P.b = it.id; if (want === 'compare') P.c = it.id;
  }
  const onlyLink = (await add({ url: 'https://www.instagram.com/p/abc/' })).item; P.link = onlyLink.id;
  assert.deepEqual([onlyLink.platform, onlyLink.hook, onlyLink.hook_type], ['instagram', null, null]);
  // 영상 + 음성(화면이 뽑은 WAV) → 받아쓰기 → 첫 문장, 음성 파일은 지움 · 비용 기록
  const video = await libFile(ctx.staffA.id, 'video/mp4', Buffer.alloc(2048, 1), 'ad.mp4');
  const wav = await libFile(ctx.staffA.id, 'audio/wav', Buffer.alloc(64000, 0), 'ad.wav');
  const v = await add({ advertiser: '경쟁사B', mediaId: video, audioFileId: wav, duration: 12 });
  assert.equal(v.sttNote, null); assert.equal(v.item.transcript, '다음 주 수요일까지 강남점 간판 교체 견적 받아 주세요. 그리고 전단지 초안은 금요일에 보겠습니다.');
  assert.equal(v.item.hook, '다음 주 수요일까지 강남점 간판 교체 견적 받아 주세요.'); assert.equal(v.item.media_mime, 'video/mp4');
  assert.ok((await sql`select deleted_at from library_files where id = ${wav}`)[0].deleted_at, '음성 파일은 지움');
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'marketing_adref_stt'`)[0].n, 1);
  assert.ok(fake.state.openai.some((x) => x.kind === 'transcription'));
  // 필수·형식·권한
  const bad = async (client, b, status, re) => { const r = await client.post('/api/marketing/adrefs', { advertiser: '경쟁사', ...b }); assert.equal(r.status, status, JSON.stringify(r.body)); if (re) assert.match(r.body.error.message, re); };
  await bad(ctx.staffA.client, {}, 400, /링크·영상\(이미지\)·대본 중 하나/);
  await bad(ctx.staffA.client, { url: 'ftp://example.com/x' }, 400, /http/);
  await bad(ctx.staffA.client, { mediaId: await libFile(ctx.staffA.id, 'application/pdf', Buffer.from('%PDF'), 'x.pdf') }, 400, /영상·이미지가 아닌 자료/);
  await bad(ctx.staffA.client, { hook: '안녕', brandId: '00000000-0000-0000-0000-00000000dead' }, 404);
  await bad(ctx.staffB.client, { hook: '안녕' }, 404);
  assert.equal((await ctx.staffB.client.get('/api/marketing/adrefs')).status, 404, '마케팅 공간 밖');
  const view = await ctx.staffA.client.ok('GET', '/api/marketing/adrefs');
  assert.equal(view.items.length, 9); assert.equal(view.hookTypes.skit, '상황극형'); assert.equal(view.sttEnabled, true); assert.equal(view.longRunDays, 30);
});

test('고치기·빼기 권한 · ★ · AI 분석(뼈대·제안·각도 / 실패·대본 없음 400) · 공통 구조 분석(대본 3안 광고형 점수 / AI 실패 → 숫자 정리) · 주간 분석(한 주 한 번·알림·3개 미만) · 다른 회사 404', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['marketing'] });
  const patch = (client, id, b) => client.patch(`/api/marketing/adrefs/${id}`, b);
  assert.equal((await patch(ctx.staffB.client, P.a, { action: 'save', note: 'x' })).status, 403, '남이 넣은 것은 못 고침');
  assert.equal((await patch(ctx.staffB.client, P.a, { action: 'remove' })).status, 403);
  assert.equal((await ctx.staffB.client.ok('PATCH', `/api/marketing/adrefs/${P.a}`, { action: 'star', starred: true })).item.starred, true, '★ 는 누구나');
  const ed = (await ctx.owner.ok('PATCH', `/api/marketing/adrefs/${P.b}`, { action: 'save', hook: '이번 달만 가입비 무료?' })).item;
  assert.deepEqual([ed.hook, ed.hook_type], ['이번 달만 가입비 무료?', 'question'], '첫 문장을 바꾸면 다시 분류');
  assert.equal((await ctx.owner.ok('PATCH', `/api/marketing/adrefs/${P.b}`, { action: 'save', hookType: 'price' })).item.hook_type, 'price', '직접 고른 유형');
  // AI 분석(한 편)
  await ctl({ anthropicReset: true, anthropicQueue: [say({ hook: '', hookType: 'question', beats: [{ part: '훅', text: '입주 앞둔 단지 지목' }, { part: '제안', text: '무료 운영 진단' }, { part: '행동', text: '양식에 단지명' }],
    offer: '무료 운영 진단', cta: '양식에 단지명 남기기', angle: '입주 앞둔 단지 관리소장', why: '추정: 45일째 돌린 것으로 보아 반응이 있었을 가능성' })] });
  const an = (await ctx.staffB.client.ok('PATCH', `/api/marketing/adrefs/${P.a}`, { action: 'analyze' })).item;
  assert.deepEqual({ beats: an.analysis.beats.map((b) => b.part), offer: an.analysis.offer, type: an.hook_type, hook: an.hook }, { beats: ['훅', '제안', '행동'], offer: '무료 운영 진단', type: 'question', hook: '입주 앞둔 단지, 커뮤니티 운영사 아직 못 정하셨나요?' });
  assert.ok(an.analyzed_at); assert.match(lastAi(), /경쟁사 광고 한 편/); assert.match(lastAi(), /45일째/); assert.match(lastAi(), /비슷한 소재 4개/);
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const af = await patch(ctx.staffA.client, P.c, { action: 'analyze' }); assert.equal(af.status, 400); assert.match(af.body.error.message, /AI 분석을 하지 못했습니다/);
  const nb = await patch(ctx.staffA.client, P.link, { action: 'analyze' }); assert.equal(nb.status, 400); assert.match(nb.body.error.message, /대본이나 첫 문장이 없어/);
  // 공통 구조 분석
  const script = (n) => ({ title: `${n}안`, hook: '입주 앞둔 단지 관리소장님, 커뮤니티 운영 무료 진단 받아 보세요', lines: ['운영사가 정해지지 않으면 오픈이 늦어집니다.', '인력과 프로그램을 한 번에 맡깁니다.'], cta: '양식에 단지명만 남기세요' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ common: ['첫 문장에서 대상을 부름', '무료 제안', '15초 안팎'], structure: ['대상 지목', '문제', '제안', '행동'], scripts: [script(1), script(2), script(3), script(4)] })] });
  const rep = await ctx.staffA.client.ok('POST', '/api/marketing/adrefs/report', { ids: [P.a, P.b, P.c], brandId: P.brand, product: '커뮤니티 위탁 운영' });
  assert.equal(rep.source, 'ai'); assert.equal(rep.result.scripts.length, 3, '대본은 3안까지');
  assert.ok(rep.result.scripts.every((s) => Number.isInteger(s.score) && typeof s.pass === 'boolean'), '광고형 점수');
  assert.deepEqual(rep.result.hookTypes, { question: 1, price: 1, compare: 1 });
  assert.ok(rep.result.facts.some((f) => /30일 넘게 돌린 광고 1개: 경쟁사A/.test(f))); assert.ok(rep.result.facts.some((f) => /비슷한 소재를 3개 이상 돌린 업체: 경쟁사A/.test(f)));
  assert.match(lastAi(), /\[우리 재료\]/); assert.match(lastAi(), /\[경쟁 광고 3개\]/); assert.match(lastAi(), /광고형\(전환\)/); assert.match(lastAi(), /금지어: 최고/); assert.match(lastAi(), /광고할 제품·서비스: 커뮤니티 위탁 운영/);
  await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 500, message: 'overloaded' }] });
  const rf = await ctx.staffA.client.ok('POST', '/api/marketing/adrefs/report', { ids: [P.a, P.b] });
  assert.deepEqual([rf.source, rf.result.scripts.length], ['template', 0]); assert.match(rf.result.note, /숫자 정리만/);
  assert.equal((await ctx.staffA.client.post('/api/marketing/adrefs/report', { ids: [P.a] })).status, 400);
  // 다른 회사 것은 섞이지 않음(보이는 것 1개 → 400) · 다른 회사 PATCH 404
  await sql`insert into tenants (id, name) values ('t_ad', '남의회사') on conflict do nothing`;
  const [o] = await sql`insert into mkt_ad_refs (tenant, advertiser, hook) values ('t_ad', '남의 광고', '남의 첫 문장') returning id`;
  assert.equal((await ctx.staffA.client.post('/api/marketing/adrefs/report', { ids: [P.a, o.id] })).status, 400);
  assert.equal((await patch(ctx.owner, o.id, { action: 'star', starred: true })).status, 404);
  // 주간 분석: 직원 403 · 관리자 → 1건 + 승인자 알림 · 같은 주 다시 → 건너뜀
  assert.equal((await ctx.staffA.client.post('/api/marketing/adrefs/weekly', {})).status, 403);
  await ctl({ anthropicReset: true, anthropicQueue: [say({ common: ['질문형이 많음'], structure: ['지목', '제안', '행동'], scripts: [script(1)] })] });
  const w = await ctx.owner.ok('POST', '/api/marketing/adrefs/weekly', {});
  assert.ok(w.created); assert.equal(w.n, 9); assert.match(w.week, /^\d{4}-W\d{2}$/);
  const [rw] = await sql`select kind, source, week, cardinality(ref_ids) n from mkt_ad_ref_reports where id = ${w.created}`;
  assert.deepEqual([rw.kind, rw.source, rw.n], ['weekly', 'ai', 9]);
  assert.equal((await sql`select count(*)::int n from notifications where type = 'weekly_report' and entity_type = 'mkt_ad_ref_report' and user_id = ${ctx.ownerId}`)[0].n, 1, '승인자(대표)에게 알림');
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/adrefs/weekly', {})).skipped, 'done');
  await sql`delete from mkt_ad_ref_reports where kind = 'weekly'`; await sql`update mkt_ad_refs set created_at = now() - interval '8 days' where tenant <> 't_ad' and id <> ${P.a}`;
  assert.deepEqual(await ctx.owner.ok('POST', '/api/marketing/adrefs/weekly', {}).then((x) => [x.skipped, x.n]), ['few', 1], '지난 7일 1개 → 건너뜀');
  const view = await ctx.owner.ok('GET', '/api/marketing/adrefs');
  assert.deepEqual(view.reports.map((r) => [r.kind, r.source, r.advertisers.length]), [['manual', 'template', 2], ['manual', 'ai', 3]]);
  assert.equal(view.items[0].id, P.a, '★ 먼저');
  // 빼기: 넣은 사람
  assert.equal((await ctx.staffA.client.ok('PATCH', `/api/marketing/adrefs/${P.link}`, { action: 'remove' })).ok, true);
  assert.equal((await sql`select count(*)::int n from mkt_ad_refs where id = ${P.link}`)[0].n, 0);
});
