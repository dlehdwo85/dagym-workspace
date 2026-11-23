// #1096 지점 주간보고(다짐 전용) 1단계 — 카카오톡 내보내기 해석·개인정보 가림(docs/branch-report-design.md 2·3절). 서버·DB 없이 Node 로 바로 확인.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';

const { parseKakaoExport, unzipTexts } = await import('../../src/lib/branchReport/kakaoParse.ts');
const { maskPII } = await import('../../src/lib/branchReport/mask.ts');
const { checkFacilityStatus, gradesIn, applyOkMark, splitGrade, fixFacilityStatus, tidyCheckLine, settleDone } = await import('../../src/lib/branchReport/facilityStatus.ts');

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

test('로컬 11/21: 청소 상태·시설 상태는 그 시설의 원문 줄 값만 — 시설 상태가 설명뿐이거나 줄이 없으면 확인 필요', () => {
  const D = `오산더샵 주간보고
<헬스장>
청소상태 : 청결
시설상태 : 런닝머신 인버터 청소완료
<골프장> 총이용인원 47 / 청소상태 청결
<독서실> 청소상태 보통 / 시설상태 부분양호`;
  const c = (f, field, v) => checkFacilityStatus(D, f, field, v);
  assert.equal(c('헬스장', 'cleaning', '청결'), '청결');
  assert.equal(c('헬스장', 'condition', '청결'), '확인 필요', '청소 상태 값을 옮겨 적음(원문 시설상태는 설명뿐)');
  assert.equal(c('헬스장', 'condition', '런닝머신 인버터 청소완료'), '확인 필요', '시설 상태는 등급 단어만');
  assert.equal(c('골프장', 'condition', '청결'), '확인 필요', '골프장에는 시설상태 줄이 없음');
  assert.equal(c('골프장', 'cleaning', '청결'), '청결');
  assert.equal(c('독서실', 'condition', '부분양호'), '부분양호');
  assert.equal(c('독서실', 'condition', '양호'), '확인 필요', "'부분양호' 안의 '양호'를 따로 세지 않음");
  assert.equal(c('독서실', 'cleaning', '청결'), '확인 필요', '다른 시설의 값');
  assert.equal(c('헬스장', 'condition', ''), ''); assert.equal(c('헬스장', 'condition', '확인 필요'), '확인 필요');
  assert.equal(checkFacilityStatus('청소상태 양호 / 시설상태 양호', '사우나', 'condition', '양호'), '양호', '시설 머리 줄이 없으면 글 전체에서');
  assert.deepEqual(gradesIn('부분양호, 일부 미흡'), ['부분양호', '미흡']);
});

test("#1105: 점검 줄 값이 0·O·○ 하나뿐이면 '이상 없음'·완료(원문 줄에서 확인) — '진행0'·다른 시설·숫자 칸은 그대로", () => {
  const D = `<골프장> 총이용인원 47
- 프로젝터 램프 : 0
- 티업기계 작동 여부 : O
- 고무패드 : ○
- 기구윤활유 : 머신전체 WD 진행0
<헬스장>
- 프로젝터 램프 : 교체 필요`;
  const L = (item, evidence = [], status = '0', state = '확인 필요') => ({ item, status, action: '', state, evidence });
  assert.deepEqual(applyOkMark(D, '골프장', L('프로젝터 램프')), { ...L('프로젝터 램프'), status: '이상 없음', state: '완료', evidence: ['D2'] }, '근거가 없으면 그 줄 번호');
  assert.deepEqual(applyOkMark(D, '골프장', L('티업기계 작동', ['D3'])).status, '이상 없음');
  assert.deepEqual(applyOkMark(D, '골프장', L('티업기계 작동 여부', ['D3'])).evidence, ['D3'], '근거 번호 그대로');
  assert.equal(applyOkMark(D, '골프장', L('고무패드')).state, '완료');
  assert.equal(applyOkMark(D, '골프장', L('기구윤활유', ['D5'], '진행0')).status, '진행0', "'진행0'은 그대로");
  assert.equal(applyOkMark(D, '헬스장', L('프로젝터 램프', [], '교체 필요')).status, '교체 필요', '다른 시설의 0 을 가져오지 않음');
  assert.equal(applyOkMark(D, '골프장', L('없는 항목')).status, '0', '원문에 없으면 그대로');
});

test("로컬 11/21 재확인: 등급 뒤에 설명이 붙으면 등급만 받고 설명은 원문에 있을 때 점검 줄로(과잉 거부 고침)", () => {
  assert.deepEqual(splitGrade('청결 / 연습실 내부룸 먼지로 청소완료'), { grade: '청결', rest: '연습실 내부룸 먼지로 청소완료' });
  assert.deepEqual(splitGrade('부분양호(런닝머신 1대 점검)'), { grade: '부분양호', rest: '런닝머신 1대 점검' });
  assert.deepEqual(splitGrade('청결함'), { grade: null, rest: '청결함' }, '등급 단어 뒤에 글자가 붙으면 등급 아님');
  assert.deepEqual(splitGrade('양호'), { grade: '양호', rest: '' });
  const D = `<골프장> 총이용인원 47
- 청소상태 : 청결 / 연습실 내부룸 먼지로 청소완료
- 프로젝터 램프 점검 여부 : 0
<헬스장>
시설상태 : 런닝머신 인버터 청소완료`;
  const golf = fixFacilityStatus(D, { name: '골프장', cleaning: '청결 / 연습실 내부룸 먼지로 청소완료', condition: '', lines: [] });
  assert.equal(golf.cleaning, '청결');
  assert.deepEqual(golf.extra, [{ item: '연습실 내부룸 먼지로 청소완료', status: '완료', action: '', state: '완료', evidence: ['D2'] }]);
  const golf2 = fixFacilityStatus(D, { name: '골프장', cleaning: '청결 / 연습실 내부룸 먼지로 청소완료', condition: '', lines: [{ item: '연습실 내부룸 청소', status: '완료', action: '', state: '완료', evidence: ['D2'] }] });
  assert.equal(golf2.cleaning, '청결'); assert.deepEqual(golf2.extra, [], '같은 내용 점검 줄이 있으면 더하지 않음');
  const gym = fixFacilityStatus(D, { name: '헬스장', cleaning: '', condition: '런닝머신 인버터 청소완료', lines: [] });
  assert.equal(gym.condition, '확인 필요'); assert.deepEqual(gym.extra.map((x) => [x.item, x.evidence[0]]), [['런닝머신 인버터 청소완료', 'D5']], '설명은 점검 줄로');
  const made = fixFacilityStatus(D, { name: '골프장', cleaning: '청결 / 바닥 왁스 코팅 완료', condition: '', lines: [] });
  assert.equal(made.cleaning, '청결'); assert.deepEqual(made.extra, [], '원문에 없는 설명은 버림');
  const badGrade = fixFacilityStatus(D, { name: '골프장', cleaning: '미흡 / 연습실 내부룸 먼지로 청소완료', condition: '', lines: [] });
  assert.equal(badGrade.cleaning, '확인 필요', '원문과 다른 등급은 확인 필요');
});

test("로컬 11/21 재확인: 점검 줄 이름에서 원문 칸 이름을 떼고 '…완료'는 상태로 · 원문 줄에 '완료'가 있으면 완료('예정'은 그대로)", () => {
  const L = (item, status = '', state = '확인 필요', evidence = [], action = '') => ({ item, status, action, state, evidence });
  assert.deepEqual(tidyCheckLine(L('청소상태 부가 설명 : 연습실 내부룸 먼지로 청소완료')), L('연습실 내부룸 먼지로 청소', '완료'));
  assert.deepEqual(tidyCheckLine(L('시설상태 : 런닝머신 인버터 청소완료', '완료')), L('런닝머신 인버터 청소', '완료'));
  assert.deepEqual(tidyCheckLine(L('타석 3번 센서', '완료')), L('타석 3번 센서', '완료'), '그대로');
  assert.deepEqual(tidyCheckLine(L('조명 교체 완료 예정')), L('조명 교체 완료 예정'), "'예정'은 그대로");
  const D = `<헬스장>
- 런닝머신 인버터 청소완료
- 사이클 페달 교체 완료 예정
- 바닥 매트 점검중`;
  assert.deepEqual(settleDone(D, L('시설상태 : 런닝머신 인버터 청소완료')), L('시설상태 : 런닝머신 인버터 청소완료', '완료', '완료', ['D2']), '근거가 없으면 원문 줄을 찾아 완료');
  assert.equal(settleDone(D, L('런닝머신 인버터 청소완료', '', '확인 필요', ['D4'])).state, '확인 필요', "근거 줄에 '완료'가 없으면 그대로");
  assert.equal(settleDone(D, L('사이클 페달 교체 완료 예정')).state, '확인 필요', "'예정'은 그대로");
  assert.equal(settleDone(D, L('런닝머신 인버터 청소완료', '', '진행 중')).state, '진행 중', "'확인 필요'만 바꿈");
  assert.equal(settleDone(D, L('바닥 왁스 코팅 완료')).state, '확인 필요', '원문에 없는 완료는 그대로');
});

test('#1096 2단계 월간: 주차 이름 · 증감·증감률 · 미완료 추적(완료 뒤 다시 열린 것은 미완료) · C 는 마지막 주 기준', async () => {
  const { weekLabel, delta, trackItems, usageC, monthRange, prevMonth } = await import('../../src/lib/branchReport/monthly.ts');
  assert.equal(weekLabel('2026-10-02'), '1주차(10/2)'); assert.equal(weekLabel('2026-10-30'), '5주차(10/30)');
  assert.deepEqual(monthRange('2026-02'), { start: '2026-02-01', end: '2026-02-28' }); assert.equal(monthRange('2026-2'), null); assert.equal(prevMonth('2026-01'), '2025-12');
  assert.deepEqual(delta('50명', '47'), { diff: '-3', rate: '▼6%' }); assert.deepEqual(delta('확인 필요', '47'), { diff: '', rate: '' }); assert.deepEqual(delta('0', '5'), { diff: '+5', rate: '' });
  const w = (day, issues, usage = []) => ({ id: day, day, body: { usage, issues } });
  const t = trackItems([w('2026-10-02', [{ title: '누수', state: '진행 중' }, { title: '조명', state: '진행 중' }]), w('2026-10-09', [{ title: '누수', state: '완료' }, { title: '조명', state: '완료' }]), w('2026-10-16', [{ title: '조 명', state: '진행 중' }])]);
  assert.deepEqual(t.unfinished.map((x) => [x.title, x.state, x.since, x.lastWeek]), [['조명', '진행 중', '10/2', '10/16']], '완료 뒤 다시 열림 → 미완료(띄어쓰기 달라도 같은 항목)');
  assert.deepEqual(t.resolved, [{ title: '누수', doneWeek: '10/9' }]);
  assert.deepEqual(usageC([w('2026-10-02', [], [{ item: '헬스', count: '410' }, { item: '골프', count: '45' }]), w('2026-10-16', [], [{ item: '헬스', count: '443' }])], null),
    [{ item: '헬스', prev: '', cur: '443' }, { item: '골프', prev: '', cur: '45' }], '마지막 주에 없는 항목은 그 전 주 값');
});

test("로컬 11/21: 시설별 이용 현황 합계에 단위 — 같은 단위면 '543명', 섞이거나 없으면 숫자만, 빈 칸이 있으면 빈 글", async () => {
  const { sumCol, delta } = await import('../../src/lib/branchReport/monthly.ts');
  assert.equal(sumCol(['443명', '47명', '15명', '16명', '22명']), '543명');
  assert.equal(sumCol(['443', '47']), '490');
  assert.equal(sumCol(['443명', '5건']), '448', '단위가 섞이면 숫자만');
  assert.equal(sumCol(['443명', '']), '', '빈 칸이 있으면 합계 없음');
  assert.deepEqual(delta('500명', '543명'), { diff: '+43', rate: '▲8.6%' });
});

test('#1106 하이링크 이용현황 표 읽기: 줄 모양·글자가 붙은 PDF 글·칸마다 줄바꿈·표 아닌 글', async () => {
  const { parseHilinkUsage } = await import('../../src/lib/branchReport/hilinkUsage.ts');
  const a = parseHilinkUsage('시설별 이용현황 2026년 11월\n시설 전달 인원 이번달 인원 증감 증감률\n헬스장 1,234명 1,240명 +6명 ▲ 0.4%\n골프장 269명 174명 -95명 ▼ 35.3%\n전시설 총 이용현황 1,503명 1,414명 -89명 ▼ 5.9%');
  assert.deepEqual(a.rows.map((r) => r.item), ['헬스장', '골프장']); assert.equal(a.rows[1].diff, '-95명'); assert.equal(a.total.item, '전시설 총 이용현황');
  const b = parseHilinkUsage('시설별 이용현황시설전달 인원이번달 인원증감증감률헬스장1,234명1,240명+6명▲ 0.4%골프장269명174명-95명▼ 35.3%');
  assert.deepEqual(b.rows.map((r) => [r.item, r.prev, r.cur, r.diff, r.rate]), [['헬스장', '1,234명', '1,240명', '+6명', '▲0.4%'], ['골프장', '269명', '174명', '-95명', '▼35.3%']]);
  const c = parseHilinkUsage('시설\n전달 인원\n이번달 인원\n증감\n증감률\n스크린 골프\n120명\n-\n-\n-\n독서실\n38명\n40명\n+2명\n▲ 5.3%');
  assert.deepEqual(c.rows.map((r) => r.item), ['스크린 골프', '독서실']);
  assert.deepEqual(parseHilinkUsage('안녕하세요 11월 21일 보고서 3쪽'), { rows: [], total: null });
});

test("로컬 11/21 실제 하이링크 PDF: 머리줄 '증감률(%)' 이 '증감률'·'(%)' 로 끊겨도 첫 시설 이름에 붙지 않음 · '|' 칸 구분 · 떨어진 '%'", async () => {
  const { parseHilinkUsage } = await import('../../src/lib/branchReport/hilinkUsage.ts');
  const a = parseHilinkUsage('■ 시설별 이용 현황 (전월 대비)\n시설 전달 인원 이번달 인원 인원 증감 증감률\n(%)\n헬스장 1,690명 1,696명 +6명 ▲ 0.4%\n실내체육관 10명 8명 -2명 ▼ 20.0%\n전시설 총 이용현황 7,407명 5,308명 -2,099명 ▼ 28.3%\n비고');
  assert.deepEqual(a.rows.map((r) => r.item), ['헬스장', '실내체육관']); assert.equal(a.total.cur, '5,308명'); assert.equal(a.total.diff, '-2,099명');
  const b = parseHilinkUsage('시설전달 인원이번달 인원인원 증감증감률(%)헬스장1,690명1,696명+6명▲ 0.4%');
  assert.equal(b.rows[0].item, '헬스장', '붙어 나온 머리줄');
  const c = parseHilinkUsage('시설 | 전달 인원 | 이번달 인원 | 인원 증감 | 증감률(%)\n헬스장 | 1,690명 | 1,696명 | +6명 | ▲ 0.4 %\n스크린골프(2층) 30명 31명 +1명 ▲ 3.3%');
  assert.deepEqual(c.rows.map((r) => [r.item, r.rate]), [['헬스장', '▲0.4%'], ['스크린골프(2층)', '▲3.3%']], "'|' 칸 구분·떨어진 % · 괄호 든 이름");
});

test('#1112 하이링크 회원목록 집계: 이용권 묶음·활성(상태를 믿음)·세대·부과·신규·종료·동별 · 시험·직원 줄 제외/포함 · 이름·연락처 칸은 안 읽음', async () => {
  const m = await import('../../src/lib/branchReport/memberList.ts');
  const g = (x) => m.groupOf(x);
  assert.deepEqual(['헬스권', '(남) 헬스+골프+수영', '헬스장 락커 (소) ', '골프장 락커', '남자 독서실', '여자독서실', '오전 수영강습A (월수금 9시)', '어린이 수영', '수영 개인강습 8회(김코치)', '오후 요가', '줌바', '매트필라', '다이어트 댄스', '키즈 댄스', '골프레슨 8회', 'PT 8회', '테스트'].map(g),
    ['헬스', '통합(헬스+골프+수영)', '락커', '락커', '독서실', '독서실', '수영 강습', '수영 강습', '수영 강습', 'GX', 'GX', 'GX', 'GX', 'GX', '골프 레슨', 'PT', '기타']);
  const H = ['순번', '동', '호수', '이름', '연락처', '이용권명', '금액', '시작일', '종료일', '이용권 상태', '락커', '자리번호', '부과월'];
  assert.equal(m.headerIndex(H).dong, 1); assert.equal(Object.values(m.headerIndex(H)).includes(3), false, '이름 칸(3)·연락처 칸(4)은 찾지 않음');
  const R = [
    ['1', '401', '1203', 'A', 'P', '헬스권', '50000', '2026-11-03', '', '활성', 'X', '', '매월'],
    ['2', '401', '1203', 'B', 'P', '(여) 헬스+골프+수영', '120000', '2026-10-01', '', '활성', 'O', '12', '매월'],
    ['3', '402', '101', 'C', 'P', '오전 수영강습A', '80000', '2026-09-01', '', '만료', 'X', '', '매월'],
    ['4', '402', '101', 'D', 'P', '-', '0', '', '', '-', 'X', '', '매월'],
    ['5', '999', '1', 'E', 'P', '헬스권', '0', '2026-11-01', '', '활성', 'X', '', '매월'],
    ['6', '403', '505', 'F', 'P', '테스트', '0', '', '', '활성', 'X', '', '매월'],
    ['7', '403', '505', 'G', 'P', 'PT 8회', '400000', '2026-07-01', '2026-11-15', '활성', 'X', '', '매월'],
  ];
  const r = m.aggregateMembers(H, R, '2026-11');
  assert.equal(r.ok, true); assert.equal(r.excluded, 2);
  const all = m.viewOf(r.stats, {}, 'all');
  assert.deepEqual([all.active, all.households, all.billing, all.newThisMonth, all.endedThisMonth], [3, 2, 570000, 1, 1]);
  assert.deepEqual(all.byDong, { 401: 2, 403: 1 }); assert.equal(all.groups['헬스'], 1); assert.equal(all.groups['PT'], 1);
  const allX = m.viewOf(r.statsAll, {}, 'all'); assert.deepEqual([allX.active, allX.households], [5, 3], '제외 끔');
  assert.ok(!/"[A-G]"|"P"|1203|"101"|"505"/.test(JSON.stringify(r)), '저장 형태에 이름·연락처·호수 없음');
  assert.equal(m.aggregateMembers(['순번', '동'], [], '2026-11').ok, false, '필요한 칸이 없으면 실패');
  assert.deepEqual(m.compare(6, 10), { diff: -4, rate: -40, drop: true }); assert.equal(m.compare(7, 10).drop, false, '정확히 30% 는 빨강 아님'); assert.equal(m.compare(3, null), null);
  assert.equal(m.monthFromName('회원목록_2026-11-20.xlsx'), '2026-11');
});

test('#1115 이용권/수강권: 기본 분류 · 띄어쓰기만 다른 이름은 하나 · 선택별 숫자(세대는 겹치면 한 번) · 이용권+수강권 = 전체 · 분류 바꾸기 · 수강권 강좌표(활성 0 접기) · 예전 형태', async () => {
  const m = await import('../../src/lib/branchReport/memberList.ts');
  assert.deepEqual(['헬스권', '(남) 헬스+골프+수영', '여자 독서실', '헬스장 락커', '골프장 락커', '오전 수영강습A (월수금 9시)', '어린이 수영', '수영 개인강습 8회 (김T)', '골프레슨', '오후 요가', '줌바', '매트필라', '키즈 댄스', 'PT 10회', '자유수영 24회', '자유수영'].map(m.defaultKind),
    ['use', 'use', 'use', 'use', 'use', 'class', 'class', 'class', 'class', 'class', 'class', 'class', 'class', 'class', 'class', 'use']);
  assert.equal(m.nameKey(' 여자 독서실 '), m.nameKey('여자독서실'));
  const H = ['순번', '동', '호수', '이름', '연락처', '이용권명', '금액', '시작일', '종료일', '이용권 상태'];
  const R = [
    ['1', '401', '1', 'A', 'P', '헬스권', '50000', '2026-11-02', '', '활성'],
    ['2', '401', '1', 'B', 'P', '오후 요가 (화목 19시)', '40000', '2026-11-05', '', '활성'], // 같은 세대가 이용권+수강권
    ['3', '401', '2', 'C', 'P', '여자 독서실', '30000', '', '', '활성'],
    ['4', '402', '7', 'D', 'P', '여자독서실', '30000', '', '2026-11-30', '활성'], // 띄어쓰기만 다름 → 같은 이름
    ['5', '402', '8', 'E', 'P', '줌바 (월수 10시)', '35000', '', '2026-10-31', '만료'], // 활성 0 강좌
    ['6', '402', '8', 'F', 'P', 'PT 10회', '500000', '2026-11-01', '', '활성'],
  ];
  const r = m.aggregateMembers(H, R, '2026-11');
  assert.equal(Object.keys(r.stats.names).length, 5, '이름 5종(독서실 둘은 하나)');
  const [all, use, cls] = ['all', 'use', 'class'].map((k) => m.viewOf(r.stats, {}, k));
  assert.deepEqual([use.active, use.households, use.billing, use.kinds], [3, 3, 110000, 2]);
  assert.deepEqual([cls.active, cls.households, cls.billing, cls.kinds], [2, 2, 540000, 3]);
  assert.deepEqual([all.active, all.households, all.billing], [5, 4, 650000], '세대 4: 401-1 은 두 쪽 모두에 있지만 전체에서는 한 번');
  assert.equal(use.active + cls.active, all.active, '이용권 + 수강권 활성 = 전체');
  assert.equal(use.newThisMonth + cls.newThisMonth, all.newThisMonth); assert.equal(use.endedThisMonth + cls.endedThisMonth, all.endedThisMonth);
  // 분류 바꾸기: 요가를 이용권으로 → 수강권 세대 1(PT 세대만)
  const yk = m.nameKey('오후 요가 (화목 19시)');
  const cls2 = m.viewOf(r.stats, { [yk]: 'use' }, 'class'); assert.deepEqual([cls2.active, cls2.households], [1, 1]);
  assert.equal(m.viewOf(r.stats, { [yk]: 'use' }, 'use').households, 3);
  // 보고서 표: 이용권 현황 · 수강권 현황(강좌별, 활성 0 접기) · 전체 합계 — 전달 대비
  const prev = m.aggregateMembers(H, [['1', '401', '1', 'A', 'P', '헬스권', '50000', '', '', '활성'], ['2', '402', '8', 'E', 'P', '줌바 (월수 10시)', '35000', '', '', '활성'], ['3', '403', '1', 'X', 'P', '줌바 (월수 10시)', '35000', '', '', '활성']], '2026-10');
  const T = m.memberTables({ fileName: 'f.xlsx', excluded: 0, exclude: true, stats: r.stats, statsAll: r.statsAll, prev: { month: '2026-10', stats: prev.stats, statsAll: prev.statsAll }, kinds: {} });
  assert.deepEqual(T.map((t) => t.title), ['이용권 현황', '수강권 현황', '전체 합계(이용권 + 수강권)']);
  const c = T[1]; const zumba = c.rows.find((x) => x.label.includes('줌바'));
  assert.deepEqual([zumba.cur, zumba.prev, zumba.rate, zumba.drop], [0, 2, -100, true], '전달에 있던 강좌가 0 이면 보이고 빨강');
  assert.equal(c.rows.some((x) => x.label.includes('PT 10회')), true); assert.deepEqual(c.folded, [], '전달 활성이 있던 강좌는 접지 않음');
  const T1 = m.memberTables({ fileName: 'f.xlsx', excluded: 0, exclude: true, stats: r.stats, statsAll: r.statsAll, prev: null, kinds: {} });
  assert.deepEqual(T1[1].folded, ['줌바 (월수 10시)'], '활성 0 강좌는 접음'); assert.equal(T1[1].rows.some((x) => x.label.includes('줌바')), false);
  assert.equal(T1[0].rows[0].prev, null); assert.match(T1[2].notes.at(-1), /비교할 지난달 없음/);
  assert.deepEqual(m.memberTables({ fileName: 'f', excluded: 0, exclude: true, stats: r.stats, statsAll: r.statsAll, prev: null }, 'class').map((t) => t.key), ['class']);
  // 예전 형태(구분 전): 전체 한 표만, 이용권/수강권 숫자는 없음
  const legacy = { active: 3, households: 2, billing: 1, newThisMonth: 0, endedThisMonth: 0, groups: { '헬스': 3 }, byDong: {}, rows: 3 };
  assert.equal(m.viewOf(legacy, {}, 'use'), null); assert.equal(m.viewOf(legacy, {}, 'all').active, 3);
  const L = m.memberTables({ fileName: 'f', excluded: 0, exclude: true, stats: legacy, statsAll: legacy, prev: null }); assert.equal(L.length, 1); assert.match(L[0].notes.join(' '), /다시 올리면 나뉩니다/);
});

test('#1115 엑셀 읽기: 끝에 공백이 있는 글자 칸 <v xml:space="preserve"> (t="str", sharedStrings 없음)도 읽음 — 하이링크 회원목록 락커 누락 고침', async () => {
  const { zip } = await import('../../src/lib/xlsx.ts');
  const { readXlsx, eachXlsxRow } = await import('../../src/lib/sales/collectors/xlsx.ts');
  const x = (t) => Buffer.from(t, 'utf8');
  const sheet = '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="str"><v>이용권명</v></c><c r="B1" t="str"><v>금액</v></c></row>'
    + '<row r="2"><c r="A2" s="5" t="str"><v xml:space="preserve">헬스장 락커 (대) </v></c><c r="B2"><v>10000</v></c></row>'
    + '<row r="3"><c r="A3" t="str"><v>헬스권</v></c><c r="B3"><v xml:space="preserve">50000</v></c></row></sheetData></worksheet>';
  const buf = zip([
    { name: 'xl/workbook.xml', data: x('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="전체" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: x('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/worksheets/sheet1.xml', data: x(sheet) },
  ]);
  const wb = readXlsx(new Uint8Array(buf));
  assert.deepEqual(wb.rows('전체'), [['이용권명', '금액'], ['헬스장 락커 (대) ', '10000'], ['헬스권', '50000']]);
  const got = []; await eachXlsxRow(new Uint8Array(buf), (cells) => { got.push([...cells.values()]); }, { sheetPath: 'xl/worksheets/sheet1.xml' });
  assert.deepEqual(got[1], ['헬스장 락커 (대) ', '10000'], '흘려 읽기(입찰 큰 파일)도 같음');
});

test('#1117 민감 내용 검사: 개인정보(가리기)·민원인 특정·사고/법적 책임·내부 정보 · 흔한 말은 이름으로 안 봄 · 걸린 말만 가림', async () => {
  const { scanText, scanReport, applyMask, pathLabel } = await import('../../src/lib/branchReport/mask.ts');
  const k = (t) => scanText(t).map((h) => [h.kind, h.match, h.mask ?? null]);
  assert.deepEqual(k('403동 1002호 입주민이 샤워실 온수 민원'), [['resident', '403동 1002호 입주민', '입주민']]);
  assert.deepEqual(k('1203동 504호 도어락 고장'), [['pii', '1203동 504호', '1203동']]);
  assert.deepEqual(k('연락처 010-1234-5678 로 회신'), [['pii', '010-1234-5678', '010-****-5678']]);
  assert.deepEqual(k('12가3456 차량 주차 민원'), [['pii', '12가3456', '12가****']]);
  assert.deepEqual(k('김철수님이 락커 키 분실'), [['pii', '김철수님', '김*수님']]);
  assert.deepEqual(k('관리자님 확인 · 이용자님 문의 · 고객님 응대 · 신규회원 안내'), [], '흔한 말은 이름 아님');
  assert.deepEqual(k('러닝머신에서 넘어져 부상 — 저희 과실 인정, 보상해드리기로'), [['legal', '부상', null], ['legal', '저희 과실', null], ['legal', '보상해드리', null]]);
  assert.deepEqual(k('강사 급여 인상 건 · 직원 평가 반영'), [['internal', '급여', null], ['internal', '직원 평가', null]]);
  assert.deepEqual(k('헬스장 러닝머신 3번 소음 — 업체 수리 완료'), [], '보통 운영 글은 걸리지 않음');
  const body = { usage: [], facilities: [{ name: '헬스장', cleaning: '청결', condition: '양호', lines: [{ item: '러닝머신', status: '고장', action: '101동 202호 회원 신고', state: '완료' }] }], issues: [{ title: '사우나 민원', details: ['박영희님 010-2222-3333 문의'], state: '완료' }], notes: '' };
  const f = scanReport('weekly', body);
  assert.deepEqual(f.map((x) => [x.label, x.kind, x.match]), [['특이사항 1 · 세부 1', 'pii', '박영희님'], ['특이사항 1 · 세부 1', 'pii', '010-2222-3333'], ['시설 점검 1 · 줄 1 · 조치', 'resident', '101동 202호 회원']]);
  const masked = applyMask(applyMask(body, f[0]), f[1]);
  assert.equal(masked.issues[0].details[0], '박*희님 010-****-3333 문의'); assert.equal(body.issues[0].details[0], '박영희님 010-2222-3333 문의', '원본은 그대로');
  assert.equal(applyMask(body, { path: 'issuesMonth.0.title', match: 'x', mask: 'y' }), null, '월간 모음은 주간에서 고침');
  assert.equal(pathLabel('progress.1.focus'), '업무 진행 2 · 중점 확인사항');
  const m = scanReport('monthly', { important: [{ work: '사고 처리', result: '' }], progress: [], next: [], unfinished: [], resolved: [], issuesMonth: [{ title: '701동 1101호 입주민 소음', details: [] }], notes: '' }, { changes: [{ path: 'usage.1', label: '시설별 이용 현황 · 골프장', text: '269명 → 174명(▼35.3%)' }] });
  assert.deepEqual(m.map((x) => [x.label, x.kind, x.fixIn ?? '']), [['중요업무 1 · 업무내용', 'legal', ''], ['이번 달 민원·특이사항 1 · 제목', 'resident', 'weekly'], ['시설별 이용 현황 · 골프장', 'change', '']]);
});
