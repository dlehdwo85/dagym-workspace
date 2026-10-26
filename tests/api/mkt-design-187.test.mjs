// 187차(로컬 10/26 대표 P1 ③④⑤) — ③(수정 요청 횟수 제한 없음·같은 요청 2번 연속 반영 안 되면 멈춤)은 mkt-auto 시험에
// ④ 디자인 지침(회사 전체·브랜드별, 4,000자 · 관리자만 · 다른 회사 브랜드 404 · 비우면 지움)·기억 1,000자 → 자동 제작 원고·제작의뢰실·카드뉴스 지시문에 그대로
//    + 노트 '반영: 디자인 지침 n개·디자인 기억 n개'(넣은 개수 그대로 — 다른 브랜드 지침·기억은 안 넣음)
// ⑤ 표지 머리말: 브랜드 키트 머리말을 채웠으면 고정(AI 머리말 비움) · 비웠으면 AI 가 글마다 — 게시 시각이 가까운 같은 브랜드 글 머리말과 겹치면 후보, 다 겹치면 비움
// 가짜 AI = 구조 시험(실제 글·그림 품질은 운영 화면에서)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const CARD = (kicker, alts = []) => ({ kicker, kickerAlts: alts, points: [], left: '', right: '', keyword: '', period: '', prices: [] });
const draftCalls = () => fake.state.anthropic.map((x) => JSON.stringify(x.body ?? {})).filter((s) => s.includes('시안 그림 칸'));
async function content(brand, title, days) {
  const [c] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, brand_id)
    values ('default', ${title}, 'instagram', 'feed', now() + make_interval(days => ${days}), 'draft', 0, ${ctx.ownerId}, true, ${brand}) returning id`;
  return c.id;
}
async function produce(id, reply) {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ brief: '', why: '', hooks: [], keyword: '', ...reply })] });
  await ctx.owner.ok('POST', `/api/marketing/auto/contents/${id}`, { action: 'regen' });
  return (await sql`select c.status, c.current_version, c.quality, v.note from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
}

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', leadDays: 7, remindHours: 72, quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '지침시험' })).id;
  P.other = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '머리말시험' })).id;
  for (const b of [P.brand, P.other]) await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b}`, { intro: '아파트 커뮤니티 운영 대행', products: '운영 대행 3개월 19만원' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('④ 디자인 지침(회사 전체·브랜드)·기억 1,000자 → 자동 제작·제작의뢰실·카드뉴스 지시문에 · 노트 반영 개수 · 비우면 지움', async () => {
  const G1 = '표지 첫 줄은 질문으로 시작\n브랜드 색은 포인트에만\n\n사람 얼굴은 손·뒷모습으로';
  const G2 = '지침시험 전용: 숫자는 크게\n지침시험 전용: 마지막 장은 상담 안내';
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/team', { action: 'guide', text: G1 })).status, 403, '지침은 관리자');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/team', { action: 'guide', text: 'ㄱ'.repeat(4001) })).status, 400, '4,000자까지');
  assert.equal((await ctx.owner.req('POST', '/api/marketing/team', { action: 'guide', text: G2, brandId: '00000000-0000-0000-0000-00000000dead' })).status, 404, '없는 브랜드·다른 회사 브랜드');
  assert.deepEqual(await ctx.owner.ok('POST', '/api/marketing/team', { action: 'guide', text: G1 }), { brandId: null, chars: G1.length, lines: 3 });
  assert.deepEqual(await ctx.owner.ok('POST', '/api/marketing/team', { action: 'guide', text: `${G2}\r\n`, brandId: P.brand }), { brandId: P.brand, chars: G2.length, lines: 2 }, '줄바꿈 정리');
  let v = await ctx.owner.ok('GET', '/api/marketing/team');
  assert.deepEqual([v.guides.common, v.guides[P.brand], v.guideMax], [G1, G2, 4000]);
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.team_guide'`).length >= 2, '감사 기록');
  // 기억 1,000자(예전 200자) — 넘으면 400
  const LONG = Array.from({ length: 60 }, (_, i) => `메모${i}`).join(' ').padEnd(600, '끝');
  assert.ok(LONG.length > 200 && LONG.length <= 1000);
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'remember', role: 'designer', text: LONG, brandId: P.brand });
  assert.equal((await ctx.owner.req('POST', '/api/marketing/team', { action: 'remember', role: 'designer', text: 'ㄴ'.repeat(1001) })).status, 400, '기억은 1,000자까지');
  assert.equal((await sql`select length(text)::int n from mkt_team_memory where role = 'designer' and kind = 'note'`)[0].n, LONG.length, '잘리지 않음');

  // 자동 제작 원고: 회사 전체 + 그 브랜드 지침·기억 → 지시문 · quality.design · 노트
  const c1 = await content(P.brand, '지침시험 글 1', 3);
  const r1 = await produce(c1, { title: '지침시험 글 1', body: '관리사무소 일, 이렇게 줄였습니다\n출입 기록이 자동으로 정리됩니다.', card: CARD('운영 기록') });
  const sent1 = draftCalls().at(-1) ?? '';
  for (const s of ['[디자인 지침 — 대표가 정한 기준', '(회사 전체)', '표지 첫 줄은 질문으로 시작', '(이 브랜드)', '지침시험 전용: 숫자는 크게', '[디자인 담당 기억', LONG.slice(0, 40)]) assert.ok(sent1.includes(s), `원고 지시문에 '${s}'`);
  assert.deepEqual(r1.quality.design, { memory: 1, guide: 5 }, '지침 5줄(회사 3 + 브랜드 2)·기억 1개');
  assert.match(r1.note, /^AI 자동 제작 · 반영: 디자인 지침 5개·디자인 기억 1개 · /, r1.note);
  // 다른 브랜드 글: 회사 전체 지침만(이 브랜드 지침·기억은 안 넣음)
  const c2 = await content(P.other, '다른 브랜드 글', 3);
  const r2 = await produce(c2, { title: '다른 브랜드 글', body: '경비실 교대가 가벼워졌습니다\n순찰 기록을 휴대폰으로 남깁니다.', card: CARD('공지') });
  const sent2 = draftCalls().at(-1) ?? '';
  assert.ok(sent2.includes('표지 첫 줄은 질문으로 시작') && !sent2.includes('지침시험 전용') && !sent2.includes(LONG.slice(0, 40)), '다른 브랜드 지침·기억은 빼고');
  assert.deepEqual(r2.quality.design, { memory: 0, guide: 3 });
  assert.match(r2.note, /^AI 자동 제작 · 반영: 디자인 지침 3개 · /, r2.note);
  // 수정본(수정 요청 → AI 수정)도 같은 지침 + 노트
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '지침시험 글 1', body: '관리사무소 일, 반으로\n출입 기록이 자동으로 정리됩니다.', brief: '', why: '', hooks: [], keyword: '', card: CARD('운영 기록') })] });
  const d = await ctx.owner.ok('POST', `/api/marketing/contents/${c1}/decide`, { version: r1.current_version, decision: 'changes', comment: '말투를 더 친근하게' });
  assert.equal(d.revision.n, 1);
  const [rv] = await sql`select note from mkt_versions where content_id = ${c1} and version = ${d.revision.version}`;
  assert.match(rv.note, /^수정본\(AI 수정 1번째\) — .* · 반영: 디자인 지침 5개·디자인 기억 2개$/, `수정 요청도 기억(수정 요청 1개 추가): ${rv.note}`);

  // 제작의뢰실 프롬프트
  await ctl({ anthropicReset: true, anthropicQueue: [say({ promptEn: 'A photorealistic photo of a Korean apartment community lounge', negativeEn: 'watermark', summaryKo: '라운지', caption: '라운지가 이렇게 바뀌었습니다\n상담은 프로필 링크에서.', refMediaIds: [],
    fields: { who: 'Korean residents', where: 'apartment lounge', action: 'reading', emotion: 'from tired to relaxed', lens: '35mm', angle: 'eye-level', movement: 'static', light: 'daylight', props: ['book', 'cup'] } })] });
  const st = await ctx.owner.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'feed', purpose: 'inquiry', message: '라운지 소개', refs: { mediaIds: [], contentIds: [], links: [] }, quantity: 1 });
  const sentS = JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
  assert.ok(sentS.includes('지침시험 전용: 숫자는 크게') && sentS.includes('표지 첫 줄은 질문으로 시작'), '제작의뢰실 지시문에 지침');
  assert.deepEqual(st.prompt.design, { memory: 2, guide: 5 }, '제작의뢰실 프롬프트에 반영 개수');

  // 카드뉴스 장별 문구
  await ctl({ anthropicReset: true, anthropicQueue: [say({ slides: [
    { kind: 'cover', title: '직영 vs 위탁,\n우리 단지엔?', body: '입주 전 가장 많이 받는 질문', rows: [], imagePlan: '라운지 사진' },
    { kind: 'body', title: '직영의 특징', body: '관리사무소가 직접 뽑아요.\n결정은 빨라요.', rows: [], imagePlan: '관리사무소 사진' },
    { kind: 'body', title: '위탁의 특징', body: '운영사가 맡아요.\n일이 줄어요.', rows: [], imagePlan: '' },
    { kind: 'cta', title: "댓글에 '비교표' 남기면 보내 드려요", body: '도움이 됐다면 저장·팔로우', rows: [], imagePlan: '' }], caption: "직영 vs 위탁\n\n댓글에 '비교표' 남기면 보내 드려요.", keyword: '비교표' })] });
  const cr = await ctx.owner.ok('POST', '/api/marketing/carousels', { brandId: P.brand, product: '커뮤니티 위탁 운영', topic: '직영 vs 위탁, 우리 단지엔?', pattern: 'vs', a: '직영', b: '위탁', keyword: '비교표', template: 'box' });
  assert.ok(JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {}).includes('지침시험 전용: 마지막 장은 상담 안내'), '카드뉴스 지시문에 지침');
  assert.deepEqual(cr.item.input.design, { memory: 2, guide: 5 });

  // 비우면 지움(회사 전체만 — 브랜드 지침은 그대로)
  assert.deepEqual(await ctx.owner.ok('POST', '/api/marketing/team', { action: 'guide', text: '   ' }), { brandId: null, chars: 0, lines: 0 });
  v = await ctx.owner.ok('GET', '/api/marketing/team');
  assert.deepEqual([v.guides.common, v.guides[P.brand]], [undefined, G2]);
});

test('⑤ 표지 머리말: 키트 값 있으면 고정 · 비우면 AI 가 글마다(가까운 글과 겹치면 후보, 다 겹치면 비움)', async () => {
  const a = await content(P.other, '머리말 시험 1', 5);
  assert.equal((await produce(a, { title: '머리말 시험 1', body: '주차 민원이 절반으로\n방문 차량 등록을 미리 받습니다.', card: CARD('운영 기록', ['이번 주 소식', '현장 노트']) })).quality.card.kicker, '운영 기록');
  const b = await content(P.other, '머리말 시험 2', 6);
  const rb = await produce(b, { title: '머리말 시험 2', body: '공지 읽음을 한눈에\n동별로 확인한 세대를 셉니다.', card: CARD('운영 기록', ['이번 주 소식', '현장 노트']) });
  assert.equal(rb.quality.card.kicker, '이번 주 소식', '가까운 글과 같은 머리말이면 다음 후보');
  const sb = draftCalls().at(-1) ?? '';
  assert.ok(sb.includes("'운영 기록'") && sb.includes('겹치지 않게') && sb.includes('kickerAlts'), '지시문에 가까운 글 머리말·후보 칸');
  const c = await content(P.other, '머리말 시험 3', 7);
  const rc = await produce(c, { title: '머리말 시험 3', body: '시설 예약을 휴대폰으로\n독서실 좌석을 주민이 직접 고릅니다.', card: CARD('운영  기록!', ['이번 주 소식', '운영 기록']) });
  assert.equal(rc.quality.card.kicker, '', '띄어쓰기·문장부호만 다른 것도 같은 머리말 — 다 겹치면 비움');
  // 키트 머리말을 채우면 고정 — AI 머리말은 비우고 지시문에 '고정'
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.other}`, { feed: { kicker: '시리즈' } });
  const d = await content(P.other, '머리말 시험 4', 8);
  const rd = await produce(d, { title: '머리말 시험 4', body: '야간 순찰 기록 정리\n사진과 시각이 함께 남습니다.', card: CARD('다른 머리말', ['후보']) });
  assert.equal(rd.quality.card.kicker, '', '키트 값 고정 — 그림은 키트 머리말');
  assert.ok((draftCalls().at(-1) ?? '').includes("브랜드 키트 머리말 '시리즈'로 고정"));
});
