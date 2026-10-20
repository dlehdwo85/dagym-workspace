// 대표 10/20 22:30 ②(M1) 서버 게시 실행기 — 가짜 Meta Graph·Threads·Google 서버(구조 시험, 실연동 완료 아님):
// 연결(메타·스레드·유튜브) → 승인된 최신 버전 [서버로 게시] → 인스타 컨테이너→게시→permalink, 페이스북, 스레드, 유튜브 재개 업로드 → 콘텐츠 게시됨 · 실패 재시도·알림 · 확인 중(중복 금지) · 자동 게시(예정 시각) · 시험 콘텐츠 409 · 직원 403
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3227;
let srv, ctx, sql, fake, calls = [], seq = 0, failPublish = false, hangPublish = false, recent = [];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const p = u.pathname; const qs = Object.fromEntries(u.searchParams);
    const send = (code, j, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
    calls.push({ method: req.method, path: p, q: qs, body });
    // Meta OAuth(기존 연결 흐름)
    if (p === '/graph/oauth/access_token') return send(200, { access_token: qs.grant_type ? 'meta-long' : 'meta-short' });
    if (p === '/graph/me') return send(200, { id: 'fb-user-77' });
    if (p === '/graph/me/permissions') return send(200, { data: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'instagram_basic', 'instagram_content_publish', 'business_management'].map((permission) => ({ permission, status: 'granted' })) });
    if (p === '/graph/me/accounts') return send(200, { data: [{ id: 'page-1', name: '다짐 본점', access_token: 'page-token-1', tasks: ['MANAGE', 'CREATE_CONTENT'], instagram_business_account: { id: 'ig-1', username: 'dagym_main' } }] });
    // 인스타: 컨테이너 → 상태 → 게시 → permalink / 최근 게시물(확인용)
    if (req.method === 'POST' && p === '/graph/ig-1/media') { if (qs.access_token !== 'page-token-1') return send(400, { error: { message: 'Invalid OAuth access token', code: 190 } }); return send(200, { id: `ctn-${++seq}` }); }
    if (req.method === 'GET' && /^\/graph\/ctn-\d+$/.test(p)) return send(200, { status_code: 'FINISHED' });
    if (req.method === 'POST' && p === '/graph/ig-1/media_publish') { if (failPublish) return send(400, { error: { message: 'The media is not ready', code: 9007 } }); if (hangPublish) return send(500, { error: { message: 'An unknown error occurred', code: 1 } }); const id = `igpost-${++seq}`; recent.push({ id, caption: calls.find((c) => c.path === '/graph/ig-1/media' && c.q.caption)?.q.caption ?? '', permalink: `https://www.instagram.com/p/${id}/` }); return send(200, { id }); }
    if (req.method === 'GET' && p === '/graph/ig-1/media') return send(200, { data: recent });
    if (req.method === 'GET' && /^\/graph\/igpost-\d+$/.test(p)) return send(200, { permalink: `https://www.instagram.com/p/${p.split('/').pop()}/` });
    // 페이스북 페이지
    if (req.method === 'POST' && p === '/graph/page-1/photos') return send(200, { id: `ph-${++seq}`, post_id: `page-1_${seq}` });
    if (req.method === 'POST' && p === '/graph/page-1/feed') return send(200, { id: `page-1_${++seq}` });
    if (req.method === 'POST' && p === '/graph/page-1/videos') return send(200, { id: `page-1_${++seq}` }); // 로컬 02:10: 릴스 → 페북 영상(+thumb)
    if (req.method === 'GET' && /^\/graph\/page-1_\d+$/.test(p)) return send(200, { permalink_url: `https://www.facebook.com/${p.split('/').pop()}` });
    // 스레드 OAuth + 게시
    if (p === '/threads/oauth/access_token') return send(200, { access_token: 'th-short', user_id: 'th-9' });
    if (p === '/threads/access_token') return send(200, { access_token: 'th-long', expires_in: 5184000 });
    if (p === '/threads/v1.0/me') return send(200, { id: 'th-9', username: 'dagym_threads' });
    if (req.method === 'POST' && p === '/threads/th-9/threads') return send(200, { id: `thc-${++seq}` });
    if (req.method === 'GET' && /^\/threads\/thc-\d+$/.test(p)) return send(200, { status: 'FINISHED' });
    if (req.method === 'POST' && p === '/threads/th-9/threads_publish') return send(200, { id: `thpost-${++seq}` });
    if (req.method === 'GET' && /^\/threads\/thpost-\d+$/.test(p)) return send(200, { permalink: `https://www.threads.net/@dagym_threads/post/${p.split('/').pop()}` });
    // 구글 OAuth + 유튜브
    if (p === '/goauth/token') { const b = Object.fromEntries(new URLSearchParams(body)); return send(200, { access_token: `yt-access-${++seq}`, refresh_token: b.grant_type === 'authorization_code' ? 'yt-refresh' : undefined, expires_in: 3600, scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' }); }
    if (p === '/yt/channels') return send(200, { items: [{ id: 'UC-dagym', snippet: { title: '다짐 TV' } }] });
    if (req.method === 'POST' && p === '/ytupload/videos') return send(200, {}, { location: `http://localhost:${PORT}/ytupload/session-${++seq}` });
    if (req.method === 'PUT' && p.startsWith('/ytupload/session-')) return send(200, { id: `vid-${++seq}` });
    send(404, { error: { message: `nope ${req.method} ${p}` } });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}`, META_APP_ID: 'app-1', META_APP_SECRET: 'app-secret', THREADS_APP_ID: 'th-app', THREADS_APP_SECRET: 'th-secret', YT_CLIENT_ID: 'yt-client', YT_CLIENT_SECRET: 'yt-secret' });
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

async function upload(name, mime, bytes) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: bytes.length, folder: '마케팅' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: bytes });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}
async function approved(over = {}) {
  const { id } = await ctx.owner.ok('POST', '/api/marketing/contents', { title: over.title ?? '가을 행사', channel: over.channel ?? 'instagram', kind: over.kind, scheduledAt: over.scheduledAt ?? new Date(Date.now() + 36e5).toISOString(), body: over.body ?? '가을 이벤트 안내 — 첫 상담 무료', mediaIds: over.mediaIds ?? [] });
  if (over.crossChannels) await sql`update mkt_contents set cross_channels = ${over.crossChannels} where id = ${id}`;
  if (over.kind) await sql`update mkt_contents set kind = ${over.kind} where id = ${id}`; // 콘텐츠 만들기 API 는 종류를 받지 않음(규칙·의뢰에서 정함)
  if (over.isTest) await sql`update mkt_contents set is_test = true where id = ${id}`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${id}/decide`, { version: 1, decision: 'approve' });
  return id;
}
const connect = async (provider, cbQuery) => { const go = new URL((await ctx.owner.get(`/api/marketing/publish/connect/${provider}`)).headers.get('location')); const cb = await ctx.owner.get(`/api/marketing/publish/callback/${provider}?code=c1&state=${go.searchParams.get('state')}${cbQuery ?? ''}`); return { go, loc: cb.headers.get('location') }; };
const P = {};

test('연결: 메타(기존) + 스레드(Threads OAuth·장기 토큰·@username) + 유튜브(별도 클라이언트·refresh·채널) → 채널 모드 자동 게시 · 토큰 비노출', async () => {
  await connect('meta');
  const th = await connect('threads');
  assert.match(th.go.pathname, /threadsauth/); assert.equal(th.go.searchParams.get('scope'), 'threads_basic,threads_content_publish'); assert.match(th.loc, /published=threads/);
  const yt = await connect('youtube');
  assert.match(yt.go.pathname, /goauth\/auth/); assert.match(yt.go.searchParams.get('scope'), /youtube\.upload/); assert.equal(yt.go.searchParams.get('access_type'), 'offline'); assert.match(yt.loc, /published=youtube/);
  const accs = await sql`select provider, external_id, label, token_enc, refresh_enc, expires_at from mkt_publish_accounts order by provider`;
  assert.deepEqual(accs.map((a) => [a.provider, a.external_id, a.label]), [['meta_fb', 'page-1', '다짐 본점'], ['meta_ig', 'ig-1', '@dagym_main'], ['meta_threads', 'th-9', '@dagym_threads'], ['youtube', 'UC-dagym', '다짐 TV']]);
  assert.ok(accs.every((a) => a.token_enc.startsWith('v1.')) && accs.find((a) => a.provider === 'youtube').refresh_enc.startsWith('v1.') && accs.find((a) => a.provider === 'meta_threads').expires_at, '토큰·refresh 암호화·만료');
  await ctx.owner.ok('PUT', '/api/marketing/publish/channels', { channel: 'threads', enabled: true });
  await ctx.owner.ok('PUT', '/api/marketing/publish/channels', { channel: 'youtube', enabled: true });
  const ch = await ctx.owner.ok('GET', '/api/marketing/publish/channels');
  assert.deepEqual(['instagram', 'facebook', 'threads', 'youtube'].map((k) => ch.channels.find((c) => c.key === k).mode), ['auto', 'auto', 'auto', 'auto'], 'M1: 연결되면 서버 게시');
  assert.ok(!JSON.stringify(ch).includes('th-long') && !JSON.stringify(ch).includes('yt-refresh'), '토큰 비노출');
  const home = await ctx.owner.ok('GET', '/api/marketing/home');
  assert.equal(home.channels.find((c) => c.key === 'youtube').state, 'connected');
});

test('인스타 1장 [지금 게시] → 컨테이너·게시·permalink → 콘텐츠 게시됨 · 같은 버전 두 번 안 올림 · 직원 403 · 시험 409 · 승인 전 409', async () => {
  P.img = await upload('시안.png', 'image/png', Buffer.from('png-bytes'));
  P.img2 = await upload('시안2.png', 'image/png', Buffer.from('png-bytes-2'));
  const id = await approved({ mediaIds: [P.img] });
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.equal(d.publish.canServer, true); assert.deepEqual(d.publish.targets.map((t) => [t.channel, t.accounts.map((a) => a.label)]), [['instagram', ['@dagym_main']]]);
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/contents/${id}/publish/server`, {})).status, 403);
  calls = [];
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/publish/server`, {});
  assert.equal(r.jobs.length, 1); assert.equal(r.ran[0].status, 'done', JSON.stringify(r.ran));
  assert.match(r.ran[0].permalink, /instagram\.com\/p\/igpost-/);
  const media = calls.find((c) => c.path === '/graph/ig-1/media');
  assert.ok(media.q.image_url.includes('/api/files/local') || media.q.image_url.startsWith('http'), '시안 공개 주소'); assert.equal(media.q.caption, '가을 이벤트 안내 — 첫 상담 무료');
  assert.deepEqual(calls.filter((c) => c.path.startsWith('/graph/ig-1')).map((c) => c.path), ['/graph/ig-1/media', '/graph/ig-1/media_publish'], '컨테이너 → 게시 순서');
  const d2 = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.equal(d2.content.status, 'published'); assert.match(d2.content.published_url, /igpost-/);
  assert.deepEqual(d2.publishJobs.map((j) => [j.provider, j.status, j.account]), [['meta_ig', 'done', '@dagym_main']]);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${id}/publish/server`, {})).status, 409, '게시된 글은 다시 못 올림');
  assert.equal((await sql`select count(*)::int n from notifications where type = 'review_result' and title like '게시 완료%'`)[0].n, 1);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt_publish.queue'`)[0].n, 1);
  const t = await approved({ mediaIds: [P.img], isTest: true, title: '[시험] 글' });
  assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${t}/publish/server`, {})).body.error.code, 'is_test');
  const { id: pend } = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '승인 전', channel: 'instagram', scheduledAt: new Date(Date.now() + 36e5).toISOString(), body: 'x', mediaIds: [P.img] });
  assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${pend}/publish/server`, {})).body.error.code, 'not_approved');
});

test('여러 채널 한 번(인스타 2장 캐러셀 + 페북 + 스레드) → 작업 3건 모두 완료, 첫 성공이 게시 주소', async () => {
  const id = await approved({ mediaIds: [P.img, P.img2], crossChannels: ['facebook', 'threads'], body: '두 장 캐러셀 글' });
  calls = [];
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/publish/server`, {});
  assert.deepEqual(r.ran.map((x) => [x.provider, x.status]).sort(), [['meta_fb', 'done'], ['meta_ig', 'done'], ['meta_threads', 'done']], JSON.stringify(r.ran));
  const ig = calls.filter((c) => c.path === '/graph/ig-1/media');
  assert.equal(ig.length, 3); assert.equal(ig[2].q.media_type, 'CAROUSEL'); assert.equal(ig[2].q.children.split(',').length, 2);
  assert.equal(calls.filter((c) => c.path === '/graph/page-1/photos').length, 2); assert.ok(calls.find((c) => c.path === '/graph/page-1/feed')?.q['attached_media[1]'], '페북 여러 장 = attached_media');
  const thr = calls.filter((c) => c.path === '/threads/th-9/threads'); assert.equal(thr.at(-1).q.media_type, 'CAROUSEL'); assert.equal(thr.at(-1).q.text, '두 장 캐러셀 글');
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${id}`);
  assert.equal(d.content.status, 'published'); assert.equal(d.publishJobs.filter((j) => j.status === 'done').length, 3);
});

test('로컬 02:10: 릴스에 표지 이미지가 섞여 있으면 영상 1개 + 표지(cover_url) — 표지를 사진 게시물로 올리지 않음', async () => {
  const vid = await upload('릴스.mp4', 'video/mp4', Buffer.from('mp4-bytes-reels'));
  const id = await approved({ kind: 'reels', mediaIds: [P.img, vid], body: '표지 + 영상', crossChannels: ['facebook'] });
  calls = [];
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/publish/server`, {});
  assert.deepEqual(r.ran.map((x) => [x.provider, x.status]).sort(), [['meta_fb', 'done'], ['meta_ig', 'done']], JSON.stringify(r.ran));
  const ig = calls.filter((c) => c.path === '/graph/ig-1/media');
  assert.equal(ig.length, 1, '컨테이너 1개(캐러셀·사진 아님)'); assert.equal(ig[0].q.media_type, 'REELS'); assert.ok(ig[0].q.video_url && ig[0].q.cover_url, '영상 + 표지');
  assert.equal(calls.filter((c) => c.path === '/graph/page-1/photos').length, 0, '페북도 사진 게시 안 함');
  const fb = calls.find((c) => c.path === '/graph/page-1/videos'); assert.ok(fb && fb.q.thumb, '페북 영상 + 썸네일');
});

test('유튜브: 영상 재개 업로드(토큰 refresh → 세션 → PUT) → youtu.be 주소 · 영상 없으면 실패(최종)', async () => {
  P.vid = await upload('쇼츠.mp4', 'video/mp4', Buffer.from('mp4-bytes'));
  await sql`update mkt_publish_accounts set expires_at = now() - interval '1 minute' where provider = 'youtube'`; // 만료 → refresh
  const id = await approved({ channel: 'youtube', kind: 'shorts', mediaIds: [P.vid], title: '가을 쇼츠' });
  calls = [];
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/publish/server`, {});
  assert.equal(r.ran[0].status, 'done', JSON.stringify(r.ran)); assert.match(r.ran[0].permalink, /youtu\.be\/vid-/);
  assert.ok(calls.find((c) => c.path === '/goauth/token' && c.body.includes('refresh_token')), 'refresh 로 새 토큰');
  const up = calls.find((c) => c.path === '/ytupload/videos'); assert.ok(up && JSON.parse(up.body).snippet.title.includes('#Shorts'));
  assert.ok(calls.find((c) => c.method === 'PUT' && c.path.startsWith('/ytupload/session-')), '영상 PUT');
  const bad = await approved({ channel: 'youtube', mediaIds: [P.img], title: '영상 없음' });
  const r2 = await ctx.owner.ok('POST', `/api/marketing/contents/${bad}/publish/server`, {});
  assert.equal(r2.ran[0].status, 'failed'); assert.match(r2.ran[0].error, /영상 파일/);
});

test('실패: 일시 오류(5xx) → 재시도 대기(5분) → tick 뒤 성공 / 영구 오류 → 실패 + 알림 + [다시 시도] / 게시 호출이 모호하면 확인 중 → 최근 게시물에서 찾아 완료(중복 안 올림)', async () => {
  // 영구 오류(400)
  failPublish = true;
  const id = await approved({ mediaIds: [P.img], body: '실패할 글' });
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${id}/publish/server`, {});
  assert.equal(r.ran[0].status, 'failed'); assert.match(r.ran[0].error, /not ready/);
  const [j] = await sql`select id, status, attempts from mkt_publish_jobs where content_id = ${id}`;
  assert.deepEqual([j.status, j.attempts], ['failed', 1]);
  assert.equal((await sql`select count(*)::int n from notifications where type = 'sync_error' and title like '게시 실패%' and entity_id = ${j.id} and user_id = ${ctx.ownerId}`)[0].n, 1, '실패 알림');
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/contents/${id}`)).content.status, 'approved', '실패해도 승인 상태 유지');
  failPublish = false;
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/publish/jobs/${j.id}/retry`, {})).status, 403);
  const rt = await ctx.owner.ok('POST', `/api/marketing/publish/jobs/${j.id}/retry`, {});
  assert.equal(rt.ran[0].status, 'done');
  // 모호(500 on media_publish) → 확인 중 → tick 에서 최근 게시물 대조(같은 캡션 없음 → 실패, 재게시 안 함)
  hangPublish = true;
  const id2 = await approved({ mediaIds: [P.img], body: '모호한 글 확인' });
  const r2 = await ctx.owner.ok('POST', `/api/marketing/contents/${id2}/publish/server`, {});
  assert.equal(r2.ran[0].status, 'verify');
  hangPublish = false;
  await sql`update mkt_publish_jobs set run_after = now() where content_id = ${id2}`;
  calls = [];
  await tick();
  const [v] = await sql`select status, last_error from mkt_publish_jobs where content_id = ${id2}`;
  assert.equal(v.status, 'failed'); assert.match(v.last_error, /찾지 못했습니다/);
  assert.equal(calls.filter((c) => c.path === '/graph/ig-1/media_publish').length, 0, '확인 중에는 다시 올리지 않음');
  // 모호 → 최근 게시물에 같은 캡션이 있으면 완료
  recent.push({ id: 'igpost-found', caption: '모호한 글 둘째 — 이미 올라감', permalink: 'https://www.instagram.com/p/igpost-found/' });
  hangPublish = true;
  const id3 = await approved({ mediaIds: [P.img], body: '모호한 글 둘째 — 이미 올라감' });
  await ctx.owner.ok('POST', `/api/marketing/contents/${id3}/publish/server`, {});
  hangPublish = false;
  await sql`update mkt_publish_jobs set run_after = now() where content_id = ${id3}`;
  await tick();
  const d3 = await ctx.owner.ok('GET', `/api/marketing/contents/${id3}`);
  assert.equal(d3.content.status, 'published'); assert.equal(d3.content.published_url, 'https://www.instagram.com/p/igpost-found/');
});

test('자동 게시(회사 설정): 승인된 글이 예정 시각이 되면 tick 이 작업을 만들어 올림 · 꺼진 회사는 안 올림 · [예정 시각에 게시]는 run_after = 예정', async () => {
  const past = new Date(Date.now() - 5 * 60_000).toISOString();
  const off = await approved({ mediaIds: [P.img], scheduledAt: past, body: '자동 게시 꺼짐' });
  await tick();
  assert.equal((await sql`select count(*)::int n from mkt_publish_jobs where content_id = ${off}`)[0].n, 0, '설정 꺼짐 → 작업 없음');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { autoPublish: true });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).settings.auto_publish, true);
  const tk = await tick();
  const d = await ctx.owner.ok('GET', `/api/marketing/contents/${off}`);
  assert.equal(d.content.status, 'published', JSON.stringify({ jobs: d.publishJobs, tick: tk?.detail?.mktPublish ?? tk })); assert.equal(d.publishJobs[0].requested_by_name, null, '자동(요청자 없음)');
  const later = new Date(Date.now() + 2 * 36e5).toISOString();
  const fut = await approved({ mediaIds: [P.img], scheduledAt: later, body: '예정 시각에' });
  const r = await ctx.owner.ok('POST', `/api/marketing/contents/${fut}/publish/server`, { atSchedule: true });
  assert.equal(r.ran, null);
  const [j] = await sql`select status, run_after from mkt_publish_jobs where content_id = ${fut}`;
  assert.equal(j.status, 'queued'); assert.ok(Math.abs(new Date(j.run_after).getTime() - new Date(later).getTime()) < 2000, '예정 시각');
  await tick();
  assert.equal((await sql`select status from mkt_publish_jobs where content_id = ${fut}`)[0].status, 'queued', '시각 전에는 실행 안 함');
  // 다른 회사 404
  assert.equal((await ctx.owner.req('POST', '/api/marketing/contents/00000000-0000-0000-0000-000000000001/publish/server', {})).status, 404);
});
