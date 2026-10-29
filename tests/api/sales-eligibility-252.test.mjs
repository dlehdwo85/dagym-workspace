// 252차 #786(대표 10/29 00:20 "입찰 참가자격 요건(자본금·기술인력·실적 등)이 공고상에 적혀 있다 — 그걸 표기, 지금은 적격심사 같은 입찰 종류가 적혀 있음"):
// 첨부 공고문에서 '참가자격' 절 자르기(원문 그대로) · 요건 항목 뽑기(AI 없음) · 목록 '참가자격' 한 줄 + 원문 · '입찰 방식' 따로 · 못 찾은 이유 · 정기 실행 채우기 · 정정(첨부 바뀜) 다시 읽기 · 당일 메일·공고 조회 같은 말
// (구조 시험 — 가짜 K-apt·가짜 파일 서버. 실제 공고문(hwp·pdf) 읽기는 운영에서 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, FAKE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const E = await import('../../src/lib/sales/eligibilityText.ts'); // 다른 모듈을 안 부르는 잎 모듈 — Node 22 형식 제거로 .ts 직접
const PORT = 3282;
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const today = kst(new Date());
const plus = (n) => kst(new Date(Date.parse(`${today}T12:00:00+09:00`) + n * 864e5));
// 대표가 준 세 가지 꼴(K-apt 주민운동시설 공고 · 나라장터식 '입찰참가자격(입찰공고일 현재기준)' · 국토부 고시 + 현장설명 참가)
const A = `4. 입찰방법\n가. 적격심사 제한경쟁입찰\n5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n나. 공고일 현재 주민운동시설 위탁운영 등록업체로서 자본금 5억원 이상인 업체\n6. 제출서류\n가. 입찰서`;
const B = `7. 입찰방법 : 제한경쟁\n8. 입찰참가자격(입찰공고일 현재기준)\n‣ 선정지침 제26조 제1항 각 호에 해당하지 않는 자\n가. 사업실적 : 최근 5년간 공사 실적 5건\n나. 기술능력 : 소프트웨어사업자, 정보통신공사업 면허를 보유한 업체\n다. 공동도급은 불가함\n9. 현장설명회\n가. 일시`;
const C = `3. 현장설명 : 2026. 11. 2.\n4. 입찰 참가자격\n가. 국토교통부고시 제2024-196호 제26조 ①항에 해당하지 않는 업체\n나. 현장설명회에 참가한 업체\n5. 입찰서 제출`;
const COMMON = `5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n6. 제출서류`;
const LINE_A = '자본금 5억 이상 · 주민운동시설 위탁운영 등록업체';
// 253차(로컬 10/29 00:58 운영 hwp·hwpx 공고문): 숫자가 '실적' 앞에 오는 꼴 — '5개 단지 이상 위탁운영 실적'
const R1 = `4. 입찰참가 자격\n가. 국토교통부고시 제2024-196호 제26조 ①항에 해당하지 않는 업체\n나. 입찰 공고일 현재로부터 최근 5년간 아파트 커뮤니티 시설 5개 단지 이상 위탁운영             실적이 있는 업체\n다. 자본금 5억 이상 업체\n5. 입찰서 제출`;
const R2 = `3. 입찰 참가자격\n가. 사업자선정지침 제26조에 해당하지 않는 자\n나. 입찰 공고일 현재 자본금  2억원 이상인 업체\n다. 입찰 공고일 현재로부터 5년간 공동주택 1개 단지 수영장운용 실적이 있는 업체\n4. 현장설명`;
function zip(files) { // 저장(압축 없음) zip — tests/api/library-text.test.mjs 와 같은 꼴
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), d = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(d.length, 18); lh.writeUInt32LE(d.length, 22); lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(d.length, 20); ch.writeUInt32LE(d.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, n, d); central.push(ch, n); off += 30 + n.length + d.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, eocd]);
}
const sharp = (await import('sharp')).default;
const PNG = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer();
const JPG = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#f0f0f0' } }).jpeg().toBuffer();
// 253차(로컬 운영 docx: 글 0·그림 16장) — 그림 7장 = 앞 6장만 AI 에. 254차: 운영 파일처럼 긴 해시 이름 jpg 섞음
const DOC_XML = '<w:document><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>';
const PHOTO_DOCX = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', DOC_XML],
  ...[1, 2, 3, 4].map((n) => [`word/media/image${n}.png`, PNG]), ...['3f9a1c0b77e24d8e9b1a', 'a07c55e1d2f34b6c8e90', 'c1d2e3f4a5b6c7d8e9f0'].map((h) => [`word/media/${h}.jpg`, JPG])]);
const BAD_DOCX = zip([['[Content_Types].xml', '<Types/>'], ['word/document.xml', DOC_XML], ['word/media/5e8f0a1b2c3d.jpg', Buffer.from('jpg 가 아닌 글자')]]); // 254차: 그림을 못 바꾸면 이유를 남김
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });

test('자르기·뽑기(규칙): 세 가지 공고문 꼴 → 절(머리부터 다음 번호 앞까지, 원문 그대로) · 요건 항목 · 한 줄(공통 문구 제26조는 줄에서 빼고 원문엔 남김)', () => {
  const a = E.eligibilitySection(A);
  assert.equal(a, '5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n나. 공고일 현재 주민운동시설 위탁운영 등록업체로서 자본금 5억원 이상인 업체');
  assert.deepEqual(E.eligibilityItems(a), [{ k: 'capital', label: '자본금 5억 이상' }, { k: 'license', label: '주민운동시설 위탁운영 등록업체' }]);
  assert.equal(E.eligibilityLine(E.eligibilityItems(a), a), LINE_A);
  const flat = A.replace(/\n/g, ' '); // 한 줄로 이어진 공고문(hwp 표에서 뽑힌 글)
  assert.equal(E.eligibilityLine(E.eligibilityItems(E.eligibilitySection(flat)), E.eligibilitySection(flat)), LINE_A);
  const b = E.eligibilitySection(B);
  assert.ok(b.startsWith('8. 입찰참가자격(입찰공고일 현재기준)') && b.endsWith('다. 공동도급은 불가함') && !b.includes('현장설명회'), b);
  assert.deepEqual(E.eligibilityItems(b), [{ k: 'license', label: '소프트웨어사업자·정보통신공사업 면허' }, { k: 'perf', label: '실적 최근 5년 공사 5건' }, { k: 'joint', label: '공동도급 불가' }]);
  assert.equal(E.eligibilityLine(E.eligibilityItems(b), b), '실적 최근 5년 공사 5건 · 소프트웨어사업자·정보통신공사업 면허 · 공동도급 불가', '자본금 → 실적 → 면허 → … 순');
  const c = E.eligibilitySection(C);
  assert.equal(c, '4. 입찰 참가자격\n가. 국토교통부고시 제2024-196호 제26조 ①항에 해당하지 않는 업체\n나. 현장설명회에 참가한 업체', "앞의 '3. 현장설명'·뒤의 '5. 입찰서 제출'은 절 밖");
  assert.deepEqual(E.eligibilityItems(c), [{ k: 'briefing', label: '현장설명 참가 업체' }]);
  // 인력·신용·지역 · 본문 속 '참가자격이 없는 자'는 머리가 아님
  const d = E.eligibilitySection('입찰 유의사항: 참가자격이 없는 자의 입찰은 무효로 한다.\n□ 참가자격의 제한\n○ 생활체육지도자 2명 이상 보유, 신용평가등급 BB 이상, 경기도 내 본사 소재 업체\n□ 제출서류');
  assert.equal(E.eligibilityLine(E.eligibilityItems(d), d), '생활체육지도자 2명 이상 · 신용등급 BB 이상 · 경기도 소재');
  // 공통 문구만 있으면 뽑을 요건 없음 · 절이 없으면 null
  assert.deepEqual(E.eligibilityItems(E.eligibilitySection(COMMON)), []);
  assert.equal(E.eligibilityLine([], E.eligibilitySection(COMMON)), null);
  assert.equal(E.eligibilitySection('입찰 유의사항: 참가자격이 없는 자의 입찰은 무효로 한다.'), null);
  assert.ok(E.eligibilitySection('x\n'.repeat(5) + A + '\n' + '가나다 '.repeat(800)).length <= 1500);
  // 나라장터 API 칸 — 공고문에서 같은 종류를 뽑았으면 겹쳐 안 씀 · 코드 번호·같은 이름 한 번
  assert.deepEqual(E.apiExtra({ license_limit: '체육시설업(4993) / 체육시설업', region_restriction: '경기도 · 서울특별시' }, []), ['업종 체육시설업', '지역 경기도·서울특별시']);
  assert.deepEqual(E.apiExtra({ license_limit: '정보통신공사업(0036)', region_restriction: '경기도' }, E.eligibilityItems(b)), ['지역 경기도']);
  assert.equal(E.eligSay({ error: '첨부 공고문 없음' }), '공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 첨부 공고문 없음)');
  assert.equal(E.eligSay({ line: '업종 체육시설업', error: '글 뽑기 오류' }), '업종 체육시설업 · 공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 글 뽑기 오류)');
  // 253차 운영 공고문 꼴 — 실적이 빠지던 것
  assert.equal(E.lineOf(E.eligibilitySection(R1)), '자본금 5억 이상 · 실적 최근 5년 아파트 커뮤니티 시설 5개 단지 이상 위탁운영');
  assert.equal(E.lineOf(E.eligibilitySection(R2)), '자본금 2억 이상 · 실적 5년 공동주택 1개 단지 수영장운용');
  assert.equal(E.lineOf(E.eligibilitySection(COMMON)), E.COMMON_ONLY);
  // 256차(로컬 10/29 08:35 운영 오탐 3종) a) 지침 이름 「주택관리업자 및 사업자 선정지침」 속 '주택관리업'은 면허 아님 b) '완료실적이 3 건 이상' 건수 붙임 c) '입찰참가자격 등록 … 콜센터' 줄은 절 머리 아님
  const R3 = `3. 입찰 참가자격\n가. 「주택관리업자 및 사업자 선정지침」 제26조에 해당하지 않는 사업자\n나. 입찰공고일 현재 자본금 5억원 이상인 사업자\n다. 입찰공고일 현재 최근 5년간 900 세대 이상 공동주택의 주민공동시설 위탁운영 완료실적이 3 건 이상인 사업자\n※ 실적은 계약기간이 끝난 실적만 인정\n4. 현장설명`;
  assert.equal(E.lineOf(E.eligibilitySection(R3)), '자본금 5억 이상 · 실적 최근 5년 900세대 이상 공동주택의 주민공동시설 위탁운영 3건 이상');
  assert.ok(E.eligibilitySection(R3).includes('완료실적이 3 건 이상') && E.eligibilitySection(R3).includes('끝난 실적만 인정'), '원문엔 그대로');
  assert.equal(E.lineOf(E.eligibilitySection('5. 입찰참가자격\n가. 「주택관리업자 및 사업자 선정지침」 제26조 제1항 각 호에 해당하지 않는 자\n나. 정보통신공사업 등록 업체\n6. 제출서류')), '정보통신공사업');
  assert.equal(E.lineOf(E.eligibilitySection('4. 참가자격\n가. 주택관리업자 및 사업자 선정지침 제26조에 해당하지 않는 자\n5. 기타')), E.COMMON_ONLY, '꺾쇠 없는 지침 이름도');
  assert.equal(E.lineOf(E.eligibilitySection('5. 참가자격\n가. 주택관리업 등록업체로서 자본금 2억원 이상\n6. 기타')), '자본금 2억 이상 · 주택관리업', '진짜 주택관리업 등록 요건은 그대로');
  const G2 = `1. 용역명: GH 주민공동시설 현황조사\n○ 입찰참가자격 등록, 나라장터 시스템: 나라장터 콜센터(☎ 1588-0800)\n○ 계약방법: 일반경쟁`;
  assert.equal(E.eligibilitySection(G2), null);
  assert.equal(E.eligibilitySection(`${G2}\n3. 입찰참가자격\n가. 엔지니어링산업 진흥법에 따른 엔지니어링사업자\n4. 입찰보증금`), '3. 입찰참가자격\n가. 엔지니어링산업 진흥법에 따른 엔지니어링사업자', '등록 안내 줄 다음의 진짜 절');
  const old = E.eligView({ eligibility: { text: '○ 입찰참가자격 등록, 나라장터 시스템: 나라장터 콜센터(☎ 1588-0800)', sig: 'x' }, license_limit: '엔지니어링사업자(1234)', region_restriction: '경기도' });
  assert.deepEqual([old.line, old.text, old.error], ['업종 엔지니어링사업자 · 지역 경기도', null, '공고문에서 참가자격 절을 못 찾음'], '예전 규칙으로 잘못 저장한 절 = 나라장터 업종·지역 먼저(정기 실행이 다시 읽음)');
  // 257차(로컬 10/29 08:45 같은 공고 다시): 문의처 표 '○ 입찰참가자격 및 제안서평가 등 : GH 건설임대처 건설임대시설1부' = 업무별 담당 부서 줄 — 절 머리 아님
  const G3 = `1. 용역명: GH 주민공동시설 현황조사\n○ 문의처\n○ 입찰참가자격 및 제안서평가 등 : GH 건설임대처 건설임대시설1부\n○ 계약 관련 : 계약부 031-250-0000`;
  assert.equal(E.eligibilitySection(G3), null);
  assert.equal(E.eligibilitySection(`${G3}\n3. 입찰참가자격\n가. 엔지니어링산업 진흥법에 따른 엔지니어링사업자\n4. 입찰보증금`), '3. 입찰참가자격\n가. 엔지니어링산업 진흥법에 따른 엔지니어링사업자', '문의처 표 다음의 진짜 절');
  const g3 = E.eligView({ eligibility: { text: '○ 입찰참가자격 및 제안서평가 등 : GH 건설임대처 건설임대시설1부', sig: 'x' }, license_limit: '엔지니어링사업자(1234)', region_restriction: '경기도' });
  assert.deepEqual([g3.line, g3.text], ['업종 엔지니어링사업자 · 지역 경기도', null], '진짜 절이 없으면 나라장터 업종 제한·참가 지역');
  assert.equal(E.lineOf(E.eligibilitySection('5. 입찰참가자격 : 아래 각 호를 모두 갖춘 자\n가. 자본금 5억원 이상\n6. 기타')), '자본금 5억 이상', '머리 줄에 쌍점이 있어도 진짜 절은 그대로');
  assert.equal(E.lineOf(E.eligibilitySection('5. 참가자격: 정보통신공사업 등록업체\n6. 기타')), '정보통신공사업');
  assert.equal(E.eligibilitySection('○ 입찰참가자격 및 제안서평가 등 : GH 건설임대처 건설임대시설1부 (031-250-0000)'), null, '전화가 붙어도');
  assert.equal(E.lineOf(E.eligibilitySection('5. 입찰참가자격 등 : 아래 각 호의 요건을 모두 갖춘 자\n가. 자본금 2억원 이상\n6. 기타')), '자본금 2억 이상', "'등 :' 뒤가 부서가 아니면 진짜 절");
  assert.deepEqual([E.jsonSafe('가\uD840나\u0000다\uDC00'), E.jsonSafe('𠀀'), E.jsonSafe(null)], ['가나다', '𠀀', null], '반쪽 글자·NUL 만 지우고 온전한 두 칸 글자는 그대로');
  // 260차(로컬 10/29 13:15 나라장터 보령 공고): 지방·국가계약법 공통 자격 문구는 한 줄에서 빼고 뒤의 진짜 요건만, 없으면 어느 법의 공통 자격인지
  const G_ONLY = '3. 입찰참가자격\n가. 입찰공고일 현재 「지방자치단체를 당사자로 하는 계약에 관한 법률」 시행령 제13조, 같은 법 시행규칙 제14조 규정에 의한 자격조건을 갖추고, 동법 제31조 규정에 의한 부정당업자로 입찰참가자격 제한을 받고 있지 아니한 자\n나. 국가종합전자조달시스템 입찰참가자격 등록규정에 의하여 반드시 입찰서 제출 마감일 전일까지 조달청에 입찰참가자격을 등록한 자\n4. 입찰보증금';
  assert.equal(E.lineOf(E.eligibilitySection(G_ONLY)), '공통 자격(지방계약법)만 적힘 — 별도 요건 없음');
  assert.equal(E.lineOf(E.eligibilitySection(G_ONLY.replace('\n4. 입찰보증금', '\n다. 공동주택 체육시설 위탁 운영 경험이 있는 법인\n4. 입찰보증금'))), '다. 공동주택 체육시설 위탁 운영 경험이 있는 법인');
  assert.equal(E.lineOf(E.eligibilitySection('3. 입찰참가자격\n가. 「지방자치단체를 당사자로 하는 계약에 관한 법률」 시행령 제13조 규정에 의한 자격을 갖추고, 공공체육시설 운영 실적이 있는 업체\n4. 기타')), '공공체육시설 운영 실적이 있는 업체', '한 문장에 섞이면 공통 부분만 뺌');
  assert.equal(E.lineOf(E.eligibilitySection(G_ONLY.replace('\n4. 입찰보증금', '\n다. 「엔지니어링산업 진흥법」에 따른 엔지니어링사업자로 신고한 자\n4. 입찰보증금'))), '엔지니어링사업자');
  assert.equal(E.lineOf(E.eligibilitySection('3. 입찰참가자격\n가. 「국가를 당사자로 하는 계약에 관한 법률」 시행령 제12조 및 같은 법 시행규칙 제14조에 의한 자격을 갖춘 자\n4. 기타')), '공통 자격(국가계약법)만 적힘 — 별도 요건 없음');
  // 259차: 공고문의 제안서·입찰서 제출 마감(협상·직찰 공고는 나라장터에 입찰 마감 칸이 없음)
  assert.deepEqual(E.docDeadline('7. 제안서 제출 마감: 2026. 11. 10.(화) 18:00\n8. 개찰일시: 2026. 11. 18.(수) 17:00', '2026-10-28'), { at: '2026-11-10T18:00:00+09:00', label: '7. 제안서 제출 마감: 2026. 11. 10.(화) 18:00' });
  assert.equal(E.docDeadline('입찰서 제출기간 2026.11.03.(화) 09:00 ~ 2026.11.10.(화) 18:00까지', '2026-10-28').at, '2026-11-10T18:00:00+09:00', '기간이면 끝 날짜');
  assert.equal(E.docDeadline('○ 접수 기한: 2026년 11월 10일(화) 오후 5시', '2026-10-28').at, '2026-11-10T17:00:00+09:00');
  assert.equal(E.docDeadline('입찰참가자격 등록 마감: 2026.11.09 18:00\n제안서 제출 마감일시\n2026.11.12 17:00', '2026-10-28').at, '2026-11-12T17:00:00+09:00', '참가자격 등록 줄은 빼고 · 다음 줄(표 칸)의 날짜');
  assert.equal(E.docDeadline('공동수급협정서 제출 마감 2026-11-17 18:00\n현장설명 일시: 2026.11.05 14:00', '2026-10-28'), null);
  assert.equal(E.docDeadline('제안서 제출 마감: 2025. 01. 10. 18:00', '2026-10-28'), null, '공고일 전 날짜는 아님');
});

// 262차(로컬 10/29 13:40 나라장터 4건): 제92조·구분선·서약 문구·머리글은 한 줄에서 거르고, 항목을 못 뽑은 긴 원문은 '요건을 항목으로 못 뽑음 — 원문 보기'(그런 공고만 AI 정리)
const BORYEONG = '3. 입찰참가자격\n가. 「지방자치단체를 당사자로 하는 계약에 관한 법률」 시행령 제92조에 해당하지 않는 자로써 아래 각 항의 자격을 모두 갖춘 업체(입찰공고일 전일 기준)\n1) ｢건설기술 진흥법｣ 제26조에 따라 건설엔지니어링업(종합 또는 설계·사업관리 중 일반) 등록 업체\n4. 입찰보증금';
const GH = '3. 입찰참가자격\n아래의 자격을\n나. 모두 충족하는 자\n가. 아래의 자격 1), 2), 3) 중 하나에 해당하는 자\n1) 「감정평가 및 감정평가사에 관한 법률」에 따른 감정평가법인\n2) 「공간정보의 구축 및 관리 등에 관한 법률」에 따른 측량업자\n4. 기타';
const HEARING = '3. 입찰참가자격\n-----------------------------------------------------------------------------\n1) 다음 각호의 자격\n가. 「중소기업제품 구매촉진 및 판로지원에 관한 법률」에 따른 직접생산 확인을 받은 자\n4. 기타';
const PROSHOP = '2. 입찰참가자격\n가. 유죄판결이 확정된 날부터 2년이 지나지 아니한 자 제출 시 제출하여야 합니다. 만일 서약내용이 허위로 판명될 경우\n3. 기타';
test('262차 한 줄 규칙: 제92조 공통·구분선·서약·머리글 거르기 · 못 뽑은 긴 원문은 원문 보기 · AI 항목은 같은 절일 때만', () => {
  assert.equal(E.lineOf(E.eligibilitySection(BORYEONG)), '건설엔지니어링업', '제92조 공통·머리글 빼고 등록 업종');
  assert.equal(E.lineOf(E.eligibilitySection(HEARING)), '직접생산확인', '구분선·머리글 빼고');
  assert.equal(E.lineOf(E.eligibilitySection(GH)), E.ELIG_NO_ITEMS, '표·번호 머리글만 — 원문 첫 문장을 쓰지 않음');
  assert.equal(E.lineOf(E.eligibilitySection(PROSHOP)), E.ELIG_NO_ITEMS, '서약 문구만 — 공통 자격으로 말하지 않음');
  assert.deepEqual([GH, PROSHOP, BORYEONG, COMMON].map((t) => E.needsAiItems(E.eligibilitySection(t))), [true, true, false, false], 'AI 정리는 못 뽑은 공고만');
  const sec = E.eligibilitySection(GH);
  const row = { eligibility: { text: sec, items: [], ai: { sig: E.textSig(sec), items: [{ k: 'license', label: '감정평가법인 또는 측량업자' }, { k: 'perf', label: '최근 3년 현황조사 실적 1건 이상' }], at: '' } } };
  const v = E.eligView(row);
  assert.deepEqual([v.line, v.ai], ['최근 3년 현황조사 실적 1건 이상 · 감정평가법인 또는 측량업자', true]);
  assert.equal(E.eligSay(v), `최근 3년 현황조사 실적 1건 이상 · 감정평가법인 또는 측량업자 (${E.AI_ITEMS_NOTE})`, '메일·공고 조회에도 AI 정리 표시');
  assert.deepEqual([E.eligView({ eligibility: { ...row.eligibility, text: sec + ' 바뀜' } }).ai, E.eligView({ eligibility: { ...row.eligibility, text: sec + ' 바뀜' } }).line], [false, E.ELIG_NO_ITEMS], '절이 바뀌면 예전 AI 항목은 안 씀');
});

// ---- 공고문 읽기(정기 실행·다시 읽기) ----
const N = {
  KA: { id: '00000000-0000-4000-8000-000000252001', bid: 'E252001', files: [{ seq: 25201, fileName: '과업지시서.txt', body: Buffer.from('과업 내용\n1. 헬스장 운영\n2. 참가자격 확인 서류 제출') }, { seq: 25202, fileName: '입찰공고문.txt', body: Buffer.from(A) }] },
  KB: { id: '00000000-0000-4000-8000-000000252002', bid: 'E252002', files: [{ seq: 25203, fileName: '입찰공고문.hwp' }] }, // 가짜 hwp — 글을 못 뽑음
  KC: { id: '00000000-0000-4000-8000-000000252003', bid: 'E252003', files: [] },
  KD: { id: '00000000-0000-4000-8000-000000252004', bid: 'E252004', files: [{ seq: 25204, fileName: '입찰공고문.txt', body: Buffer.from(COMMON) }] },
  CLOSED: { id: '00000000-0000-4000-8000-000000252005', bid: 'E252005', files: [{ seq: 25205, fileName: '입찰공고문.txt', body: Buffer.from(A) }], closed: true },
  OTHER: { id: '00000000-0000-4000-8000-000000252006', bid: 'E252006', files: [{ seq: 25206, fileName: '입찰공고문.txt', body: Buffer.from(A) }], unrelated: true },
  PHOTO: { id: '00000000-0000-4000-8000-000000252007', bid: 'E252007', files: [{ seq: 25207, fileName: '입찰공고문.docx', body: PHOTO_DOCX }] }, // 253차: 그림만 든 docx
  BAD: { id: '00000000-0000-4000-8000-000000252008', bid: 'E252008', files: [{ seq: 25208, fileName: '입찰공고문.docx', body: BAD_DOCX }] },
};
const NO_PAYER = '공고문이 사진(스캔)으로만 되어 있음 · AI 사진 읽기 안 함: 비용 낼 회사 없음(영업 공간·전환 열린 운영 회사)';
const G = { id: '00000000-0000-4000-8000-000000252010', no: 'R26BK252010-000' };
const HALF_HEAD = '3. 입찰참가자격\n가. 정보통신공사업 등록업체\n';
const DL_DOC = `1. 용역명: 시험252 파크골프장 기본계획\n3. 입찰참가자격\n가. 엔지니어링산업 진흥법에 따른 엔지니어링사업자\n4. 제안서 제출 마감: ${plus(6).replace(/-/g, '. ')}.(목) 17:00\n5. 개찰: ${plus(8)} 17:00`; // 259차
const docs = { '/g2b/notice-gh.txt': `1. 용역명: 시험262 현황조사\n${GH}`, '/g2b/notice-b.txt': B, '/g2b/notice-c.txt': C, '/g2b/notice-half.txt': `1. 공사명: 출입통제\n${HALF_HEAD}${'가'.repeat(1499 - HALF_HEAD.length)}𠀀 나머지\n4. 입찰보증금`, '/g2b/notice-dl.txt': DL_DOC }; // 257차: 1,500자째에 두 칸 글자
let srv, ctx, sql, fake, fg;
const rowOf = async (id) => (await sql`select row from sales_src_rows where src_id = ${id}`)[0]?.row;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const put = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, ...row })}, 'workin')`;

before(async () => {
  const files = Object.fromEntries(Object.values(N).map((o) => [o.bid, o.files]));
  const kapt = fakeKapt({ files });
  fake = http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const u = new URL(req.url, 'http://x');
    if (docs[u.pathname]) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('입찰공고서.txt')}` }); return res.end(Buffer.from(docs[u.pathname])); }
    if (kapt.handle(req, res, body)) return;
    res.writeHead(404); res.end('nope');
  }).listen(PORT);
  fg = await startFakeGoogle();
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://localhost:${PORT}`, SALES_ELIGIBILITY: 'on', SALES_ELIGIBILITY_MAX: '10' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`delete from sales_cutover`; // #790 사진 읽기는 비용을 낼 회사(영업 전환 연 회사)가 있을 때만 — 마지막 시험에서 연다(다른 시험 파일이 남긴 줄 지움)
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified, created_at) values ('default', ${plus(-1)}, '[]', '{}', 1, 1, ${new Date(`${plus(-1)}T08:00:00+09:00`)})`;
  for (const [k, o] of Object.entries(N)) await put(o.id, { source_type: 'kapt_bid', source_external_id: o.bid, title: `[경기] 시험252 ${k} 단지 주민운동시설 위탁운영 사업자 선정`, issuer: `시험252 ${k} 단지`, related: !o.unrelated, fit_business: '다짐', classification: '검토',
    current_status: '공고중', notice_kind: 'new', posted_date: today, deadline_at: `${o.closed ? plus(-2) : plus(10)}T17:00:00+09:00`, first_seen_at: new Date().toISOString(), award_method: '적격심사', contract_method: '제한경쟁' });
  await put(G.id, { source_type: 'g2b_bid', source_external_id: G.no, title: '시험252 체육센터 출입통제 시스템 구축 공사', issuer: '시험252 시청', related: true, fit_business: '하이링크', classification: '검토', current_status: '공고중', notice_kind: 'new',
    posted_date: today, deadline_at: `${plus(8)}T10:00:00+09:00`, first_seen_at: new Date().toISOString(), license_limit: '정보통신공사업(0036)', region_restriction: '경기도',
    attachment_urls: [{ name: '입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-b.txt` }, { name: '과업지시서.hwp', url: `http://127.0.0.1:${PORT}/g2b/task.hwp` }] });
});
after(async () => { srv?.proc.kill(); fake?.close(); fg?.server.close(); await sql?.end(); });

test('정기 실행: 열린 관련 공고만 읽음(마감 지남·관련 아님 제외) · 공고문일 법한 파일 먼저 · 원문·항목·한 줄·파일 이름 저장 · 나라장터는 API 지역을 합침 · 못 찾으면 이유', async () => {
  await tick();
  const ka = (await rowOf(N.KA.id)).eligibility;
  assert.equal(ka.text, E.eligibilitySection(A)); assert.equal(ka.line, LINE_A); assert.equal(ka.error, null);
  assert.equal(ka.file?.name, '입찰공고문.txt', '과업지시서보다 공고문 먼저'); assert.ok(ka.text.includes('제26조'), '원문엔 공통 문구 그대로');
  const g = (await rowOf(G.id)).eligibility;
  assert.equal(g.line, '실적 최근 5년 공사 5건 · 소프트웨어사업자·정보통신공사업 면허 · 공동도급 불가 · 지역 경기도', '공고문에서 면허를 뽑았으니 API 업종은 겹쳐 안 씀, 지역은 합침');
  const kb = (await rowOf(N.KB.id)).eligibility;
  assert.equal(kb.text, null); assert.ok(kb.error && kb.tries === 1, JSON.stringify(kb));
  assert.equal((await rowOf(N.KC.id)).eligibility.error, '첨부 공고문 없음');
  assert.equal((await rowOf(N.KD.id)).eligibility.line, '공통 자격(사업자선정지침)만 적힘 — 별도 요건 없음');
  const ph = (await rowOf(N.PHOTO.id)).eligibility;
  assert.deepEqual([ph.text, ph.error, ph.file?.name, ph.tries], [null, NO_PAYER, '입찰공고문.docx', 0], '못 읽어도 어떤 파일을 봤는지 · AI 를 안 부른 이유 · 설정 이유는 못 읽은 횟수로 안 셈');
  assert.equal((await rowOf(N.CLOSED.id)).eligibility, undefined, '마감 지난 공고는 안 읽음');
  assert.equal((await rowOf(N.OTHER.id)).eligibility, undefined, '관련 아닌 공고는 안 읽음');
  // 257차(로컬 10/29 08:45 '안 읽은 6건이 정기 실행에서 계속 남음'): 정기 실행 기록(job_runs)에 이번에 읽은 공고·결과와 다음 차례
  const [run] = await sql`select detail from job_runs where job = 'tick' and detail ? 'salesEligibility' order by id desc limit 1`;
  const se = run.detail.salesEligibility;
  assert.ok(se.tried.includes(`${N.KA.bid} 절 찾음`) && se.tried.includes(`${N.KC.bid} 첨부 공고문 없음`), JSON.stringify(se));
  assert.ok(Array.isArray(se.waiting), JSON.stringify(se));
  // 공고 조회: 정기 실행이 안 읽는 이유
  const look = async (no) => (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${no}`)).items[0].eligibility;
  const lc = await look(N.CLOSED.bid), lk = await look(N.KA.bid);
  assert.deepEqual([lc.skip, lc.due, lk.skip], ['마감 지남', false, null]);
  // 258차(로컬 10/29 09:20 ⓑ): 마감일 칸이 빈 관련 공고도 읽음(원천 목록에서 30일 안에 본 것) — 오래 안 보인 줄은 이유와 함께 빠짐
  const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
  await put('00000000-0000-4000-8000-000000252021', { source_type: 'g2b_bid', source_external_id: 'R26BK0252021-000', title: '(협상)시험252 파크골프장 타당성 조사 용역', related: true, fit_business: '다짐', current_status: '공고중', notice_kind: 'new', posted_date: plus(-5), first_seen_at: ago(5), last_seen_at: ago(0) });
  await put('00000000-0000-4000-8000-000000252022', { source_type: 'g2b_bid', source_external_id: 'R26BK0252022-000', title: '시험252 오래된 협력회사 등록', related: true, fit_business: '다짐', current_status: '공고중', notice_kind: 'new', posted_date: plus(-60), first_seen_at: ago(60), last_seen_at: ago(40) });
  const [n1, n2] = [await look('R26BK0252021-000'), await look('R26BK0252022-000')];
  assert.deepEqual([n1.skip, n1.due, n2.skip, n2.due], [null, true, '마감일 칸 없음 · 원천 목록에서 30일 넘게 안 보임', false]);
  await tick();
  assert.deepEqual([(await rowOf('00000000-0000-4000-8000-000000252021')).eligibility?.error, (await rowOf('00000000-0000-4000-8000-000000252022')).eligibility], ['첨부 공고문 없음', undefined]);
  const open = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=open');
  assert.ok(open.noClose >= 1 && open.items.some((x) => x.noticeNo === 'R26BK0252021-000' && !x.close), JSON.stringify({ noClose: open.noClose }));
  // 다시 돌아도 같은 공고는 안 읽음(못 읽은 것도 20시간 뒤에)
  const at = ka.readAt; await tick();
  assert.equal((await rowOf(N.KA.id)).eligibility.readAt, at); assert.equal((await rowOf(N.KB.id)).eligibility.tries, 1);
  await sql`update sales_src_rows set row = jsonb_set(row, '{eligibility,readAt}', to_jsonb(${new Date(Date.now() - 21 * 36e5).toISOString()}::text)) where src_id = ${N.KB.id}`;
  await tick();
  assert.equal((await rowOf(N.KB.id)).eligibility.tries, 2, '못 읽은 공고는 20시간 뒤 다시(3번까지)');
});

test('정정(첨부가 바뀜) → 다시 읽음 · [공고문 다시 읽기] API', async () => {
  await sql`update sales_src_rows set row = row || ${sql.json({ attachment_urls: [{ name: '정정 입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-c.txt` }] })} where src_id = ${G.id}`;
  await tick();
  const g = (await rowOf(G.id)).eligibility;
  assert.equal(g.line, '현장설명 참가 업체 · 업종 정보통신공사업 · 지역 경기도', '정정 공고문으로 다시 — 면허를 못 뽑았으니 API 업종을 합침');
  const r = await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.KC.id });
  assert.deepEqual([r.eligibility.text, r.eligibility.error], [null, '첨부 공고문 없음']);
  // 257차: 절을 1,500자에서 자르다 두 칸 글자(𠀀 등)가 반으로 갈리면 jsonb 저장이 통째로 실패해 '아직 안 읽음'으로 남았음 — 반쪽 글자를 지우고 저장
  await sql`update sales_src_rows set row = row || ${sql.json({ attachment_urls: [{ name: '입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-half.txt` }] })} where src_id = ${G.id}`;
  const half = (await ctx.owner.ok('POST', '/api/sales/eligibility', { id: G.id })).eligibility;
  assert.ok(half.text && half.text.length === 1499 && half.text.includes('정보통신공사업') && !/[\uD800-\uDFFF]/.test(half.text), JSON.stringify(half).slice(0, 200));
  assert.equal((await rowOf(G.id)).eligibility.text, half.text, '저장됨');
  // 259차: 공동수급협정 마감(임시)인 공고는 공고문의 제안서 제출 마감으로 바꿈('doc' · 그 글줄) — 목록 카드에도
  const DLID = '00000000-0000-4000-8000-000000252031';
  await put(DLID, { source_type: 'g2b_bid', source_external_id: 'R26BK0252031-000', title: '(협상)시험252 파크골프장 기본계획 용역', related: true, fit_business: '다짐', current_status: '공고중', notice_kind: 'new',
    posted_date: plus(-2), first_seen_at: new Date().toISOString(), deadline_at: `${plus(9)}T18:00:00+09:00`, deadline_src: 'agreement', agreement_close_at: `${plus(9)}T18:00:00+09:00`, opening_at: `${plus(10)}T17:00:00+09:00`,
    attachment_urls: [{ name: '입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-dl.txt` }] });
  const dr = (await ctx.owner.ok('POST', '/api/sales/eligibility', { id: DLID })).eligibility;
  const drow = await rowOf(DLID);
  assert.deepEqual([drow.deadline_at, drow.deadline_src, drow.doc_deadline_label, dr.dl.at], [`${plus(6)}T17:00:00+09:00`, 'doc', `4. 제안서 제출 마감: ${plus(6).replace(/-/g, '. ')}.(목) 17:00`, `${plus(6)}T17:00:00+09:00`]);
  const dcard = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => x.noticeNo === 'R26BK0252031-000');
  assert.deepEqual([dcard.close, dcard.deadlineSrc, dcard.agreementClose, dcard.opening?.slice(0, 10)], [plus(6), 'doc', `${plus(9)}T18:00:00+09:00`, plus(10)]);
  await sql`delete from sales_src_rows where src_id = ${DLID}`; // 아래 당일 메일 시험의 건수에 안 섞이게
  assert.equal((await ctx.owner.req('POST', '/api/sales/eligibility', { id: '00000000-0000-4000-8000-0000002520ff' })).status, 404);
});

test("화면 자료·공고 조회·당일 메일: '참가자격' 한 줄과 원문 · '입찰 방식'(적격심사·제한경쟁)은 따로 · 못 찾음은 이유와 함께 같은 말", async () => {
  const items = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items;
  const ka = items.find((x) => x.noticeNo === N.KA.bid), kc = items.find((x) => x.noticeNo === N.KC.bid);
  assert.deepEqual([ka.elig.line, ka.elig.file, ka.terms], [LINE_A, '입찰공고문.txt', '적격심사 · 제한경쟁']);
  assert.equal(ka.elig.text, E.eligibilitySection(A)); assert.equal(ka.detail.qualification, ka.elig.text);
  assert.deepEqual([kc.elig.line, kc.elig.error], [null, '첨부 공고문 없음']);
  // 253차: 한 줄은 저장한 원문에서 다시 뽑음 — 예전 규칙으로 저장된 줄이어도 화면은 지금 규칙
  await sql`update sales_src_rows set row = jsonb_set(row, '{eligibility,line}', '"예전 줄"'::jsonb) where src_id = ${N.KA.id}`;
  assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => x.noticeNo === N.KA.bid).elig.line, LINE_A);
  const it = (await ctx.owner.ok('GET', `/api/platform/sales-notices?no=${N.KA.bid}`)).items[0];
  assert.deepEqual([it.eligibility?.say, it.eligibility?.file?.name, it.eligibility?.due, it.terms], [LINE_A, '입찰공고문.txt', false, '적격심사 · 제한경쟁']);
  await sql`delete from sales_digests where day = ${today}`; // 256차: 서울 08시 뒤에 돌면 첫 정기 실행이 참가자격을 읽기 전에 오늘 묶음을 저장함 — 시각과 무관하게 지금 기준으로
  const d = await ctx.owner.ok('GET', '/api/sales/digest');
  const da = d.items.find((x) => x.noticeNo === N.KA.bid), dc = d.items.find((x) => x.noticeNo === N.KC.bid);
  assert.ok(da && dc, JSON.stringify(d.items.map((x) => x.noticeNo)));
  assert.equal(da.elig, LINE_A); assert.equal(dc.elig, '공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 첨부 공고문 없음)');
  const text = (await ctx.owner.req('GET', '/api/sales/digest?preview=text')).body;
  assert.ok(text.includes(`참가자격: ${LINE_A}`), text);
  const html = (await ctx.owner.req('GET', '/api/sales/digest?preview=html')).body;
  assert.ok(html.includes('data-digest-elig="1"') && html.includes(LINE_A));
});

test('#790 사진 공고문: 글이 없으면 AI 비전으로 참가자격 절을 옮겨 적음(앞 6장) · 운영 회사 AI 예산·사용량 이름 · 같은 첨부면 다시 안 부름 · 화면 안내', async () => {
  assert.equal((await rowOf(N.PHOTO.id)).eligibility.error, NO_PAYER, '비용을 낼 회사(영업 전환 연 회사)가 없으면 사진 읽기 안 함');
  // 254차(로컬 01:25 운영: 이유 없이 안 읽힘): [다시 읽기]를 여러 번 눌러도 설정 이유면 횟수가 안 쌓여 나중에 읽을 수 있음
  for (let i = 0; i < 3; i++) assert.equal((await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.PHOTO.id })).eligibility.tries, 0);
  // 254b(로컬 01:55 운영 '관리자 계정을 못 찾음'): 체험 조직(demo)이 먼저 잡히지 않게 — demo 는 영업 전환을 열어 둬도 비용 낼 회사가 아님
  await sql`insert into tenants (id, name, spaces) values ('demo', '체험', '{work,sales}') on conflict (id) do update set spaces = '{work,sales}'`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('demo', true, true) on conflict (tenant) do update set writes_open = true`;
  assert.equal((await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.PHOTO.id })).eligibility.error, NO_PAYER, 'demo 만 열려 있으면 비용 낼 회사 없음');
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const bad = (await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.BAD.id })).eligibility;
  assert.match(bad.error, /^공고문이 사진\(스캔\)으로만 되어 있음 · AI 사진 읽기 안 함: 그림 1장을 AI 용으로 못 바꿈\(.+\)$/, bad.error); assert.equal(bad.tries, 0);
  await queue([say({ found: true, text: R1 })]);
  const r = await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.PHOTO.id });
  assert.deepEqual([r.eligibility.by, r.eligibility.text, r.eligibility.error, r.eligibility.file?.name], ['vision', E.eligibilitySection(R1), null, '입찰공고문.docx']);
  const st = await (await fetch(`${FAKE}/__state`)).json();
  const req = st.anthropic.at(-1).body; const imgs = req.messages[0].content.filter((b) => b.type === 'image');
  assert.equal(imgs.length, 6, '그림은 앞 6장만');
  const used = await sql`select tenant, purpose from ai_usage where purpose = 'sales_eligibility_vision'`;
  assert.deepEqual(used.map((x) => [x.tenant, x.purpose]), [['default', 'sales_eligibility_vision']]);
  await ctx.owner.ok('POST', '/api/sales/eligibility', { id: N.PHOTO.id }); // 같은 첨부 — 다시 부르지 않고 읽은 글 그대로
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_eligibility_vision'`)[0].n, 1);
  const it = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => x.noticeNo === N.PHOTO.bid);
  assert.deepEqual([it.elig.vision, it.elig.line], [true, '자본금 5억 이상 · 실적 최근 5년 아파트 커뮤니티 시설 5개 단지 이상 위탁운영']);
  const { aiPurposeLabel } = await import('../../src/components/aiPurpose.ts');
  assert.equal(aiPurposeLabel('sales_eligibility_vision'), '입찰 참가자격 사진 읽기');
});

test('262차 AI 항목 정리: 규칙으로 못 뽑은 공고만 빠른 모델로(공고당 한 번·같은 절이면 다시 안 부름·사용량 이름) · 목록 한 줄·AI 표시 · 예전에 읽은 공고는 정기 실행이 공고문을 다시 받지 않고 정리', async () => {
  // 앞 시험(#790)에서 비용 낼 회사(영업 전환)가 열려 있음
  const ID = '00000000-0000-4000-8000-000000262001';
  await put(ID, { source_type: 'g2b_bid', source_external_id: 'R26BK262001-000', title: '시험262 현황조사 용역', issuer: '시험262 공사', related: true, fit_business: '하이링크', current_status: '공고중', notice_kind: 'new',
    posted_date: today, deadline_at: `${plus(9)}T10:00:00+09:00`, first_seen_at: new Date().toISOString(), attachment_urls: [{ name: '입찰공고서.txt', url: `http://127.0.0.1:${PORT}/g2b/notice-gh.txt` }] });
  await queue([say({ items: [{ k: 'license', label: '감정평가법인 또는 측량업자' }, { k: 'perf', label: '최근 3년 현황조사 실적 1건 이상' }, { k: 'other', label: '청렴서약서 제출' }, { k: 'zzz', label: '지방계약법 시행령 제13조 자격' }] })]);
  const n0 = (await sql`select count(*)::int n from ai_usage where purpose = 'sales_eligibility_items'`)[0].n;
  const r = (await ctx.owner.ok('POST', '/api/sales/eligibility', { id: ID })).eligibility;
  assert.deepEqual(r.ai.items, [{ k: 'license', label: '감정평가법인 또는 측량업자' }, { k: 'perf', label: '최근 3년 현황조사 실적 1건 이상' }], '서약·공통 문구 항목은 버림');
  assert.equal(r.line, '최근 3년 현황조사 실적 1건 이상 · 감정평가법인 또는 측량업자');
  const req = (await (await fetch(`${FAKE}/__state`)).json()).anthropic.at(-1).body;
  assert.ok(JSON.stringify(req.system).includes('참가자격') && JSON.stringify(req.messages).includes('감정평가법인'), '저장한 절을 보냄');
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_eligibility_items'`)[0].n, n0 + 1);
  await ctx.owner.ok('POST', '/api/sales/eligibility', { id: ID }); // 같은 절 — 다시 안 부름
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'sales_eligibility_items'`)[0].n, n0 + 1);
  const it = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all')).items.find((x) => x.noticeNo === 'R26BK262001-000');
  assert.deepEqual([it.elig.ai, it.elig.line], [true, '최근 3년 현황조사 실적 1건 이상 · 감정평가법인 또는 측량업자']);
  // 예전(262차 전)에 읽어 둔 공고 — 첨부 지문 그대로라 공고문은 다시 안 받고, 저장한 절로 AI 정리만
  const OLD = '00000000-0000-4000-8000-000000262002'; const sec = E.eligibilitySection(PROSHOP);
  await put(OLD, { source_type: 'g2b_bid', source_external_id: 'R26BK262002-000', title: '시험262 골프장 프로샵 임대', issuer: '시험262 공단', related: true, fit_business: '다짐', current_status: '공고중', notice_kind: 'new',
    posted_date: today, deadline_at: `${plus(7)}T10:00:00+09:00`, first_seen_at: new Date().toISOString(),
    eligibility: { text: sec, items: [], line: '유죄판결이 확정된 날부터 2년이 지나지 아니한 자 제출 시', error: null, file: { name: '공고문.hwp', url: 'http://127.0.0.1:1/x.hwp' }, readAt: new Date().toISOString(), sig: '', tries: 0 } });
  await queue([say({ items: [{ k: 'license', label: '골프장 프로샵 운영 경험 업체' }] })]);
  await tick();
  const o = (await rowOf(OLD)).eligibility;
  assert.deepEqual([o.ai?.items, o.line, o.file?.name], [[{ k: 'license', label: '골프장 프로샵 운영 경험 업체' }], '골프장 프로샵 운영 경험 업체', '공고문.hwp'], JSON.stringify(o));
  const [run] = await sql`select detail from job_runs where job = 'tick' and detail ? 'salesEligibility' order by id desc limit 1`;
  assert.ok(run.detail.salesEligibility.aiDone >= 1 && run.detail.salesEligibility.tried.some((x) => /R26BK262002-000 AI 항목 1개/.test(x)), JSON.stringify(run.detail.salesEligibility));
  const { aiPurposeLabel } = await import('../../src/components/aiPurpose.ts');
  assert.equal(aiPurposeLabel('sales_eligibility_items'), '입찰 참가자격 항목 정리(AI)');
});
