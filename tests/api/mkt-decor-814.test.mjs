// 276차 #814(대표 #644 가독성 '화살표·이모티콘 빼기', 로컬 10/31: 운영 시안 16건 전부 이모지 3~5개·피드 7/8 화살표·8/8 【】):
// 글쓰기 지시문에서 이모지·화살표·체크·【 】를 빼고, AI 가 써도 다듬기에서 뺌(카드뉴스 장·제목 포함) · 사람이 쓴 글은 올리기 전 검사가 알려 줌
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const DECOR = /\p{Extended_Pictographic}|[→⇒➔➜➡▶►▸▹➤✓✔☑【】]/u;
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('AI 원고의 이모지·화살표·체크·【 】 → 다듬기에서 뺌(본문·제목·카드뉴스 장) · 지시문에 금지 줄 · 사람이 쓴 글은 검사가 알려 줌', async () => {
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${brand}`, { voice: { topics: '운동', formality: 'polite', emoji: 'many', emojis: ['💪'] } });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { quietStart: 0, quietEnd: 0, leadDays: 3 });
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '12:00', topicHint: '아침 운동' });
  const [slot] = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at limit 1`;
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${r.id} and id <> ${slot.id}`;
  await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${slot.id}`;
  const body = '💪 아침 7시에 문을 엽니다.\n【혜택】 첫 달 상담 무료 ✅\n→ 상담 → 등록 → 운동\n✓ 샤워실 새로 단장\n상담은 전화로 편하게 받습니다 😊';
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '🔥 아침 운동은 다짐에서', body, brief: '현장 실사',
    slides: [{ role: 'problem', title: '👉 아침이 바쁘죠', body: '→ 출근 전 30분' }, { role: 'solution', title: '【해결】 7시 오픈', body: '✓ 샤워실 완비' }, { role: 'cta', title: '상담 문의', body: '전화 주세요 📞' }] })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const sys = fake.state.anthropic.at(-1)?.body?.system;
  assert.match(JSON.stringify(sys ?? fake.state.anthropic.at(-1)?.body), /이모지·화살표\(→ ▶\)·체크\(✓\)·【 】 괄호는 쓰지 않음/, '지시문에 금지 줄');
  assert.doesNotMatch(JSON.stringify(fake.state.anthropic.at(-1)?.body), /허용 이모지/, '말투 프로필 이모지 칸은 지시문에 안 넣음');
  const [c] = await sql`select title, quality from mkt_contents where id = ${slot.id}`;
  const [v] = await sql`select body from mkt_versions where content_id = ${slot.id} and version = 1`;
  assert.ok(!DECOR.test(v.body), v.body); assert.ok(!DECOR.test(c.title), c.title);
  /* 빈 줄은 다듬기(가독성 줄 나눔)가 넣을 수 있음 */
  assert.match(v.body, /^아침 7시에 문을 엽니다\.\n+혜택 첫 달 상담 무료\n+상담, 등록, 운동\n+샤워실 새로 단장\n+상담은 전화로 편하게 받습니다/);
  assert.equal(c.title, '아침 운동은 다짐에서');
  for (const p of c.quality.pages ?? []) assert.ok(!DECOR.test(`${p.title}\n${p.body}`), JSON.stringify(p));
  assert.ok((c.quality.report?.notes ?? []).some((n) => /이모지 \d+·화살표 \d+·【 】 \d+개 뺌/.test(n)), JSON.stringify(c.quality.report?.notes));
  // 사람이 쓴 글: 올리기 전 검사가 알려 줌(빼지는 않음)
  const pf = (await ctx.owner.ok('POST', '/api/marketing/quality/check', { channel: 'instagram', kind: 'feed', title: '가을 안내', brandId: brand, body: '가을 이벤트 안내 🎉\n→ 등록하면 선물\n상담은 전화로 받습니다.' })).preflight;
  assert.ok(pf.some((x) => /^이모지·화살표·【 】 빼기\(이모지 1개 · 화살표·체크 1개\)/.test(x)), JSON.stringify(pf));
  await sql`update mkt_rules set active = false where id = ${r.id}`;
});
