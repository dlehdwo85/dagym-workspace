// #426 P1 글 품질 엔진: 일부러 나쁜 글 세트가 걸러지는지(훅 탈락·상투어·보이지 않는 문자·채널 한도·광고 글자 수) · 규칙 숫자(플랫폼 설정표) 경계값 ·
// 자동 제작 연결(말투 프로필 → 지시문, 약한 훅 → 통과 후보/AI 한 번 더, 해시태그 상한, 금지 표현, 보고서 v) · [AI로 다듬기] · [잘 된 글로 말투 만들기] · 제작의뢰실 장면표
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const check = (c, b) => c.ok('POST', '/api/marketing/quality/check', b);
const AI_TEXT = '다양한 혜택을 놓치지 마세요! 지금 바로 특별한 경험을 시작해 보세요!! 혁신적인 서비스로 여러분의 일상을 한 단계 업그레이드하세요! ✨✨✨';
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('나쁜 글 세트: 인사·스크롤 멈춤·내용 없는 서두·상투어 훅은 탈락 · 상투어 범벅은 다듬기 필요 · 보이지 않는 문자·특수 대시 정리 · 좋은 글은 통과', async () => {
  const c = ctx.staffA.client;
  for (const h of ['안녕하세요! 다짐 피트니스입니다.', '스크롤 멈추세요! 이건 꼭 봐야 해요', '오늘은 저희 센터를 소개해 드릴게요', '다양한 혜택을 놓치지 마세요', '가을맞이 이벤트 진행 중']) {
    const r = await check(c, { channel: 'instagram', kind: 'feed', body: `${h}\n상담은 댓글로 남겨 주세요.` });
    assert.equal(r.hook.pass, false, `탈락해야 함: ${h} (${r.hook.score}점)`);
  }
  const hi = await check(c, { channel: 'instagram', kind: 'feed', body: '안녕하세요! 다짐입니다.' });
  assert.ok(hi.hook.fails.includes('인사로 시작') && hi.hook.score <= 20, JSON.stringify(hi.hook));
  const GOOD = 'PT 3개월, 체중보다 먼저 바뀌는 것\n회원님들이 가장 먼저 말하는 변화는 아침 컨디션입니다.\n출근 전 20분 스트레칭 루틴을 이번 주 스토리에 올려 둘게요.\n궁금한 점은 댓글로 남겨 주세요.';
  const good = await check(c, { channel: 'instagram', kind: 'feed', body: GOOD, brandId: P.brand });
  assert.equal(good.hook.pass, true, JSON.stringify(good.hook)); assert.equal(good.hook.score, 80);
  assert.deepEqual([good.human.score, good.needsPolish, good.channel.filter((x) => x.level === 'error').length], [100, false, 0]);
  assert.ok([...good.preview].length <= 125, "'더 보기' 전 125자 미리보기");
  const bad = await check(c, { channel: 'instagram', kind: 'feed', body: AI_TEXT });
  assert.ok(bad.human.score < 70 && bad.needsPolish, `사람다움 ${bad.human.score}점`);
  assert.ok(bad.human.issues.some((x) => x.includes("'놓치지 마세요'") && x.includes("'혁신적인'")) && bad.human.issues.some((x) => x.includes('이모지 나열')) && bad.human.issues.some((x) => x.includes('느낌표')), JSON.stringify(bad.human.issues));
  // 보이지 않는 문자·특수 대시: 정리본에서 빠짐(숫자 범위는 ~), 점수는 깎지 않음
  const inv = await check(c, { channel: 'threads', body: '가격은​ 3만 원 — 이번 주만 가능합니다. 운영 10–12시' });
  assert.equal(inv.cleaned, '가격은 3만 원, 이번 주만 가능합니다. 운영 10~12시');
  assert.ok(inv.human.issues.includes('보이지 않는 문자 2개 지움') && inv.human.issues.includes('특수 대시 2개 바꿈') && inv.human.score === 100, JSON.stringify(inv.human));
  // 채널 한도(막음)·권장
  assert.ok((await check(c, { channel: 'instagram', kind: 'feed', body: '가을 PT 3개월 차 변화\n#a #b #c #d #e #f #g' })).channel.some((x) => x.level === 'error' && x.msg === '해시태그 7개 — 최대 5개'));
  assert.ok((await check(c, { channel: 'threads', body: '가'.repeat(501) })).channel.some((x) => x.level === 'error' && x.msg === '스레드는 500자 이내(지금 501자)'));
  assert.equal((await check(c, { channel: 'threads', body: '가'.repeat(500) })).channel.filter((x) => x.level === 'error').length, 0, '500자는 통과(경계)');
  assert.ok((await check(c, { channel: 'instagram', kind: 'feed', body: '가'.repeat(501), cross: ['threads'] })).channel.some((x) => x.level === 'error' && x.msg.startsWith('스레드: ')), "'스레드에도' 글도 500자");
  assert.ok((await check(c, { channel: 'youtube', kind: 'shorts', title: '가'.repeat(101), body: '설명' })).channel.some((x) => x.level === 'error' && x.msg.includes('101자')));
  const blog = await check(c, { channel: 'blog', kind: 'blog', title: '가을맞이 회원 이벤트 안내, 천안 두정동 헬스장', body: '■ 하나\n본문', keyword: '두정동 헬스장' });
  assert.ok(blog.channel.some((x) => x.msg.includes("키워드 '두정동 헬스장'")) && blog.channel.some((x) => x.msg.startsWith('소제목 1개')), JSON.stringify(blog.channel));
  // 광고 문구: 구글 한글 2배폭 30, 네이버 제목 15
  assert.ok((await check(c, { channel: 'other', ad: { platform: 'google', headline: '가을 PT 상담 이벤트 진행중입니다', description: '설명' } })).ad.issues.some((x) => x.msg.startsWith('구글 제목 폭 32')));
  assert.deepEqual((await check(c, { channel: 'other', ad: { platform: 'google', headline: '가을 PT 상담 이벤트 진행', description: '설명' } })).ad.issues, [], '폭 24');
  assert.ok((await check(c, { channel: 'other', ad: { platform: 'naver', headline: '가을 PT 상담 이벤트 진행중', description: '설명' } })).ad.issues.some((x) => x.msg === '제목은 15자 이내(지금 16자)'));
  // 릴스 대본 → 초 단위 구성표(분당 300음절): 첫 장면 3초·한 장면 4초 넘으면 표시
  const reel = await check(c, { channel: 'instagram', kind: 'reels', body: '[컷1] 헬스 초보라면 이 3가지만 기억하세요 그러면 첫 달이 훨씬 편해집니다\n[컷2] 무게보다 자세\n[컷3] 셋째, 잠을 7시간 이상 자는 것이 생각보다 훨씬 중요하다는 걸 기억하세요\n캡션: 저장해 두세요' });
  assert.deepEqual(reel.timing.rows.map((r) => !!r.over), [true, false, true], JSON.stringify(reel.timing));
  assert.ok(reel.timing.warnings.some((w) => w.startsWith('훅(첫 장면)')) && reel.timing.warnings.some((w) => w.startsWith('3번째 장면')));
  assert.equal(reel.hook.text, '헬스 초보라면 이 3가지만 기억하세요 그러면 첫 달이 훨씬 편해집니다', '릴스 훅 = 첫 장면');
  assert.equal((await ctx.staffB.client.req('POST', '/api/marketing/quality/check', { channel: 'instagram', body: 'x' })).status, 404, '공간 밖');
  assert.equal((await c.req('POST', '/api/marketing/quality/check', { channel: 'instagram', body: 'x', brandId: '00000000-0000-4000-8000-000000000000' })).status, 404, '없는·다른 회사 브랜드');
});

test('규칙 숫자(플랫폼 운영 › 글 품질 규칙): 운영자만 · 범위 검사 · 저장하면 검사에 바로 — 훅 통과 점수·해시태그 상한 경계값 · 칸 단위 저장', async () => {
  assert.equal((await ctx.staffA.client.get('/api/platform/quality-rules')).status, 404);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/platform/quality-rules', { hook: { min: 10 } })).status, 404);
  const v = await ctx.owner.ok('GET', '/api/platform/quality-rules');
  assert.deepEqual([v.rules.instagram.hashtags, v.rules.hook.min, v.rules.ads.naverHeadline, v.updatedAt], [5, 40, 15, null]);
  assert.ok(v.fields.length >= 20 && v.fields.every((f) => f.length === 6));
  assert.equal((await ctx.owner.req('PUT', '/api/platform/quality-rules', { hook: { min: 101 } })).status, 400);
  assert.equal((await ctx.owner.req('PUT', '/api/platform/quality-rules', { threads: { max: 501 } })).status, 400, '스레드 API 한도 500 위로는 못 올림');
  // '출근 전 10분이면 충분합니다' = 40점(앞부분 20 + 구체성 20) — 기준 40 통과, 45 탈락
  const H = { channel: 'threads', body: '출근 전 10분이면 충분합니다' };
  const h0 = await check(ctx.staffA.client, H);
  assert.deepEqual([h0.hook.score, h0.hook.pass, h0.thresholds.hook], [40, true, 40]);
  await ctx.owner.ok('PUT', '/api/platform/quality-rules', { hook: { min: 45 }, instagram: { hashtags: 3 } });
  assert.equal((await check(ctx.staffA.client, H)).hook.pass, false, '기준을 올리면 탈락');
  const T4 = { channel: 'instagram', kind: 'feed', body: '가을 PT 3개월 차 변화\n#a #b #c #d' };
  assert.ok((await check(ctx.staffA.client, T4)).channel.some((x) => x.msg === '해시태그 4개 — 최대 3개'));
  await ctx.owner.ok('PUT', '/api/platform/quality-rules', { hook: { maxSec: 4 } });
  assert.deepEqual((await sql`select value from app_settings where key = 'mkt_quality_rules'`)[0].value, { hook: { min: 45, maxSec: 4 }, instagram: { hashtags: 3 } }, '기본값과 다른 칸만, 같은 구역의 다른 칸은 그대로');
  const back = await ctx.owner.ok('PUT', '/api/platform/quality-rules', { hook: { min: 40, maxSec: 3 }, instagram: { hashtags: 5 } });
  assert.deepEqual((await sql`select value from app_settings where key = 'mkt_quality_rules'`)[0].value, {}, '기본값으로 되돌리면 비움');
  assert.ok(back.updatedAt);
  assert.equal((await check(ctx.staffA.client, T4)).channel.filter((x) => x.level === 'error').length, 0);
  assert.ok((await sql`select count(*)::int n from audit_logs where action = 'platform.quality_rules'`)[0].n >= 3, '감사 기록');
});

test('자동 제작 연결: 말투 프로필이 지시문에 · 약한 첫 줄은 통과 후보로(모두 탈락이면 AI 로 한 번 더) · 해시태그 5개로 · 보고서(v) 저장 · 절대 안 쓰는 표현은 수정 요청', async () => {
  const voice = { topics: '퇴근 후 운동', audience: '천안 직장인', phrases: ['같이 해요'], avoid: ['역대급'], formality: 'polite', emoji: 'few', offer: 'PT 10회', examples: ['퇴근길 20분, 같이 해요.'] };
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { tone: '친근하게', intro: '천안 두정동 헬스장', voice });
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { voice: { formality: 'rude' } })).status, 400, '말투 값 검사');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/auto/brands/${P.brand}`, { voice })).status, 403, '브랜드 키트는 관리자');
  assert.deepEqual((await ctx.owner.ok('GET', '/api/marketing/auto')).brands.find((b) => b.id === P.brand).voice, { ...voice, emojis: [] }); // 160차: 허용 이모지 칸(기본 빈 목록)
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '가을 PT' });
  const slots = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 2`;
  const tags = '#다짐 #헬스 #PT #천안 #두정동 #운동 #가을';
  // #499-1: '가을맞이 이벤트 진행 중'은 판매 문구로 시작 — 콘텐츠형(기본) '처음부터 판다' 15점 감점(25 → 10점)
  await ctl({ anthropicReset: true, anthropicQueue: [
    say({ title: '가을 PT', body: `가을맞이 이벤트 진행 중\n퇴근 후 20분, 같이 해요. 첫 상담은 댓글로 남겨 주세요.\n${tags}`, brief: '실사', why: '가을 목표', hooks: ['가을맞이 이벤트 진행 중', '안녕하세요 다짐입니다', '다양한 혜택을 놓치지 마세요'], keyword: '두정동 헬스장' }),
    say({ hooks: ['퇴근 후 20분이면 충분한 이유', '천안 직장인이라면 이 3가지만', '안녕하세요'] }),
  ] });
  const n0 = fake.state.anthropic.length;
  const re = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${slots[0].id}`, { action: 'regen' });
  assert.equal(fake.state.anthropic.length - n0, 2, '원고 1번 + 훅 다시 쓰기 1번(후보가 모두 탈락일 때만)');
  const sys = JSON.stringify(fake.state.anthropic[n0].body.system);
  assert.ok(sys.includes('[말투 프로필]') && sys.includes('천안 직장인') && sys.includes('역대급') && sys.includes('hooks:') && sys.includes('흔히 믿는 것을 짧게 말하고 바로 뒤집기') && sys.includes("'아직도 ~ 계신가요?'"), '말투 프로필·금지 표현·훅 공식(구조만 — 예문 틀은 금지 목록으로)이 지시문에');
  assert.match(JSON.stringify(fake.state.anthropic[n0 + 1].body.messages), /약한 이유/);
  const [c1] = await sql`select status, quality from mkt_contents where id = ${slots[0].id}`;
  const [v1] = await sql`select body from mkt_versions where content_id = ${slots[0].id} and version = 1`;
  assert.ok(v1.body.startsWith('퇴근 후 20분이면 충분한 이유\n'), v1.body);
  assert.equal((v1.body.match(/#\S+/g) ?? []).length, 5, '해시태그 7개 → 5개');
  const rep = c1.quality.report;
  assert.deepEqual([rep.v, rep.hooks.length, rep.hook.pass, rep.keyword, re.passed, c1.status], [1, 3, true, '두정동 헬스장', true, 'pending']);
  assert.ok(rep.notes.some((x) => x.includes('해시태그 2개 뺌')) && rep.notes.some((x) => x.startsWith('약한 훅(10점)을 바꿈')), JSON.stringify(rep.notes));
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${slots[0].id}`);
  assert.deepEqual([d.qualityReport.v, d.qualityReport.hooks.length], [1, 3], '상세 = 제작 때 보고서(훅 후보 포함)');
  const card = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.find((x) => x.id === slots[0].id);
  assert.equal(card.quality.report.v, 1, '승인함 카드에도 보고서(다듬기 필요 배지용)');
  // 후보에 통과 훅이 있으면 AI 를 더 부르지 않음 · 말투 프로필의 '절대 안 쓰는 표현'은 금지어처럼 → 수정 요청
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 PT 2', body: '역대급 가을 이벤트 시작\n이번 가을은 역대급으로 준비했어요. 상담은 댓글로 남겨 주세요.', brief: '실사', hooks: ['안녕하세요', '천안 직장인이라면 이 3가지만', '가을'] })] });
  const n1 = fake.state.anthropic.length;
  const re2 = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${slots[1].id}`, { action: 'regen' });
  assert.equal(fake.state.anthropic.length - n1, 1, '통과 후보가 있으면 다시 쓰지 않음');
  const [v2] = await sql`select body from mkt_versions where content_id = ${slots[1].id} and version = 1`;
  assert.ok(v2.body.startsWith('천안 직장인이라면 이 3가지만\n'), '첫 통과 후보(AI 순서)로');
  assert.deepEqual([re2.passed, re2.issues.some((x) => x === "금지어 '역대급'")], [false, true], JSON.stringify(re2));
  // 훅 없는 옛 형식 원고(가짜 AI)는 그대로 — 추가 AI 호출 없음
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 PT 3', body: '가을맞이 이벤트 진행 중', brief: '' })] });
  const n2 = fake.state.anthropic.length;
  await ctx.owner.ok('POST', `/api/marketing/auto/contents/${slots[0].id}`, { action: 'regen' });
  assert.equal(fake.state.anthropic.length - n2, 1);
  const [c3] = await sql`select quality, current_version from mkt_contents where id = ${slots[0].id}`;
  assert.deepEqual([c3.current_version, c3.quality.report.v, c3.quality.report.hook.pass, c3.quality.report.hooks.length], [2, 2, false, 0]);
});

test('[AI로 다듬기]: 사람이 올린 글도 바로 검사(저장 안 함) · 관리자만 · 같은 사진으로 새 버전(0크레딧) · 다듬을 이유가 지시로 · 승인된 글은 안 됨', async () => {
  const m = await ctx.staffA.client.ok('POST', '/api/marketing/contents', { title: '가을 안내', channel: 'instagram', brandId: P.brand, body: AI_TEXT, mediaIds: [] });
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${m.id}`);
  assert.deepEqual([d.qualityReport.needsPolish, d.qualityReport.v, d.content.brand_voice], [true, undefined, undefined], '바로 검사 · 말투 프로필 원본은 안 내보냄');
  assert.equal((await sql`select quality from mkt_contents where id = ${m.id}`)[0].quality, null, '사람이 올린 글은 저장하지 않음');
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/auto/contents/${m.id}`, { action: 'polish' })).status, 403);
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 안내', body: '퇴근 후 20분이면 충분한 이유\n천안 두정동에서 같이 해요.\n상담은 댓글로 남겨 주세요.', brief: '', hooks: [] })] });
  const n0 = fake.state.anthropic.length;
  const p = await ctx.owner.ok('POST', `/api/marketing/auto/contents/${m.id}`, { action: 'polish' });
  assert.equal(p.version, 2); assert.equal(fake.state.anthropic.length - n0, 1);
  const msg = JSON.stringify(fake.state.anthropic[n0].body.messages);
  assert.ok(msg.includes('AI 티 줄이기') && msg.includes('놓치지 마세요') && msg.includes(AI_TEXT.slice(0, 20)), '다듬을 이유 + 지난 원고');
  const d2 = await ctx.owner.ok('GET', `/api/marketing/contents/${m.id}`);
  assert.deepEqual([d2.content.current_version, d2.content.status, d2.versions[0].note.startsWith('AI로 다듬기(0크레딧)'), d2.qualityReport.v, d2.qualityReport.needsPolish], [2, 'pending', true, 2, false]);
  assert.match(d2.versions[0].body, /^퇴근 후 20분이면 충분한 이유\n/);
  assert.equal((await sql`select credits::float8 c from mkt_credit_ledger where content_id = ${m.id} and note = 'AI로 다듬기 — 글자'`)[0].c, 0, '원장 0크레딧');
  await sql`update mkt_contents set status = 'approved', approved_version = 2 where id = ${m.id}`;
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/contents/${m.id}`, { action: 'polish' })).status, 400, '승인된 글은 다듬지 않음');
});

test('[잘 된 글로 말투 만들기]: 승인·게시 글이 없으면 400 · 관리자만 · AI 초안(저장 안 함) → [저장]', async () => {
  const b = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id;
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/brands/${b}/voice-draft`, {})).status, 400);
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '현장 소식', channel: 'instagram', brandId: b, body: '오늘 두정동 현장은 조용했습니다. 다음 주 공사 일정 공유드려요.', mediaIds: [] });
  await sql`update mkt_contents set status = 'published', published_at = now() where id = ${m.id}`;
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/auto/brands/${b}/voice-draft`, {})).status, 403);
  await ctl({ anthropicReset: true, anthropicQueue: [say({ topics: '현장 소식', audience: '입주민', offer: '시설 관리', phrases: ['공유드려요'], avoid: ['역대급'], formality: 'polite', emoji: 'none', examples: [1] })] });
  const dr = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${b}/voice-draft`, {});
  assert.deepEqual([dr.draft.audience, dr.draft.formality, dr.draft.emoji, dr.draft.examples[0].startsWith('오늘 두정동'), dr.sources.length], ['입주민', 'polite', 'none', true, 1]);
  assert.ok(JSON.stringify(fake.state.anthropic.at(-1).body.messages).includes('공사 일정 공유드려요'), '게시 글이 재료로');
  assert.deepEqual((await sql`select voice from mkt_brands where id = ${b}`)[0].voice, {}, '초안은 저장하지 않음');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b}`, { voice: dr.draft });
  assert.equal((await sql`select voice->>'audience' a from mkt_brands where id = ${b}`)[0].a, '입주민');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/auto/brands/00000000-0000-4000-8000-000000000000/voice-draft', {})).status, 404);
});

test('제작의뢰실: 영상은 장면별 자막 → 초 단위 장면표(넘친 장면 표시) · AI 자막 정리·점수 · 제작 요청 카드에 장면표와 Shot list', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ promptEn: 'A vertical 15-second video of a Korean apartment gym at dusk', negativeEn: 'watermark', summaryKo: '퇴근길 운동', caption: '퇴근 후 20분 — 다양한 혜택을 놓치지 마세요', refMediaIds: [], scenes: [
    { line: '퇴근 후 20분이면 충분한 이유', visualEn: 'Close-up of running shoes being tied' },
    { line: '첫째, 무게보다 자세를 먼저 봅니다', visualEn: 'Trainer adjusting posture, hands only' },
    { line: '둘째, 주 3회만 꾸준히 해도 몸이 달라지는 걸 느끼게 되는데 그 이유를 지금부터 하나씩 설명해 드릴게요', visualEn: 'Calendar with three marks' },
    { line: '퇴근 후 20분, 오늘부터', visualEn: 'Shoes again, walking out' }] })] });
  const r = await ctx.staffA.client.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'reels', purpose: 'inquiry', message: '퇴근 후 20분 PT', refs: { mediaIds: [], contentIds: [], links: [] }, quantity: 1 });
  const sent = JSON.stringify(fake.state.anthropic.at(-1).body);
  assert.ok(sent.includes('scenes') && sent.includes('[말투 프로필]') && sent.includes('역대급'), '영상은 장면 배열 · 말투 프로필·절대 안 쓰는 표현');
  assert.equal(r.prompt.caption, '퇴근 후 20분, 다양한 혜택을 놓치지 마세요', 'AI 자막의 특수 대시 정리');
  assert.ok(r.prompt.quality.human.issues.some((x) => x.includes("'놓치지 마세요'")) && r.prompt.quality.hook.text === '퇴근 후 20분이면 충분한 이유');
  assert.deepEqual(r.prompt.timing.rows.map((x) => !!x.over), [false, false, true, false], JSON.stringify(r.prompt.timing));
  assert.ok(r.prompt.timing.warnings.some((w) => w.startsWith('3번째 장면')));
  // 사람이 고친 자막은 그대로(점수만 다시)
  await ctx.staffA.client.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'update', promptEn: r.prompt.promptEn, caption: '퇴근 후 20분 — 같이 해요' });
  const b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r.id);
  assert.deepEqual([b.prompt.caption, b.prompt.quality.human.issues.includes('특수 대시 1개 바꿈'), b.prompt.timing.rows.length], ['퇴근 후 20분 — 같이 해요', true, 4]);
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  const card = (await ctx.owner.ok('GET', '/api/marketing/auto')).requests.find((q) => q.brief_id === r.id);
  assert.match(card.brief, /Shot list \(keep this timing\):\n1\. 0\.0-2\.7s Close-up of running shoes being tied/);
  assert.match(card.brief, /장면 구성\(초 단위·분당 낭독 속도 기준, 전체 [\d.]+초\):\n1\) 0\.0~2\.7초 «퇴근 후 20분이면 충분한 이유»/);
});
