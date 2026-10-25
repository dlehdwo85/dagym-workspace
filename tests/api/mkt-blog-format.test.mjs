// #235 ⓑ(대표 노션 '네이버 블로그 자동 작성 툴') 블로그 네이버 형식 + 로컬 10/25 11:15 사진 쓰임 규칙
// 원고 재료 = 번호 붙은 본문 사진 후보(사진 AI 설명) → 원고의 '[사진 P번호]' 줄 = '[사진 n] AI 설명'(글에 나온 순서·모르는 번호·같은 사진 두 번은 지움) · 본문 사진 = 그 순서 · 표지 바탕은 본문 사진과 겹치지 않음
// · 블로그 원고는 표준 모델 이상(빠른 모델 회사도) + 화면 비용 차이 · 한 문장 한 줄 · 보고서(메인·서브 키워드·검색자·숫자)
// · 글자만 500자 넘게 이어지면 올리기 전 검사가 막음 · 사진·인용구·키워드 횟수는 경고 · 수정본은 사진 줄 번호·설명 그대로
// · 안내판 글자 많은 실사 = 블로그 본문 후보(바탕 아님) · '쓰지 않음' 표시는 후보에서 빠짐 — 구조 시험(가짜 AI). 실제 AI 원고 품질은 운영에서
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, br; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
let minutes = 90;
async function libFile(name, vision, tags = []) {
  const data = await sharp({ create: { width: 320, height: 240, channels: 3, background: { r: 60 + minutes, g: 120, b: 150 } } }).jpeg().toBuffer();
  const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision, created_at)
    values ('default', 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${tags}, ${sql.json(vision)}, now() - ${`${minutes--} minutes`}::interval) returning id`;
  const key = `lib/default/${f.id}/${name}`;
  await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
  await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
  await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
  return f.id;
}
async function slot({ channel = 'blog', kind = 'blog', day = 3, hour = 13 } = {}) {
  const at = new Date(Date.now() + day * 864e5); at.setUTCHours(hour - 9, 0, 0, 0);
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produce_at)
    values ('default', ${br.id}, '자동 칸', ${channel}, ${kind}, ${at}, 'draft', 0, ${ctx.ownerId}, true, now() - interval '1 minute') returning id`;
  return c.id;
}
const cur = async (id) => (await sql`select c.status, c.quality, c.title, v.body, v.media_ids, v.version from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`)[0];
const drafts = () => fake.state.anthropic.filter((x) => JSON.stringify(x.body.system ?? '').includes('네이버 블로그 원고'));
const photoLines = (body) => body.split('\n').filter((l) => /^\[사진/.test(l));

// 원고 문장(상투어·틀 문구 없이 길이를 섞음) — 문단은 4문장, 소제목·인용구·사진 줄 사이 글자는 400자 안
const S = ['회원권은 기간이 길수록 한 달 값이 내려갑니다.', '처음에는 한 달 회원권으로 시작해도 괜찮습니다.', '운동이 몸에 붙으면 그때 기간을 늘리면 됩니다.', '등록하기 전에 하루 둘러보면 기구 배치와 샤워실을 직접 볼 수 있습니다.',
  '궁금한 점은 상담할 때 바로 물어보면 됩니다.', '퇴근 뒤 저녁 일곱 시 무렵이 가장 붐빕니다.', '아침 여섯 시부터 여덟 시 사이는 비교적 한가합니다.', '점심시간에 삼십 분만 운동하는 분도 꽤 있습니다.',
  '한가한 시간에는 기구를 천천히 익힐 수 있어 처음 오시는 분께 맞습니다.', '트레이너에게 사용법을 물어보면 자세를 바로 잡아 줍니다.', '운동화와 수건, 물 한 병이면 첫날 준비는 끝납니다.', '실내에서만 신는 운동화를 따로 챙기면 더 편합니다.',
  '사물함은 그날그날 비워 두는 방식입니다.', '옷은 땀이 잘 마르는 편한 옷이면 충분합니다.', '첫 주에는 무게를 올리기보다 동작을 익히는 데 시간을 씁니다.', '일주일에 세 번 오는 것을 첫 목표로 잡는 분이 많습니다.',
  '운동 기록을 짧게 남겨 두면 다음에 할 일이 분명해집니다.', '같은 시간에 오면 얼굴을 익힌 분들과 인사도 나누게 됩니다.', '쉬는 날을 미리 정해 두면 꾸준히 다니기 쉽습니다.', '힘든 날에는 가볍게 걷기만 하고 돌아가도 괜찮습니다.',
  '샤워실에는 기본 세면도구가 놓여 있습니다.', '처음 두 주는 몸이 적응하는 기간이라 조금 뻐근할 수 있습니다.', '스트레칭을 오 분만 해도 다음 날이 한결 가볍습니다.', '혼자 운동하기 어렵다면 수업 시간표를 먼저 확인해 보세요.',
  '시간표는 매장 입구와 상담 데스크에 붙어 있습니다.', '등록 상담은 평일 저녁에도 받습니다.', '가족이 함께 등록하는 경우도 많습니다.', '한 달이 지나면 처음 세운 목표를 다시 살펴봅니다.'];
let si = 0; const para = (pre = '') => `${pre}${Array.from({ length: 4 }, () => S[si++ % S.length]).join(' ')}`;
const KW = '송도 헬스장';
function goodBody() {
  si = 0;
  return [`${KW}을 처음 알아보는 분이라면 이 글이 도움이 됩니다. 이사 온 지 얼마 안 된 직장인 분들이 가장 많이 묻는 내용을 모았습니다. 결론부터 말씀드리면 첫 주에는 시간대만 정해도 충분합니다.`,
    '[사진 P2]', `■ ${KW} 가격 확인하는 법`, para(`${KW} 회원권은 등록 방식이 단순합니다. `), para(), '“처음 한 달은 시간대만 정해도 충분합니다.”', para(), '[사진 P1]',
    '■ 운동 시간대 고르기', para(), para(), '[사진 P3]', para(), '[사진 P99]', '[사진 P2]',
    '■ 처음 오시는 날 준비물', para(), '[사진 P4]', para(), para(), '“준비물은 운동화 한 켤레면 시작할 수 있습니다.”',
    '■ 꾸준히 다니는 요령', para(), '[사진 P5]', para(), '[사진 P6]', para(),
    '■ 마무리', para(`${KW}을 고를 때는 가격보다 내가 갈 수 있는 시간이 더 중요합니다. `), '[사진 P7]', para(`${KW} 상담은 아래 번호로 받습니다. `), '[사진 P8]', '문의 032-111-2222'].join('\n\n');
}

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0, autoHold: false });
  await sql`update mkt_settings set write_tier = 'fast' where tenant = 'default'`; // 빠른 모델 회사 — 블로그만 표준 모델로 올라가는지
  br = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '블로그짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${br.id}`, { intro: '송도 동네 헬스장', products: '1개월 회원권',
    facts: { phone: '032-111-2222', address: '인천 연수구 송도동 1', keywords: ['송도 헬스장', '송도 PT'] } });
  for (let k = 1; k <= 10; k++) P[`s${k}`] = await libFile(`블로그짐 매장 ${k}.jpg`, V({ caption: `매장 장면 ${k}`, scene: `장면 ${k}의 모습입니다. 밝은 조명입니다.`, tags: ['매장'] }));
  P.board = await libFile('블로그짐 안내판.jpg', V({ caption: '이용 수칙 안내판 앞 출입 단말', text: 'much', seen: '이용 수칙' }));
  P.promo = await libFile('IMG_0300.jpg', V({ caption: '할인 이벤트 포스터', kind: 'graphic', text: 'much', promo: true }));
  P.skip = await libFile('블로그짐 창고.jpg', V({ caption: '창고 선반 사진' }), ['쓰지않음']);
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('블로그 원고 = 네이버 형식: 표준 모델 · 사진 후보(P번호) → [사진 n] AI 설명(장면 순서) · 본문 사진 = 그 순서 · 표지 바탕은 본문 사진과 안 겹침 · 한 문장 한 줄 · 보고서', async () => {
  const id = await slot();
  const persona = '송도로 이사 와 퇴근 뒤 운동할 곳을 찾는 30대 직장인';
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: `${KW} 처음 가기 전 알아둘 세 가지`, body: goodBody(), brief: '', why: '', hooks: [], keyword: KW, persona, subKeywords: ['가격', '시간대', '준비물'] })] });
  const n0 = drafts().length;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const req = drafts()[n0];
  assert.ok(req, '블로그 원고 요청');
  // 빠른 모델 회사여도 블로그는 표준 모델 · 형식 지시·검색자·서브 키워드 칸
  assert.equal(req.body.model, 'claude-sonnet-5-5');
  const sys = JSON.stringify(req.body.system); const user = String(req.body.messages[0].content);
  assert.ok(['네이버 블로그 형식', '메인 키워드', '송도 헬스장, 송도 PT', '한 줄에 한 문장', '인용구 2~4개', '[사진 P번호]', '8~11장'].every((w) => sys.includes(w)), sys.slice(0, 600));
  assert.ok(['persona', 'subKeywords'].every((k) => req.body.output_config.format.schema.required.includes(k)));
  // 사진 후보: 이 브랜드 실사(사진 AI 설명) — 안내판 글자 많은 실사는 뒤로(바탕은 아님), 홍보물·'쓰지 않음' 표시는 빠짐
  const cand = Object.fromEntries([...user.matchAll(/^P(\d+): (.+?)(?: — .*)?$/gm)].map((m) => [Number(m[1]), m[2]]));
  assert.equal(Object.keys(cand).length, 11, user);
  assert.equal(cand[11], '이용 수칙 안내판 앞 출입 단말', '글자 많은 실사 = 본문 후보 맨 뒤');
  assert.ok(!user.includes('할인 이벤트 포스터') && !user.includes('창고 선반 사진'), '홍보물·쓰지 않음 표시 사진은 후보 아님');
  assert.ok(!user.includes('쓸 수 있는 실사 사진(자료실'), '블로그는 번호 붙은 후보 목록만');
  // 결과: [사진 P2]·[사진 P1]·…·[사진 P8] → [사진 1~8] AI 설명, 모르는 번호(P99)·두 번째 P2 는 지움
  const c = await cur(id);
  assert.equal(c.status, 'pending', JSON.stringify(c.quality.issues));
  const order = [2, 1, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(photoLines(c.body), order.map((p, k) => `[사진 ${k + 1}] ${cand[p]}`));
  assert.ok(!/\[사진 P/.test(c.body));
  const idOf = Object.fromEntries((await sql`select id, vision->>'caption' as cap from library_files where tenant = 'default'`).map((r) => [r.cap, r.id]));
  const bodyIds = order.map((p) => idOf[cand[p]]);
  assert.deepEqual(c.media_ids.slice(1).map(String), bodyIds, '본문 사진 = 글에 나온 순서');
  assert.deepEqual(c.quality.visual.bodyIds, bodyIds);
  assert.ok(c.quality.visual.photoId && !bodyIds.includes(c.quality.visual.photoId), '표지 바탕 = 본문에 안 쓴 글자 없는 실사');
  // 한 문장 한 줄 · 사진·인용구·소제목은 제 줄
  assert.match(c.body, /^송도 헬스장을 처음 알아보는 분이라면 이 글이 도움이 됩니다\.\n이사 온 지 얼마 안 된 직장인 분들이 가장 많이 묻는 내용을 모았습니다\.\n결론부터 말씀드리면 첫 주에는 시간대만 정해도 충분합니다\.\n\n\[사진 1\] /);
  assert.ok(c.body.includes('\n\n“처음 한 달은 시간대만 정해도 충분합니다.”\n\n'));
  // 보고서: 블로그 형식 숫자 · 경고 없음(사진 8장·인용구 2개·키워드 5회·서브 키워드 소제목에)
  const r = c.quality.report;
  assert.deepEqual([r.blog.keyword, r.blog.keywordCount, r.blog.subKeywords, r.blog.persona, r.blog.photos, r.blog.quotes, r.blog.heads], [KW, 5, ['가격', '시간대', '준비물'], persona, 8, 2, 5]);
  assert.ok(r.blog.chars >= 1800 && r.blog.chars <= 2500 && r.blog.maxRun < 500, JSON.stringify(r.blog));
  assert.deepEqual(r.channel.filter((x) => /사진|인용구|메인 키워드|서브 키워드|첫 문단|끝 문단|이하 권장/.test(x.msg)), [], JSON.stringify(r.channel));
  assert.deepEqual(r.preflight, []);
  // 상세 화면도 같은 보고서(블로그 형식 줄)
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.equal(d.qualityReport.blog.photos, 8);
  P.blog = id; P.cand = cand; P.bodyIds = bodyIds;
});

test('수정 요청 → 수정본은 사진 줄 번호·설명 그대로(설명을 바꾸거나 새 번호·P 줄을 넣어도 되살림) · 본문 사진 그대로 · 사진 후보 목록 없이', async () => {
  const v1 = await cur(P.blog);
  const rev = v1.body.replace(`[사진 1] ${P.cand[2]}`, '[사진 1] 바꾼 설명입니다').replace('■ 운동 시간대 고르기', '[사진 P3]\n\n■ 운동 시간대 고르기\n\n[사진 9]\n\n[사진 2]');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: v1.title, body: rev, brief: '', why: '', hooks: [], keyword: KW, persona: '같은 사람', subKeywords: ['가격', '시간대', '준비물'] })] });
  const n0 = drafts().length;
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${P.blog}/decide`, { version: v1.version, decision: 'changes', comment: '첫 문단을 조금 더 짧게 써 주세요' });
  assert.equal(r.revision.version, v1.version + 1, JSON.stringify(r.revision));
  const req = drafts()[n0];
  assert.ok(JSON.stringify(req.body.system).includes('지난 원고의 \\"[사진 n] …\\" 줄은 번호·설명·순서 그대로'), '수정본 지시');
  assert.ok(!String(req.body.messages[0].content).includes('[블로그 사진 후보'), '수정본에는 새 사진 후보 없음');
  const v2 = await cur(P.blog);
  assert.deepEqual(photoLines(v2.body), [2, 1, 3, 4, 5, 6, 7, 8].map((p, k) => `[사진 ${k + 1}] ${P.cand[p]}`), v2.body);
  assert.deepEqual(v2.media_ids.slice(1).map(String), P.bodyIds, '본문 사진 그대로');
  assert.ok(!P.bodyIds.includes(v2.quality.visual.photoId), '표지 바탕은 본문 사진이 아님');
});

test('글자만 500자 넘게 이어지면 올리기 전 검사가 막음(수정 요청 칸) · 사진 자리·인용구·키워드 횟수·서브 키워드는 경고만 · 사진 줄 없으면 예전처럼 본문 사진 1장', async () => {
  const id = await slot({ day: 4 });
  si = 0;
  const wall = [`${KW} 이야기입니다. 오늘은 처음 오시는 분을 위한 안내를 적었습니다.`, `■ ${KW} 첫 방문`, para(), para(), para(), para(), para(), '■ 다음 방문', para(), para(), para(), para(), para(), para(), para(), '문의 032-111-2222'].join('\n\n');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: `${KW} 첫 방문 안내`, body: wall, brief: '', why: '', hooks: [], keyword: KW, persona: '처음 오는 사람', subKeywords: ['요금'] })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const c = await cur(id);
  assert.equal(c.status, 'changes');
  assert.ok(c.quality.preflight.some((x) => /^글자만 [\d,]+자 이어짐\('.+…'부터\) — 500자 안에 소제목·인용구·사진 줄로 끊기$/.test(x)), JSON.stringify(c.quality.preflight));
  const msgs = c.quality.report.channel.map((x) => x.msg);
  for (const re of [/^본문 사진 자리\(\[사진 n\] 줄\) 0개 — 8~15장 권장/, /^인용구 0개 — 2~4개/, /^메인 키워드 '송도 헬스장' 본문 \d회 — 5~7회$/, /^서브 키워드가 소제목에 없음: '요금'$/]) assert.ok(msgs.some((m) => re.test(m)), `${re} — ${msgs.join(' / ')}`);
  assert.equal(c.media_ids.length, 2, '사진 줄이 없으면 표지 + 본문 사진 1장(예전처럼)');
});

test('글 모델: 빠른 모델 회사도 블로그만 표준 모델 — 화면에 블로그 1건 비용·빠른 모델과의 차이 · 피드 원고는 그대로 빠른 모델', async () => {
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.deepEqual([v.writeModel.tier, v.writeModel.blog.tier, v.writeModel.blog.label, v.writeModel.blog.model, v.writeModel.blog.upgraded], ['fast', 'default', '표준 모델', 'claude-sonnet-5-5', true]);
  assert.ok(v.writeModel.blog.extraKrw > 0 && v.writeModel.blog.perDraftKrw > v.writeModel.blog.extraKrw, JSON.stringify(v.writeModel.blog));
  const id = await slot({ channel: 'instagram', kind: 'feed', day: 5, hour: 10 });
  await ctl({ anthropicReset: true });
  const n0 = fake.state.anthropic.length;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const feed = fake.state.anthropic.slice(n0).find((x) => JSON.stringify(x.body.system ?? '').includes('인스타그램 피드 캡션'));
  assert.equal(feed?.body.model, 'claude-haiku-5-5');
  assert.ok((await cur(id)).body, '피드 제작됨');
});

test('사진 쓰임(로컬 10/25): 안내판 글자 많은 실사 = 본문 가능·바탕 아님 · 쓰지 않음 = 둘 다 아님 · 사실 카드 블로그 키워드(2~30자·5개까지)', async () => {
  const items = Object.fromEntries((await ctx.owner.ok('GET', '/api/marketing/photos')).items.map((x) => [x.id, x]));
  assert.deepEqual([items[P.board].cover, items[P.board].body], [false, true]);
  assert.deepEqual([items[P.skip].cover, items[P.skip].body, items[P.skip].mark], [false, false, 'skip']);
  assert.deepEqual([items[P.promo].cover, items[P.promo].body], [false, false]);
  assert.deepEqual((await sql`select facts->'keywords' as k from mkt_brands where id = ${br.id}`)[0].k, ['송도 헬스장', '송도 PT']);
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/brands/${br.id}`, { facts: { keywords: ['송'] } })).status, 400, '한 글자 키워드는 안 됨');
});
