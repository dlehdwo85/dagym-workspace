// 273차 #811 1) 앱 화면 녹화(대표 10/29 'AI 영상 비용 최소화'): 자료실 '마케팅/화면 녹화' 영상(로컬 PC 녹화 실행기가 올림)에 자막·끝 화면·배경음을 붙여 릴스·쇼츠로 — 생성 비용 0
// (구조 시험 — 실제 녹화 실행기·운영 합성 시간은 로컬·운영 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake; const P = {};
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const FF = [process.env.FFMPEG_PATH, join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg')].find((x) => x && existsSync(x)) ?? 'ffmpeg';
/** 녹화 실행기가 만드는 꼴(1080×1920 mp4, 소리 없음) */
function clip(sec) {
  const out = join(tmpdir(), `rec-${process.pid}-${sec}.mp4`);
  const r = spawnSync(FF, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=1080x1920:rate=30:duration=${sec}`, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', out]);
  assert.equal(r.status, 0, String(r.stderr)); const b = readFileSync(out); rmSync(out, { force: true }); return b;
}
async function upload(name, data, extra = {}) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'video/mp4', size: data.length, folder: '마케팅/화면 녹화', space: 'marketing', tags: ['다짐', '화면 녹화'], ...extra });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: data }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
async function probe(fileId) {
  const [f] = await sql`select storage_key from library_files where id = ${fileId}`;
  const r = spawnSync(FF, ['-hide_banner', '-i', join(tmpdir(), 'workos-test', 'uploads', f.storage_key)], { encoding: 'utf8' });
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr); const v = /Video:[^\n]*?(\d{3,4})x(\d{3,4})/.exec(r.stderr);
  return { duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : null, w: v ? +v[1] : null, h: v ? +v[2] : null };
}
async function content(kind) {
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, status, current_version, created_by)
    values ('default', ${P.brand}, ${`다짐 ${kind} 녹화 시험`}, 'instagram', ${kind}, 'pending', 1, ${ctx.ownerId}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, created_by) values (${c.id}, 1, ${'아침 7시에 문을 엽니다.\n상담은 전화로 받습니다.'}, ${[]}, ${ctx.ownerId})`;
  return c.id;
}

before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { headline: '오늘도 다짐' }, facts: { phone: '1600-5678' } });
  P.rec1 = await upload('다짐_업무_녹화.mp4', clip(6) /* 6초 = 장면 2개(2.5초마다 한 장면) */, { title: '다짐 업무 화면 녹화', description: '업무를 휴대폰에서 바로\n마감 알림까지 한 번에' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('승인함 [녹화 파일로 영상 만들기]: 목록(이 브랜드·안 씀·자막 줄) → 고르면 녹화에 자막(파일 설명 줄)·끝 화면 전화 → 새 판 · 생성 비용 0 · 관리자만 · 다시 보면 쓴 적 있음', async () => {
  const id = await content('reels');
  assert.ok([403, 404].includes((await ctx.staffA.client.req('GET', `/api/marketing/studio/screen?contentId=${id}`)).status), '관리자만');
  assert.equal((await ctx.owner.req('GET', '/api/marketing/studio/screen?contentId=x')).status, 404);
  const l = await ctx.owner.ok('GET', `/api/marketing/studio/screen?contentId=${id}`);
  assert.deepEqual(l.files.map((f) => [f.id, f.mine, f.used, f.lines]), [[P.rec1, true, false, 2]]);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/studio/screen', { contentId: await content('feed'), fileId: P.rec1 })).status, 400, '피드 글은 안 됨');
  const r = await ctx.owner.ok('POST', '/api/marketing/studio/screen', { contentId: id, fileId: P.rec1 });
  assert.equal(r.lines, 2);
  const [b] = await sql`select status, est_credits, result from mkt_briefs where id = ${r.briefId}`;
  assert.equal(b.status, 'review', JSON.stringify(b.result?.variants?.[0]?.renderError ?? b.result?.errors));
  assert.equal(Number(b.est_credits), 0);
  assert.deepEqual(b.result.variants[0].scenes.map((s) => s.line), ['업무를 휴대폰에서 바로', '마감 알림까지 한 번에'], '자막 = 파일 설명 줄');
  const [v] = await sql`select media_ids, note from mkt_versions where content_id = ${id} and version = 2`;
  assert.match(v.note, /^앱 화면 녹화로 만든 영상\(생성 비용 0\) · 자막·끝 화면 전화/);
  const p = await probe(v.media_ids[0]); assert.deepEqual([p.w, p.h], [1080, 1920]); assert.ok(p.duration > 6 && p.duration < 10, `길이 ${p.duration}`);
  const [lf] = await sql`select file_name, tags from library_files where id = ${v.media_ids[0]}`;
  assert.match(lf.file_name, /\(화면 녹화\)\.mp4$/); assert.ok(lf.tags.includes('화면 녹화') && !lf.tags.includes('AI 생성'), lf.tags.join(','));
  assert.equal((await sql`select count(*)::int n from mkt_credit_ledger where content_id = ${id}`)[0].n, 0, '생성 비용 없음');
  assert.deepEqual((await ctx.owner.ok('GET', `/api/marketing/studio/screen?contentId=${id}`)).files.map((f) => f.used), [true], '쓴 적 있음');
});

test('자동 제작: 브랜드 영상 방법 = 앱 화면 녹화 → 이 브랜드의 안 쓴 녹화로 원고 판(v1)에 영상 · 제작 요청 카드는 대신함 · 안 쓴 녹화가 없으면 카드(예상 0)와 판 메모에 이유', async () => {
  const rec2 = await upload('다짐_캘린더_녹화.mp4', clip(3), { title: '다짐 캘린더 화면 녹화', description: '팀 일정을 같은 달력에서' });
  await upload('워크인_녹화.mp4', clip(3), { title: '워크인 녹화', tags: ['워크인', '화면 녹화'] }); // 다른 브랜드 — 안 씀
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { video: { method: 'screen' } });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { videoPause: false, leadDays: 3, quietStart: 0, quietEnd: 0 });
  const r = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'shorts', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '12:00', topicHint: '아침 운동' });
  const slots = await sql`select id from mkt_contents where rule_id = ${r.id} order by scheduled_at`;
  const only = async (id) => { await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${r.id} and produced_at is null`; await sql`update mkt_contents set produce_at = now() - interval '1 minute' where id = ${id}`; };
  const draft = say({ title: '아침 운동은 다짐에서', body: '아침 7시, 문을 엽니다.\n상담은 전화로 편하게 받습니다.', brief: '앱 화면', script: ['아침 7시 문 여는 다짐', '상담은 전화로'] });
  await only(slots[0].id); await ctl({ anthropicReset: true, anthropicQueue: [draft, draft] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const [c] = await sql`select current_version, quality, status from mkt_contents where id = ${slots[0].id}`;
  assert.equal(c.current_version, 1);
  const [v] = await sql`select media_ids, note from mkt_versions where content_id = ${slots[0].id} and version = 1`;
  assert.equal(v.media_ids.length, 1, v.note); assert.match(v.note, / · 앱 화면 녹화로 만든 영상\(생성 비용 0\)/);
  const [b] = await sql`select result from mkt_briefs where content_id = ${slots[0].id}`;
  assert.equal(b.result.reuse.fileId, rec2, '이 브랜드의 안 쓴 녹화');
  const [q] = await sql`select status, brief from mkt_production_requests where content_id = ${slots[0].id} and kind = 'video'`;
  assert.equal(q.status, 'done'); assert.match(q.brief, /화면 녹화 영상으로 대신함\(생성 비용 0\)$/);
  // 안 쓴 녹화가 없으면: 카드(예상 0·녹화 안내) 그대로 + 판 메모에 이유
  await only(slots[1].id); await ctl({ anthropicReset: true, anthropicQueue: [draft, draft] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const [q2] = await sql`select status, brief, est_credits from mkt_production_requests where content_id = ${slots[1].id} and kind = 'video'`;
  assert.ok(['open', 'needs_approval'].includes(q2.status)); assert.equal(Number(q2.est_credits), 0); assert.match(q2.brief, /^앱 화면 녹화로 만듭니다/);
  const [v2] = await sql`select media_ids, note from mkt_versions where content_id = ${slots[1].id} and version = 1`;
  assert.equal(v2.media_ids.length, 0); assert.match(v2.note, /화면 녹화 영상 못 만듦: 이 브랜드의 안 쓴 화면 녹화 없음/);
  await sql`update mkt_rules set active = false where id = ${r.id}`;
});
