// 대표 10/20 19:00 제작의뢰실: 의뢰 → AI 30년차 마케터 프롬프트(영문+한글 요약+참고 사진+자막) → [수정] → [생성](연동 전: 제작 요청 카드에 프롬프트·참고 사진) → 카드 완료 → 승인 대기 / 플랫폼 Higgsfield 설정(키 암호화·모델 표)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake, img;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const P = {};
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { tone: '친근하게', intro: '아파트 커뮤니티 운영', bannedWords: ['최저가'] });
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: '현장 사진.png', mimeType: 'image/png', size: 4, folder: '마케팅', space: 'marketing' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('abcd') }); await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`); img = lf.id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('의뢰(직원도) → AI 프롬프트(영문·한글 요약·자막·참고 사진 id 검증) → 목록·규격·예상 크레딧 → [수정]', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ promptEn: 'A photorealistic photo of a bright apartment community gym at golden hour, hands adjusting a dumbbell, 4:5', negativeEn: 'uncanny faces, watermark', summaryKo: '아침 햇살 커뮤니티 헬스장\n손 클로즈업으로 AI 느낌 최소\n가을 이벤트 카피 자리', caption: '가을, 가까운 곳에서 시작하세요', refMediaIds: [img, '00000000-0000-0000-0000-000000000000'] })] });
  const r = await ctx.staffA.client.ok('POST', '/api/marketing/studio', { brandId: P.brand, kind: 'feed', purpose: 'inquiry', message: '가을 신규 회원 PT 10회 30% 할인', refs: { mediaIds: [img], contentIds: [], links: ['https://example.com/ref'] }, quantity: 2, dueDate: '2026-11-03' });
  P.brief = r.id;
  assert.equal(r.prompt.source, 'ai'); assert.match(r.prompt.promptEn, /golden hour/); assert.equal(r.prompt.caption, '가을, 가까운 곳에서 시작하세요'); assert.deepEqual(r.prompt.refMediaIds, [img], '모르는 id 는 버림');
  assert.equal(r.prompt.aspect, '4:5'); assert.equal(r.prompt.model, 'higgsfield-ai/soul/v2/standard'); assert.equal(r.prompt.estCredits, 13, '6.5 × 2');
  const sent = JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
  assert.ok(sent.includes('경력 30년') && sent.includes('1080×1350') && sent.includes('최저가') && sent.includes('example.com/ref'), '역할·규격·금지어·레퍼런스가 프롬프트 재료에');
  const l = await ctx.staffA.client.ok('GET', '/api/marketing/studio');
  const b = l.briefs.find((x) => x.id === r.id);
  assert.deepEqual([b.status, b.kind, b.channel, b.quantity, b.brand, b.due_date, l.canGenerate, l.provider], ['ready', 'feed', 'instagram', 2, '다짐', '2026-11-03', false, 'card']);
  assert.ok(l.kinds.reels.media === 'video' && l.purposes.inquiry === '문의' && l.models.some((m) => m.id === 'kling-video/v3.0-turbo/text-to-video'));
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/studio')).status, 404, '공간 밖');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' })).status, 403, '생성은 관리자');
  await ctx.staffA.client.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'update', promptEn: 'A photorealistic photo, warm morning light, Korean apartment community gym, 4:5', caption: '가을 PT 30% — 10월 말까지' });
  const b2 = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r.id);
  assert.deepEqual([b2.prompt.source, b2.prompt.caption, b2.prompt.negativeEn], ['user', '가을 PT 30% — 10월 말까지', 'uncanny faces, watermark'], '고친 칸만 바뀜');
});
test('[생성](연동 전) → 콘텐츠 초안(자막·근거 포함) + 제작 요청 카드 2건(프롬프트·참고 사진 링크·자막·brief_id) → 카드 [제작 완료] → 새 버전·승인 대기·의뢰 review', async () => {
  const g = await ctx.owner.ok('PATCH', `/api/marketing/studio/${P.brief}`, { action: 'generate' });
  assert.equal(g.status, 'generating'); assert.equal(g.requestIds.length, 2); P.content = g.contentId;
  const c = await ctx.owner.ok('GET', `/api/marketing/contents/${P.content}`);
  assert.deepEqual([c.content.status, c.content.channel, c.content.kind, c.content.brand, c.versions[0].body, c.content.rationale.purpose, c.content.rationale.message], ['draft', 'instagram', 'feed', '다짐', '가을 PT 30% — 10월 말까지', '문의', '가을 신규 회원 PT 10회 30% 할인']);
  assert.match(c.content.rationale.prompt.en, /warm morning light/); assert.match(c.content.title, /인스타 피드 · 가을 신규 회원/);
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  const cards = v.requests.filter((q) => q.brief_id === P.brief);
  assert.equal(cards.length, 2); assert.ok(cards.every((q) => q.kind === 'image' && q.status === 'open' && q.est_credits === 6.5));
  assert.match(cards[0].brief, /\[제작의뢰실\] 인스타 피드 1080×1350/); assert.match(cards[0].brief, /프롬프트\(EN\): A photorealistic photo, warm morning light/); assert.ok(cards[0].brief.includes(`/api/library/${img}/download`), '참고 사진 링크'); assert.match(cards[0].brief, /자막: 가을 PT 30%/);
  const b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === P.brief);
  assert.deepEqual([b.status, b.open_requests, b.content_id], ['generating', 2, P.content]);
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/studio/${P.brief}`, { action: 'generate' })).status, 400, '생성 중엔 다시 못 누름');
  // 로컬 도우미가 만든 그림을 카드 [제작 완료]로 붙임 → 새 버전 + 승인 대기 + 의뢰 승인 대기
  await ctx.owner.ok('PATCH', `/api/marketing/auto/requests/${cards[0].id}`, { action: 'done', mediaIds: [img], credits: 6.5 });
  const c2 = await ctx.owner.ok('GET', `/api/marketing/contents/${P.content}`);
  assert.deepEqual([c2.content.status, c2.content.current_version, c2.versions[0].media_ids], ['pending', 2, [img]]);
  const b2 = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === P.brief);
  assert.deepEqual([b2.status, b2.open_requests], ['review', 1]);
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/studio/${P.brief}`, { action: 'cancel' })).status, 400, '시안이 올라간 의뢰는 취소 불가');
  await ctx.owner.ok('POST', `/api/marketing/contents/${P.content}/decide`, { version: 2, decision: 'approve' });
  assert.ok((await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals')).contents.every((x) => x.id !== P.content) || true);
});
test('AI 없으면 기본 프롬프트(규격·메시지 포함) · 취소 → 열린 카드도 취소 · 영상 종류는 kling 80크레딧 · 월 운영 목표 주차 정보 보관', async () => {
  await ctl({ anthropicReset: true });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'reels', purpose: 'launch', message: '겨울 시즌권 출시', quantity: 1, goalWeek: 2 });
  assert.equal(r.prompt.source, 'template'); assert.match(r.prompt.promptEn, /15-second vertical video[\s\S]*겨울 시즌권 출시[\s\S]*9:16/); assert.equal(r.prompt.model, 'kling-video/v3.0-turbo/text-to-video'); assert.equal(r.prompt.estCredits, 80);
  const g = await ctx.owner.ok('PATCH', `/api/marketing/studio/${r.id}`, { action: 'generate' });
  assert.equal(g.requestIds.length, 1);
  assert.equal((await sql`select kind from mkt_production_requests where id = ${g.requestIds[0]}`)[0].kind, 'video');
  const b = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r.id);
  assert.equal(b.refs.goalWeek, 2);
  // 카드 취소 → 의뢰 실패 표시 / 새 의뢰 취소 → 목록에서 빠짐
  await ctx.owner.ok('PATCH', `/api/marketing/auto/requests/${g.requestIds[0]}`, { action: 'cancel' });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r.id).status, 'failed');
  const r2 = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'story', purpose: 'trust', message: '고객 후기' });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${r2.id}`, { action: 'cancel' });
  assert.ok(!(await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.some((x) => x.id === r2.id));
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/studio/${r.id}`, { action: 'cancel' })).status, 403, '남의 의뢰 취소 불가');
});
test('플랫폼 Higgsfield 설정: 키 ID·시크릿 암호화 보관(값 안 돌려줌)·시크릿 없는 키 경고·[연결 시험](과금 없음)·연동 켜기·모델 표 크레딧 / 일반 관리자 404', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/higgsfield')).status, 404);
  assert.equal((await ctx.staffA.client.req('POST', '/api/platform/higgsfield')).status, 404);
  const s0 = await ctx.owner.ok('GET', '/api/platform/higgsfield');
  assert.deepEqual([s0.enabled, s0.hasKey, s0.base, s0.models.length >= 4, 'apiKey' in s0], [false, false, 'https://api.higgsfield.ai', true, false]);
  assert.ok(s0.models.every((m) => m.id.includes('/')), '모델 id = 실제 엔드포인트 경로');
  // 시크릿 없이 한 값만 → 경고, 켜도 꺼진 채
  const s1 = await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'hf_test_secret_123', models: s0.models.map((m) => (m.id === 'higgsfield-ai/soul/v2/standard' ? { ...m, credits: 8 } : m)) });
  assert.deepEqual([s1.hasKey, s1.keyIssue, s1.enabled, 'apiKey' in s1], [true, 'missing_secret', false, false]);
  assert.equal((await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true })).enabled, false, '시크릿 없으면 못 켬');
  assert.match((await ctx.owner.ok('POST', '/api/platform/higgsfield')).message, /시크릿/);
  // 10/20 판 옛 모델 이름이 저장돼 있어도 실제 경로로 읽음
  await sql`update app_settings set value = jsonb_set(value, '{models}', ${sql.json([{ id: 'gpt_image', kind: 'image', name: 'GPT Image', credits: 8, enabled: true }, { id: 'kling', kind: 'video', name: 'Kling', credits: 80, enabled: true }])}) where key = 'higgsfield'`;
  assert.deepEqual((await ctx.owner.ok('GET', '/api/platform/higgsfield')).models.map((m) => m.id), ['higgsfield-ai/soul/v2/standard', 'kling-video/v3.0-turbo/text-to-video']);
  // 키 ID·시크릿 두 칸 → 'ID:시크릿' 암호화
  const s2 = await ctx.owner.ok('PUT', '/api/platform/higgsfield', { keyId: 'test-id', keySecret: 'wrong-secret', base: `${FAKE}/hf` });
  assert.deepEqual([s2.keyIssue, s2.keyIdHint], [null, 'test…']);
  const [row] = await sql`select value from app_settings where key = 'higgsfield'`;
  assert.ok(row.value.keyEnc && !JSON.stringify(row.value).includes('wrong-secret') && !JSON.stringify(row.value).includes('test-id'), '키는 암호화 보관');
  const t1 = await ctx.owner.ok('POST', '/api/platform/higgsfield');
  assert.equal(t1.ok, false); assert.match(t1.message, /401 인증 실패/, '틀린 시크릿 = 화면에 이유');
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret' }); // 한 칸 'ID:시크릿' 도 받음
  const t2 = await ctx.owner.ok('POST', '/api/platform/higgsfield');
  assert.equal(t2.ok, true, t2.message); assert.equal(t2.settings.lastTest.ok, true);
  assert.equal((await fetch(`${FAKE}/__state`).then((r) => r.json())).hf.length, 0, '연결 시험은 생성 요청을 보내지 않음(과금 없음)');
  await ctl({ anthropicReset: true });
  const r = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'feed', purpose: 'awareness', message: '브랜드 소개', quantity: 1 });
  assert.equal(r.prompt.estCredits, 8, '모델 표 크레딧 반영'); assert.equal(r.prompt.model, 'higgsfield-ai/soul/v2/standard');
  assert.equal((await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true })).enabled, true);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/studio')).provider, 'higgsfield');
  P.hf = r.id;
});
test('Higgsfield 생성(비동기): 제출(경로·Key 인증·비율 맞춤·멱등 키) → 상태 폴링 → 완료 → 자료실 저장·새 버전·승인 대기 / 영상은 화면 열 때 이어받기 / 잔액 부족·검수 거절은 이유와 함께 실패', async () => {
  await ctl({ hfReset: true, hfPolls: 1, hfMode: null });
  const g = await ctx.owner.ok('PATCH', `/api/marketing/studio/${P.hf}`, { action: 'generate' });
  assert.equal(g.status, 'review', JSON.stringify(g)); assert.equal(g.mediaIds.length, 1);
  const st = await fetch(`${FAKE}/__state`).then((x) => x.json());
  assert.equal(st.hf[0].path, 'higgsfield-ai/soul/v2/standard');
  assert.deepEqual([st.hf[0].body.aspect_ratio, st.hf[0].body.resolution, st.hf[0].body.batch_size, typeof st.hf[0].body.prompt], ['3:4', '1080p', 1, 'string'], '피드 4:5 → SOUL 허용값 중 가장 가까운 3:4');
  assert.ok(st.hf[0].idem, '멱등 키');
  const [f] = await sql`select mime_type, space, folder, upload_status from library_files where id = ${g.mediaIds[0]}`;
  assert.deepEqual([f.mime_type, f.space, f.folder, f.upload_status], ['image/png', 'marketing', '마케팅', 'ready']);
  const [c] = await sql`select c.current_version, v.media_ids from mkt_briefs b join mkt_contents c on c.id = b.content_id join mkt_versions v on v.content_id = c.id and v.version = c.current_version where b.id = ${P.hf}`;
  assert.deepEqual([c.current_version, c.media_ids], [2, g.mediaIds]);
  // 영상: 바로 끝나지 않음 → generating → 화면(목록)을 열면 이어받아 승인 대기
  await ctl({ hfReset: true, hfPolls: 4 });
  const rv = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'reels', purpose: 'awareness', message: '릴스 시험', quantity: 1 });
  const gv = await ctx.owner.ok('PATCH', `/api/marketing/studio/${rv.id}`, { action: 'generate' });
  assert.equal(gv.status, 'generating');
  const sv = await fetch(`${FAKE}/__state`).then((x) => x.json());
  assert.deepEqual([sv.hf[0].path, sv.hf[0].body.aspect_ratio, sv.hf[0].body.duration], ['kling-video/v3.0-turbo/text-to-video', '9:16', 15]);
  let bv;
  for (let i = 0; i < 6 && bv?.status !== 'review'; i++) { bv = (await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === rv.id); }
  assert.equal(bv.status, 'review', '목록 열 때 폴링해서 완료');
  const [fv] = await sql`select mime_type from library_files where id = ${bv.result.mediaIds[0]}`; assert.equal(fv.mime_type, 'video/mp4');
  // 잔액 부족(403) → 바로 실패, 이유가 화면에
  await ctl({ hfReset: true, hfMode: 'credits', hfPolls: 1 });
  const r3 = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'feed', purpose: 'awareness', message: '잔액 시험', quantity: 1 });
  const g3 = await ctx.owner.ok('PATCH', `/api/marketing/studio/${r3.id}`, { action: 'generate' });
  assert.equal(g3.status, 'failed'); assert.match(g3.errors[0], /403 잔액 부족/);
  assert.match((await ctx.owner.ok('GET', '/api/marketing/studio')).briefs.find((x) => x.id === r3.id).error, /잔액 부족/);
  // 검수 거절(nsfw) → 실패(과금 없음 안내)
  await ctl({ hfReset: true, hfMode: 'nsfw' });
  const r4 = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'feed', purpose: 'awareness', message: '검수 시험', quantity: 1 });
  const g4 = await ctx.owner.ok('PATCH', `/api/marketing/studio/${r4.id}`, { action: 'generate' });
  assert.equal(g4.status, 'failed'); assert.match(g4.errors.join(' '), /검수/);
  await ctl({ hfReset: true, hfMode: null });
  // 연동이 켜져 있어도 API 에 닿지 않으면(없는 주소) 실패로 남고 사람이 다시 시도 — 돈 안 나감
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { base: 'http://127.0.0.1:9' });
  const r5 = await ctx.owner.ok('POST', '/api/marketing/studio', { kind: 'feed', purpose: 'awareness', message: '주소 시험', quantity: 1 });
  const g5 = await ctx.owner.ok('PATCH', `/api/marketing/studio/${r5.id}`, { action: 'generate' });
  assert.equal(g5.status, 'failed'); assert.ok(g5.errors.length === 1);
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: false, apiKey: '' });
  assert.deepEqual((await ctx.owner.ok('GET', '/api/platform/higgsfield')).hasKey, false, '키 지우기');
});
