// 375차 #997(대표 11/06 "메일 보낸 것들만 따로 모아서 볼 수 있도록 사이드바에 만들어 주세요") — 보낸 메일 모아 보기
// 직원 = 내가 보낸 것만 · 대표·관리자 = 회사 전체도 · 자동 메일(company_key 없는 메일)은 관리자가 켤 때만 · 다른 회사·남의 줄 상세는 404
// 거름: 검색(받는 사람·제목·업무 이름) · 기간 · 상태(보냄·예약·대기·실패·취소) · 종류(업무 메일·문자/카톡·견적·AI 비서·자동 메일)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql; const ids = {};
const today = seoulToday();
const row = async (key, o) => {
  const id = randomUUID(); ids[key] = id;
  await sql`insert into outbox (id, tenant, channel, status, task_id, company_key, created_by, from_name, to_addrs, cc_addrs, subject, body_text, files, message_id, sent_at, scheduled_at, next_attempt_at, last_error, created_at)
    values (${id}, ${o.tenant ?? 'default'}, ${o.channel}, ${o.status ?? 'sent'}, ${o.taskId ?? null}, ${o.company ?? null}, ${o.by}, ${o.fromName ?? null}, ${o.to ?? []}, ${o.cc ?? []}, ${o.subject ?? null}, ${o.body ?? ''},
      ${sql.json(o.files ?? [])}, ${`<${id}@t>`}, ${o.status === 'sent' || !o.status ? (o.at ?? new Date()) : null}, ${o.scheduledAt ?? null}, ${o.scheduledAt ?? new Date()}, ${o.error ?? null}, ${o.at ?? new Date()})`;
};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const task = await ctx.owner.ok('POST', '/api/tasks', { title: '시험997 견적 보내기 업무' });
  const o = ctx.ownerId, s = ctx.staffA.id;
  await row('ownerMail', { channel: 'email:workin', company: 'dagym', by: o, taskId: task.id, to: ['a997@x.com', 'b997@x.com'], subject: '시험997 자료 보내 드립니다', body: '안녕하세요.\n자료 보내 드립니다.', files: [{ attachmentId: null, name: '자료.pdf', size: 2048 }] });
  await row('ownerFailed', { channel: 'email:smtp', company: 'dagym', by: o, status: 'failed', to: ['c997@x.com'], subject: '시험997 실패한 메일', error: '받는 주소 없음(550)' });
  await row('ownerQuote', { channel: 'quote:mail', by: o, to: ['견적처997'], subject: '견적서 Q-997', body: '견적처 · 합계 1,000원' });
  await row('system', { channel: 'email:workin', by: o, to: ['owner997@x.com'], subject: '시험997 오늘 입찰 공고' });
  await row('staffSms', { channel: 'sms:handoff', by: s, taskId: task.id, to: ['010-1234-5678'], subject: '문자', body: '시험997 문자 본문' });
  await row('staffScheduled', { channel: 'email:workin', company: 'dagym', by: s, status: 'queued', scheduledAt: new Date(Date.now() + 3 * 86400_000), to: ['d997@x.com'], subject: '시험997 예약 메일' });
  await row('staffAi', { channel: 'sms:handoff', by: s, to: ['010-9999-0000'], subject: '문자', body: 'AI 비서 문자997' });
  await row('oldMail', { channel: 'email:workin', company: 'dagym', by: o, to: ['old997@x.com'], subject: '시험997 지난달 메일', at: new Date(`${addDays(today, -40)}T10:00:00+09:00`) });
  await row('otherTenant', { tenant: 'other997', channel: 'email:workin', company: 'x', by: o, to: ['z997@x.com'], subject: '시험997 다른 회사' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const subjects = (r) => r.items.map((x) => x.subject).sort();

test('범위: 직원은 내가 보낸 것만(회사 전체를 골라도) · 대표는 내 것/회사 전체 · 자동 메일은 켤 때만 · 다른 회사는 안 보임', async () => {
  const st = await ctx.staffA.client.ok('GET', '/api/mail/outbox');
  assert.deepEqual(subjects(st), ['문자', '문자', '시험997 예약 메일']);
  assert.equal(st.admin, false); assert.ok(!st.kinds.some((k) => k.key === 'system'), '직원에게 자동 메일 종류 없음');
  assert.deepEqual(subjects(await ctx.staffA.client.ok('GET', '/api/mail/outbox?scope=all&system=1')), subjects(st), '직원은 회사 전체·자동 메일 못 봄');
  const mine = await ctx.owner.ok('GET', '/api/mail/outbox');
  assert.deepEqual(subjects(mine), ['견적서 Q-997', '시험997 실패한 메일', '시험997 자료 보내 드립니다', '시험997 지난달 메일']);
  const all = await ctx.owner.ok('GET', '/api/mail/outbox?scope=all');
  assert.equal(all.items.length, 7); assert.ok(!all.items.some((x) => x.kind === 'system'));
  const sys = await ctx.owner.ok('GET', '/api/mail/outbox?scope=all&system=1');
  assert.equal(sys.items.length, 8); assert.equal(sys.items.find((x) => x.kind === 'system')?.subject, '시험997 오늘 입찰 공고');
  assert.ok(!sys.items.some((x) => x.subject === '시험997 다른 회사'));
});

test('목록 칸: 받는 사람 n·보낸 방식·연결 업무·첨부·상태(보냄·예약·실패)·종류', async () => {
  const all = await ctx.owner.ok('GET', '/api/mail/outbox?scope=all');
  const by = Object.fromEntries(all.items.map((x) => [x.id, x]));
  const m = by[ids.ownerMail];
  assert.deepEqual([m.toCount, m.to[0], m.via, m.files, m.status, m.kind, m.task?.title], [2, 'a997@x.com', '워크인 메일', 1, 'sent', 'mail', '시험997 견적 보내기 업무']);
  assert.deepEqual([by[ids.ownerFailed].status, by[ids.ownerFailed].via, by[ids.ownerFailed].error], ['failed', '회사 메일 계정', '받는 주소 없음(550)']);
  assert.deepEqual([by[ids.staffScheduled].status, by[ids.staffScheduled].sender, by[ids.staffScheduled].mine], ['scheduled', '이직원', false]);
  assert.deepEqual([by[ids.staffSms].kind, by[ids.staffSms].via], ['sms', '휴대폰 문자']);
  assert.deepEqual([by[ids.staffAi].kind, by[ids.ownerQuote].kind, by[ids.ownerQuote].via], ['ai', 'quote', '견적서(메일)']);
  assert.equal(all.items[0].subject === '시험997 지난달 메일', false, '최근 것부터');
});

test('거름: 상태·종류·검색(받는 사람·제목·업무 이름)·기간', async () => {
  const g = (qs) => ctx.owner.ok('GET', `/api/mail/outbox?scope=all&${qs}`).then((r) => r.items.map((x) => x.id));
  assert.deepEqual(await g('status=failed'), [ids.ownerFailed]);
  assert.deepEqual(await g('status=scheduled'), [ids.staffScheduled]);
  assert.deepEqual(await g('kind=quote'), [ids.ownerQuote]);
  assert.deepEqual(await g('kind=ai'), [ids.staffAi]);
  assert.deepEqual(await g(`q=${encodeURIComponent('b997@x.com')}`), [ids.ownerMail], '받는 사람으로');
  assert.deepEqual((await g(`q=${encodeURIComponent('견적 보내기 업무')}`)).sort(), [ids.ownerMail, ids.staffSms].sort(), '업무 이름으로');
  assert.deepEqual(await g(`q=${encodeURIComponent('지난달')}`), [ids.oldMail], '제목으로');
  assert.ok(!(await g(`from=${addDays(today, -7)}`)).includes(ids.oldMail), '기간 밖은 뺌');
  assert.deepEqual(await g(`from=${addDays(today, -41)}&to=${addDays(today, -39)}`), [ids.oldMail]);
  const bad = await ctx.owner.req('GET', '/api/mail/outbox?status=nope'); assert.equal(bad.status, 400);
});

test('상세: 본문 전체·받는 사람 전체·첨부·할 수 있는 일 · 남의 줄은 직원에게 404 · 다른 회사 404', async () => {
  const d = await ctx.owner.ok('GET', `/api/mail/outbox/${ids.ownerMail}`);
  assert.deepEqual([d.to, d.body, d.files[0].name, d.task.title], [['a997@x.com', 'b997@x.com'], '안녕하세요.\n자료 보내 드립니다.', '자료.pdf', '시험997 견적 보내기 업무']);
  assert.deepEqual(d.can, { retry: false, reschedule: false, resend: true });
  assert.equal((await ctx.owner.ok('GET', `/api/mail/outbox/${ids.ownerFailed}`)).can.retry, true, '실패 메일은 다시 보내기');
  assert.equal((await ctx.owner.ok('GET', `/api/mail/outbox/${ids.staffScheduled}`)).can.reschedule, true, '대표는 직원 예약도 바꿈');
  const own = await ctx.staffA.client.ok('GET', `/api/mail/outbox/${ids.staffScheduled}`); assert.equal(own.can.reschedule, true);
  assert.equal((await ctx.staffA.client.req('GET', `/api/mail/outbox/${ids.ownerMail}`)).status, 404, '남이 보낸 줄');
  assert.equal((await ctx.staffA.client.req('GET', `/api/mail/outbox/${ids.system}`)).status, 404);
  assert.equal((await ctx.owner.req('GET', `/api/mail/outbox/${ids.otherTenant}`)).status, 404, '다른 회사');
  assert.equal((await ctx.owner.req('GET', '/api/mail/outbox/not-a-uuid')).status, 404);
  // 예약 취소는 기존 주소 그대로 — 취소하면 목록 상태 '취소됨'
  await ctx.staffA.client.ok('POST', `/api/mail/outbox/${ids.staffScheduled}/schedule`, { cancel: true });
  assert.equal((await ctx.staffA.client.ok('GET', '/api/mail/outbox?status=canceled')).items[0]?.id, ids.staffScheduled);
});
