// 184차 대표 지적 소형 묶음(로컬 10/26 15:50·18:00·18:25):
// ① 메일 명함 로고 주소에 파일 id(A안) — 로고를 바꿔도 지난 메일은 보낸 때 로고, 옛 주소 형식도 계속 열림, 지운 파일이면 지금 로고
// ② 명함·문자 서명 번호 한국 표기(하이픈) + 한글 라벨(대표번호·휴대폰·팩스·이메일·홈페이지·주소) · 내 명함 저장 때 번호 정리
// ③ 일정 화상 회의 링크: 빈칸 = 없음 · 줌 회의 번호만 → https://zoom.us/j/번호 · 주소만 → https:// · 잘못된 값은 칸 이름 '화상 회의 링크'로 안내
// ④ 알림 목록: 안 읽은 줄은 [확인]만 있어도 보임 · 묶음 알림 [확인](푸시) = 그 묶음 오늘 안 읽은 것 모두, 목록(only) = 그 줄만 · 묶음 [열기]
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql, taskId;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', phone: '15550000', fax: '0212345678', website: 'www.dagym.test', address: '시험시 시험로 1, 3층 301호', isDefault: true });
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '명함 시험 업무', assigneeId: ctx.ownerId, approvalRequired: false })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const png = (r, g, b) => { // 1×1 PNG(색만 다름)
  const raw = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([raw, Buffer.from([r, g, b])]); // 내용 비교용(그림으로 열 필요 없음)
};
async function upload(name, bytes) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: name, mimeType: 'image/png', size: bytes.length, folder: '회사' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: bytes });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  return lf.id;
}

test('② 명함 번호 하이픈·한글 라벨 · 문자 서명 하이픈 · 내 명함 저장 때 번호 정리', async () => {
  await ctx.owner.ok('PUT', '/api/account/card', { title: '대표', phone: '01011112222' });
  assert.equal((await sql`select phone from users where id = ${ctx.ownerId}`)[0].phone, '010-1111-2222', '저장 때 한국 표기');
  await sql`update users set phone = '01033334444' where id = ${ctx.ownerId}`; // 예전에 숫자만 저장된 번호
  const c = await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`);
  const html = c.companies.find((x) => x.key === 'dagym').html;
  for (const s of ['>대표번호<', '>휴대폰<', '>팩스<', '>홈페이지<', '>주소<', '1555-0000', '010-3333-4444', '02-1234-5678']) assert.ok(html.includes(s), s);
  for (const s of ['>T<', '>M<', '>F<', '>W<', '>A<']) assert.ok(!html.includes(s), `영문 약자 없음 ${s}`);
  const sms = c.companies.find((x) => x.key === 'dagym').smsLine.split('\n');
  assert.equal(sms[1], '휴대폰 010-3333-4444');
});

test('① 로고 주소 = 파일 id 포함 · 로고 바꿔도 지난 주소는 그때 로고 · 옛 형식 주소도 열림 · 지운 파일이면 지금 로고 · 서명 틀리면 404', async () => {
  const red = png(255, 0, 0), blue = png(0, 0, 255);
  const f1 = await upload('로고1.png', red);
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', phone: '15550000', isDefault: true, logoFileId: f1 });
  const [p] = await sql`select id from company_profiles where key = 'dagym'`;
  const html1 = (await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`)).companies.find((x) => x.key === 'dagym').html;
  const sig1 = html1.match(/mail-logo\/([0-9a-f-]{36})\/([0-9a-f-]{36})\?s=([A-Za-z0-9_-]{24})/);
  assert.ok(sig1, `새 주소 형식(회사정보/파일?s=): ${(html1.match(/<img[^>]*>/) ?? ['(그림 없음)'])[0]}`);
  assert.deepEqual([sig1[1], sig1[2]], [p.id, f1]);
  const url1 = `${BASE}/api/public/mail-logo/${p.id}/${f1}?s=${sig1[3]}`;
  const get = async (u) => { const r = await fetch(u); return { status: r.status, body: Buffer.from(await r.arrayBuffer()), cache: r.headers.get('cache-control') }; };
  const a = await get(url1); assert.equal(a.status, 200); assert.ok(a.body.equals(red)); assert.match(a.cache, /immutable/);
  // 옛 형식(파일 id 없음) — 이미 보낸 메일: 같은 서명으로 열림
  const old1 = `${BASE}/api/public/mail-logo/${p.id}?s=${sig1[3]}`;
  assert.ok((await get(old1)).body.equals(red));
  // 로고 교체 → 지난 두 주소 모두 그때 로고(빨강) · 새 메일 주소는 파랑
  const f2 = await upload('로고2.png', blue);
  await ctx.owner.ok('PUT', '/api/org/company-profiles', { key: 'dagym', name: '시험상호 다짐', phone: '15550000', isDefault: true, logoFileId: f2 });
  assert.ok((await get(url1)).body.equals(red), '새 형식 지난 주소 = 그때 로고');
  assert.ok((await get(old1)).body.equals(red), '옛 형식 지난 주소도 = 그때 로고(전에는 404)');
  const sig2 = (await ctx.owner.ok('GET', `/api/tasks/${taskId}/mail`)).companies.find((x) => x.key === 'dagym').html.match(/mail-logo\/[0-9a-f-]{36}\/([0-9a-f-]{36})\?s=([A-Za-z0-9_-]{24})/);
  assert.equal(sig2[1], f2);
  assert.ok((await get(`${BASE}/api/public/mail-logo/${p.id}/${f2}?s=${sig2[2]}`)).body.equals(blue));
  // 옛 로고 파일을 자료실에서 지우면 지난 주소는 지금 로고(파랑)로 대신 — 짧게만 캐시
  await sql`update library_files set deleted_at = now() where id = ${f1}`;
  const gone = await get(url1); assert.equal(gone.status, 200); assert.ok(gone.body.equals(blue)); assert.doesNotMatch(gone.cache, /immutable/);
  assert.ok((await get(old1)).body.equals(blue));
  // 서명이 틀리면 404 · 다른 파일 id 에 남의 서명을 붙여도 404
  assert.equal((await get(`${BASE}/api/public/mail-logo/${p.id}/${f2}?s=${'0'.repeat(24)}`)).status, 404);
  assert.equal((await get(`${BASE}/api/public/mail-logo/${p.id}/${f2}?s=${sig1[3]}`)).status, 404);
  assert.equal((await get(`${BASE}/api/public/mail-logo/${p.id}?s=${'a'.repeat(24)}`)).status, 404);
  assert.equal((await get(`${BASE}/api/public/mail-logo/not-a-uuid/${f2}?s=${sig2[2]}`)).status, 404);
});

test('③ 화상 회의 링크: 빈칸 그대로 · 줌 번호 → zoom 주소 · 주소만 → https:// · 잘못된 값은 "화상 회의 링크:" 안내', async () => {
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  const at = (h) => new Date(Date.now() + (24 + h) * 3600e3).toISOString();
  const mk = (meetingUrl) => ctx.owner.req('POST', '/api/events', { calendarId: cal, title: '회의 링크 시험', start: at(1), end: at(2), meetingUrl });
  const url = async (id) => (await sql`select meeting_url from events where id = ${id}`)[0].meeting_url;
  const e0 = await mk(''); assert.equal(e0.status, 200); assert.equal(await url(e0.body.id), null, '빈칸 = 없음(필수 아님)');
  const e1 = await mk('123 4567 8901'); assert.equal(await url(e1.body.id), 'https://zoom.us/j/12345678901');
  const e2 = await mk('meet.google.com/abc-defg-hij'); assert.equal(await url(e2.body.id), 'https://meet.google.com/abc-defg-hij');
  const e3 = await mk('https://zoom.us/j/999?pwd=x'); assert.equal(await url(e3.body.id), 'https://zoom.us/j/999?pwd=x');
  const bad = await mk('회의실 3번');
  assert.equal(bad.status, 400);
  assert.match(bad.body.error.message, /화상 회의 링크: 회의 주소를 붙여 넣어 주세요/);
  assert.doesNotMatch(bad.body.error.message, /meetingUrl/, '영문 칸 이름이 안 보임');
});

test('④ 알림: 안 읽은 줄 [확인] · 묶음 [확인](푸시)은 그 묶음 오늘 것 모두 · 목록 only 는 그 줄만 · 묶음 [열기] 허용', async () => {
  const ins = async (title, meta = null) => (await sql`insert into notifications (user_id, type, title, body, link, meta, dedupe_key)
    values (${ctx.ownerId}, 'review_result', ${title}, '', '/s/marketing/approvals', ${sql.json(meta ?? {})}, ${`t184:${title}`}) returning id`)[0].id;
  const single = await ins('게시 완료 한 건');
  const list = async () => (await ctx.owner.ok('GET', '/api/notifications')).items;
  assert.deepEqual((await list()).find((n) => n.id === single).actions.map((a) => a.id), ['ack'], '안 읽은 줄은 [확인]만이어도 보임');
  await ctx.owner.ok('POST', '/api/notifications/read', { ids: [single] });
  assert.deepEqual((await list()).find((n) => n.id === single).actions, [], '읽은 줄은 [확인]만이면 버튼 없음');
  const G = { group: 'marketing:done', head: '제작 완료' };
  const g1 = await ins('제작 완료: 가을 이벤트', G), g2 = await ins('제작 완료: 겨울 PT', G), g3 = await ins('제작 완료: 설 연휴', G);
  // 목록의 [확인](only) → 그 줄만
  await ctx.owner.ok('POST', `/api/notifications/${g1}/action`, { action: 'ack', only: true });
  let rows = await sql`select id, read_at, action_done from notifications where id in (${g1}, ${g2}, ${g3}) order by created_at`;
  assert.deepEqual(rows.map((r) => !!r.read_at), [true, false, false]);
  // 푸시 [확인](only 없음) → 이 알림까지 같은 묶음 오늘 안 읽은 것 모두 '확인함'
  const r = await ctx.owner.ok('POST', `/api/notifications/${g3}/action`, { action: 'ack' });
  assert.equal(r.label, '확인함');
  rows = await sql`select id, read_at, action_done from notifications where id in (${g1}, ${g2}, ${g3}) order by created_at`;
  assert.deepEqual(rows.map((x) => [!!x.read_at, x.action_done]), [[true, '확인함'], [true, '확인함'], [true, '확인함']]);
  // 묶음 [열기] = 서버 처리 없음(읽음 + '눌러서 열어 주세요' 400, 옛 안드로이드 앱용) — 묶음 아닌 알림의 [열기]는 할 수 없는 처리
  const g4 = await ins('제작 완료: 봄 이벤트', G);
  const v = await ctx.owner.req('POST', `/api/notifications/${g4}/action`, { action: 'view' });
  assert.equal(v.status, 400); assert.match(v.body.error.message, /눌러서 열어/);
  const s2 = await ins('게시 완료 두 번째');
  const v2 = await ctx.owner.req('POST', `/api/notifications/${s2}/action`, { action: 'view' });
  assert.equal(v2.status, 400); assert.match(v2.body.error.message, /할 수 없는 처리/);
});
