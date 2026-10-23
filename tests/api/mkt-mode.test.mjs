// #499-1(테크트리 EP.12·S1) 콘텐츠형(참여)/광고형(전환) 분리 채점: 같은 훅도 용도마다 다르게(광고형 = 대상 호명·제안, 콘텐츠형 = '처음부터 판다' 감점) ·
// 광고형 대본은 끝에 행동 1개·20초 안 · 광고 제목은 늘 광고형 · 자동 제작 규칙/제작의뢰/새 콘텐츠의 용도 → AI 지시문·보고서 · 용도를 바꾸면 같은 훅 후보로 다시 채점 · 메타 광고 세팅안 알림
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const check = (b) => ctx.owner.ok('POST', '/api/marketing/quality/check', b);
const INFO = '헬스장 고를 때 아무도 안 알려주는 3가지'; // 정보형(콘텐츠형에 맞는) 훅
const OFFER = 'PT 처음이신 분, 무료 체성분 진단 받아 가세요'; // 대상 + 제안(광고형)
const SALE = '30% 할인! 가을 PT 등록 이벤트'; // 처음부터 판다
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '천안 두정동 헬스장', products: 'PT·체성분 진단' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('같은 훅, 다른 기준: 정보형 훅은 콘텐츠형 통과·광고형 탈락(제안·대상 없음) · 대상+제안 훅은 광고형 높음 · 판매 문구로 시작하면 콘텐츠형 감점 · 광고 제목은 늘 광고형', async () => {
  const body = (h) => `${h}\n상담은 댓글로 남겨 주세요.`;
  const c1 = await check({ channel: 'instagram', kind: 'feed', body: body(INFO) });
  const a1 = await check({ channel: 'instagram', kind: 'feed', body: body(INFO), mode: 'ad' });
  assert.deepEqual([c1.mode, c1.hook.pass, a1.mode, a1.hook.pass], ['content', true, 'ad', false], JSON.stringify([c1.hook, a1.hook]));
  assert.ok(a1.hook.notes.some((n) => n.startsWith('제안이 없음')) && a1.hook.notes.some((n) => n.startsWith('대상 호명이 없음')), JSON.stringify(a1.hook.notes));
  assert.deepEqual([a1.hook.parts.offer, a1.hook.parts.callout], [0, 0]);
  const a2 = await check({ channel: 'instagram', kind: 'feed', body: body(OFFER), mode: 'ad' });
  assert.ok(a2.hook.pass && a2.hook.score > a1.hook.score && a2.hook.parts.offer === 25 && a2.hook.parts.callout === 25 && !a2.hook.notes.length, JSON.stringify(a2.hook));
  const c3 = await check({ channel: 'instagram', kind: 'feed', body: body(SALE) });
  const a3 = await check({ channel: 'instagram', kind: 'feed', body: body(SALE), mode: 'ad' });
  assert.ok(!c3.hook.pass && c3.hook.notes.some((n) => n.startsWith('처음부터 판다')), JSON.stringify(c3.hook));
  assert.ok(a3.hook.pass && !a3.hook.notes.some((n) => n.startsWith('처음부터 판다')), '광고형은 판매 문구로 시작해도 감점 없음');
  // 광고 제목(구글·네이버·메타 문구 검사)은 용도와 상관없이 광고형 기준 — 정보형 제목은 '제안 없음'
  const ad = await check({ channel: 'other', ad: { platform: 'google', headline: INFO, description: '설명' } });
  assert.deepEqual([ad.ad.hook.mode, ad.ad.hook.pass, ad.ad.hook.notes.some((n) => n.startsWith('제안이 없음'))], ['ad', false, true]);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/quality/check', { channel: 'instagram', body: 'x', mode: 'banner' })).status, 400);
});

test('광고형 대본: 끝 장면에 행동 1개(없으면 경고) · 20초 넘으면 경고 · 콘텐츠형은 반복 고리 경고 그대로', async () => {
  const noAct = await check({ channel: 'instagram', kind: 'reels', mode: 'ad', script: ['PT 처음이신 분, 무료 진단', '체성분부터 자세까지 20분', '두정동 다짐에서 기다릴게요'], body: '캡션' });
  assert.ok(noAct.timing.warnings.some((w) => w.startsWith('광고형 마지막 장면에 행동 1개')), JSON.stringify(noAct.timing.warnings));
  assert.ok(!noAct.timing.warnings.some((w) => w.includes('반복 시청 고리')), '광고형은 반복 고리 대신 행동');
  const act = await check({ channel: 'instagram', kind: 'reels', mode: 'ad', script: ['PT 처음이신 분, 무료 진단', '체성분부터 자세까지 20분', '프로필 링크에서 신청하세요'], body: '캡션' });
  assert.ok(!act.timing.warnings.some((w) => w.startsWith('광고형 마지막 장면')), JSON.stringify(act.timing.warnings));
  const long = Array.from({ length: 7 }, (_, k) => `${k + 1}번째, 회원님들이 처음에 가장 많이 묻는 것`);
  const adLong = await check({ channel: 'instagram', kind: 'reels', mode: 'ad', script: long, body: '캡션' });
  const ctLong = await check({ channel: 'instagram', kind: 'reels', script: long, body: '캡션' });
  assert.ok(adLong.timing.total > 20 && adLong.timing.warnings.some((w) => /광고형은 15초 안팎\(20초 넘음\)/.test(w)), JSON.stringify(adLong.timing));
  assert.ok(!ctLong.timing.warnings.some((w) => w.startsWith('전체 ') || w.startsWith('광고형')), '콘텐츠형은 60초까지 · 광고형 경고 없음');
  const ctLoop = await check({ channel: 'instagram', kind: 'reels', script: ['PT 처음이신 분, 무료 진단', '체성분부터 자세까지 20분', '프로필 링크에서 신청하세요'], body: '캡션' });
  assert.ok(ctLoop.timing.warnings.some((w) => w.includes('반복 시청 고리')) && !ctLoop.timing.warnings.some((w) => w.startsWith('광고형')), '콘텐츠형은 반복 고리 경고 그대로');
});

test('자동 제작 규칙 용도: 광고형 규칙 → 칸도 광고형 · AI 지시문에 광고형 안내 · 보고서 광고형 기준 · 규칙 용도를 바꾸면 아직 안 만든 칸도 · 형식 검사', async () => {
  assert.equal((await ctx.owner.req('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'feed', weekdays: [1], postTime: '10:00', mode: 'banner' })).status, 400);
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '체성분 진단', mode: 'ad' });
  const slots = await sql`select id, mode from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 3`;
  assert.ok(slots.length >= 2 && slots.every((s) => s.mode === 'ad'), JSON.stringify(slots));
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).rules.find((x) => x.id === r.id).mode, 'ad');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '체성분 진단', body: `${OFFER}\n10분이면 끝나요. 프로필 링크에서 신청하세요.`, brief: '실사', why: '문의 목표', hooks: [OFFER, '두정동 직장인이라면 무료 진단부터', INFO], keyword: '두정동 헬스장' })] });
  const n0 = fake.state.anthropic.length;
  await ctx.owner.ok('POST', `/api/marketing/auto/contents/${slots[0].id}`, { action: 'regen' });
  const sys = JSON.stringify(fake.state.anthropic[n0].body.system);
  assert.ok(sys.includes('광고형(전환)') && sys.includes('2초 안에') && !sys.includes('콘텐츠형(참여): 첫 줄은'), '광고형 규칙 → 광고형 안내');
  const [c] = await sql`select quality from mkt_contents where id = ${slots[0].id}`;
  assert.deepEqual([c.quality.report.mode, c.quality.report.hook.text, c.quality.report.hook.pass], ['ad', OFFER, true], JSON.stringify(c.quality.report.hook));
  assert.equal(c.quality.report.hooks.find((h) => h.text === INFO).pass, false, '정보형 후보는 광고형 기준 탈락');
  // 규칙을 콘텐츠형으로 → 아직 안 만든 칸만 콘텐츠형(만든 칸은 그대로)
  await ctx.owner.ok('PATCH', `/api/marketing/auto/rules/${r.id}`, { mode: 'content' });
  const after2 = await sql`select id, mode, produced_at from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 3`;
  assert.deepEqual(after2.map((x) => [x.id === slots[0].id ? 'made' : 'todo', x.mode]), [['made', 'ad'], ['todo', 'content'], ['todo', 'content']]);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/auto/rules/${r.id}`, { mode: 'ad' })).status, 403, '규칙은 관리자');
  P.adContent = slots[0].id;
});

test('콘텐츠 용도 바꾸기: 상세 보고서가 같은 훅 후보로 그 기준에 맞춰 다시 채점(자동 수정 기록은 그대로) · 목록에 용도 · 관리자만 · 게시한 글은 못 바꿈', async () => {
  const d0 = await ctx.owner.ok('GET', `/api/marketing/contents/${P.adContent}`);
  assert.deepEqual([d0.content.mode, d0.qualityReport.mode, d0.qualityReport.v], ['ad', 'ad', 1]);
  const p = await ctx.owner.ok('PATCH', `/api/marketing/contents/${P.adContent}`, { mode: 'content' });
  assert.equal(p.mode, 'content');
  const d1 = await ctx.owner.ok('GET', `/api/marketing/contents/${P.adContent}`);
  assert.deepEqual([d1.qualityReport.mode, d1.qualityReport.v, d1.qualityReport.hooks.length], ['content', 1, 3], '같은 훅 후보 3개를 콘텐츠형으로');
  assert.equal(d1.qualityReport.hooks.find((h) => h.text === INFO).pass, true, '정보형 후보는 콘텐츠형 기준 통과');
  assert.deepEqual(d1.qualityReport.notes, d0.qualityReport.notes, '자동 수정 기록 유지');
  const row = (await ctx.owner.ok('GET', '/api/marketing/contents')).contents.find((x) => x.id === P.adContent);
  assert.equal(row.mode, 'content');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/contents/${P.adContent}`, { mode: 'ad' })).status, 403);
  await sql`update mkt_contents set status = 'published', published_at = now() where id = ${P.adContent}`;
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/contents/${P.adContent}`, { mode: 'ad' })).status, 404, '게시한 글');
});

test('새 콘텐츠·제작의뢰실 용도: 사람이 올린 광고형 글은 바로 광고형 채점 · 의뢰 용도 → AI 지시문·자막 점수·만든 콘텐츠까지', async () => {
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '진단 광고', channel: 'instagram', brandId: P.brand, body: `${INFO}\n댓글로 남겨 주세요.`, mediaIds: [], mode: 'ad' });
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${m.id}`);
  assert.deepEqual([d.content.mode, d.qualityReport.mode, d.qualityReport.hook.pass, d.qualityReport.v], ['ad', 'ad', false, undefined], '바로 검사(저장 안 함) · 광고형 기준 탈락');
  const plain = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '정보 글', channel: 'instagram', brandId: P.brand, body: `${INFO}\n댓글로 남겨 주세요.`, mediaIds: [] });
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/contents/${plain.id}`)).content.mode, 'content', '기본은 콘텐츠형');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ promptEn: 'A photorealistic photo of a Korean gym body-composition scan', negativeEn: 'watermark', summaryKo: '무료 진단', caption: `${OFFER}\n프로필 링크에서 신청하세요.`, refMediaIds: [] })] });
  const r = await ctx.staffA.client.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'feed', purpose: 'inquiry', mode: 'ad', message: '무료 체성분 진단', refs: { mediaIds: [], contentIds: [], links: [] }, quantity: 1 });
  const sent = JSON.stringify(fake.state.anthropic.at(-1).body);
  assert.ok(sent.includes('용도: 광고형(전환)') && sent.includes('광고형(전환): 첫 줄 2초 안에'), '의뢰 용도가 AI 마케터 지시문에');
  assert.deepEqual([r.prompt.quality.mode, r.prompt.quality.hook.text, r.prompt.quality.hook.pass], ['ad', OFFER, true], JSON.stringify(r.prompt.quality));
  const b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r.id);
  assert.equal(b.mode, 'ad');
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const [bc] = await sql`select c.mode from mkt_briefs b join mkt_contents c on c.id = b.content_id where b.id = ${r.id}`;
  assert.equal(bc.mode, 'ad', '의뢰로 만든 콘텐츠도 광고형');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'feed', purpose: 'inquiry', mode: 'x', message: '무료 진단', refs: { mediaIds: [], contentIds: [], links: [] } })).status, 400);
});
