// 로컬 마케팅 시안 60건 검수(10/24) 수정 요청: ① 원고 형식이 깨지면(JSON 아님·빈 본문·JSON 모양 본문) 한 번 다시 → 그래도면 본문에 넣지 않고 '제작 실패'
// (2시간 뒤 자동 한 번 더, 두 번째 실패면 자동 멈춤 → [AI 다시 만들기]) · ⑦ 초안 보관 글에 수정본·결정이 들어오면 보관 표시(held)를 지움 (가짜 Anthropic)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, brand, rule;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const text = (t) => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0 });
  brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' });
  rule = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '가을 이벤트' });
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${rule.id}`; // 이 시험이 고른 칸만 만들게
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('① 원고 형식이 두 번 깨지면 본문에 넣지 않고 제작 실패 — 2시간 뒤 한 번 더, 두 번째 실패면 자동 멈춤, [AI 다시 만들기]로 복구', async () => {
  const [c] = await sql`select id from mkt_contents where rule_id = ${rule.id} order by scheduled_at limit 1`;
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${c.id}`;
  // JSON 아님 → 다시 → 본문이 JSON 모양(내부 메모가 섞임) = 둘 다 실패
  await ctl({ anthropicReset: true, anthropicQueue: [text('제목: 가을\n본문: 가을 이벤트 안내\nbrief: 현관 실사'), say({ title: '가을', body: '{"title":"가을","brief":"현관 실사","hooks":["a"]}', brief: '', why: '', hooks: [], keyword: '' })] });
  const r1 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const e1 = r1.produced.find((p) => p.id === c.id);
  assert.match(e1?.error ?? '', /원고 형식이 두 번 다 깨져/, JSON.stringify(r1.produced));
  let [row] = await sql`select produced_at, produce_at, status, quality, current_version from mkt_contents where id = ${c.id}`;
  assert.deepEqual([row.produced_at, row.status, row.current_version, row.quality.failed.n], [null, 'draft', 0, 1]);
  assert.ok(row.produce_at.getTime() > Date.now() + 110 * 60e3, '2시간 뒤 다시');
  assert.equal((await sql`select count(*)::int n from mkt_versions where content_id = ${c.id}`)[0].n, 0, '본문 저장 없음');
  // 승인함 '예정(초안)'에서 실패 표시가 보이게 quality.failed 가 목록에 실림
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.equal(list.contents.find((x) => x.id === c.id)?.quality?.failed?.n, 1);
  // 두 번째 실패(빈 본문 · 공백뿐) → 자동 멈춤(produce_at 비움)
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${c.id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을', body: '', brief: '', why: '', hooks: [], keyword: '' }), say({ title: '가을', body: '   \n ', brief: '', why: '', hooks: [], keyword: '' })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  [row] = await sql`select produced_at, produce_at, quality from mkt_contents where id = ${c.id}`;
  assert.deepEqual([row.produced_at, row.produce_at, row.quality.failed.n], [null, null, 2]);
  const st = await (await fetch(FAKE + '/__state')).json();
  const n = st.anthropic.length;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await (await fetch(FAKE + '/__state')).json()).anthropic.length, n, '자동으로는 다시 안 만듦');
  // [AI 다시 만들기] = 정상 원고 → 만들어지고 실패 표시는 지워짐
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 이벤트', body: '가을 맞이 이벤트를 안내합니다. 이번 주 토요일까지 방문하시면 상담해 드립니다.', brief: '현관 실사', why: '이번 주 주제', hooks: [], keyword: '가을' })] });
  await ctx.owner.ok('POST', `/api/marketing/auto/contents/${c.id}`, { action: 'regen' });
  [row] = await sql`select produced_at, status, quality from mkt_contents where id = ${c.id}`;
  assert.ok(row.produced_at, '만들어짐');
  assert.equal(row.quality.failed, undefined, '실패 표시 지움');
  const [v] = await sql`select body from mkt_versions where content_id = ${c.id} order by version desc limit 1`;
  assert.match(v.body, /^가을 맞이 이벤트를 안내합니다/);
  assert.doesNotMatch(v.body, /"brief"|"hooks"/);
});

test('① 빈 본문에 AI 표시 줄만 붙여 글로 만들지 않음(품질 검사)', async () => {
  // qualityCheck 를 거치는 사람 쪽 길: 수정본이 비면 서버가 막지 않더라도 AI 표시 줄만 붙인 '내용 있는 글'은 생기지 않는지 — 자동 제작 원고로 확인
  const [c] = await sql`select id from mkt_contents where rule_id = ${rule.id} and produced_at is null order by scheduled_at limit 1`;
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${c.id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을', body: 'AI 도움을 받아 제작했습니다', brief: '', why: '', hooks: [], keyword: '' }), say({ title: '가을', body: '\nAI 도움을 받아 제작했습니다\n', brief: '', why: '', hooks: [], keyword: '' })] });
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(r.produced.find((p) => p.id === c.id)?.error, JSON.stringify(r.produced));
  assert.equal((await sql`select count(*)::int n from mkt_versions where content_id = ${c.id}`)[0].n, 0, 'AI 표시 줄만 있는 글은 저장 안 함');
});

test('⑦ 초안 보관 글에 수정본을 올리면 승인 대기 + 보관 표시 지움 · 결정해도 지움', async () => {
  const mk = async (title) => (await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values ('default', ${brand.id}, ${title}, 'instagram', 'feed', now() + interval '3 days', 'draft', 1, ${ctx.ownerId}, true, now(), ${sql.json({ passed: true, issues: [], held: { at: new Date().toISOString(), reason: '브랜드 템플릿 전' } })}) returning id`)[0].id;
  const a = await mk('보관 글 A');
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${a}, 1, '보관 글 본문', '{}', ${ctx.ownerId})`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${a}/versions`, { body: '사람이 고친 수정본입니다', mediaIds: [] });
  let [row] = await sql`select status, quality from mkt_contents where id = ${a}`;
  assert.equal(row.status, 'pending');
  assert.equal(row.quality?.held, undefined, "'pending/held' 섞임 없음");
  const b = await mk('보관 글 B');
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${b}, 1, '보관 글 본문', '{}', ${ctx.ownerId})`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${b}/decide`, { version: 1, decision: 'hold', comment: '다음 주에' });
  [row] = await sql`select status, quality from mkt_contents where id = ${b}`;
  assert.equal(row.status, 'hold');
  assert.equal(row.quality?.held, undefined);
});
