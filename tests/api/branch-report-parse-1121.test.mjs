// #1096 지점 주간보고(다짐 전용) 1단계 — 카카오톡 내보내기 해석·개인정보 가림(docs/branch-report-design.md 2·3절). 서버·DB 없이 Node 로 바로 확인.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

const { parseKakaoExport, unzipTexts } = await import('../../src/lib/branchReport/kakaoParse.ts');
const { maskPII } = await import('../../src/lib/branchReport/mask.ts');

const PC = `가상지점 운영방 님과 카카오톡 대화
저장한 날짜 : 2026-11-21 18:00:00

--------------- 2026년 11월 17일 화요일 ---------------
가나다님이 들어왔습니다.
[김관리] [오전 9:05] 헬스장 러닝머신 3번 소음 있습니다
[김관리] [오전 9:06] 사진
[이매니저] [오후 1:30] 수리 업체 연락했습니다
내일 오전 방문 예정
[이매니저] [오후 12:10] 점심 교대합니다
--------------- 2026년 11월 18일 수요일 ---------------
[김관리] [오전 10:00] 러닝머신 3번 수리 완료
[박직원] [오후 3:15] 삭제된 메시지입니다.`;
const MOBILE = `2026년 11월 18일 수요일
2026년 11월 18일 오전 10:00, 김관리 : 러닝머신 3번 수리 완료
2026년 11월 19일 오후 4:20, 박직원 : 사우나 온도 민원 접수
2026. 11. 20. 오전 7:05, 김관리 : 샤워실 배수구 점검
2026. 11. 20. 18:30, 이매니저 : 금요일 마감 정리`;
const CSV = `Date,User,Message
2026-11-19 16:20:00,"박직원","사우나 온도 민원 접수"
2026-11-21 09:00:00,"김관리","주간 보고 준비, 이번 주 특이사항:
1) 러닝머신 수리
2) 사우나 민원"
2026-11-21 09:01:00,"김관리","사진"`;

test('PC txt: 날짜 줄·[이름] [오전/오후 시:분]·여러 줄 메시지 · 입장·사진·삭제 메시지 뺌 · 12시 오후', () => {
  const r = parseKakaoExport([{ name: 'talk.txt', data: PC }]);
  assert.deepEqual(r.formats, ['pc-txt']);
  assert.deepEqual(r.messages.map((m) => [m.at, m.sender, m.text]), [
    ['2026-11-17T09:05', '김관리', '헬스장 러닝머신 3번 소음 있습니다'],
    ['2026-11-17T12:10', '이매니저', '점심 교대합니다'],
    ['2026-11-17T13:30', '이매니저', '수리 업체 연락했습니다\n내일 오전 방문 예정'],
    ['2026-11-18T10:00', '김관리', '러닝머신 3번 수리 완료'],
  ]);
  assert.equal(r.from, '2026-11-17'); assert.equal(r.to, '2026-11-18');
  assert.ok(r.skipped >= 3, `입장·사진·삭제 뺌(${r.skipped})`);
});

test('모바일 txt(년월일·점 찍은 날짜·24시) + csv(따옴표 안 줄바꿈·쉼표) + 겹치는 메시지는 한 번 · 시각 순', () => {
  const r = parseKakaoExport([{ name: 'pc.txt', data: PC }, { name: 'mobile.txt', data: MOBILE }, { name: 'mac.csv', data: CSV }]);
  assert.deepEqual(r.formats, ['csv', 'mobile-txt', 'pc-txt']);
  assert.equal(r.duplicates, 2, '같은 시각·사람·내용(수리 완료, 사우나 민원)은 한 번');
  assert.deepEqual(r.messages.slice(-4).map((m) => `${m.at} ${m.sender}`), ['2026-11-19T16:20 박직원', '2026-11-20T07:05 김관리', '2026-11-20T18:30 이매니저', '2026-11-21T09:00 김관리']);
  assert.equal(r.messages.length, 8, 'PC 4 + 모바일 새 것 3 + csv 새 것 1');
  const csvMsg = r.messages.find((m) => m.at === '2026-11-21T09:00');
  assert.equal(csvMsg.text, '주간 보고 준비, 이번 주 특이사항:\n1) 러닝머신 수리\n2) 사우나 민원');
  assert.ok(!r.messages.some((m) => m.text === '사진'), 'csv 의 사진 줄도 뺌');
  assert.deepEqual([r.from, r.to], ['2026-11-17', '2026-11-21']);
  for (let i = 1; i < r.messages.length; i++) assert.ok(r.messages[i - 1].at <= r.messages[i].at, '시각 순');
});

test('zip: 안의 txt·csv(저장·압축 모두) 읽음 · __MACOSX 무시', () => {
  const entries = [{ name: 'KakaoTalk_Chat.txt', data: Buffer.from(MOBILE), deflate: true }, { name: 'chat.csv', data: Buffer.from(CSV), deflate: false }, { name: '__MACOSX/._chat.csv', data: Buffer.from('x'), deflate: false }];
  const zip = makeZip(entries);
  assert.deepEqual(unzipTexts(zip).map((f) => f.name), ['KakaoTalk_Chat.txt', 'chat.csv']);
  const r = parseKakaoExport([{ name: 'export.zip', data: zip }]);
  assert.ok(r.formats.includes('zip') && r.formats.includes('csv') && r.formats.includes('mobile-txt'));
  assert.equal(r.messages.filter((m) => m.text === '사우나 온도 민원 접수').length, 1, 'zip 안 두 파일의 같은 메시지도 한 번');
  assert.throws(() => unzipTexts(Buffer.from('not a zip')), /zip 파일이 아닙니다/);
});

test('가림: 전화·주민번호·카드·계좌·차량·동호수·이메일 → 표시만 · 날짜·시간·금액·호기는 그대로', () => {
  const src = '101동 1203호 누수, 1502호도 확인. 연락처 010-1234-5678 / 02)555-1234 / 1588-1234, 주민 900101-1234567, 카드 1234-5678-9012-3456, 계좌 110-123-456789, 차량 12가3456·서울 123나 4567, 메일 a.b@test.co.kr';
  const { text, counts } = maskPII(src);
  assert.equal(text, '[호수] 누수, [호수]도 확인. 연락처 [전화] / [전화] / [전화], 주민 [주민번호], 카드 [카드], 계좌 [계좌], 차량 [차량]·[차량], 메일 [이메일]');
  assert.deepEqual(counts, { email: 1, rrn: 1, card: 1, phone: 3, car: 2, unit: 2, account: 1 });
  // 로컬 11/21 실측에서 새던 모양: 줄 맨 앞 목록 표시 '-' 바로 뒤에 붙은 휴대폰 번호
  assert.equal(maskPII('민원 접수\n -010-1234-5678 (입주민)\n- 010 9876 5432').text, '민원 접수\n -[전화] (입주민)\n- [전화]');
  const keep = '2026년 11월 21일 오후 2:05, 12월 2026 계획, 30분 1000원, 엘리베이터 2호기, 3번 러닝머신, 온도 26도';
  assert.equal(maskPII(keep).text, keep, '건드리지 않음');
});

/** 시험용 zip 만들기(로컬 헤더 + 중앙 목록) */
function makeZip(entries) {
  const locals = []; const centrals = []; let off = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name); const body = e.deflate ? deflateRawSync(e.data) : e.data; const method = e.deflate ? 8 : 0;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(method, 8); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(e.data.length, 22); lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(method, 10); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(e.data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(off, 42);
    centrals.push(ch, name);
    off += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
