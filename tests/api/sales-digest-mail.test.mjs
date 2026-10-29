// #509·#510(대표 10/23 17:30): 당일 공고 메일 — ① 워크인 발송(받은메일함) 먼저, 회사 SMTP 는 없을 때만(보내는 회사 주소는 받는 사람에서 뺌) · 주소 직접 추가(최대 5)·보낸 사람 이름·답장 주소
// ② 21라인 수준 정리: 구역(★ 즉시 검토 → 검토 → 마감 임박 → 정정·취소 → 참고) · 구역마다 1부터 · 빈칸 숨김 · 같은 공고는 최신 차수 1줄 · 검색어만 맞은 공고는 '참고' 건수만 · 미리보기 API
// 가짜 SMTP·가짜 Resend 로 시험 — 실제 네이버·Gmail 받은메일함 확인은 로컬 세션이 대표와(가짜 서버 통과 ≠ 실제 연동 완료)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const SMTP_PORT = 2533, RESEND_PORT = 3243;
const PASS = 'digest-pass-1234';
const FROM_NAME = '다짐·하이링크 영업실';
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const mdw = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}(${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
const at = (d, hm) => `${d}T${hm}:00+09:00`;
const ago = (h) => new Date(Date.now() - h * 36e5).toISOString();
const ID = (n) => `00000000-0000-4000-8000-000000510${String(n).padStart(3, '0')}`;
let srv, sql, ctx, smtp, resendSrv;
const box = [], resent = [];

function startSmtp() {
  return new Promise((resolve) => {
    const s = new SMTPServer({ authOptional: false, allowInsecureAuth: true, disabledCommands: ['STARTTLS'], logger: false,
      onAuth(a, _s, cb) { return a.password === PASS ? cb(null, { user: a.username }) : cb(Object.assign(new Error('Authentication failed'), { responseCode: 535 })); },
      onData(stream, _s, cb) { const c = []; stream.on('data', (x) => c.push(x)); stream.on('end', async () => { box.push(await simpleParser(Buffer.concat(c))); cb(); }); } });
    s.listen(SMTP_PORT, '127.0.0.1', () => resolve(s));
  });
}
function startResend() {
  return http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer re_test_key') { res.statusCode = 401; return res.end('{"message":"bad key"}'); }
    resent.push(JSON.parse(b)); res.end(JSON.stringify({ id: `re_${resent.length}` }));
  }); }).listen(RESEND_PORT);
}
const ins = (n, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n),
  source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=${row.source_external_id}`, notice_kind: 'new', current_status: '진행중', related: !!row.fit_business, posted_date: today,
  first_seen_at: ago(2), updated_at: ago(2), ...row })}, 'workin')`;
const SERVER_ENV = { MAIL_DEV: '1', SALES_COLLECT_TEST_BASE: 'http://127.0.0.1:9' };

before(async () => {
  smtp = await startSmtp(); resendSrv = startResend();
  await resetDb(); srv = await startServer(SERVER_ENV); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  // 지난 메일 = 어제 08:00 → 그 뒤 처음 본 공고가 오늘 메일 몫
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${plus(-1)}, '[]', '{}', 1, 1, ${new Date(at(plus(-1), '08:00'))})`;
  const kapt = { source_type: 'kapt_bid', fit_business: '다짐', bid_system: 'K-APT' };
  await ins(1, { ...kapt, source_external_id: 'K510-1', title: '[서울강남] 시험 단지 피트니스 위탁운영 사업자 선정', issuer: '래미안 시험', region: '서울강남', classification: '즉시 검토', deadline_at: at(plus(5), '17:00'),
    estimated_amount: 0, bid_category: '사업자 &gt; 용역 &gt; 주민운동시설의 위탁', attachment_urls: ['https://www.k-apt.go.kr/a.hwp', 'https://www.k-apt.go.kr/b.pdf'] });
  // 나라장터 같은 공고 001·002 차수 → 002 하나만 · 지역 '-' 는 발주처에서 시도
  const g2b = { source_type: 'g2b_bid', fit_business: '다짐', classification: '중장기 영업리드', title: '시험구 체육센터 헬스장 위탁운영 용역', issuer: '경기도 시험시', region: '-', bid_category: '용역',
    deadline_at: at(plus(9), '10:00'), participation_deadline_at: at(plus(7), '18:00'), opening_at: at(plus(9), '11:00'), site_briefing_at: at(plus(3), '14:00'), source_url: 'https://www.g2b.go.kr/link/R2026510' };
  await ins(2, { ...g2b, source_external_id: 'R2026510-001', estimated_amount: 52000000, first_seen_at: ago(3), updated_at: ago(3) });
  await ins(3, { ...g2b, source_external_id: 'R2026510-002', estimated_amount: 53000000 });
  // 번호가 달라도 제목·발주처·마감일·종류가 같으면 한 줄
  const dup = { source_type: 'g2b_bid', fit_business: '다짐', classification: '즉시 검토', title: '시험동 주민센터 체력단련실 운영 위탁', issuer: '서울특별시 시험구', deadline_at: at(plus(6), '15:00'), source_url: 'https://www.g2b.go.kr/link/D510' };
  await ins(4, { ...dup, source_external_id: 'D510A-000' }); await ins(5, { ...dup, source_external_id: 'D510B-000', budget_amount: 30000000 });
  // 검색어만 맞은 공고(새 공고·취소) → 참고
  await ins(6, { source_type: 'kapt_bid', source_external_id: 'KW510', title: '[경기성남] 시험키워드 승강기 보수공사', deadline_at: at(plus(8), '10:00') });
  await ins(7, { source_type: 'kapt_bid', source_external_id: 'KC510', title: '[서울] 시험키워드 외벽 도색공사', deadline_at: at(plus(8), '10:00'), notice_kind: 'cancel', current_status: '취소', first_seen_at: ago(72), updated_at: ago(1) });
  // 관련 사업 취소(전에 받은 공고가 오늘 취소로 바뀜) → 정정·취소
  await ins(8, { source_type: 'g2b_bid', source_external_id: 'C510-000', fit_business: '다짐', title: '시험구 국민체육센터 위탁운영', issuer: '서울특별시 시험구', deadline_at: at(plus(8), '10:00'), notice_kind: 'cancel', current_status: '취소', first_seen_at: ago(72), updated_at: ago(1) });
  // 마감 임박: 전에 받은 관련 공고 D-2 · 진행 기록(영업 업무)이 걸린 D-1 은 뺌
  await ins(9, { ...kapt, source_external_id: 'S510', title: '[경기용인] 시험 단지 운동시설 위탁관리업체 선정', classification: '즉시 검토', deadline_at: at(plus(2), '17:00'), first_seen_at: ago(72), updated_at: ago(72), posted_date: plus(-3),
    bid_category: '사업자 - 공사 - 일반보수', bid_system: 'KG2B' });
  await ins(10, { ...kapt, source_external_id: 'S510L', title: '[서울] 시험 단지 헬스장 위탁운영', deadline_at: at(plus(1), '17:00'), first_seen_at: ago(72), updated_at: ago(72), posted_date: plus(-3) });
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '시험 단지 헬스장 입찰 준비', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: ID(10) })} where id = ${t.id}`;
  // 걸러지는 공고: 마감 지남 · 업종 무관 · 제외어
  await ins(11, { ...kapt, source_external_id: 'X510-OLD', title: '[인천] 시험 단지 커뮤니티 위탁운영(마감 지남)', deadline_at: at(plus(-1), '10:00') });
  await ins(12, { source_type: 'kapt_bid', source_external_id: 'X510-UN', title: '[서울] 시험 단지 승강기 교체공사', deadline_at: at(plus(8), '10:00') });
  await ins(13, { ...kapt, source_external_id: 'X510-EX', title: '[서울] 시험 단지 피트니스 위탁 제외단어', deadline_at: at(plus(8), '10:00') });
});
after(async () => { srv?.proc.kill(); smtp?.close(); resendSrv?.close(); await sql?.end(); });

test('#509 b·c 맞춤 설정: 메일 주소 직접 추가(소문자·중복 정리·최대 5·형식) · 보낸 사람 이름 · 답장 주소 · 관리자만', async () => {
  assert.equal((await ctx.staffA.client.req('PUT', '/api/sales/digest/prefs', { digestEmails: ['a@b.test'] })).status, 403);
  const six = await ctx.owner.req('PUT', '/api/sales/digest/prefs', { digestEmails: ['a1@x.test', 'a2@x.test', 'a3@x.test', 'a4@x.test', 'a5@x.test', 'a6@x.test'] });
  assert.equal(six.status, 400); assert.match(JSON.stringify(six.body), /5개까지/);
  const bad = await ctx.owner.req('PUT', '/api/sales/digest/prefs', { digestEmails: ['메일아님'] });
  assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.body), /메일 주소 형식/);
  assert.equal((await ctx.owner.req('PUT', '/api/sales/digest/prefs', { digestReplyTo: 'reply-bad' })).status, 400);
  // 215차: 정기 시각 0시 — 정기 시각 전 [지금 보내기]는 시험 발송이라, 새벽에 도는 자동 검사에서도 아래 시험들의 '보내기'가 정식 발송이 되게
  const p = await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: ['시험키워드'], excludes: ['제외단어'], digestFromName: ` ${FROM_NAME} `, digestEmails: ['office@mail.test', 'Boss@Client.test', 'boss@client.test'], digestReplyTo: '', digestHour: 0 });
  assert.deepEqual([p.digest_emails, p.digest_from_name, p.digest_reply_to], [['office@mail.test', 'boss@client.test'], FROM_NAME, null]);
  const g = await ctx.owner.ok('GET', '/api/sales/digest/prefs');
  assert.deepEqual([g.mail.channel, g.mail.fallback, g.mail.fromName, g.mail.replyTo], [null, 'dev', FROM_NAME, null], '메일 계정·워크인 발송 없음 = 개발 모드');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/sales/digest/prefs')).canEdit, false);
});

test('#510 메일 정리(21라인 수준): 구역·번호·빈칸 숨김·같은 공고 1줄·참고 분리·마감 임박·제목 · 미리보기 API(보내지 않음)', async () => {
  const pv = await ctx.owner.req('GET', '/api/sales/digest?preview=html');
  assert.equal(pv.status, 200); assert.match(pv.headers.get('content-type'), /text\/html/); assert.match(pv.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.equal((await sql`select count(*)::int n from sales_digests where day = ${today}`)[0].n, 0, '미리보기는 보내지 않음');
  assert.equal((await ctx.staffB.client.req('GET', '/api/sales/digest?preview=html')).status, 404, '영업 공간 밖');
  const txt = await ctx.owner.req('GET', '/api/sales/digest?preview=text');
  assert.match(txt.headers.get('content-type'), /text\/plain/);
  const html = pv.body; const text = txt.body;
  const subject = `[${FROM_NAME}] ${mdw(today)} 오늘 입찰 4건 (즉시 검토 2, 마감 임박 1)`;
  assert.equal(text.split('\n')[0], subject, text.slice(0, 300));
  assert.ok(html.includes('새 공고 3(즉시 검토 2 · 검토 1) · 정정 0 · 취소 1 · 마감 임박(D-3 이내) 1'), '머리 요약');
  assert.ok(html.includes('오늘 공고 전체 보기') && html.includes('맞춤 설정'));
  // 구역 순서와 번호(구역마다 1부터, 0 번호 없음)
  const order = [...html.matchAll(/data-digest-section="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, ['now', 'review', 'soon', 'change', 'ref']);
  const items = [...html.matchAll(/data-digest-item="(\w+)"[\s\S]*?font-weight:600;margin-right:4px">(\d+)\.<\/span>/g)].map((m) => `${m[1]}${m[2]}`);
  assert.deepEqual(items, ['now1', 'now2', 'review1', 'soon1', 'change1'], '번호는 구역마다 1부터');
  assert.ok(!/>0\.<\/span>/.test(html));
  // 같은 공고(001·002 차수 · 번호 다른 같은 공고)는 한 줄 · 최신 차수 금액
  assert.equal(html.split('시험구 체육센터 헬스장 위탁운영 용역').length - 1, 1); assert.equal(html.split('시험동 주민센터 체력단련실 운영 위탁').length - 1, 1);
  assert.ok(html.includes('R2026510-002') && !html.includes('R2026510-001'), '최신 차수 번호');
  assert.ok(html.includes('추정가격 5,300만원') && !html.includes('5,200만원'));
  assert.match(html, /같은 공고 2줄은 최신 차수 하나로/);
  // 빈칸 숨김: '-'·'0만원'·undefined 없음, 추정가격 0 = '미공개', 지역 '-' 는 발주처 시도로
  assert.ok(html.includes('추정가격 미공개') && !/(^|[^\d,])0만원|>-<| · - | · -<|undefined|null/.test(html), '빈 값 표시 없음');
  assert.ok(html.includes('경기도 시험시 · 경기 · 추정가격 5,300만원'), '나라장터 지역 = 발주처 시도');
  // 3행: 참가신청마감·입찰마감 D-day·개찰·현장설명·첨부·출처 공고번호·[원문](원천 주소는 글자로 안 보임)
  assert.ok(html.includes(`참가신청마감 ${mdw(plus(7))} 18:00 · 입찰마감 ${mdw(plus(9))} 10:00 <b style="color:#D97706">D-9 · 준비 시작</b>`), html.slice(html.indexOf('R2026510-002') - 600, html.indexOf('R2026510-002') + 50));
  assert.ok(html.includes(`현장설명 ${mdw(plus(3))} 14:00`) && html.includes(`개찰 ${mdw(plus(9))} 11:00`));
  assert.ok(html.includes(`입찰마감 ${mdw(plus(5))} 17:00 <b style="color:#D97706">D-5 · 준비 시작</b>`), '대표 10/24 추가 ③: D-4~D-10 = 주황 준비 시작');
  assert.ok(html.includes(`입찰마감 ${mdw(plus(2))} 17:00 <b style="color:#DC2626">D-2</b>`), '마감 임박 D-2 빨강');
  assert.ok(html.includes('첨부 2') && html.includes('K-apt K510-1'));
  const kaptUrl = 'https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=K510-1';
  assert.equal(html.split(kaptUrl).length - 1, html.split(`href="${kaptUrl}"`).length - 1, '원천 주소는 [원문] 링크로만');
  assert.ok(html.includes(`/s/sales/hub?tab=bids&amp;bt=all&amp;id=${ID(1)}`), '공고명 = 워크인 상세(#611 허브 입찰 탭)');
  assert.ok(html.includes('>용역</span>') && html.includes('>주민운동시설의 위탁</span>'), '업종 태그(입찰 분류 나눔)');
  assert.ok(html.includes('>공사</span>') && html.includes('>일반보수</span>') && !html.includes('사업자 -') && !html.includes('>사업자<'), "로컬 22:45 ①: K-apt '사업자 - 공사 - 일반보수' → 공사·일반보수");
  assert.ok(!html.includes('투찰 K-APT') && html.includes('투찰 KG2B'), '로컬 22:45 ②: 투찰처가 원천(K-apt)과 같으면 숨김, 다른 곳만');
  // 정정·취소 = 관련 사업만(취소 배지·가운데 줄) · 검색어만 맞은 공고(새·취소)는 참고 건수만
  assert.ok(html.includes('시험구 국민체육센터 위탁운영') && html.includes('>취소</span>') && html.includes('text-decoration:line-through'));
  // 로컬 10/25 10:55: 취소 공고에는 'D-n · 준비 시작'·D-day 없이 마감일만
  const cx = html.slice(html.indexOf('시험구 국민체육센터 위탁운영'), html.indexOf('</td>', html.indexOf('시험구 국민체육센터 위탁운영')));
  assert.ok(cx.includes(`입찰마감 ${mdw(plus(8))} 10:00`) && !/D-\d|준비 시작/.test(cx), cx);
  assert.ok(!html.includes('시험키워드'), '참고 공고 제목은 메일에 안 나옴');
  assert.ok(html.includes('<b>참고(검색어만 일치)</b> 2건') && html.includes('/s/sales/hub?tab=bids&amp;bt=ref'));
  // 마감 임박: 진행 기록 걸린 공고는 뺌
  assert.ok(html.includes('[경기용인] 시험 단지 운동시설 위탁관리업체 선정') && !html.includes('[서울] 시험 단지 헬스장 위탁운영'));
  assert.ok(html.includes('걸러진 공고 업종 무관 1 · 제외어 1 · 마감 지남 1') && html.includes('이 메일은 워크인 영업실 당일 공고 알림입니다'));
  // 텍스트판도 같은 내용
  assert.ok(text.includes('■ ★ 즉시 검토 (2)') && text.includes('■ 진행 중(D-3 안) (1)') && text.includes('■ 참고(검색어만 일치) 2건')); // #608: 구역 이름 '마감 임박' → '진행 중(D-3 안)'
  assert.ok(/\n1\. \[서울강남\] 시험 단지 피트니스 위탁운영 사업자 선정/.test(text) && !/\n0\. /.test(text));
  assert.ok(text.includes(`입찰마감 ${mdw(plus(5))} 17:00 D-5 · 준비 시작`));
});

test('#509 a·d 회사 SMTP 경로(워크인 발송 없음): 회사 주소는 받는 사람에서 빠짐 · 보낸 사람 이름·답장 주소 · 받는 사람이 회사 주소뿐이면 안 보냄 · 오늘 탭·참고 탭·상세 바로 열기', async () => {
  const acc = { provider: 'custom', host: '127.0.0.1', port: SMTP_PORT, secure: false, username: 'dagym-in', fromEmail: 'office@mail.test', fromName: '시험회사', password: PASS };
  await ctx.owner.ok('PUT', '/api/org/mail-account', acc); box.length = 0;
  const g = await ctx.owner.ok('GET', '/api/sales/digest/prefs');
  assert.deepEqual([g.mail.channel, g.mail.smtpFrom, g.mail.replyTo], ['email:smtp', 'office@mail.test', 'office@mail.test']);
  const sent = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.deepEqual([sent.mailVia, sent.mailed, sent.mailError], ['email:smtp', 2, null], JSON.stringify(sent.counts));
  const [o] = await sql`select channel, status, to_addrs, reply_to, from_name, subject from outbox where subject like '[%' order by created_at desc limit 1`;
  assert.deepEqual([o.channel, o.status, [...o.to_addrs].sort(), o.reply_to, o.from_name], ['email:smtp', 'sent', ['boss@client.test', 'ceo@dagym.test'], 'office@mail.test', FROM_NAME], '지금 보내기는 바로 발송');
  assert.equal(box.length, 1); const m = box[0];
  assert.equal(m.from.value[0].name, FROM_NAME); assert.equal(m.replyTo.value[0].address, 'office@mail.test');
  assert.ok(!m.to.value.some((x) => x.address === 'office@mail.test'), '회사 주소는 받는 사람에서 뺌');
  assert.match(m.subject, /오늘 입찰 4건 \(즉시 검토 2, 마감 임박 1\)$/); assert.ok(m.html.includes('data-digest="1"') && m.text.includes('■ 정정·취소 (1)'));
  const counts = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).last.counts;
  assert.deepEqual([counts.now, counts.review, counts.soon, counts.ref, counts.cancel, counts.mailVia], [2, 1, 1, 2, 1, 'email:smtp']);
  // 참고 [보기] = 마지막 메일의 검색어만 맞은 공고 · 메일 제목 링크(?id=) = 그 공고 한 건
  const ref = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=ref')).items.map((n) => n.id).sort();
  assert.deepEqual(ref, [ID(6), ID(7)]);
  const one = (await ctx.owner.ok('GET', `/api/sales/src?view=bids&tab=all&q=${ID(3)}`)).items;
  assert.ok(one.some((n) => n.id === ID(3)), JSON.stringify(one.map((n) => n.id)));
  // 받는 사람이 보내는 회사 주소뿐이면 보내지 않고 이유를 남김
  await sql`update mail_accounts set from_email = 'ceo@dagym.test'`;
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestEmails: [] });
  const self = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.equal(self.mailed, 0); assert.match(self.mailError, /받는 사람이 보내는 회사 메일 주소뿐이라 보내지 않았습니다 — 워크인 발송을 켜면 받은메일함으로 옵니다/);
  await sql`update mail_accounts set from_email = 'office@mail.test'`;
});

test('#509 a 워크인 발송(Resend)이 있으면 먼저 — 회사 주소도 받은메일함으로 · 보낸 사람 이름·답장 주소(설정값)', async () => {
  srv.proc.kill(); await once(srv.proc, 'exit');
  srv = await startServer({ ...SERVER_ENV, RESEND_API_KEY: 're_test_key', MAIL_FROM_DOMAIN: 'mail.work-in.test', RESEND_API_BASE: `http://localhost:${RESEND_PORT}` });
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestEmails: ['office@mail.test'], digestReplyTo: 'Sales@Company.test' });
  const g = await ctx.owner.ok('GET', '/api/sales/digest/prefs');
  assert.deepEqual([g.mail.channel, g.mail.replyTo, g.mail.fromName], ['email:workin', 'sales@company.test', FROM_NAME]);
  resent.length = 0; box.length = 0;
  const sent = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.deepEqual([sent.mailVia, sent.mailed], ['email:workin', 2], JSON.stringify(sent));
  assert.equal(resent.length, 1, '바로 발송'); assert.equal(box.length, 0, '회사 SMTP 는 안 씀');
  const r = resent[0];
  assert.equal(r.from, `"${FROM_NAME}" <noreply@mail.work-in.test>`); assert.equal(r.reply_to, 'sales@company.test');
  assert.deepEqual([...r.to].sort(), ['ceo@dagym.test', 'office@mail.test'], '회사 주소도 받는 사람(받은메일함)');
  assert.ok(r.html.includes('data-digest-section="now"') && r.text.startsWith(`[${FROM_NAME}] ${mdw(today)} 오늘 입찰 4건`));
});

test('로컬 22:45 ③ 마감 임박은 10건까지 · 나머지 n건 — [보기](입찰 화면 진행 중·마감 임박순)', async () => {
  for (let k = 0; k < 11; k++) await ins(30 + k, { source_type: 'kapt_bid', fit_business: '다짐', bid_system: 'K-APT', source_external_id: `S510-M${k}`, title: `[서울] 시험 단지 헬스장 위탁 마감 임박 ${k + 1}`,
    deadline_at: at(plus(1 + (k % 3)), '16:00'), first_seen_at: ago(72), updated_at: ago(72), posted_date: plus(-3) });
  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body; const text = (await ctx.owner.req('GET', '/api/sales/digest?preview=text')).body;
  assert.match(html, /진행 중\(D-3 안\) <span[^>]*>12<\/span>/, '구역 머리 건수는 전체');
  assert.equal((html.match(/data-digest-item="soon"/g) ?? []).length, 10, '줄은 10건까지');
  assert.ok(html.includes('data-digest-more="soon"') && html.includes('나머지 2건 — <a href=') && html.includes('/s/sales/hub?tab=bids&amp;bt=open'));
  assert.ok(text.includes('■ 진행 중(D-3 안) (12)') && text.includes('나머지 2건 — 보기: ') && text.includes('/s/sales/hub?tab=bids&bt=open'));
});

// 215차(#530 로컬 10/24 21라인 실메일 대조 ①~⑨ + 주의): 받은 기간 · 맞춤 조건 상자 · 금액 나눔 · 지역 제한 + 본사 기준 참가 가능/불가 · 일정 줄 · 배지 확대 · 구역 안 사업별 묶음 · 진행·담당 ·
// 결과 낙찰률·참가 수(결과는 처음 안 때 기준 — 예전 결과가 다시 고쳐져도 다시 안 오름) · 정기 시각 전 [지금 보내기] = 시험 발송(누른 사람에게만·기록 없음 → 정기 메일 그대로)
test('215차 #530 21라인 이상: 받은 기간·맞춤 조건·금액 나눔·참가 가능·일정·배지·사업별 묶음·진행 담당·낙찰률 · 새벽 [지금 보내기] = 시험 발송', async (t) => {
  await ctx.owner.ok('PUT', '/api/sales/business-categories', { items: [{ key: 'biz-a', name: '시험사업A', color: '#2563EB', keywords: ['피트니스'] }, { key: 'biz-b', name: '시험사업B', color: '#DC2626', keywords: ['출입통제'] }] });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시' });
  const g = { source_type: 'g2b_bid', fit_business: '다짐', classification: '즉시 검토', bid_category: '용역', first_seen_at: ago(1), updated_at: ago(1) };
  await ins(51, { ...g, source_external_id: 'R215-1-000', title: '시험시 피트니스센터 위탁운영 215 서울 제한', issuer: '서울특별시 시험구', region: '서울특별시', region_restriction: '서울특별시', estimated_amount: 50000000,
    site_briefing_at: at(plus(4), '10:00'), participation_deadline_at: at(plus(8), '18:00'), deadline_at: at(plus(12), '10:00'), opening_at: at(plus(12), '11:00'), source_url: 'https://www.g2b.go.kr/link/R215-1' });
  await ins(52, { ...g, source_external_id: 'R215-2-000', title: '시험시 피트니스 위탁 215 경기 제한', issuer: '경기도 시험시', region: '경기도', region_restriction: '경기도', base_amount: 100000000, estimated_amount: 90909091, budget_amount: 100000000,
    contract_method: '수의계약', site_briefing_at: at(plus(-1), '10:00'), deadline_at: at(plus(11), '10:00'), source_url: 'https://www.g2b.go.kr/link/R215-2' }); // 현장설명이 이미 지남 → 배지 없음(일정 줄에는 남음)
  await ins(53, { ...g, fit_business: '하이링크', source_external_id: 'R215-3-000', title: '시험 단지 출입통제 시스템 구축 215', issuer: '시험 관리사무소', deadline_at: at(plus(13), '10:00'), source_url: 'https://www.g2b.go.kr/link/R215-3' });
  await ins(54, { ...g, source_external_id: 'R215-4-000', title: '피트니스 출입통제 통합 구축 215', issuer: '시험 관리사무소', deadline_at: at(plus(14), '10:00'), source_url: 'https://www.g2b.go.kr/link/R215-4' });
  // ⑨ 진행·담당: 진행 기록(검토중) + 입찰 업무 담당
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('default', 'opportunity_work', 'w215-3', ${sql.json({ id: 'w215-3', notice_id: ID(53), status: '검토중' })}, 'workin')`;
  const tk = await ctx.owner.ok('POST', '/api/tasks', { title: '출입통제 215 입찰 준비', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: ID(53) })} where id = ${tk.id}`;
  const [{ name: staffName }] = await sql`select name from users where id = ${ctx.staffA.id}`;
  // ⑥ 결과: 처음 안 때(result_at)가 지난 메일 뒤면 결과 구역 — 낙찰률·참가 수 · 예전 결과가 다시 고쳐진 줄(result_at 예전·개찰 30일 전 예전 줄)은 안 나옴
  const r = { source_type: 'g2b_bid', fit_business: '다짐', bid_category: '용역', current_status: '낙찰', first_seen_at: ago(240), updated_at: ago(1), deadline_at: at(plus(-5), '10:00') };
  await ins(55, { ...r, source_external_id: 'R215-5-000', title: '시험구 체육관 위탁운영 215 결과', winner_name: '시험낙찰(주)', winner_amount: 120000000, winner_rate: 88.123, bidders: 7, award_date: today, result_at: ago(1), source_url: 'https://www.g2b.go.kr/link/R215-5' });
  await ins(56, { ...r, source_external_id: 'R215-6-000', title: '시험구 체육관 위탁운영 215 예전 결과 다시 고침', winner_name: '예전낙찰(주)', winner_amount: 90000000, award_date: plus(-20), result_at: ago(240), source_url: 'https://www.g2b.go.kr/link/R215-6' });
  await ins(57, { ...r, source_external_id: 'R215-7-000', title: '시험구 체육관 위탁운영 215 예전 줄(결과 시각 없음)', winner_name: '옛낙찰(주)', award_date: plus(-30), source_url: 'https://www.g2b.go.kr/link/R215-7' });

  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body; const text = (await ctx.owner.req('GET', '/api/sales/digest?preview=text')).body;
  const item = (title) => { const k = html.indexOf(title); assert.ok(k > 0, title); return html.slice(html.lastIndexOf('<tr>', k), html.indexOf('</td></tr>', k)); };
  // ① 받은 기간(지난 메일 = 어제 08:00 ~ 지금) ② 맞춤 조건 상자 + [바꾸기]
  assert.match(html, new RegExp(`data-digest-period="1">받은 기간 ${mdw(plus(-1)).replace(/[()]/g, '\\$&')} 08:00 ~ ${mdw(today).replace(/[()]/g, '\\$&')} \\d{2}:\\d{2}<`));
  assert.ok(html.includes('data-digest-cond="1"><b style="color:#111827;margin-right:4px">맞춤 조건</b>관심 사업 시험사업A·시험사업B · 관심 검색어 1개 · 제외어 1개 · 지역 전국 · 금액 제한 없음 · 본사 경기 용인시 — <a href="'), html.slice(html.indexOf('data-digest-cond'), html.indexOf('data-digest-cond') + 400));
  // ③ 금액 나눔 ④ 지역 제한 + 본사 기준(같은 시·도 하나면 지역은 한 번만) ⑦ 배지
  const x1 = item('시험시 피트니스센터 위탁운영 215 서울 제한');
  assert.ok(x1.includes('서울특별시 시험구 · 추정가격 5,000만원 · <b style="color:#B91C1C" data-digest-limit="no">지역 제한 서울 — 참가 불가(본사 경기 용인시)</b>') && !x1.includes('서울특별시 ·'), x1);
  assert.ok(x1.includes('>현장설명</span>'), '현장설명 배지');
  // ⑤ 일정 줄: 현장설명 → 참가신청마감 → 입찰마감 D-day → 개찰
  assert.ok(x1.includes(`data-digest-sched="1"><b style="color:#6B7280;margin-right:4px">일정</b>현장설명 ${mdw(plus(4))} 10:00 · 참가신청마감 ${mdw(plus(8))} 18:00 · 입찰마감 ${mdw(plus(12))} 10:00 <b style="color:#374151">D-12</b> · 개찰 ${mdw(plus(12))} 11:00</div>`), x1);
  const x2 = item('시험시 피트니스 위탁 215 경기 제한');
  assert.ok(x2.includes('경기도 시험시 · 기초금액 1억 · 추정가격 9,091만원 · 배정예산 1억 · <b style="color:#047857" data-digest-limit="ok">지역 제한 경기 — 참가 가능</b>'), x2);
  assert.ok(x2.includes('>수의계약</span>') && !x2.includes('>현장설명</span>') && x2.includes(`일정</b>현장설명 ${mdw(plus(-1))} 10:00 · 입찰마감`), '지난 현장설명은 배지 없이 일정 줄에만');
  // ⑨ 진행·담당
  assert.ok(item('시험 단지 출입통제 시스템 구축 215').includes(`<b style="color:#047857" data-digest-progress="1">진행 검토중 · 담당 ${staffName}</b>`));
  // ⑧ 구역 안 사업별 묶음(관심 사업 순서 → 사업 이름 없이 적합만 → 여러 사업) · 머리 사업별 건수 · 번호는 구역 안에서 이어서
  const now = html.slice(html.indexOf('data-digest-section="now"'), html.indexOf('data-digest-section="review"'));
  assert.deepEqual([...now.matchAll(/data-digest-group="([^"]+)"/g)].map((m) => m[1]), ['시험사업A', '시험사업B', '다짐', '시험사업A·시험사업B']);
  assert.deepEqual([...now.matchAll(/font-weight:600;margin-right:4px">(\d+)\.<\/span>/g)].map((m) => Number(m[1])), [1, 2, 3, 4, 5, 6]);
  assert.match(now, /data-digest-group="시험사업A">[\s\S]*?3건<\/span>/);
  assert.match(html, /data-digest-biz="1">사업별 새 공고 시험사업A 3 · 시험사업B 1 · 다짐 2 · 시험사업A·시험사업B 1</);
  // ⑥ 결과: 낙찰 배지·낙찰률·참가 수 · 예전 결과는 안 나옴
  const res = html.slice(html.indexOf('data-digest-section="result"'));
  assert.ok(res.includes('>낙찰</span>') && res.includes('낙찰 시험낙찰(주) · 낙찰금액 1.2억 · 낙찰률 88.123% · 참가 7곳'), res.slice(0, 1500));
  assert.ok(!html.includes('예전 결과 다시 고침') && !html.includes('예전 줄(결과 시각 없음)'), '예전 결과는 다시 안 오름');
  // 텍스트판
  assert.ok(text.split('\n')[1].startsWith(`받은 기간 ${mdw(plus(-1))} 08:00 ~ `), text.slice(0, 200));
  assert.ok(text.includes('맞춤 조건: 관심 사업 시험사업A·시험사업B · 관심 검색어 1개 · 제외어 1개 · 지역 전국 · 금액 제한 없음 · 본사 경기 용인시 — 바꾸기: '));
  assert.ok(text.includes('  ◇ 시험사업A 3건') && text.includes(`   일정: 현장설명 ${mdw(plus(4))} 10:00 · 참가신청마감 ${mdw(plus(8))} 18:00 · 입찰마감 ${mdw(plus(12))} 10:00 D-12 · 개찰`));
  assert.ok(text.includes('지역 제한 서울 — 참가 불가(본사 경기 용인시)') && text.includes(`진행 검토중 · 담당 ${staffName}`));

  // 주의(로컬 10/24): 정기 시각 전 [지금 보내기] → 시험 발송(누른 사람에게만, 기록·알림 없음) → 정기 실행은 그대로 보냄
  const kh = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
  if (kh >= 23) { t.diagnostic('서울 23시 — 정기 시각 전을 만들 수 없어 시험 발송 확인은 건너뜀'); return; }
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestHour: 23, digestEmails: ['office@mail.test'] });
  await sql`delete from sales_digests where tenant = 'default' and day = ${today}`;
  const nb = (await sql`select count(*)::int n from notifications where type = 'briefing'`)[0].n;
  resent.length = 0;
  const tr = await ctx.owner.ok('POST', '/api/sales/digest/send', {});
  assert.deepEqual([tr.test, tr.hour, tr.mailed, tr.notified], [true, 23, 1, 0], JSON.stringify(tr));
  assert.equal(resent.length, 1); assert.deepEqual(resent[0].to, ['ceo@dagym.test'], '누른 사람에게만(직접 넣은 주소·담당에게는 안 감)');
  assert.ok(resent[0].subject.startsWith(`[시험 발송] [${FROM_NAME}] `) && resent[0].html.includes('data-digest-test="1"') && resent[0].html.includes('오늘 23:00 정기 메일은 그대로 갑니다'), resent[0].subject);
  assert.equal((await sql`select count(*)::int n from sales_digests where day = ${today}`)[0].n, 0, '오늘 기록 없음 → 정기 발송이 건너뛰지 않음');
  assert.equal((await sql`select count(*)::int n from notifications where type = 'briefing'`)[0].n, nb, '시험 발송은 알림 없음');
  // 정기 시각이 되면(여기서는 0시로 바꿔) 정기 실행이 그대로 보냄
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { digestHour: 0 });
  resent.length = 0;
  const tick = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
  assert.equal(tick.status, 200);
  const [row] = await sql`select mailed, notified from sales_digests where tenant = 'default' and day = ${today}`;
  assert.ok(row && row.mailed >= 1, JSON.stringify(row)); assert.ok(resent.some((m) => !m.subject.startsWith('[시험 발송]') && m.to.includes('office@mail.test')), JSON.stringify(resent.map((m) => [m.subject, m.to])));
});
