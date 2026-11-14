// 415차(범용화 S-06): 자동화 규칙·캘린더의 회사 표시
// 전에는 ① 새 규칙을 회사 없이 저장 → 칸 기본값 'default'(기본 회사)로 들어감
//        ② 실행할 때 회사 조건이 없어 '회사 전체 규칙'(조직·프로젝트 없음)이 모든 회사 업무에 실행(담당자 변경·후속 업무·알림)
//        ③ 다른 회사 관리자가 규칙 id 로 고치거나 지울 수 있었음
// 이제: 규칙은 만든 회사 것으로 저장되고, 그 회사 업무에만 실행되며, 목록·고치기·지우기는 같은 회사만(다른 회사 규칙은 404), 규칙이 가리키는 사람도 같은 회사만.
// 기본 회사: 회사 전체 규칙이 기본 회사 업무에 예전처럼 실행된다.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, other, RD, RO;
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@auto-1026.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@auto-1026.test', password: 'signup-pass-1234', name: '새대표', mode: 'team', company: '다른회사', industry: '기타', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  other = { c, tenant: me.user.tenant, id: me.user.id, unit: me.orgUnits[0].id };
  assert.ok(other.tenant && other.tenant !== 'default');
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('415차 자동화 규칙은 만든 회사 업무에만', () => {
  test('저장: 회사 전체 규칙이 만든 회사 것으로 저장되고, 목록에는 자기 회사 규칙만', async () => {
    RD = (await ctx.owner.ok('POST', '/api/automations', { name: '기본회사 전체 규칙', trigger: 'task_created', actions: [{ type: 'set_priority', priority: 'urgent' }] })).id;
    RO = (await other.c.ok('POST', '/api/automations', { name: '다른회사 전체 규칙', trigger: 'task_created', actions: [{ type: 'set_assignee', userId: other.id }, { type: 'create_follow_up', title: '다른회사 후속 업무' }] })).id;
    const rows = Object.fromEntries((await sql`select id, tenant from automation_rules`).map((x) => [x.id, x.tenant]));
    assert.deepEqual([rows[RD], rows[RO]], ['default', other.tenant]);
    assert.deepEqual((await ctx.owner.ok('GET', '/api/automations')).rules.map((x) => x.name), ['기본회사 전체 규칙']);
    assert.deepEqual((await other.c.ok('GET', '/api/automations')).rules.map((x) => x.name), ['다른회사 전체 규칙']);
  });

  test('실행: 기본 회사 업무에는 기본 회사 규칙만, 다른 회사 업무에는 그 회사 규칙만', async () => {
    const d = await ctx.owner.ok('POST', '/api/tasks', { title: '기본회사 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id });
    const [td] = await sql`select priority, assignee_id from tasks where id = ${d.id}`;
    assert.deepEqual([td.priority, td.assignee_id], ['urgent', ctx.staffA.id], '기본 회사 규칙은 그대로 실행 · 다른 회사 규칙이 담당자를 바꾸지 않음');
    const o = await other.c.ok('POST', '/api/tasks', { title: '다른회사 업무', orgUnitId: other.unit });
    const [to] = await sql`select priority, assignee_id from tasks where id = ${o.id}`;
    assert.deepEqual([to.priority, to.assignee_id], ['normal', other.id], '다른 회사 업무에 기본 회사 규칙(긴급)이 실행되지 않음 · 자기 회사 규칙은 실행');
    // 후속 업무는 다른 회사 업무에만 1건 — 기본 회사 업무에는 안 생김
    const follow = await sql`select t.title, d.depends_on_id from tasks t join task_dependencies d on d.task_id = t.id where t.title = '다른회사 후속 업무'`;
    assert.deepEqual(follow.map((x) => x.depends_on_id), [o.id]);
    const runs = await sql`select rule_id, task_id, status from automation_runs order by id`;
    assert.deepEqual(runs.map((x) => [x.rule_id, x.task_id, x.status]), [[RD, d.id, 'ok'], [RO, o.id, 'ok']]);
    // 다른 회사 사람에게 기본 회사 업무 알림이 가지 않았다
    const [n] = await sql`select count(*)::int as n from notifications where user_id = ${other.id} and entity_id = ${d.id}`;
    assert.equal(n.n, 0);
  });

  test('고치기·지우기: 다른 회사 규칙은 없는 것처럼 404 · 규칙이 가리키는 사람은 같은 회사만', async () => {
    const patch = { name: '바꿈', trigger: 'task_created', actions: [{ type: 'set_priority', priority: 'low' }] };
    assert.equal((await other.c.req('PATCH', `/api/automations/${RD}`, patch)).status, 404);
    assert.equal((await other.c.req('DELETE', `/api/automations/${RD}`)).status, 404);
    assert.equal((await ctx.owner.req('PATCH', `/api/automations/${RO}`, patch)).status, 404);
    assert.equal((await ctx.owner.req('DELETE', `/api/automations/${RO}`)).status, 404);
    assert.deepEqual((await sql`select name from automation_rules order by name`).map((x) => x.name), ['기본회사 전체 규칙', '다른회사 전체 규칙'], '아무것도 안 바뀜');
    // 다른 회사 사람을 담당자·알림 대상으로 지정할 수 없다
    assert.equal((await other.c.req('POST', '/api/automations', { name: 'x', trigger: 'task_created', actions: [{ type: 'set_assignee', userId: ctx.staffA.id }] })).status, 400);
    assert.equal((await ctx.owner.req('POST', '/api/automations', { name: 'x', trigger: 'task_created', actions: [{ type: 'notify', to: 'user', userId: other.id }] })).status, 400);
    // 자기 회사 규칙은 고치고 지울 수 있다
    await ctx.owner.ok('PATCH', `/api/automations/${RD}`, { ...patch, name: '기본회사 전체 규칙' });
    await other.c.ok('DELETE', `/api/automations/${RO}`);
  });

  test('기존 행 바로잡기(259): 회사 없이 저장돼 default 로 들어간 규칙·캘린더가 실제 회사로', async () => {
    // 예전 방식으로 저장된 행을 흉내: 다른 회사가 만든 회사 전체 규칙·조직 규칙·개인 캘린더가 'default'
    const [w] = await sql`insert into automation_rules (name, trigger, conditions, actions, created_by, tenant) values ('옛 전체 규칙', 'task_created', ${sql.json({})}, ${sql.json([{ type: 'set_priority', priority: 'high' }])}, ${other.id}, 'default') returning id`;
    const [s] = await sql`insert into automation_rules (name, org_unit_id, trigger, conditions, actions, created_by, tenant) values ('옛 조직 규칙', ${other.unit}, 'task_created', ${sql.json({})}, ${sql.json([{ type: 'set_priority', priority: 'low' }])}, ${other.id}, 'default') returning id`;
    await other.c.ok('GET', '/api/calendars'); // 개인 캘린더 만들기(새 코드는 회사 명시)
    const [pc] = await sql`select id, tenant from calendars where type = 'personal' and owner_user_id = ${other.id}`;
    assert.equal(pc.tenant, other.tenant, '새로 만드는 개인 캘린더는 주인의 회사');
    await sql`update calendars set tenant = 'default' where id = ${pc.id}`; // 옛 행처럼
    const baseRules = async () => (await sql`select id, tenant from automation_rules where created_by in (select id from users where tenant = 'default') order by id`).map((x) => [x.id, x.tenant]);
    const before = await baseRules();
    await sql.unsafe(readFileSync(new URL('../../db/migrations/259_rule_calendar_tenant.sql', import.meta.url), 'utf8'));
    const t = Object.fromEntries((await sql`select id, tenant from automation_rules where id = any(${[w.id, s.id]}::uuid[])`).map((x) => [x.id, x.tenant]));
    assert.deepEqual([t[w.id], t[s.id]], [other.tenant, other.tenant]);
    assert.equal((await sql`select tenant from calendars where id = ${pc.id}`)[0].tenant, other.tenant);
    assert.deepEqual(await baseRules(), before, '기본 회사 규칙은 그대로'); assert.ok(before.length >= 1 && before.every((x) => x[1] === 'default'));
    const [cnt] = await sql`select count(*)::int as n from calendars c join users u on u.id = c.owner_user_id where c.type = 'personal' and c.tenant <> u.tenant`;
    assert.equal(cnt.n, 0);
    // 바로잡힌 옛 전체 규칙은 이제 그 회사 업무에만 실행(기본 회사 업무에는 안 됨)
    const d2 = await ctx.owner.ok('POST', '/api/tasks', { title: '기본회사 업무 2', orgUnitId: ctx.siteA });
    assert.equal((await sql`select priority from tasks where id = ${d2.id}`)[0].priority, 'low', '기본 회사 규칙(위에서 낮음으로 고침)만 실행');
  });
});
