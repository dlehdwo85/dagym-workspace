// 348차(대표 11/03 02:42 휴대폰: '아름베스트빌이 있는데 검색해도 안 나옴 — 제목·설명·댓글 등 이름이 있으면 뜨게 · 아름까지만 검색해도 풀네임 다 보이게'):
// 업무 검색(q)은 제목·설명·태그 + 댓글·체크리스트·첨부 이름·하위 업무·원천 이름까지 보고, 완료 업무도(includeDone=0 이어도) 찾으며, 줄마다 어디에 맞았는지(match.in)와 낱말이 잘리지 않은 둘레 글(match.text)을 준다
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, bootstrap, resetDb, seoulToday, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql; const P = {};
const mk = (body) => ctx.owner.ok('POST', '/api/tasks', { orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.ownerId, dueDate: addDays(seoulToday(), 7), ...body });
const search = async (q, extra = '') => (await ctx.owner.ok('GET', `/api/tasks?q=${encodeURIComponent(q)}${extra}`)).tasks;
const byId = (rows, id) => rows.find((t) => t.id === id);

before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  P.desc = (await mk({ title: '[문의] 하이링크 플랫폼 문의 — 부산', description: '> AI 요약: 부산 아름베스트빌6차 관리사무소, 주차 자동입출차·식당 출입 통제 도입 및 운영 수수료 문의\n\n| 항목 | 내용 |\n|---|---|\n| 회사/단지명 | 아름베스트빌6차아파트 |\n| 지역 | 부산 |' })).id;
  P.comment = (await mk({ title: '현장 방문 준비' })).id; await ctx.owner.ok('POST', `/api/tasks/${P.comment}/comments`, { body: '아름베스트빌 관리소장님과 11/5 통화 예정' });
  P.check = (await mk({ title: '제안서 작성' })).id; await ctx.owner.ok('POST', `/api/tasks/${P.check}/checklist`, { text: '아름베스트빌6차 견적 보내기' });
  P.done = (await mk({ title: '아름베스트빌 1차 미팅' })).id; await ctx.owner.ok('PATCH', `/api/tasks/${P.done}`, { status: 'done' });
  P.parent = (await mk({ title: '부산 영업 묶음' })).id; await mk({ title: '아름베스트빌 현장 실측', parentId: P.parent });
  P.attach = (await mk({ title: '자료 정리' })).id;
  await sql`insert into attachments (task_id, kind, file_name, mime_type, size_bytes, created_by) values (${P.attach}, 'file', '아름베스트빌_평면도.pdf', 'application/pdf', 10, ${ctx.ownerId})`;
  P.other = (await mk({ title: '다른 단지 상담', description: '해운대 센텀 상담' })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('q=아름 → 설명·댓글·체크리스트·첨부 이름·하위 업무 제목에 있는 업무까지 모두 나오고 다른 업무는 안 나옴 · 완료 업무도 includeDone=0 이어도 나옴(맨 아래)', async () => {
  const rows = await search('아름', '&includeDone=0');
  for (const k of ['desc', 'comment', 'check', 'done', 'parent', 'attach']) assert.ok(byId(rows, P[k]), `${k} 가 검색 결과에 있어야 함 (${rows.map((t) => t.title).join(', ')})`);
  assert.equal(byId(rows, P.other), undefined, '다른 단지는 안 나옴');
  assert.equal(rows[rows.length - 1].id, P.done, '완료 업무는 맨 아래');
});

test('match: 어디에 맞았는지 + 낱말이 잘리지 않은 둘레 글(아름 → 아름베스트빌6차아파트) · 제목 일치는 글 없음', async () => {
  const rows = await search('아름');
  assert.deepEqual(byId(rows, P.done).match, { in: '제목', text: null });
  const d = byId(rows, P.desc).match; assert.equal(d.in, '설명'); assert.match(d.text, /아름베스트빌6차 관리사무소/); assert.ok(!/[|>]/.test(d.text), `표 기호는 뺌: ${d.text}`);
  const c = byId(rows, P.comment).match; assert.equal(c.in, '댓글'); assert.match(c.text, /아름베스트빌 관리소장님/);
  const k = byId(rows, P.check).match; assert.equal(k.in, '체크리스트'); assert.match(k.text, /아름베스트빌6차 견적 보내기/);
  const a = byId(rows, P.attach).match; assert.equal(a.in, '첨부'); assert.match(a.text, /아름베스트빌_평면도\.pdf/);
  const s = byId(rows, P.parent).match; assert.equal(s.in, '하위 업무'); assert.match(s.text, /아름베스트빌 현장 실측/);
  // 뒤쪽 낱말 전체: '6차아파트' 로 찾아도 앞 '아름베스트빌' 까지 붙어 나옴
  const rows2 = await search('6차아파트'); const m = byId(rows2, P.desc).match; assert.match(m.text, /아름베스트빌6차아파트/);
  // 검색어 없으면 match 없음
  const plain = (await ctx.owner.ok('GET', '/api/tasks')).tasks; assert.equal(byId(plain, P.desc).match, undefined);
});

test('보기 건수(counts)도 같은 검색 범위 · 다른 회사 직원은 못 봄(권한 그대로)', async () => {
  const c = await ctx.owner.ok('GET', '/api/tasks/counts?q=아름');
  assert.ok(c.counts.requested >= 1, JSON.stringify(c.counts));
  const b = (await ctx.staffB.client.ok('GET', '/api/tasks?q=아름')).tasks;
  assert.equal(b.find((t) => t.id === P.desc), undefined, '다른 지점 직원에게는 안 보임');
});
