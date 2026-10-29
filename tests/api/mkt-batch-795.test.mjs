// 267차(대표 #795 10/29 18:45 "승인을 올릴 때 두서없이 올리지 말고 수정 및 보완할 수 있는 시간까지 고려해서 — 주 단위로만 올리거나 3일 전부터 올려서 검수 후 게시"):
// 주 단위 묶음 — 그 주(월~일) 게시분 원고는 앞 주 묶음 때(기본 목 10:00)까지 초안으로 모아 두고, 다 만들어지면 한 번에 승인 대기로 + 알림 1건(사이에 한 건씩 안 올라옴)
// · 승인 마감 = 게시 전날 18:00 · 이미 올린 주의 늦은 원고는 바로 · 게시 3일 안 남았는데 승인 안 된 글은 한 번 알림 · '한 건씩'으로 바꾸면 모아 둔 원고를 바로 올림
// 시험 시각과 상관없게: 묶음 요일 = 오늘(서울)·0시 → 다음 주 묶음 때 = 오늘 0시(지남) · 다다음 주 묶음 때 = 7일 뒤(아직)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const DAY = 864e5;
const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kst = (d, hm) => new Date(`${d}T${hm}:00+09:00`);
const addDay = (d, n) => ymd(new Date(Date.parse(`${d}T12:00:00+09:00`) + n * DAY));
const dowOf = (d) => new Date(`${d}T12:00:00+09:00`).getUTCDay();
const weekOf = (d) => addDay(d, -((dowOf(d) + 6) % 7));
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const today = ymd(new Date());
const W1 = addDay(weekOf(today), 7), W2 = addDay(W1, 7); // 다음 주·다다음 주 월요일
const NOTES = ['현관 화분을 새로 들였습니다. 입주민 사진 공모도 함께 엽니다.', '주말 분리수거 시간이 바뀝니다. 토요일 오전 9시부터 받습니다.', '놀이터 바닥 공사를 마쳤습니다. 이번 주부터 다시 엽니다.',
  '경비실 택배 보관 기간은 사흘입니다. 찾아가실 때 동·호수를 알려 주세요.', '독서실 좌석을 늘렸습니다. 예약은 관리사무소에서 받습니다.', '엘리베이터 점검은 목요일 오후 두 시에 합니다.',
  '산책로 조명을 바꿨습니다. 밤에도 밝게 걸을 수 있습니다.', '겨울 대비 배관 점검을 시작합니다. 세대별 일정은 따로 알립니다.', '헬스장 기구 두 대를 새로 들였습니다. 사용법은 안내문을 보세요.'];
let note = 0;
const queue = (n) => ctl({ anthropicReset: true, anthropicQueue: Array.from({ length: n }, () => { const i = note++; return say({ title: `묶음 시험 ${i + 1}`, body: NOTES[i % NOTES.length], brief: '현관 실사' }); }) });
const notes = (re) => sql`select title, body from notifications where user_id = ${ctx.ownerId} and type = 'review_requested' order by created_at`.then((r) => r.filter((x) => re.test(x.title)));

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('주 단위 묶음: 칸 원고 만드는 때 = 그 주 묶음 4시간 전 · 모아 두었다가 다 되면 한 번에 승인 대기 + 알림 1건 · 늦은 원고는 바로 · 마감 = 게시 전날 18:00', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const s0 = (await ctx.owner.ok('GET', '/api/marketing/auto')).settings;
  assert.deepEqual([s0.approval_mode, s0.deadline_days], ['lead', 0], '설정이 없는 새 회사는 예전 방식(한 건씩·게시 당일 마감)');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, approvalMode: 'weekly', batchDow: dowOf(today), batchHour: 0, deadlineDays: 1, approvalHour: 18 });
  const view = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(view.rhythm.deadlineRule, '게시 전날 18:00');
  assert.equal(view.rhythm.next.label, `${md(W2)}~${md(addDay(W2, 6))} 게시분`, '다음 묶음 = 다다음 주 게시분(다음 주 묶음 때는 오늘 0시로 지남)');
  const brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '묶음 시험 브랜드' });
  // 규칙이 만든 칸: 원고 만드는 때 = 그 주 묶음 4시간 전(지났으면 지금)
  const rule = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '단지 소식' });
  const slots = await sql`select scheduled_at, produce_at, created_at from mkt_contents where rule_id = ${rule.id}`;
  assert.ok(slots.length >= 7, `칸 ${slots.length}`);
  for (const c of slots) {
    const w = weekOf(ymd(new Date(c.scheduled_at)));
    const want = Math.max(new Date(c.created_at).getTime() - 5e3, kst(addDay(w, -((((1 - dowOf(today) + 7) % 7) || 7))), '00:00').getTime() - 4 * 3600e3);
    assert.ok(Math.abs(new Date(c.produce_at).getTime() - want) < 120e3 || (new Date(c.produce_at).getTime() <= Date.now() && want <= Date.now()), `${ymd(new Date(c.scheduled_at))} 만드는 때 ${new Date(c.produce_at).toISOString()} ≠ ${new Date(want).toISOString()}`);
    if (w === W2) assert.equal(ymd(new Date(c.produce_at)), addDay(today, 6), '다다음 주 칸 = 7일 뒤 0시의 4시간 전(6일 뒤 20시)');
  }
  // 시험은 아래 직접 넣은 칸만으로(규칙은 끄고 칸 지움 — 원고 재료(주제)는 규칙에서)
  await sql`update mkt_rules set active = false where id = ${rule.id}`;
  await sql`delete from mkt_contents where rule_id = ${rule.id}`;
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${brand.id}`;
  const put = async (title, day, hm, ago = 1) => (await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, rule_id, kind, auto, produce_at, is_test, mode)
    values (${tenant}, ${brand.id}, ${title}, 'instagram', ${kst(day, hm)}, 'draft', 0, ${ctx.ownerId}, ${rule.id}, 'feed', true, now() - make_interval(mins => ${ago}::int), false, 'content') returning id`)[0].id;
  const A = [];
  for (let k = 0; k < 6; k++) A.push(await put(`다음 주 칸 ${k + 1}`, addDay(W1, k), k % 2 ? '15:00' : '11:00', 20 - k)); // 만드는 차례 = 칸 순서(다다음 주 칸이 마지막)
  const B = await put('다다음 주 칸', addDay(W2, 2), '11:00', 2);
  // 1번째 실행: 한 번에 5건까지 만듦 → 다음 주 칸이 1건 남아 묶음은 아직 안 올림(만든 5건도 초안)
  await queue(8);
  const r1 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal(r1.produced.length, 5, JSON.stringify(r1.produced));
  assert.ok(r1.produced.every((p) => p.batch), '묶음으로 모음');
  const st1 = await sql`select id, status, quality from mkt_contents where id = any(${[...A, B]}::uuid[])`;
  assert.ok(st1.every((c) => c.status === 'draft'), `사이에 한 건씩 안 올라옴: ${st1.map((c) => c.status)}`);
  assert.equal((await notes(/승인 요청|게시 \d+건/)).length, 0, '알림 없음');
  const box1 = (await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.filter((c) => c.quality?.batch && !c.quality.batch.released);
  assert.equal(box1.length, 5, '승인함 \'묶음 준비 중\'');
  // 2번째 실행: 남은 1건(다음 주) → 다음 주 6건을 한 번에 승인 대기 + 알림 1건 · 다다음 주 칸(묶음 때 7일 뒤)은 그대로 초안
  await queue(4);
  const r2 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.deepEqual(r2.batches, [{ week: W1, n: 6 }], JSON.stringify(r2));
  const st2 = Object.fromEntries((await sql`select id, status, quality from mkt_contents where id = any(${[...A, B]}::uuid[])`).map((c) => [c.id, c]));
  assert.ok(A.every((id) => ['pending', 'changes'].includes(st2[id].status) && st2[id].quality.batch.released), JSON.stringify(A.map((id) => st2[id].status)));
  assert.equal(st2[B].status, 'draft'); assert.equal(st2[B].quality.batch.week, W2);
  const sent = await notes(/게시 \d+건/);
  assert.equal(sent.length, 1, '묶음 알림 1건');
  assert.match(sent[0].title, /^다음 주 게시 6건/); assert.match(sent[0].body, /승인 마감 게시 전날 18:00/);
  assert.equal((await notes(/승인 요청/)).length, 0, '한 건씩 알림 없음');
  // 승인함: 묶음 표 · 마감 = 게시 전날 18:00
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  assert.equal(list.deadlineRule, '게시 전날 18:00');
  const a0 = list.contents.find((c) => c.id === A[0]);
  assert.equal(new Date(a0.deadline).toISOString(), kst(addDay(W1, -1), '18:00').toISOString());
  // 이미 올린 주에 늦게 나온 원고는 바로 승인 대기 + 그 글 알림
  const late = await put('다음 주 늦은 칸', addDay(W1, 6), '19:00');
  await queue(3);
  const r3 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(r3.produced.some((p) => p.id === late && !p.batch), JSON.stringify(r3.produced));
  assert.ok(['pending', 'changes'].includes((await sql`select status from mkt_contents where id = ${late}`)[0].status));
  // 게시 3일 안 남았는데 승인 안 된 글 → 한 번 알림(올린 지 하루 안 된 글은 빼고)
  await sql`update mkt_contents set status = 'pending', scheduled_at = now() + interval '2 days', produced_at = now() - interval '2 days' where id = ${A[0]}`;
  const r4 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal(r4.nudged, 1, JSON.stringify(r4));
  assert.match((await notes(/게시 3일 안/))[0].title, /승인 안 된 글 1건/);
  const r5 = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal(r5.nudged, undefined, '한 번만');
  // '한 건씩'으로 바꾸면 모아 둔 원고(다다음 주)를 바로 올림 · 만드는 때도 예전 식(게시 3일 전 13시)
  const B2 = await put('다다음 주 안 만든 칸', addDay(W2, 4), '11:00');
  const sv = await ctx.owner.ok('PUT', '/api/marketing/auto', { approvalMode: 'lead', leadDays: 3, leadHour: 13 });
  assert.deepEqual(sv.released, [{ week: W2, n: 1 }]);
  assert.ok(['pending', 'changes'].includes((await sql`select status from mkt_contents where id = ${B}`)[0].status));
  const [b2] = await sql`select produce_at from mkt_contents where id = ${B2}`;
  assert.equal(new Date(b2.produce_at).toISOString(), kst(addDay(W2, 1), '13:00').toISOString());
  assert.ok((await sql`select 1 from audit_logs where action = 'mkt.approval_mode' and target_id = ${tenant}`).length, '방식 바꿈 감사 기록');
});
