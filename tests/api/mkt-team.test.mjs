// #499-7 AI 마케팅팀: 역할 7개 보기(기본 켜짐·공간 밖 404)·켜기/끄기(관리자, 예산 담당은 못 끔·감사 기록)·기획 담당 브랜드·기억(더하기·지우기·다른 회사 404)
// · 기획 담당 [오늘 주제 받기](브랜드마다 3안·형식·틀·근거·첫 문장 점수·지난 대기 주제 넘김·하루 한 번 표시·승인자 알림 · 재료/★ 경쟁 광고/기억이 지시문에)
// · 채택 → 디자인 담당(카드뉴스 초안 → 깨끗하면 그려서 승인 대기 / 채울 곳 있으면 초안 / 릴스 = 제작의뢰실 의뢰) · 반려(사유 = 기억) · 디자인 담당 끄면 만들지 않음 → [맡기기]
// · 기억이 카드뉴스·공통 구조·분석 카드 지시문에 · 운영 제안 결정 = 보고 담당 기억 · 정기 점검(점검마다 한 브랜드, 다 끝나면 알림 1번 — 운영은 서울 07~21시, 시험 서버는 시각 무관)·예산 담당 마지막 점검
// 가짜 AI = 구조 시험(실제 주제·카드뉴스 품질은 확인 못함)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const lastAi = () => JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const IDEAS = (v = '') => say({ ideas: [
  { title: `직영 vs 위탁, 우리 단지엔?${v}`, hook: '커뮤니티 운영, 직영과 위탁 중 무엇이 맞을까요?', format: 'carousel', pattern: 'vs', product: '커뮤니티 위탁 운영', angle: '입주 앞둔 단지 관리소장',
    basis: [{ kind: 'season', text: '연말 재계약 시즌' }, { kind: 'competitor', text: '질문형 첫 문장이 많음' }] },
  { title: `입주 3개월 전 체크리스트${v}`, hook: '입주가 3개월 남았는데 운영사가 아직 없나요?', format: 'reels', pattern: 'vs', product: '커뮤니티 위탁 운영', angle: '신축 입주 준비 담당', basis: [{ kind: 'goal', text: '신축 문의 늘리기' }] },
  { title: `헬스장 강사가 자주 바뀌는 이유${v}`, hook: '강사가 또 바뀌었다는 민원, 이번 달 몇 번째인가요?', format: 'feed', pattern: 'xx', product: '', angle: '운영 중 단지', basis: [{ kind: 'weird', text: '이상한 근거 종류' }] },
  { title: '네 번째는 버림', hook: '', format: 'carousel', pattern: 'vs', product: '', angle: '', basis: [] }] });
const SLIDES = [
  { kind: 'cover', title: '직영 vs 위탁,\n우리 단지엔?', body: '입주 3개월 전 가장 많이 받는 질문', rows: [], imagePlan: '단지 커뮤니티 실내 사진' },
  { kind: 'body', title: '같은 시설인데 왜 다를까', body: '운영 방식에 따라\n민원과 비용이 달라져요.', rows: [], imagePlan: '운영 데스크 사진' },
  { kind: 'body', title: '직영의 특징', body: '관리사무소가 직접 인력을 뽑아요.\n결정은 빠르지만 부담이 커요.', rows: [], imagePlan: '관리사무소 사진' },
  { kind: 'body', title: '위탁 운영의 특징', body: '운영사가 인력과 프로그램을 맡아요.\n관리사무소 일이 줄어요.', rows: [], imagePlan: '' },
  { kind: 'table', title: '유형별 추천', body: '', rows: [['단지 유형', '추천'], ['인력 여유 있음', '직영'], ['인력 부족', '위탁 운영']], imagePlan: '' },
  { kind: 'cta', title: "댓글에 '비교표' 남기면 보내 드려요", body: '도움이 됐다면 저장·팔로우', rows: [], imagePlan: '' }];
const CAPTION = "직영 vs 위탁, 우리 단지엔?\n\n세 가지만 비교해 보세요.\n\n댓글에 '비교표' 남기면 보내 드려요.\n#커뮤니티운영 #아파트";
/** 디자인 담당은 응답 뒤(after)에 일함 → 결과가 나올 때까지 기다림 */
async function settled(id) {
  for (let k = 0; k < 120; k++) { const [x] = await sql`select result_status from mkt_team_ideas where id = ${id}`; if (x.result_status && x.result_status !== 'working') return x.result_status; await new Promise((r) => setTimeout(r, 250)); }
  throw new Error('디자인 담당이 끝나지 않음');
}

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ TEAM_PLANNER_HOUR: '0' }); sql = testDb(); ctx = await bootstrap(); // 기획 담당 정기 실행을 시험 시각과 무관하게
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 위탁 운영', products: '커뮤니티 운영·피트니스·GX' });
  await sql`update mkt_brands set banned_words = '{최고}' where id = ${P.brand}`;
  P.brand2 = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '하이링크' })).id;
  P.test = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '시험 브랜드' })).id;
  await sql`update mkt_brands set test_mode = true where id = ${P.test}`;
  await sql`insert into tenants (id, name) values ('t_tm', '남의회사') on conflict do nothing`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('보기(역할 7개·기본 켜짐·공간 밖 404) · 켜기/끄기(관리자·예산 담당 못 끔·감사) · 기획 담당 브랜드 · 기억(더하기·지우기·AI 안 쓰는 역할 400·다른 회사 404)', async () => {
  const v = await ctx.staffA.client.ok('GET', '/api/marketing/team');
  assert.deepEqual(v.roles.map((r) => [r.key, r.mode, r.enabled]), [['planner', 'toggle', false], ['designer', 'toggle', true], ['researcher', 'toggle', true], ['adsetter', 'request', true],
    ['budget', 'always', true], ['responder', 'always', true], ['reporter', 'toggle', true]]);
  assert.deepEqual(v.roles.map((r) => r.name), ['기획 담당', '디자인 담당', '광고 리서처', '광고 세팅 담당', '예산 담당', '응대 담당', '보고 담당']);
  assert.ok(v.roles.every((r) => r.recipe.length >= 3 && r.link.href.startsWith('/s/marketing/')), '레시피·바로가기');
  assert.equal(v.roles[0].isDefault, true); assert.equal(v.roles[0].next, null, '꺼진 역할은 다음 실행 없음');
  assert.match(v.roles.find((r) => r.key === 'reporter').next, /09:00 이후$/); assert.equal(v.roles.find((r) => r.key === 'budget').next, '매시간');
  assert.deepEqual(v.brands.map((b) => [b.name, b.planned]), [['다짐', true], ['하이링크', true]], '시험 브랜드는 빼고');
  assert.equal(v.canDecide, false); assert.deepEqual(v.ideas, []);
  assert.ok(v.roles.find((r) => r.key === 'responder').stats[0].includes('리드 광고 신청 없음'));
  assert.equal((await ctx.staffB.client.get('/api/marketing/team')).status, 404, '마케팅 공간 밖');
  assert.equal((await ctx.staffA.client.post('/api/marketing/team', { action: 'toggle', role: 'planner', enabled: true })).status, 403);
  // 켜기·끄기
  assert.deepEqual(await ctx.owner.ok('POST', '/api/marketing/team', { action: 'toggle', role: 'planner', enabled: true }), { role: 'planner', enabled: true });
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'toggle', role: 'researcher', enabled: false });
  const nb = await ctx.owner.post('/api/marketing/team', { action: 'toggle', role: 'budget', enabled: false }); assert.equal(nb.status, 400); assert.match(nb.body.error.message, /끌 수 없습니다/);
  let w = await ctx.owner.ok('GET', '/api/marketing/team');
  const pl = w.roles[0]; assert.deepEqual([pl.enabled, pl.isDefault], [true, false]); assert.match(pl.next, /07:00 이후$/);
  assert.deepEqual([w.roles[2].enabled, w.roles[2].next], [false, null]); assert.equal(w.canDecide, true);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt.team_toggle'`)[0].n, 2);
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'toggle', role: 'researcher', enabled: true });
  // 기획 담당 브랜드
  assert.equal((await ctx.owner.post('/api/marketing/team', { action: 'brands', brandIds: ['00000000-0000-0000-0000-00000000dead'] })).status, 404);
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'brands', brandIds: [P.brand] });
  w = await ctx.owner.ok('GET', '/api/marketing/team');
  assert.deepEqual(w.brands.map((b) => b.planned), [true, false]);
  // 기억
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'remember', role: 'planner', text: "'관리비' 대신 '운영비'라고 씁니다", brandId: P.brand });
  assert.equal((await ctx.owner.post('/api/marketing/team', { action: 'remember', role: 'budget', text: '증액은 30%까지' })).status, 400, 'AI 안 쓰는 역할');
  assert.equal((await ctx.owner.post('/api/marketing/team', { action: 'remember', role: 'planner', text: 'x' })).status, 400);
  assert.equal((await ctx.staffA.client.post('/api/marketing/team', { action: 'remember', role: 'planner', text: '직원은 못 함' })).status, 403);
  const tmp = await ctx.owner.ok('POST', '/api/marketing/team', { action: 'remember', role: 'designer', text: '지울 메모' });
  assert.equal(tmp.ok, true);
  w = await ctx.owner.ok('GET', '/api/marketing/team');
  const pm = w.roles[0].memory; assert.deepEqual(pm.map((m) => [m.kind, m.brand_name, m.created_by_name]), [['note', '다짐', '김대표']]);
  const dm = w.roles[1].memory[0];
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'forget', id: dm.id });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/team')).roles[1].memoryCount, 0);
  const [o] = await sql`insert into mkt_team_memory (tenant, role, kind, text) values ('t_tm', 'planner', 'note', '남의 기억') returning id`;
  assert.equal((await ctx.owner.post('/api/marketing/team', { action: 'forget', id: o.id })).status, 404, '다른 회사 기억');
});

test('기획 담당 [오늘 주제 받기] → 채택(디자인 담당: 카드뉴스 → 그려서 승인 대기 / 릴스 → 제작의뢰실)·반려(기억)·디자인 담당 끄면 [맡기기] · 다른 회사 404', async () => {
  await sql`insert into mkt_ad_refs (tenant, advertiser, hook, hook_type, starred, brand_id) values ('default', '경쟁사A', '입주 앞둔 단지, 운영사 정하셨나요?', 'question', true, ${P.brand})`;
  await ctl({ anthropicReset: true, anthropicQueue: [IDEAS()] });
  const r = await ctx.owner.ok('POST', '/api/marketing/team', { action: 'run', role: 'planner' });
  assert.deepEqual([r.created, r.brands.map((b) => b.brand), r.left], [3, ['다짐'], []], '고른 브랜드만');
  const ai = lastAi();
  for (const re of [/기획 담당/, /\[재료\]/, /아파트 커뮤니티 위탁 운영/, /금지어\(쓰지 않음\): 최고/, new RegExp(`오늘: ${today()}`), /참고\(★\) 첫 문장: «입주 앞둔 단지, 운영사 정하셨나요\?»/,
    /\[기획 담당 기억/, /'관리비' 대신 '운영비'/]) assert.match(ai, re);
  assert.equal((await sql`select count(*)::int n from notifications where dedupe_key = ${`team:planner:default:${today()}`} and user_id = ${ctx.ownerId}`)[0].n, 1, '승인자 알림');
  let v = await ctx.owner.ok('GET', '/api/marketing/team');
  assert.deepEqual(v.ideas.map((x) => [x.format, x.pattern, x.status]), [['carousel', 'vs', 'pending'], ['reels', null, 'pending'], ['feed', null, 'pending']]);
  assert.equal(v.ideas[2].product, '커뮤니티 운영', '비우면 주력 상품 첫 줄'); assert.deepEqual(v.ideas[2].basis, [{ kind: 'season', text: '이상한 근거 종류' }]);
  assert.ok(v.ideas.every((x) => Number.isInteger(x.score) && typeof x.pass === 'boolean'), '첫 문장 점수');
  assert.match(v.roles[0].stats[0], /오늘 주제 3개 · 채택 0 · 반려 0 · 대기 3/);
  assert.equal((await sql`select count(*)::int n from mkt_team_log where run_key = ${`planner:${today()}:${P.brand}`}`)[0].n, 1, '하루 한 번 표시');
  // 다시 받기 → 대기 주제는 '지난 주제'로
  await ctl({ anthropicReset: true, anthropicQueue: [IDEAS(' (2)')] });
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/team', { action: 'run', role: 'planner', brandId: P.brand })).created, 3);
  const old = v.ideas; v = await ctx.owner.ok('GET', '/api/marketing/team');
  assert.deepEqual(v.ideas.filter((x) => x.status === 'pending').map((x) => x.title), ['직영 vs 위탁, 우리 단지엔? (2)', '입주 3개월 전 체크리스트 (2)', '헬스장 강사가 자주 바뀌는 이유 (2)']);
  assert.equal((await sql`select count(*)::int n from mkt_team_ideas where id = any(${old.map((x) => x.id)}::uuid[]) and status = 'expired'`)[0].n, 3);
  assert.equal((await ctx.owner.post(`/api/marketing/team/ideas/${old[0].id}`, { action: 'adopt' })).status, 409, '지난 주제');
  const [car, reel, feed] = v.ideas.filter((x) => x.status === 'pending');
  assert.equal((await ctx.staffA.client.post(`/api/marketing/team/ideas/${car.id}`, { action: 'adopt' })).status, 403, '직원은 채택 못 함');
  // 채택(카드뉴스) → 디자인 담당: 장별 문구(디자인 담당 기억 포함) → 채울 곳 없음 → 그려서 승인 대기
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'remember', role: 'designer', text: '표지에는 숫자를 쓰지 않습니다' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ slides: SLIDES, caption: CAPTION, keyword: '비교표' })] });
  assert.deepEqual(await ctx.owner.ok('POST', `/api/marketing/team/ideas/${car.id}`, { action: 'adopt', note: '이번 주에 올리기' }), { status: 'adopted', designer: 'queued' });
  assert.equal(await settled(car.id), 'done');
  assert.match(lastAi(), /\[디자인 담당 기억/); assert.match(lastAi(), /표지에는 숫자를 쓰지 않습니다/); assert.match(lastAi(), /기획 담당 주제\(대표 채택\)/);
  const [ci] = await sql`select result_type, result_id, result_note from mkt_team_ideas where id = ${car.id}`;
  assert.equal(ci.result_type, 'carousel'); assert.match(ci.result_note, /카드뉴스 6장을 그려 승인 대기로 보냈습니다/);
  const [cs] = await sql`select c.status, c.topic, cardinality(c.media_ids) n, mc.status as content_status from mkt_carousels c join mkt_contents mc on mc.id = c.content_id where c.id = ${ci.result_id}`;
  assert.deepEqual([cs.status, cs.topic, cs.n], ['sent', '직영 vs 위탁, 우리 단지엔? (2)', 6]); assert.equal(cs.content_status, 'pending', '승인 대기');
  assert.equal((await ctx.owner.post(`/api/marketing/team/ideas/${car.id}`, { action: 'adopt' })).status, 409, '이미 결정');
  assert.equal((await ctx.owner.post(`/api/marketing/team/ideas/${car.id}`, { action: 'make' })).status, 409, '이미 만든 주제');
  // 반려 → 기획 담당 기억
  assert.equal((await ctx.owner.ok('POST', `/api/marketing/team/ideas/${feed.id}`, { action: 'reject', note: '시기가 아님' })).status, 'rejected');
  // 디자인 담당 끄고 채택(릴스) → 만들지 않음 → [디자인 담당에게 맡기기] → 제작의뢰실 릴스 의뢰
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'toggle', role: 'designer', enabled: false });
  assert.deepEqual(await ctx.owner.ok('POST', `/api/marketing/team/ideas/${reel.id}`, { action: 'adopt' }), { status: 'adopted', designer: 'off' });
  assert.equal((await sql`select result_status from mkt_team_ideas where id = ${reel.id}`)[0].result_status, null);
  await ctl({ anthropicReset: true });
  assert.equal((await ctx.owner.ok('POST', `/api/marketing/team/ideas/${reel.id}`, { action: 'make' })).designer, 'queued');
  assert.equal(await settled(reel.id), 'done');
  const [ri] = await sql`select result_type, result_id, result_note from mkt_team_ideas where id = ${reel.id}`;
  assert.equal(ri.result_type, 'brief'); assert.match(ri.result_note, /제작의뢰실 릴스/);
  const [b] = await sql`select kind, mode, purpose, message, refs->>'ideaId' as idea from mkt_briefs where id = ${ri.result_id}`;
  assert.deepEqual([b.kind, b.mode, b.purpose, b.idea], ['reels', 'content', 'awareness', reel.id]); assert.match(b.message, /^입주 3개월 전 체크리스트 \(2\) — 입주가 3개월 남았는데/);
  // 보기: 기억·기록·숫자
  v = await ctx.owner.ok('GET', '/api/marketing/team');
  const mem = v.roles[0].memory.map((m) => [m.kind, m.text, m.reason]);
  assert.deepEqual(mem.slice(0, 1), [['note', "'관리비' 대신 '운영비'라고 씁니다", null]], '대표 메모 먼저');
  assert.ok(mem.some((m) => m[0] === 'adopt' && m[1] === '직영 vs 위탁, 우리 단지엔? (2)' && m[2] === '이번 주에 올리기'));
  assert.ok(mem.some((m) => m[0] === 'reject' && m[1] === '헬스장 강사가 자주 바뀌는 이유 (2)' && m[2] === '시기가 아님'));
  const des = v.roles[1]; assert.equal(des.enabled, false);
  assert.deepEqual(des.records.map((l) => l.status), ['done', 'done']); assert.match(des.stats[0], /카드뉴스 1개\(승인 요청 1\) · 제작 의뢰 1개/);
  assert.equal(v.ideas.find((x) => x.id === car.id).result_link, '/s/marketing/approvals'); assert.equal(v.ideas.find((x) => x.id === reel.id).result_link, '/s/marketing/automation?tab=studio');
  // 다른 회사 주제 404
  const [oi] = await sql`insert into mkt_brands (tenant, name) values ('t_tm', '남의 브랜드') returning id`;
  const [ox] = await sql`insert into mkt_team_ideas (tenant, brand_id, day, title) values ('t_tm', ${oi.id}, ${today()}::date, '남의 주제') returning id`;
  assert.equal((await ctx.owner.post(`/api/marketing/team/ideas/${ox.id}`, { action: 'adopt' })).status, 404);
  assert.ok(!(await ctx.owner.ok('GET', '/api/marketing/team')).ideas.some((x) => x.title === '남의 주제'));
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'toggle', role: 'designer', enabled: true });
});

test('기억 → 공통 구조·분석 카드 지시문 · 운영 제안 결정 = 보고 담당 기억 · 카드뉴스 AI 로 고치기 = 디자인 담당 기억 · [지금 일하기](광고 리서처·보고 담당)', async () => {
  // 광고 리서처 기억 → 공통 구조 지시문
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'remember', role: 'researcher', text: '가격 광고는 참고하지 않습니다' });
  const refs = await sql`insert into mkt_ad_refs (tenant, advertiser, hook, hook_type) values ('default', '경쟁사B', '월 9,900원', 'price'), ('default', '경쟁사C', '운영사 고를 때 3가지', 'number') returning id`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ common: ['숫자'], structure: ['지목', '제안'], scripts: [] })] });
  await ctx.owner.ok('POST', '/api/marketing/adrefs/report', { ids: refs.map((x) => x.id) });
  assert.match(lastAi(), /\[광고 리서처 기억/); assert.match(lastAi(), /가격 광고는 참고하지 않습니다/);
  // [지금 일하기] 광고 리서처(3개 이상이라 분석) → 기록
  await ctl({ anthropicReset: true, anthropicQueue: [say({ common: ['질문형'], structure: ['지목', '제안', '행동'], scripts: [] })] });
  const rr = await ctx.owner.ok('POST', '/api/marketing/team', { action: 'run', role: 'researcher' });
  assert.ok(rr.created, JSON.stringify(rr));
  // 보고 담당 기억 → 분석·방향 카드 지시문, [지금 일하기] → 주간 운영 제안 → 승인 = 보고 담당 기억(채택)
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'remember', role: 'reporter', text: '협업 제안은 지역 업체만' });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ cards: [] })] });
  await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['analysis'] });
  assert.match(lastAi(), /\[보고 담당 기억/); assert.match(lastAi(), /협업 제안은 지역 업체만/);
  const wk = await ctx.owner.ok('POST', '/api/marketing/team', { action: 'run', role: 'reporter' });
  assert.equal(wk.created, 1);
  await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${wk.id}`, { action: 'approve', note: '좋음' });
  const v = await ctx.owner.ok('GET', '/api/marketing/team');
  const rep = v.roles.find((r) => r.key === 'reporter');
  assert.ok(rep.memory.some((m) => m.kind === 'adopt' && /^주간 운영 제안: 주간 운영 제안/.test(m.text) && m.reason === '좋음'), JSON.stringify(rep.memory));
  assert.match(rep.records[0].title, /주간 운영 제안을 승인함에 올렸습니다/); assert.match(rep.last.summary, /주간 운영 제안 \d+건/);
  const res = v.roles.find((r) => r.key === 'researcher');
  assert.match(res.records[0].title, /경쟁 광고 주간 분석\(\d{4}-W\d{2}\) — 광고 \d+개/); assert.match(res.stats[0], /보관함 \d+개 · ★ 참고 1개/);
  // 카드뉴스 [AI 로 고치기] → 디자인 담당 기억(수정 요청)
  const [c] = await sql`select id from mkt_carousels order by created_at desc limit 1`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ slides: SLIDES, caption: CAPTION, keyword: '비교표', changes: '표지를 짧게' })] });
  await ctx.owner.ok('PATCH', `/api/marketing/carousels/${c.id}`, { action: 'rewrite', note: '표지 질문을 더 짧게' });
  const des = (await ctx.owner.ok('GET', '/api/marketing/team')).roles.find((r) => r.key === 'designer');
  assert.ok(des.memory.some((m) => m.kind === 'edit' && m.text === '표지 질문을 더 짧게' && m.brand_name === '다짐'));
});

test('정기 점검: 기획 담당(점검마다 한 브랜드·다 끝나면 알림 1번·하루 한 번·끄면 건너뜀) · 예산 담당 마지막 점검', async () => {
  await sql`delete from mkt_team_log where role = 'planner'`; await sql`delete from mkt_team_ideas where tenant = 'default'`; await sql`delete from notifications where dedupe_key like 'team:planner:%'`;
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'brands', brandIds: [] }); // 전체(시험 브랜드 빼고) = 다짐·하이링크
  const mine = (t) => t.detail.mktOps.find((x) => x.tenant === 'default');
  // 시험 서버는 TEAM_PLANNER_HOUR=0 → 시각과 무관(운영은 서울 07~21시)
  await ctl({ anthropicReset: true, anthropicQueue: [IDEAS(' (점검)'), IDEAS(' (점검2)')] });
  const t1 = mine(await tick());
  assert.deepEqual([t1.planner.brand, t1.planner.created], ['다짐', 3], JSON.stringify(t1.planner));
  assert.equal((await sql`select count(*)::int n from notifications where dedupe_key like 'team:planner:%'`)[0].n, 0, '아직 남은 브랜드');
  const t2 = mine(await tick());
  assert.deepEqual([t2.planner.brand, t2.planner.created], ['하이링크', 3], JSON.stringify(t2.planner));
  assert.equal((await sql`select count(*)::int n from notifications where dedupe_key = ${`team:planner:default:${today()}`}`)[0].n, 1, '다 끝나면 알림 1번');
  assert.equal(mine(await tick()).planner.skipped, 'done', '하루 한 번');
  assert.equal((await sql`select count(*)::int n from mkt_team_ideas where tenant = 'default' and status = 'pending'`)[0].n, 6);
  // 기획 담당 끄면 점검 때 건너뜀
  await ctx.owner.ok('POST', '/api/marketing/team', { action: 'toggle', role: 'planner', enabled: false });
  assert.equal(mine(await tick()).planner.skipped, 'off');
  // 예산 담당: 승인된 이달 예산이 없으면 '잔액만 점검'(기록 줄 없이 마지막 점검만)
  const bud = (await ctx.owner.ok('GET', '/api/marketing/team')).roles.find((r) => r.key === 'budget');
  assert.equal(bud.last.status, 'skipped'); assert.match(bud.last.summary, /승인된 이달 예산 없음/); assert.deepEqual(bud.records, []);
});
