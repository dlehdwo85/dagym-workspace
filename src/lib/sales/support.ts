// #450 영업실 '지원사업' — 공고(공용 수집 + 회사 수기) × 회사 프로필 → 1차 규칙(지역·업력·규모·관심 분야) → AI 판단(✅/⚠/❌·이유·맞는 브랜드·준비 서류)
// → [관심]·[신청 준비] = 담당 업무(체크리스트) + 마감 7일·3일 전 알림 → 신청·선정·탈락 기록. 업종 중립: 회사 이름·업종을 코드에 두지 않고 회사마다 자기 프로필로 판단.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../log';
import { notify } from '../notifications';
import { aiEnabled, anthropicProvider, costUsd, modelFor, usdKrw, type AiProvider } from '../ai/provider';
import { tenantOf, type SessionUser } from '../types';
import { NOT_SUPPORT_RE, SIDO, supportKeyStatus, watchDetailText } from './collectors/support';
import { SIDO_ALIASES } from './collectors/prospects';
import { garbledText } from './collectors/files';

const ymd = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const addDays = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) + n * 864e5));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00+09:00`) - Date.parse(`${a}T12:00:00+09:00`)) / 864e5);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_SLUG: Record<string, string> = { bizinfo: 'bizinfo_support', kstartup: 'kstartup_support', watch: 'support_watch', gov24: 'gov24_support' };
export const SOURCE_LABEL: Record<string, string> = { bizinfo: '기업마당', kstartup: 'K-Startup', watch: '기관 공지', gov24: '정부24 지원금', manual: '직접 입력' };
export const STATUS_LABEL: Record<string, string> = { interest: '관심', preparing: '신청 준비', applied: '신청 완료', selected: '선정', rejected: '탈락', dropped: '포기' };
const OPEN_WORK = ['interest', 'preparing'];
export const SIZES = ['예비창업', '소상공인', '소기업', '중기업', '중견기업'] as const;
/** 관심 분야 → 공고에서 찾을 낱말(목록에 없는 관심 분야는 그 낱말 그대로) */
export const INTEREST_WORDS: Record<string, string[]> = {
  IP: ['지식재산', '특허', '상표', '디자인권', '디자인 출원', 'IP'], 'R&D': ['R&D', '연구개발', '기술개발', '연구 개발'], 수출: ['수출', '해외', '글로벌', '바이어'], 고용: ['고용', '채용', '인력', '일자리', '인건비'],
  SaaS: ['SaaS', '소프트웨어', '클라우드', '플랫폼', '디지털 전환', 'AI'], 마케팅: ['마케팅', '홍보', '판로', '광고', '브랜드', '온라인 판매'], 창업: ['창업', '스타트업', '예비창업'], 자금: ['융자', '보증', '자금', '정책자금', '대출'],
  시설: ['시설', '설비', '리모델링', '환경 개선', '스마트공장'], 교육: ['교육', '컨설팅', '멘토링', '역량 강화'], 인증: ['인증', '시험', '검사', '표준'],
};
export const CERTS = ['벤처기업', '이노비즈', '메인비즈', '기업부설연구소', '연구개발전담부서', 'SW사업자', '여성기업', '사회적기업', '장애인기업', '소셜벤처', 'ISO'];
/** #649(대표 10/25 23:20 '식품제조가공업 대상 공고가 맞춤에'): 공고 '지원 대상'에 적힌 업종 묶음 ↔ 회사 프로필 업종(같은 낱말 표로 묶음). 업종 중립 — 특정 회사 이름 없음. 짧은 영문(IT·SW·AI)은 낱말 경계로만 */
/** #788 정부24 지원 조건 코드 이름(소상공인·법인/단체·업종만) */
export const JA_LABEL: Record<string, string> = { JA1101: '예비창업자', JA1102: '영업 중 소상공인', JA1103: '생계곤란·폐업예정 소상공인', JA1201: '음식점업', JA1202: '제조업', JA1299: '기타업종',
  JA2101: '중소기업', JA2102: '사회복지시설', JA2103: '기관·단체', JA2201: '제조업', JA2202: '농림어업', JA2203: '정보통신업', JA2299: '기타업종' };
export const INDUSTRY_GROUPS: Record<string, string[]> = {
  식품: ['식품', '식품제조', '식품가공', '즉석판매', '외식', '음식점', '농식품', '식음료', '먹거리', '푸드'],
  제조: ['제조업', '제조기업', '제조 중소기업', '뿌리산업', '스마트공장', '생산설비', '생산 설비', '공장'],
  농림수산: ['농업', '농업인', '농업법인', '어업', '어업인', '수산', '임업', '축산', '귀농', '귀어', '농산물'],
  건설: ['건설업', '건설사', '건설기업', '시공사', '건축사'],
  바이오의료: ['바이오', '제약', '의료기기', '의약', '헬스케어', '디지털 헬스', '병원'],
  반도체소재: ['반도체', '디스플레이', '이차전지', '배터리', '소재부품장비', '소부장', '초격차'],
  뷰티: ['화장품', '뷰티', '미용'],
  패션섬유: ['패션', '섬유', '의류', '봉제'],
  관광: ['관광', '숙박', '여행사', '관광기업'],
  콘텐츠: ['콘텐츠', '게임', '영상 제작', '웹툰', '출판', '방송', '음악', '애니메이션', '미디어'],
  소프트웨어: ['소프트웨어', 'SW', 'IT', '정보통신', 'ICT', '플랫폼', '앱', '인공지능', 'AI', '데이터', '클라우드', '핀테크', '에듀테크', '프롭테크', '솔루션'],
  에너지환경: ['에너지', '환경', '신재생', '탄소', '친환경', '기후', '배출시설', '방지시설', '배출사업장', '대기오염', '오염물질', '발전사', '발전소', '발전 분야', '발전분야', '전력산업', '전력 산업'], // #781 IoT 측정기기(대기 배출시설)·발전사 상생 공고
  물류운송: ['물류', '운송', '운수', '택배', '모빌리티', '자동차'],
  유통: ['유통', '도소매', '소매업', '도매업', '온라인 쇼핑몰', '이커머스', '수출입', '무역'],
  교육: ['교육', '학원', '에듀', '교육서비스'],
  // #649 후속(로컬 10/25 157차 확인 거짓 '해당 없음' 3건): 프로필 '공동주택 커뮤니티시설 위탁운영' = 시설관리·스포츠 둘 다. '경비'(홍보 경비 = 돈)·'청소'·'부동산' 낱말 하나로는 안 잡고 업종 꼴(경비업·청소 용역·부동산업)만
  스포츠: ['스포츠', '체육', '피트니스', '헬스장', '운동', '레저', '커뮤니티시설', '커뮤니티 시설'],
  시설관리: ['시설관리', '시설 관리', '시설운영', '시설 운영', '경비업', '경비 용역', '경비용역', '청소업', '청소 용역', '청소용역', '주택관리', '건물관리', '건물 관리', '부동산업', '부동산 관리', '부동산관리', '위탁관리', '위탁 관리', '위탁운영', '위탁 운영', '커뮤니티시설', '커뮤니티 시설', '관리사무소', '공동주택', '아파트 관리'],
};
/** 업종 제한이 아닌 문구(전 업종·서비스업 전체·모든 중소기업) */
const GENERIC_TARGET = /전\s*업종|업종\s*(무관|제한\s*없음|불문)|모든\s*업종|서비스업|전체\s*중소기업|모든\s*중소기업|전\s*산업|모든\s*(?:분야|산업)|분야\s*(?:무관|제한\s*없음)/;
/** #649 후속: '지원 대상' 글에서 업종 판단에 쓰면 안 되는 구절을 뗌 — 제외·불가 구절(괄호 "(단, 부동산업 제외)" · 꼬리 "단, … 제외" · "※ 제외 업종: 음식점업, 미용업, 부동산업" 줄)과 우대·가점·우선 구절.
 * 로컬 10/25 157차 확인: 제외 업종 목록의 음식점·미용·부동산을 '대상 업종'으로 읽어 "식품·뷰티·시설관리 업종 대상 → 해당 없음"이 됨 */
export function targetText(t: string) {
  const EXCL = /제외|불가|비대상|해당\s*없음/;
  // #781(로컬 10/28): '(청년창업기업·지식서비스 등은) 1인 이상도 가능' 같은 예외·특례 구절의 업종은 대상 업종이 아님 — 청년일자리도약장려금 거짓 '해당 없음'
  const EXC = /1인\s*이상|도\s*(?:신청\s*|지원\s*|참여\s*)?가능|예외|특례/;
  return t.replace(/\([^()]*(?:제외|불가|비대상|해당\s*없음|1인\s*이상|도\s*가능|예외|특례)[^()]*\)/g, ' ')
    .split(/\n|※/).map((line) => { const x = EXCL.test(line) ? line.replace(/(?:단|다만)\s*,?[^\n]*$/, ' ') : line; return EXCL.test(x) || EXC.test(x) ? '' : x; }).join('\n')
    .replace(/[^.,·\n()]*(우대|가점|우선)[^.,·\n()]*/g, ' ');
}
/** 시·군 이름(광역시·특별시·도 제외) — 제목·대상·기관에 다른 시·군이 적힌 지자체 공고를 가려내는 데 씀 */
export const SIGUNGU = new Set(('수원시 성남시 의정부시 안양시 부천시 광명시 평택시 동두천시 안산시 고양시 과천시 구리시 남양주시 오산시 시흥시 군포시 의왕시 하남시 용인시 파주시 이천시 안성시 김포시 화성시 광주시 양주시 포천시 여주시 연천군 가평군 양평군 '
  + '춘천시 원주시 강릉시 동해시 태백시 속초시 삼척시 홍천군 횡성군 영월군 평창군 정선군 철원군 화천군 양구군 인제군 고성군 양양군 청주시 충주시 제천시 보은군 옥천군 영동군 증평군 진천군 괴산군 음성군 단양군 '
  + '천안시 공주시 보령시 아산시 서산시 논산시 계룡시 당진시 금산군 부여군 서천군 청양군 홍성군 예산군 태안군 전주시 군산시 익산시 정읍시 남원시 김제시 완주군 진안군 무주군 장수군 임실군 순창군 고창군 부안군 '
  + '목포시 여수시 순천시 나주시 광양시 담양군 곡성군 구례군 고흥군 보성군 화순군 장흥군 강진군 해남군 영암군 무안군 함평군 영광군 장성군 완도군 진도군 신안군 포항시 경주시 김천시 안동시 구미시 영주시 영천시 상주시 문경시 경산시 '
  + '의성군 청송군 영양군 영덕군 청도군 고령군 성주군 칠곡군 예천군 봉화군 울진군 울릉군 창원시 진주시 통영시 사천시 김해시 밀양시 거제시 양산시 의령군 함안군 창녕군 남해군 하동군 산청군 함양군 거창군 합천군 '
  + '제주시 서귀포시 기장군 달성군 군위군 강화군 옹진군 울주군').split(' '));

// ---------------- #781 지역 단서(원천 지역 칸이 비어 있을 때) ----------------
// 로컬 10/28: [전남광주]·○○통합특별시·기관 이름(울산경제일자리진흥원·강원창조경제혁신센터)·서울 서초구·'○○ 소재 기업'에만 지역이 적힌 공고가 맞춤에 들어옴
/** 광역시 자치구 → 시·도, 시의 일반구 → 시. 여러 광역시에 같은 이름인 중구·동구·서구·남구·북구는 뺌 */
const GU = new Map<string, { sido: string[]; city?: string }>();
for (const [sido, names] of [['서울', '종로구 용산구 성동구 광진구 동대문구 중랑구 성북구 강북구 도봉구 노원구 은평구 서대문구 마포구 양천구 구로구 금천구 영등포구 동작구 관악구 서초구 강남구 송파구 강동구'],
  ['부산', '영도구 부산진구 동래구 해운대구 사하구 금정구 연제구 수영구 사상구'], ['대구', '수성구 달서구'], ['인천', '미추홀구 연수구 남동구 부평구 계양구'], ['광주', '광산구'], ['대전', '유성구 대덕구']]) for (const n of names.split(' ')) GU.set(n, { sido: [sido] });
GU.set('강서구', { sido: ['서울', '부산'] });
for (const [sido, city, names] of [['경기', '수원시', '장안구 권선구 팔달구 영통구'], ['경기', '성남시', '수정구 중원구 분당구'], ['경기', '안양시', '만안구 동안구'], ['경기', '안산시', '상록구 단원구'], ['경기', '고양시', '덕양구 일산동구 일산서구'],
  ['경기', '용인시', '처인구 기흥구 수지구'], ['충북', '청주시', '상당구 서원구 흥덕구 청원구'], ['충남', '천안시', '동남구 서북구'], ['전북', '전주시', '완산구 덕진구'], ['경남', '창원시', '의창구 성산구 마산합포구 마산회원구 진해구']]) for (const n of names.split(' ')) GU.set(n, { sido: [sido], city });
const GU_LONG = [...GU.keys()].sort((a, b) => b.length - a.length);
/** 시·군 이름에서 '시·군'을 뗀 이름 → 시·군(대괄호 꼬리표 '[용인]'·'용인 소재'). 보통 낱말과 같은 이름(화성·예산·강화·고령·음성·부여…)은 본문에서는 안 씀 */
const SGG_BASE = new Map<string, string[]>();
for (const n of SIGUNGU) { const b = n.replace(/[시군]$/, ''); if (b.length >= 2 && !SIDO.includes(b)) SGG_BASE.set(b, [...(SGG_BASE.get(b) ?? []), n]); }
const AMBIG_BASE = new Set('화성 예산 강화 고령 음성 부여 장수 상주 영양 진도 영광 구리 공주 동해 고성 광명 신안 보성 성주 완도 하동 남해 금산 청도 영동 정선 장성 의성 단양 화천'.split(' '));
type Place = { sido: string[]; sgg: string[] };
/** '전남광주'·'대구경북'처럼 시·도 짧은 이름만으로 이어진 낱말 → 시·도들 */
function sidoCombo(w: string): string[] | null {
  const out: string[] = []; let x = w;
  while (x) { const n = SIDO.find((v) => x.startsWith(v)); if (!n) return null; out.push(n); x = x.slice(n.length); }
  return out.length ? out : null;
}
/** 낱말 하나 → 시·도 / 시·군(꼬리표면 보통 낱말과 같은 시·군 이름도) */
function placeOf(w0: string, tag = false): Place | null {
  const w = w0.trim(); if (w.length < 2) return null;
  if (SIDO_ALIASES[w]) return { sido: [SIDO_ALIASES[w]], sgg: [] };
  if (SIGUNGU.has(w)) return { sido: [], sgg: [w] };
  const g = GU.get(w); if (g) return { sido: g.sido, sgg: g.city ? [g.city] : [] };
  const c = sidoCombo(w.replace(/(?:특별자치도|특별자치시|특별시|광역시|도|시)$/, '')); if (c) return { sido: c, sgg: [] };
  const b = SGG_BASE.get(w); if (b && (tag || !AMBIG_BASE.has(w))) return { sido: [], sgg: b };
  return null;
}
export type RegionHints = { sido: string[]; sgg: string[]; agency: string[]; doubt: string[]; national: boolean; capitalOut: boolean };
/** 공고 글 속 지역 단서 — sido·sgg = 강한 단서(제목 꼬리표·통합특별시·제목/대상의 시·도·구 이름·'○○ 소재/관내/지역 기업'), agency = 기관·수행기관 이름 앞 시·도 */
export function regionHints(p: { title: string; target: string | null; summary: string | null; agency: string | null; executor: string | null; hashtags?: string[] | null; category?: string | null }): RegionHints {
  const sido = new Set<string>(); const sgg = new Set<string>(); const agency = new Set<string>(); const doubt = new Set<string>();
  const add = (x: Place | null) => { if (x) { x.sido.forEach((v) => sido.add(v)); x.sgg.forEach((v) => sgg.add(v)); } };
  // 1) 제목 앞 [꼬리표] — [전남광주] [대구·경북] [용인]
  let rest = p.title;
  for (let m = rest.match(/^\s*[[(【]([^\])】]{1,20})[\])】]/); m; m = rest.match(/^\s*[[(【]([^\])】]{1,20})[\])】]/)) {
    for (const w of m[1].split(/[\s·,ㆍ/]+/)) add(placeOf(w, true));
    rest = rest.slice(m[0].length);
  }
  // 2) ○○통합특별시
  for (const m of `${p.title} ${p.target ?? ''} ${p.agency ?? ''} ${p.executor ?? ''}`.matchAll(/([가-힣]{2,8})통합특별시/g)) add(placeOf(m[1], true));
  // 3) 제목·대상의 시·도 이름(낱말 하나로) — 행사 장소가 적힌 제목은 뺌, '대전'(○○ 대전)·'세종'(세종학당)·경기(경기 활성화·스포츠 경기)는 꼴로만
  const tgt = targetText(String(p.target ?? ''));
  const venue = /코엑스|킨텍스|벡스코|엑스코|세텍|aT\s*센터|DDP|박람회|전시회|페어|엑스포|EXPO|개최/i.test(rest);
  for (const [txt, isTitle] of [[rest, true], [tgt, false]] as const) {
    if (isTitle && venue) continue;
    const ws = txt.split(/[\s,·ㆍ/()[\]「」<>'"‘’“”~:;!?-]+/).filter(Boolean);
    ws.forEach((w0, i) => {
      const w = w0.replace(/(?:지역|권역|소재|관내|형|내|의|에서|에|은|는|이|가)$/, '');
      const bare = w === w0;
      if (bare && (w === '대전' || w === '세종')) return;
      if (w === '경기' && (/^(활성화|침체|부양|회복|둔화|불황|하강|전망|변동|대회|운영|일정|결과|규칙|장|중)/.test(ws[i + 1] ?? '') || /(스포츠|체육|축구|야구|농구|배구|e스포츠)$/.test(ws[i - 1] ?? ''))) return;
      if (SIDO.includes(w) || SIDO_ALIASES[w] || sidoCombo(w.replace(/(?:특별자치도|특별자치시|특별시|광역시|도|시)$/, '')) && w !== '광주시') add(placeOf(w));
      else if (isTitle) { // 로컬 10/28 23:50: '대구리더스포럼'·'강원권'·「경남창조경제혁신센터」 — 지역 행사·투자일 수 있음 → 확인 필요(맞춤 아님)
        const n = SIDO.find((v) => w.startsWith(v) && w.length > v.length && v !== '대전' && v !== '세종' && !(v === '광주' && w.startsWith('광주시')));
        if (n && !(n === '경기' && /^경기(?:도|활성|침체|부양|회복|둔화)/.test(w))) doubt.add(n);
      }
    });
    let x = txt; for (const n of GU_LONG) if (x.includes(n)) { add(placeOf(n)); x = x.split(n).join(' '); }
  }
  // 4) 대상·본문의 '○○ 소재 기업'·'○○ 관내 업체'·'○○ 지역 중소기업'·'○○에 본사를 둔 기업'(목록 '서울·경기·인천 소재'도)
  const body = targetText(`${p.target ?? ''}\n${String(p.summary ?? '').slice(0, 3000)}`);
  for (const m of body.matchAll(/\s*(?:내\s*)?(?:소재|관내|지역|에\s*(?:본사|본점|주사무소|사업장)[을를이가]?\s*(?:둔|두고|있는|소재한|위치한))\s*(?:의\s*)?(?:중소\s*|중견\s*|창업\s*|청년\s*)?(?:기업|업체|사업자|소상공인|스타트업|법인|사업장|창업자)/g)) {
    const ws = body.slice(Math.max(0, (m.index ?? 0) - 40), m.index).split(/[\s,·ㆍ/]+|및/).filter(Boolean);
    for (let i = ws.length - 1; i >= 0; i--) { const pl = placeOf(ws[i]); if (!pl) break; add(pl); }
  }
  // 5) 기관·수행기관 이름 앞 시·도(울산경제일자리진흥원·강원창조경제혁신센터·서초구청) — 공항·항만 공사는 전국
  for (const w of `${p.agency ?? ''} ${p.executor ?? ''}`.split(/[\s,·()/]+/).filter(Boolean)) {
    if (/^(인천국제공항|인천공항|인천항|부산항|울산항|여수광양항)/.test(w)) continue;
    const long = Object.keys(SIDO_ALIASES).find((k) => w.startsWith(k)); if (long) { agency.add(SIDO_ALIASES[long]); continue; }
    const gu = GU_LONG.find((n) => w.startsWith(n)); if (gu) { GU.get(gu)!.sido.forEach((v) => agency.add(v)); continue; }
    const n = SIDO.find((v) => w.startsWith(v) && w.length > v.length);
    if (n && !(n === '세종' && !/^세종(시|특별자치시)/.test(w)) && !/^광주시/.test(w)) agency.add(n);
  }
  const national = /전국/.test(`${p.title} ${p.target ?? ''} ${(p.hashtags ?? []).join(' ')} ${p.category ?? ''}`);
  const capitalOut = /비\s*수도권|수도권\s*(?:소재\s*)?(?:기업\s*)?(?:외|이외|제외)/.test(`${p.title} ${p.target ?? ''}`);
  return { sido: SIDO.filter((v) => sido.has(v)), sgg: [...sgg], agency: SIDO.filter((v) => agency.has(v)), doubt: SIDO.filter((v) => doubt.has(v) && !sido.has(v)), national, capitalOut };
}

export type Profile = { region_sido: string | null; region_sigungu: string | null; founded: string | null; size: string | null; employees: number | null; revenue_krw: number | null; industries: string[]; keywords: string[];
  certs: string[]; brands: string[]; interests: string[]; excludes: string[]; memo: string | null; certs_none?: boolean };
type Prog = { id: string; tenant: string | null; source: string; title: string; agency: string | null; executor: string | null; category: string | null; target: string | null; regions: string[]; nationwide: boolean; summary: string | null;
  apply_start: string | null; apply_end: string | null; apply_text: string | null; amount: string | null; biz_years: string | null; url: string | null; apply_url: string | null; attachments: { name: string; url: string }[]; hashtags: string[];
  posted_at: string | null; first_seen_at: string; created_by: string | null; /** #788 정부24 지원 조건(JA 코드) */ conditions?: string[] };
const COLS = (sql: Sql, summaryLen = 1500) => sql`p.id, p.tenant, p.source, p.title, p.agency, p.executor, p.category, p.target, p.regions, p.nationwide, left(p.summary, ${summaryLen}) as summary, p.apply_start::text, p.apply_end::text,
  p.apply_text, p.amount, p.biz_years, p.url, p.apply_url, p.attachments, p.hashtags, p.posted_at, p.first_seen_at, p.created_by, p.conditions`;

// ---------------- 회사 프로필 ----------------
const arr = z.array(z.string().trim().min(1).max(40)).max(40).default([]);
export const profileInput = z.object({
  regionSido: z.string().trim().max(10).nullable().optional(), regionSigungu: z.string().trim().max(20).nullable().optional(),
  founded: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), size: z.enum(SIZES).nullable().optional(),
  employees: z.number().int().min(0).max(1_000_000).nullable().optional(), revenueKrw: z.number().int().min(0).max(1e15).nullable().optional(),
  industries: arr, keywords: arr, certs: arr, brands: arr, interests: arr, excludes: arr, memo: z.string().trim().max(1000).nullable().optional(),
  autoAi: z.boolean().optional(), // #785 새 공고 자동 AI 판단(회사 AI 예산에서)
  certsNone: z.boolean().optional(), // 로컬 10/28 23:50 '보유 인증 없음'(빈칸과 구분)
});
/** #785 판단 기준 칸 — 이것이 바뀌면 그 전 AI 판단은 '예전 프로필 기준'(다시 판단) */
const basisKey = (x: { region_sido?: string | null; region_sigungu?: string | null; founded?: string | null; size?: string | null; employees?: number | null; revenue_krw?: number | null; industries?: string[]; certs?: string[]; certs_none?: boolean }) =>
  JSON.stringify([x.region_sido ?? null, x.region_sigungu ?? null, x.founded ?? null, x.size ?? null, x.employees ?? null, x.revenue_krw == null ? null : Number(x.revenue_krw), [...(x.industries ?? [])].sort(), [...(x.certs ?? [])].sort(), !!x.certs_none]);
const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
/** 저장된 프로필, 없으면 회사 정보에서 채운 기본값(업종·본점 주소 시·도·관심 사업 이름·사업 소개) */
/** #785 마지막 자동 판단 결과(회사별) — stopped = 회사 AI 예산·한도·크레딧에 걸려 멈춤(다음 정기 실행 때 다시 해 봄) */
export type AutoState = { at: string; done: number; failed: number; left: number; stopped: string | null; error: string | null; fp?: string };
type ProfileOf = { profile: Profile; saved: boolean; updatedAt: string | null; autoAi: boolean; basisAt: string | null; autoState: AutoState | null };
export async function profileOf(t: string, sql: Sql = db()): Promise<ProfileOf> {
  const [r] = await sql<any[]>`select region_sido, region_sigungu, founded::text, size, employees, revenue_krw::float8 as revenue_krw, industries, keywords, certs, brands, interests, excludes, memo, updated_at,
    certs_none, auto_ai, basis_at, auto_state from support_profiles where tenant = ${t}`;
  if (r) {
    const { auto_ai, basis_at, auto_state, updated_at, ...pf } = r;
    return { profile: { ...pf, revenue_krw: pf.revenue_krw == null ? null : Number(pf.revenue_krw) }, saved: true, updatedAt: updated_at, autoAi: auto_ai !== false, basisAt: basis_at ? new Date(basis_at).toISOString() : null, autoState: auto_state ?? null };
  }
  const [tn] = await sql<{ industries: string[]; industry: string | null; ai_business: string | null }[]>`select industries, industry, ai_business from tenants where id = ${t}`;
  const [cp] = await sql<{ address: string | null }[]>`select address from company_profiles where tenant = ${t} order by is_default desc, key limit 1`;
  const brands = (await sql<{ name: string }[]>`select name from sales_business_categories where tenant = ${t} and active order by sort, name`).map((x) => x.name);
  const addr = String(cp?.address ?? '').trim(); const first = addr.split(/\s+/);
  const { SIDO_ALIASES } = await import('./collectors/prospects');
  const sido = SIDO_ALIASES[first[0] ?? ''] ?? SIDO.find((s) => (first[0] ?? '').startsWith(s)) ?? null;
  const sigungu = first[1] && /(시|군|구)$/.test(first[1]) ? first[1] : null;
  return { profile: { region_sido: sido, region_sigungu: sigungu, founded: null, size: null, employees: null, revenue_krw: null, industries: clean(tn?.industries?.length ? tn.industries : tn?.industry ? [tn.industry] : []),
    keywords: [], certs: [], brands, interests: [], excludes: [], memo: tn?.ai_business ? tn.ai_business.slice(0, 1000) : null, certs_none: false }, saved: false, updatedAt: null, autoAi: true, basisAt: null, autoState: null };
}
export async function getProfile(u: SessionUser) {
  await assertSpace(u, 'sales');
  const p = await profileOf(tenantOf(u));
  return { ...p, canEdit: isAdmin(u), sido: SIDO, sizes: SIZES, certOptions: CERTS, interestOptions: Object.keys(INTEREST_WORDS) };
}
export async function saveProfile(u: SessionUser, i: z.infer<typeof profileInput>) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('회사 프로필은 관리자만 바꿀 수 있습니다');
  if (i.regionSido && !SIDO.includes(i.regionSido)) throw badRequest('시·도를 목록에서 고르세요');
  const t = tenantOf(u); const sql = db();
  const v = { region_sido: i.regionSido ?? null, region_sigungu: i.regionSigungu || null, founded: i.founded ?? null, size: i.size ?? null, employees: i.employees ?? null, revenue_krw: i.revenueKrw ?? null,
    industries: clean(i.industries), keywords: clean(i.keywords), certs: clean(i.certs), brands: clean(i.brands), interests: clean(i.interests), excludes: clean(i.excludes), memo: i.memo || null,
    certs_none: !!i.certsNone && !clean(i.certs).length };
  const [prev] = await sql<any[]>`select region_sido, region_sigungu, founded::text, size, employees, revenue_krw::float8 as revenue_krw, industries, certs, certs_none, basis_at, auto_ai from support_profiles where tenant = ${t}`;
  const changed = !!prev && basisKey(prev) !== basisKey(v); // #785 판단 기준이 바뀌면 열린 공고의 AI 판단을 다시(자동 판단 차례로)
  const auto = { auto_ai: i.autoAi ?? prev?.auto_ai ?? true, basis_at: changed ? new Date() : prev?.basis_at ?? null };
  await sql`insert into support_profiles ${sql({ tenant: t, ...v, ...auto, updated_by: u.id } as never)}
    on conflict (tenant) do update set region_sido = excluded.region_sido, region_sigungu = excluded.region_sigungu, founded = excluded.founded, size = excluded.size, employees = excluded.employees, revenue_krw = excluded.revenue_krw,
      industries = excluded.industries, keywords = excluded.keywords, certs = excluded.certs, brands = excluded.brands, interests = excluded.interests, excludes = excluded.excludes, memo = excluded.memo,
      certs_none = excluded.certs_none, auto_ai = excluded.auto_ai, basis_at = excluded.basis_at, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'support.profile', 'tenant', null, { region: v.region_sido, size: v.size, interests: v.interests.length, basisChanged: changed, autoAi: auto.auto_ai }).catch(() => {});
  return getProfile(u);
}

// ---------------- 1차 규칙 맞춤 ----------------
/** need = 이 경고를 풀려면 채울 회사 프로필 칸(#784 '빈칸 n개를 채우면 n건 더 판단') */
export type Flag = { level: 'ok' | 'warn' | 'no'; text: string; need?: string };
export type Rule = { score: number; verdict: 'fit' | 'maybe' | 'no'; flags: Flag[] };
const yearsSince = (founded: string, today: string) => Math.max(0, Math.floor((daysBetween(founded, today) / 365.25) * 10) / 10);
/** 업력 상한(년) — K-Startup 업력 칸(예: 예비창업자,1년미만,…,7년미만) · '창업 N년 이내·미만' 문구 · '창업기업'(법정 업력 7년 이내). 10년이상이 있으면 제한 없음 */
export function maxYears(p: Pick<Prog, 'biz_years' | 'target' | 'title' | 'summary'>): { max: number; strict: boolean; preOnly: boolean; why?: string } | null {
  const by = String(p.biz_years ?? '');
  if (by) {
    if (/이상/.test(by)) return null;
    const ns = [...by.matchAll(/(\d+)\s*년\s*(미만|이하|이내)/g)].map((m) => ({ n: Number(m[1]), strict: m[2] === '미만' }));
    if (ns.length) { const top = ns.sort((a, b) => b.n - a.n)[0]; return { max: top.n, strict: top.strict, preOnly: false }; }
    if (/예비\s*창업/.test(by)) return { max: 0, strict: false, preOnly: true };
  }
  const text = `${p.title} ${p.target ?? ''} ${(p.summary ?? '').slice(0, 2000)}`;
  const m = text.match(/(?:창업|업력|설립)\s*(?:후\s*)?(\d{1,2})\s*년\s*(이내|미만|이하)/);
  if (m) return { max: Number(m[1]), strict: m[2] === '미만', preOnly: false };
  // #781(로컬 10/28): 제목·대상이 예비창업자만(예비창업패키지 아카데미·예비창업자 교육) — 기업·창업기업·업력 문구가 함께 있으면 아님
  const tt = `${p.title} ${p.target ?? ''}`;
  if (/예비\s*창업/.test(tt) && !/기업|창업자\s*및|초기|재창업|소상공인|사업자|업력|기\s*창업/.test(tt.replace(/예비\s*창업(?:자|패키지)?/g, ' '))) return { max: 0, strict: false, preOnly: true, why: '예비창업자' };
  if (/(?<!예비\s*)창업\s*기업/.test(`${p.title} ${p.target ?? ''}`)) return { max: 7, strict: false, preOnly: false, why: '창업기업' }; // 중소기업창업 지원법: 업력 7년 이내
  return null;
}
const base = (s: string) => s.replace(/(특별자치시|특별자치도|광역시|특별시|시|군|구)$/, '');
const termsOf = (pr: Profile) => {
  const words = new Map<string, string>(); // 낱말 → 화면 이름
  for (const i of pr.interests) for (const w of INTEREST_WORDS[i] ?? [i]) words.set(w.toLowerCase(), i);
  for (const k of [...pr.keywords, ...pr.industries]) for (const w of k.split(/[\s,·/]+/).filter((x) => x.length >= 2)) words.set(w.toLowerCase(), k);
  return words;
};
const SIGUNGU_LONG = [...SIGUNGU].sort((a, b) => b.length - a.length);
/** 글 속 시·군 — 긴 이름부터 찾고 지워서 '남양주시' 안의 '양주시' 같은 겹침을 막는다 */
/** 짧은 영문 낱말(IP·AI·R&D)은 낱말 경계로만(VIP·mail 같은 데 안 걸리게), 나머지는 포함 */
const inText = (t: string, w: string) => (/^[a-z0-9&+]{1,4}$/.test(w) ? new RegExp(`(^|[^a-z0-9])${w.replace(/[&+]/g, '\\$&')}([^a-z0-9]|$)`).test(t) : t.includes(w));
const sigunguIn = (t: string) => { let x = t; const out: string[] = []; for (const n of SIGUNGU_LONG) if (x.includes(n)) { out.push(n); x = x.split(n).join(' '); } return out; };
/** 글 속 업종 묶음 이름들(#649) */
const groupsIn = (t: string) => { const s = t.toLowerCase(); return Object.entries(INDUSTRY_GROUPS).filter(([, ws]) => ws.some((w) => inText(s, w.toLowerCase()))).map(([g]) => g); };
/** 상시근로자 조건(예: 상시근로자 5인 이상 50인 미만) */
function workerRules(t: string) { return [...t.matchAll(/상시\s*근로자\s*(?:수\s*)?(?:가\s*)?(\d{1,4})\s*(?:인|명)\s*(이상|이하|미만|초과)/g)].map((m) => ({ n: Number(m[1]), op: m[2] })); }
const workerOk = (e: number, r: { n: number; op: string }) => (r.op === '이상' ? e >= r.n : r.op === '초과' ? e > r.n : r.op === '이하' ? e <= r.n : e < r.n);
export function ruleMatch(p: Prog, pr: Profile | null, today: string): Rule {
  const flags: Flag[] = []; let score = 0;
  // #651: 깨진 해독(치환 문자·한자 범벅) 제목은 맞춤·마감 임박·주간 묶음에 안 올림 — 수집기가 다시 받으면 고쳐짐
  if (garbledText(p.title)) { flags.push({ level: 'no', text: '제목 글자가 깨져 있음 — 다시 수집하면 고쳐짐' }); score -= 100; }
  const title = p.title.toLowerCase(); const body = `${p.target ?? ''} ${p.summary ?? ''}`;
  const text = `${p.title} ${p.category ?? ''} ${p.target ?? ''} ${(p.hashtags ?? []).join(' ')} ${p.summary ?? ''}`.toLowerCase();
  // 기출원 건 지원 불가(IP) — 프로필과 무관하게 늘 경고
  if (/(기\s*출원|이미\s*출원|출원\s*(?:완료|된|한)\s*건)[^.\n]{0,30}(불가|제외|지원하지|지원\s*안|않)/.test(body) || /협약\s*(?:체결\s*)?(?:이\s*)?후\s*출원/.test(body))
    flags.push({ level: 'warn', text: '이미 출원한 건은 지원 불가 — 선정·협약 전에 출원하지 않기' });
  if (!pr) return { score: 0, verdict: 'maybe', flags: [...flags, { level: 'warn', text: '회사 프로필을 채우면 맞춤 판단', need: 'profile' }] };
  const has = (c: string) => pr.certs.some((x) => x.replace(/\s/g, '').includes(c));
  // 제외어
  const ex = pr.excludes.find((w) => title.includes(w.toLowerCase()) || String(p.target ?? '').toLowerCase().includes(w.toLowerCase()));
  if (ex) { flags.push({ level: 'no', text: `제외어 '${ex}'` }); score -= 100; }
  // 지역 — 시·도(원천 지역 칸, 비어 있으면 #781 글 속 단서: 제목 [꼬리표]·통합특별시·시·도·구 이름·'○○ 소재 기업' → 다음으로 기관 이름 앞 시·도)
  const hint = regionHints(p); let regionDoubt = false; // 지역이 의심스러우면 '맞춤'까지는 안 감(확인 필요)
  const regs = p.regions?.length ? p.regions : hint.sido;
  if (regs.length && pr.region_sido) {
    if (regs.includes(pr.region_sido)) { flags.push({ level: 'ok', text: `${pr.region_sido} 지역 공고` }); score += 20; }
    else { flags.push({ level: 'no', text: `${regs.join('·')} 기업 대상(우리 ${pr.region_sido})` }); score -= 100; }
  } else if (regs.length) flags.push({ level: 'warn', text: `${regs.join('·')} 지역 공고 — 본점 지역을 넣으면 판단`, need: 'region_sido' });
  else if (hint.agency.length) {
    if (!pr.region_sido) flags.push({ level: 'warn', text: `${hint.agency.join('·')} 기관 공고 — 본점 지역을 넣으면 판단`, need: 'region_sido' });
    else if (hint.agency.includes(pr.region_sido)) { flags.push({ level: 'ok', text: `${pr.region_sido} 기관 공고` }); score += 10; }
    else if (hint.national) { flags.push({ level: 'warn', text: `${hint.agency.join('·')} 기관 공고 — 지역 제한 확인` }); regionDoubt = true; }
    else { flags.push({ level: 'no', text: `${hint.agency.join('·')} 기관 공고(우리 ${pr.region_sido})` }); score -= 100; }
  }
  else if (hint.doubt.length && pr.region_sido && !hint.doubt.includes(pr.region_sido)) { flags.push({ level: 'warn', text: `${hint.doubt.join('·')} 지역 행사·기관일 수 있음 — 참가 지역 확인` }); regionDoubt = true; }
  if (hint.capitalOut && pr.region_sido && ['서울', '경기', '인천'].includes(pr.region_sido)) { flags.push({ level: 'no', text: `비수도권 기업 대상(우리 ${pr.region_sido})` }); score -= 100; }
  // 지역 — 시·군(제목·대상·해시태그·'○○ 소재'·[꼬리표]에 적힌 시·군은 강한 신호, 기관 이름에만 있으면 확인 필요)
  const strong = [...new Set([...sigunguIn(`${p.title} ${p.target ?? ''} ${(p.hashtags ?? []).map((h) => (SIGUNGU.has(`${h}시`) ? `${h}시` : SIGUNGU.has(`${h}군`) ? `${h}군` : h)).join(' ')}`), ...hint.sgg])];
  const weak = sigunguIn(`${p.agency ?? ''} ${p.executor ?? ''}`).filter((n) => !strong.includes(n));
  const mine = pr.region_sigungu ? base(pr.region_sigungu.split(/\s+/)[0]) : null;
  const isMine = (n: string) => !!mine && base(n) === mine;
  if (strong.length) {
    if (strong.some(isMine)) { flags.push({ level: 'ok', text: `${pr.region_sigungu} 공고` }); score += 25; }
    else if (mine) { flags.push({ level: 'no', text: `${strong.slice(0, 2).join('·')} 공고(우리 ${pr.region_sigungu})` }); score -= 100; }
    else flags.push({ level: 'warn', text: `${strong.slice(0, 2).join('·')} 공고 — 본점 시·군을 넣으면 판단`, need: 'region_sigungu' });
  } else if (weak.length) {
    if (weak.some(isMine)) { flags.push({ level: 'ok', text: `${pr.region_sigungu} 기관 공고` }); score += 15; }
    else flags.push({ level: 'warn', text: `${weak[0]} 기관 공고 — 지역 제한 확인` });
  } else if (mine && mine.length >= 2 && `${p.title} ${p.agency ?? ''} ${p.executor ?? ''}`.includes(mine)) { flags.push({ level: 'ok', text: `${pr.region_sigungu} 공고` }); score += 25; }
  // 업력
  const my = maxYears(p);
  if (my) {
    const yrs = pr.founded ? yearsSince(pr.founded, today) : null; const cond = `${my.why ? `${my.why}(업력 ${my.max}년 이내)` : `업력 ${my.max}년 ${my.strict ? '미만' : '이내'}`}`;
    if (my.preOnly) { if (pr.founded) { flags.push({ level: 'no', text: '예비창업자 대상' }); score -= 100; } else flags.push({ level: 'warn', text: '예비창업자 대상', need: 'founded' }); }
    else if (yrs == null) flags.push({ level: 'warn', text: `${cond} — 설립일을 넣으면 판단`, need: 'founded' });
    else if (my.strict ? yrs < my.max : yrs <= my.max) { flags.push({ level: 'ok', text: `${cond} — 우리 ${yrs}년` }); score += 10; }
    else { flags.push({ level: 'no', text: `${cond}만 — 우리 ${yrs}년` }); score -= 100; }
  }
  // 상시근로자 수
  const wr = workerRules(`${p.target ?? ''} ${(p.summary ?? '').slice(0, 2000)}`);
  if (wr.length) {
    const cond = `상시근로자 ${wr.map((r) => `${r.n}인 ${r.op}`).join(' ')}`;
    if (pr.employees == null) flags.push({ level: 'warn', text: `${cond} — 근로자 수를 넣으면 판단`, need: 'employees' });
    else if (wr.every((r) => workerOk(pr.employees!, r))) { flags.push({ level: 'ok', text: `${cond} — 우리 ${pr.employees}명` }); score += 5; }
    else { flags.push({ level: 'no', text: `${cond}만 — 우리 ${pr.employees}명` }); score -= 100; }
  }
  // 규모·대상
  const tg = `${p.target ?? ''} ${p.title}`;
  if (/소상공인/.test(tg) && !/중소기업|중소·|기업\s*및|중견/.test(tg.replace(/소상공인/g, ''))) {
    if (pr.size && ['중기업', '중견기업'].includes(pr.size)) { flags.push({ level: 'no', text: `소상공인 대상(우리 ${pr.size})` }); score -= 100; }
    else if (pr.size && ['소상공인', '소기업'].includes(pr.size)) { flags.push({ level: 'ok', text: '소상공인 대상' }); score += 5; }
    else flags.push({ level: 'warn', text: '소상공인 대상 — 규모를 넣으면 판단', need: 'size' });
  }
  // #781(로컬 10/28): 1인 창조기업 대상(1인 또는 5인 미만 공동 창업) — 상시근로자 5명 이상·중기업 이상이면 해당 없음
  const tt1 = `${p.title} ${p.target ?? ''}`;
  if (/1인\s*창조\s*기업/.test(tt1) && !/(?:중소|일반|창업)\s*기업|소상공인/.test(tt1.replace(/1인\s*창조\s*기업/g, ' '))) {
    if (pr.employees != null) { if (pr.employees >= 5) { flags.push({ level: 'no', text: `1인 창조기업 대상(우리 상시근로자 ${pr.employees}명)` }); score -= 100; } else { flags.push({ level: 'ok', text: '1인 창조기업 대상' }); score += 5; } }
    else if (pr.size && ['중기업', '중견기업'].includes(pr.size)) { flags.push({ level: 'no', text: `1인 창조기업 대상(우리 ${pr.size})` }); score -= 100; }
    else flags.push({ level: 'warn', text: '1인 창조기업 대상 — 상시근로자 수를 넣으면 판단', need: 'employees' });
  }
  if (/중견기업/.test(tg) && !/중소/.test(tg) && pr.size && ['소상공인', '소기업', '예비창업'].includes(pr.size)) flags.push({ level: 'warn', text: '중견기업 대상' });
  if (/(대학생|대학원생|청년\s*개인|농업인|어업인|임업인)/.test(String(p.target ?? '')) && !/기업/.test(String(p.target ?? ''))) flags.push({ level: 'warn', text: '개인·특정 대상 공고' });
  // #788 정부24 지원 조건(supportConditions JA 코드) — 소상공인만(JA11)·법인/단체(JA21)·업종(JA12·JA22)
  const jc = p.source === 'gov24' ? p.conditions ?? [] : [];
  if (jc.length) {
    const small = jc.filter((c) => c.startsWith('JA11')); const corp = jc.filter((c) => c.startsWith('JA21')); const ind = jc.filter((c) => /^JA(12|22)/.test(c));
    if (small.length && !corp.length) {
      const heavy = /제조|건설|운수|광업/.test(pr.industries.join(' ')); const lim = heavy ? 10 : 5; // 소상공인 = 상시근로자 5명 미만(제조·건설·운수·광업 10명 미만)
      if (small.every((c) => c === 'JA1101')) { if (pr.founded) { flags.push({ level: 'no', text: '예비창업자 대상' }); score -= 100; } else flags.push({ level: 'warn', text: '예비창업자 대상', need: 'founded' }); }
      else if (pr.size === '소상공인' || (pr.employees != null && pr.employees < lim)) { flags.push({ level: 'ok', text: '소상공인 대상 — 우리 회사 해당' }); score += 5; }
      else if (pr.employees != null || (pr.size && pr.size !== '예비창업')) { flags.push({ level: 'no', text: `소상공인 대상 — 우리 회사는 ${pr.employees != null ? `상시근로자 ${pr.employees}명이라` : `${pr.size}라`} 소상공인 아님` }); score -= 100; }
      else flags.push({ level: 'warn', text: '소상공인 대상 — 규모·상시근로자 수를 넣으면 판단', need: 'employees' });
    } else if (corp.length && !corp.includes('JA2101') && !small.length) { flags.push({ level: 'no', text: '사회복지시설·기관/단체 대상' }); score -= 100; }
    else if (corp.includes('JA2101')) { if (pr.size === '중견기업') flags.push({ level: 'warn', text: '중소기업 대상(우리 중견기업)' }); else { flags.push({ level: 'ok', text: '중소기업 대상' }); score += 5; } }
    if (ind.length) {
      if (!pr.industries.length) flags.push({ level: 'warn', text: `${[...new Set(ind.map((c) => JA_LABEL[c] ?? c))].join('·')} 대상 — 프로필에 업종을 넣으면 판단`, need: 'industries' });
      else {
        const mine = new Set<string>();
        for (const w of pr.industries) {
          if (/제조/.test(w)) { mine.add('JA2201'); mine.add('JA1202'); } else if (/농|어업|임업|축산|수산/.test(w)) mine.add('JA2202');
          else if (/정보통신|소프트웨어|SW|IT|ICT|플랫폼|앱|인공지능|AI|데이터|클라우드|통신/i.test(w)) mine.add('JA2203');
          else if (/음식|외식|식당/.test(w)) mine.add('JA1201');
          else { mine.add('JA2299'); mine.add('JA1299'); } // 기타업종 — 제조·농림어업·정보통신·음식점이 아닌 업종(체육시설 운영 등)
        }
        const hit = ind.filter((c) => mine.has(c)); const names = (cs: string[]) => [...new Set(cs.map((c) => JA_LABEL[c] ?? c))].join('·');
        if (hit.length) { flags.push({ level: 'ok', text: `대상 업종 ${names(hit)} — 우리 업종` }); score += 15; }
        else { flags.push({ level: 'no', text: `${names(ind)} 대상(우리 ${pr.industries.slice(0, 2).join('·')})` }); score -= 100; }
      }
    }
  }
  // #649 업종: '지원 대상'(우대·가점·제외 구절은 뺌)에 적힌 업종이 우리 프로필 업종과 하나도 안 겹치면 해당 없음(여러 업종이 나열되면 하나만 겹쳐도 통과), 프로필 업종이 비어 있으면 확인 필요, 제목에만 있으면 확인 필요
  // #781: 본문의 '○○ 분야(업종·산업) 기업' 구절도 대상 업종(남동발전 '발전·에너지 분야 중소기업') · 제목의 대기 배출시설·방지시설 낱말(IoT 측정기기 부착 지원)
  const phr = [...targetText(String(p.summary ?? '').slice(0, 4000)).matchAll(/([가-힣A-Za-z·ㆍ,\s]{2,24}?)\s*(?:분야|업종|산업)\s*(?:의\s*)?(?:중소\s*|중견\s*|창업\s*|영위\s*)?(?:기업|사업자|업체)/g)].map((m) => m[1]).join(' · ');
  const tgt = [targetText(String(p.target ?? '')), phr, /배출시설|방지시설|배출사업장|대기오염|오염물질/.test(p.title) ? p.title : ''].join('\n');
  const tg2 = groupsIn(tgt); const mineG = groupsIn(pr.industries.join(' '));
  let industryOk = false;
  if (tg2.length && !GENERIC_TARGET.test(tgt)) {
    const hit = tg2.filter((g) => mineG.includes(g));
    if (hit.length) { flags.push({ level: 'ok', text: `대상 업종 ${hit.join('·')} — 우리 업종` }); score += 15; industryOk = true; }
    else if (mineG.length) { flags.push({ level: 'no', text: `${tg2.slice(0, 3).join('·')} 업종 대상(우리 ${pr.industries.slice(0, 2).join('·')})` }); score -= 100; }
    else flags.push({ level: 'warn', text: `${tg2.slice(0, 3).join('·')} 업종 대상 — 프로필에 업종을 넣으면 판단`, need: 'industries' });
  } else if (!tg2.length) {
    const tt = groupsIn(p.title);
    if (tt.length && mineG.length && !tt.some((g) => mineG.includes(g))) flags.push({ level: 'warn', text: `제목에 ${tt.slice(0, 2).join('·')} 업종 — 대상 확인 필요` });
  }
  // 연구소·전담부서 / 벤처·이노비즈 / SW사업자 — 요구(또는 우대) 문구가 있을 때
  if (/(기업부설\s*연구소|연구개발\s*전담\s*부서)[^.\n]{0,20}(보유|설립|인정|있는|갖춘)/.test(body)) {
    if (has('기업부설연구소') || has('연구개발전담부서')) { flags.push({ level: 'ok', text: '연구소·전담부서 보유' }); score += 10; }
    else flags.push({ level: 'warn', text: '기업부설연구소·연구개발전담부서 보유 기업 대상(또는 우대)', ...(pr.certs.length || pr.certs_none ? {} : { need: 'certs' }) });
  }
  const vc = ['벤처기업', '이노비즈', '메인비즈'].filter((c) => new RegExp(`${c}[^.\\n]{0,20}(인증|확인|보유|대상|우대)`).test(body));
  if (vc.length) {
    if (vc.some(has)) { flags.push({ level: 'ok', text: `${vc.filter(has).join('·')} 인증 보유` }); score += 10; }
    else flags.push({ level: 'warn', text: `${vc.join('·')} 인증 기업 대상(또는 우대)`, ...(pr.certs.length || pr.certs_none ? {} : { need: 'certs' }) });
  }
  if (/(SW|소프트웨어)\s*사업자/.test(`${p.title} ${body}`)) {
    if (has('SW사업자') || has('소프트웨어사업자')) { flags.push({ level: 'ok', text: 'SW사업자 신고 기업' }); score += 5; }
    else flags.push({ level: 'warn', text: 'SW사업자 신고 필요', ...(pr.certs.length || pr.certs_none ? {} : { need: 'certs' }) });
  }
  const certHit = pr.certs.filter((c) => !/벤처|이노비즈|메인비즈|연구소|전담부서|SW|소프트웨어/.test(c) && text.includes(c.toLowerCase()));
  if (certHit.length) { flags.push({ level: 'ok', text: `${certHit.join('·')} 대상·우대 — 보유` }); score += 10; }
  // 관심 분야·검색어·업종
  const hits = new Set<string>(); let kw = 0;
  for (const [w, label] of termsOf(pr)) { if (inText(title, w)) { hits.add(label); kw += 12; } else if (inText(text, w)) { hits.add(label); kw += 6; } }
  if (hits.size) { flags.push({ level: 'ok', text: `관심: ${[...hits].slice(0, 4).join('·')}` }); score += Math.min(40, kw); }
  // #649 ②: 관심 키워드만으로는 맞춤이 안 됨(가점만) — 지역·업력·규모·근로자·인증·업종 중 하나라도 '맞음'이 있어야 1차 맞춤
  const eligOk = flags.filter((f) => f.level === 'ok' && !f.text.startsWith('관심:')).length;
  const verdict: Rule['verdict'] = flags.some((f) => f.level === 'no') ? 'no' : hits.size && score >= 12 && (eligOk > 0 || industryOk) && !regionDoubt ? 'fit' : 'maybe';
  return { score, verdict, flags };
}

// ---------------- 목록·상세 ----------------
type Match = { program_id: string; ai_verdict: 'fit' | 'maybe' | 'no' | null; ai_reasons: string[]; ai_brands: string[]; ai_docs: string[]; ai_summary: string | null; ai_amount: string | null; ai_at: string | null; hidden: boolean;
  ai_use?: string[]; ai_schedule?: string | null; ai_auto?: boolean; auto_fail?: number; ai_effect?: Effect | null; listed_at?: string | null; ai_rule_verdict?: string | null };
type Work = { id: string; program_id: string; status: string; owner_id: string | null; owner_name: string | null; task_id: string | null; brands: string[]; applied_at: string | null; result_at: string | null; amount_awarded: string | null; result_memo: string | null; memo: string | null; updated_at: string };
const RANK: Record<string, number> = { fit: 0, maybe: 1, none: 2, no: 3 };
async function disabledSources(sql: Sql, t: string) {
  const off = await sql<{ slug: string }[]>`select slug from sales_collector_settings where tenant = ${t} and not enabled and slug = any(${Object.values(SOURCE_SLUG)})`;
  const g = await sql<{ slug: string }[]>`select slug from sales_collector_state where not enabled and slug = any(${Object.values(SOURCE_SLUG)})`;
  const slugs = new Set([...off, ...g].map((x) => x.slug));
  return Object.entries(SOURCE_SLUG).filter(([, s]) => slugs.has(s)).map(([src]) => src);
}
// ---------------- #781 정렬·D-day·종류 ----------------
/** 지원 금액(원) — 금액 문구에서 가장 큰 금액('1억 5천만원'·'최대 720만 원'·'1,000,000원'), 모르면 null(정렬 맨 뒤) */
export function amountKrw(s: string | null | undefined): number | null {
  const t = String(s ?? '').replace(/(\d),(?=\d{3})/g, '$1');
  const U: Record<string, number> = { 억: 1e8, 천만: 1e7, 백만: 1e6, 십만: 1e5, 만: 1e4, 천: 1e3 };
  let best = 0, run = 0, unit = Infinity, end = -1;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(억|천만|백만|십만|만|천)?\s*(원)?/g)) {
    const u = m[2] ? U[m[2]] : m[3] ? 1 : 0; const at = m.index ?? 0;
    if (!u) { run = 0; unit = Infinity; end = -1; continue; }
    if (at !== end || u >= unit) run = 0; // '1억 5천만원' 처럼 붙은 큰 단위 → 작은 단위만 이어 셈
    run += Number(m[1]) * u; unit = u; end = at + m[0].length;
    if (m[3]) { best = Math.max(best, run); run = 0; unit = Infinity; end = -1; }
  }
  return best > 0 ? Math.round(best) : null;
}
export const KIND_LABEL = { money: '돈', free: '무료 서비스', space: '공간', invest: '투자·IR', event: '행사·교육' } as const;
export type Kind = keyof typeof KIND_LABEL;
/** 공고 종류(여럿 가능) — 제목·지원 분야(K-Startup 분류 포함)·금액 문구로. 아무것도 아니면 [] */
export function kindsOf(p: { title: string; category: string | null }, amount: string | null): Kind[] {
  const t = `${p.title} ${p.category ?? ''}`; const out: Kind[] = [];
  // 로컬 10/28 23:50: 돈 = 회사에 현금·융자·보증·바우처·인건비가 들어오는 것만('금융'·'투자'·'지원' 낱말이나 컨설팅 금액만으로는 아님) · 컨설팅 비용 지원 = 무료 서비스
  const free = /컨설팅|멘토링|자문|진단|코칭|상담(?!회)|무료|무상|법률|노무|세무|회계|채용관|홍보\s*지원|언론\s*홍보|기사|시제품|디자인\s*지원|인증\s*(?:획득\s*)?지원|훈련/.test(t);
  const edu = /교육|아카데미|과정|세미나|포럼|설명회|강좌|특강|워크숍|워크샵/.test(t);
  if (/자금|융자|보조금|지원금|장려금|사업화|사업비|바우처|보증|대출|R&D|연구\s*개발\s*(?:비|자금|과제|지원)|기술\s*개발\s*(?:비|자금|과제|지원)|(?<!(?:컨설팅|교육|진단|멘토링|훈련)\s*)비용\s*지원|인건비|임차료|상금|포상금/.test(t) || (amountKrw(amount) && !free && !edu)) out.push('money');
  if (free) out.push('free');
  if (/입주|공간|사무실|보육|오피스|테스트베드|팝업\s*스토어|센터\s*운영기업/.test(t)) out.push('space');
  if (/투자|(?:^|[^A-Za-z])IR(?:[^A-Za-z]|$)|데모\s*데이|액셀러레이|엑셀러레이|펀드|창공|벤처\s*캐피탈|VC(?:[^A-Za-z]|$)/i.test(t)) out.push('invest');
  if (/교육|아카데미|과정|세미나|포럼|설명회|박람회|전시회|전시\s*참가|참관|컨퍼런스|콘퍼런스|공모전|경진\s*대회|캠프|행사|상담회|네트워킹|네트워크|교육생|강좌|특강|워크숍|워크샵|학교/.test(t)) out.push('event');
  return out;
}
export const SORTS = ['fit', 'deadline', 'new', 'amount'] as const;
export const DDS = ['all', 'd3', 'd7', 'd14', 'd30', 'open'] as const;
const KIND_KEYS = ['all', ...Object.keys(KIND_LABEL)] as [string, ...string[]];
/** #788 대상 칩 — 중소기업·법인 / 소상공인 / 고용 지원금(정부24 지원 조건 코드 · 대상·제목 낱말) */
export const AUD_LABEL = { corp: '중소기업·법인', small: '소상공인', job: '고용 지원금' } as const;
const AUD_KEYS = ['all', ...Object.keys(AUD_LABEL)] as [string, ...string[]];
function audOf(p: Prog): string[] {
  const c = p.conditions ?? []; const out: string[] = [];
  if (c.some((x) => x.startsWith('JA21')) || (p.source !== 'gov24' && /중소\s*기업|법인|중소·중견/.test(p.target ?? ''))) out.push('corp');
  if (c.some((x) => x.startsWith('JA11')) || /소상공인/.test(`${p.title} ${p.target ?? ''}`)) out.push('small');
  // 정부24 서비스분야 '고용·창업'은 창업 융자도 품어 분야만으로는 안 셈 — 제목 낱말, 또는 분야가 고용이고 대상에 채용·인건비가 있을 때
  if (/장려금|고용\s*(?:지원|유지|안정|촉진|창출)|채용|일자리|인건비/.test(p.title) || (/고용|일자리/.test(p.category ?? '') && /채용|신규\s*고용|인건비/.test(p.target ?? ''))) out.push('job');
  return out;
}
/** 탭마다 기본 정렬(사람이 고르면 그 정렬을 기억해 모든 탭에) */
const TAB_SORT: Record<string, string> = { fit: 'fit', closing: 'deadline', list: 'deadline', mine: 'deadline', all: 'new' };
export const supportViewInput = z.object({ sort: z.enum(SORTS).nullable().optional(), dd: z.enum(DDS).optional(), kind: z.enum(KIND_KEYS).optional(), aud: z.enum(AUD_KEYS).optional() });
type SupportView = { sort: (typeof SORTS)[number] | null; dd: (typeof DDS)[number]; kind: string; aud: string };
/** 사람별 정렬·필터 기억 — user_settings.list_views.support(어느 기기에서나 같게) */
async function supportViewOf(sql: Sql, userId: string): Promise<SupportView> {
  const [r] = await sql<{ v: any }[]>`select list_views->'support' as v from user_settings where user_id = ${userId}`;
  const v = supportViewInput.safeParse(r?.v ?? {}); const d = v.success ? v.data : {};
  return { sort: d.sort ?? null, dd: d.dd ?? 'all', kind: d.kind ?? 'all', aud: d.aud ?? 'all' };
}
export async function saveSupportView(u: SessionUser, i: z.infer<typeof supportViewInput>) {
  await assertSpace(u, 'sales');
  const sql = db(); const cur = await supportViewOf(sql, u.id);
  const next: SupportView = { sort: i.sort !== undefined ? i.sort : cur.sort, dd: i.dd ?? cur.dd, kind: i.kind ?? cur.kind, aud: i.aud ?? cur.aud };
  await sql`insert into user_settings (user_id, list_views) values (${u.id}, ${sql.json({ support: next } as never)})
    on conflict (user_id) do update set list_views = coalesce(user_settings.list_views, '{}'::jsonb) || ${sql.json({ support: next } as never)}`;
  return next;
}
/** AI 판단 1건 예상 비용(원) — 이 회사 최근 지원사업 판단 30건 평균(없으면 모든 회사, 그것도 없으면 보통 길이로 계산) */
async function aiCostKrw(sql: Sql, t: string) {
  const avg = async (mine: boolean) => (await sql<{ a: number | null }[]>`select avg(cost_usd)::float8 as a from (select cost_usd from ai_usage where purpose = 'sales_support' and (${!mine} or tenant = ${t}) order by created_at desc limit 30) x`)[0]?.a ?? null;
  const usd = (await avg(true)) ?? (await avg(false)) ?? costUsd(modelFor('fast'), { input_tokens: 6000, output_tokens: 900 });
  const krw = usd * usdKrw();
  return krw < 10 ? Math.max(1, Math.round(krw)) : Math.round(krw / 10) * 10;
}
const NEED_LABEL: Record<string, string> = { profile: '회사 프로필', region_sido: '본점 시·도', region_sigungu: '본점 시·군', founded: '설립일', employees: '상시근로자 수', size: '규모', industries: '업종', certs: '보유 인증' };

function itemOf(p: Prog, rule: Rule, m: Match | undefined, w: Work | undefined, today: string, me: string, basisAt: string | null = null) {
  const stale = !!(m?.ai_verdict && m.ai_at && basisAt && new Date(m.ai_at).getTime() < new Date(basisAt).getTime()); // #785 판단 뒤 프로필 기준 칸이 바뀜
  // 로컬 10/28 23:50: 규칙의 자격 '해당 없음'(지역·대상·업종·1인·예비창업)은 AI '확인 필요'보다 앞섬 · AI '해당'인데 규칙 '해당 없음'이면 '규칙과 다름 · 확인'
  const aiV = m?.ai_verdict ?? null;
  const final = !aiV ? { verdict: rule.verdict, by: 'rule' as const, conflict: false }
    : aiV === 'maybe' && rule.verdict === 'no' ? { verdict: 'no' as const, by: 'rule' as const, conflict: false }
    : { verdict: aiV, by: 'ai' as const, conflict: aiV === 'fit' && rule.verdict === 'no' };
  const dday = p.apply_end ? daysBetween(today, p.apply_end) : null;
  const amount = m?.ai_amount || p.amount;
  return {
    id: p.id, title: p.title, agency: p.agency, executor: p.executor, category: p.category, source: p.source, sourceLabel: SOURCE_LABEL[p.source] ?? p.source, regions: p.regions ?? [], nationwide: p.nationwide,
    applyStart: p.apply_start, applyEnd: p.apply_end, applyText: p.apply_text, dday, amount, amountKrw: amountKrw(amount) ?? amountKrw(p.amount), kinds: kindsOf(p, amount), url: p.url, applyUrl: p.apply_url, manual: !!p.tenant, mine: p.created_by === me,
    isNew: Date.now() - new Date(p.first_seen_at).getTime() < 2 * 864e5 && !p.tenant, target: p.target, seen: p.first_seen_at, alsoOn: [] as string[], aud: audOf(p),
    garbled: garbledText(p.title), pending: !m?.ai_verdict && rule.verdict === 'fit', // #651 깨진 제목 · #649 ③ 1차 맞춤이지만 AI 판정 전(#782 '규칙상 맞음 · AI 판단 전')
    rule, ai: m?.ai_verdict ? { verdict: m.ai_verdict, reasons: m.ai_reasons ?? [], brands: m.ai_brands ?? [], docs: m.ai_docs ?? [], summary: m.ai_summary, at: m.ai_at, use: Array.isArray(m.ai_use) ? m.ai_use : [], schedule: m.ai_schedule ?? null, auto: !!m.ai_auto, stale, effect: m.ai_effect ?? null, ruleAt: m.ai_rule_verdict ?? null } : null, final, hidden: !!m?.hidden, listed: !!m?.listed_at, listedAt: m?.listed_at ?? null,
    queued: false, autoFail: m?.auto_fail ?? 0, // #785 자동 판단 차례(listView 가 채움) · 자동 판단 실패 횟수
    work: w ? { id: w.id, status: w.status, statusLabel: STATUS_LABEL[w.status] ?? w.status, ownerId: w.owner_id, ownerName: w.owner_name, taskId: w.task_id, brands: w.brands ?? [], appliedAt: w.applied_at, resultAt: w.result_at,
      amountAwarded: w.amount_awarded, resultMemo: w.result_memo, memo: w.memo } : null,
  };
}
export type SupportItem = ReturnType<typeof itemOf>;
const normTitle = (t: string) => t.replace(/^\s*[[(【][^\])】]{1,20}[\])】]\s*/, '').replace(/[\s·.,()[\]"'「」<>~\-]/g, '').toLowerCase();
/** 기업마당·K-Startup 에 같은 공고가 함께 올라오면 공고명+접수 마감일로 하나로(진행·AI 판단이 있는 것 > K-Startup > 기업마당 > 기관 공지) — 직접 넣은 공고는 그대로 */
function dedupe(items: SupportItem[]) {
  const pri = (x: SupportItem) => (x.work ? 0 : x.ai ? 1 : x.source === 'kstartup' ? 2 : x.source === 'bizinfo' ? 3 : 4);
  const groups = new Map<string, SupportItem[]>(); const out: SupportItem[] = [];
  for (const x of items) { if (x.manual) { out.push(x); continue; } const k = `${normTitle(x.title)}|${x.applyEnd ?? ''}`; const g = groups.get(k); if (g) g.push(x); else groups.set(k, [x]); }
  for (const g of groups.values()) { g.sort((a, b) => pri(a) - pri(b)); out.push({ ...g[0], alsoOn: [...new Set(g.slice(1).map((x) => x.sourceLabel).filter((l) => l !== g[0].sourceLabel))] }); }
  // #788: 정부24 상시 서비스와 같은 사업 공고(기업마당·K-Startup·기관 공지)는 하나로 — 공고명이 같거나 한쪽이 다른 쪽을 품고(8자 이상) 기관이 같을 때(진행·AI 판단이 있는 정부24 줄은 그대로)
  const notices = out.filter((x) => x.source !== 'gov24' && !x.manual).map((x) => ({ x, n: normTitle(x.title), a: normTitle(x.agency ?? '') }));
  const drop = new Set<string>();
  for (const g of out) {
    if (g.source !== 'gov24' || g.work || g.ai) continue;
    const n = normTitle(g.title.replace(/^\d{4}\s*년(?:도)?\s*/, '')); const a = normTitle(g.agency ?? '');
    const same = n.length >= 6 && notices.find(({ n: m, a: b }) => (m === n || (Math.min(m.length, n.length) >= 8 && (m.includes(n) || n.includes(m)))) && (!a || !b || a === b || a.includes(b) || b.includes(a)));
    if (same) { drop.add(g.id); same.x.alsoOn = [...new Set([...same.x.alsoOn, g.sourceLabel])]; }
  }
  return drop.size ? out.filter((x) => !drop.has(x.id)) : out;
}
const rankOf = (x: SupportItem) => (x.final.conflict ? RANK.maybe : x.final.by === 'ai' ? RANK[x.final.verdict] : x.final.verdict === 'no' ? RANK.no : x.rule.verdict === 'fit' ? 0.5 : RANK.none);
/** 담당 고르기: 영업 공간을 쓰는 사람(관리자는 켠 공간 전부) */
async function peopleOf(sql: Sql, t: string) {
  return sql<{ id: string; name: string }[]>`select us.id, us.name from users us left join space_members m on m.user_id = us.id and m.tenant = us.tenant
    where us.tenant = ${t} and us.status = 'active' and (us.role in ('owner', 'admin') or 'sales' = any(coalesce(m.spaces, '{}'::text[]))) order by us.name`;
}
/** 탭: fit(맞춤 — 기본) · closing(마감 14일 안) · mine(관심·준비) · results(신청·결과) · all(전체 공고, 새로 들어온 순)
 * #781 정렬(맞춤·마감 임박·새로 올라온·지원 금액) · D-day 칩(3·7·14·30일 안·상시/예산 소진) · 종류 칩(돈·무료 서비스·공간·투자·IR·행사·교육) — 셋 다 안 주면 그 사람이 마지막에 고른 것 */
export async function listView(u: SessionUser, q: { tab?: string; q?: string; showNo?: boolean; limit?: number; sort?: string; dd?: string; kind?: string; aud?: string } = {}) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  const tab = ['fit', 'closing', 'list', 'mine', 'results', 'all'].includes(q.tab ?? '') ? q.tab! : 'fit';
  const remembered = q.sort === undefined && q.dd === undefined && q.kind === undefined && q.aud === undefined ? await supportViewOf(sql, u.id) : null;
  const pick = <T extends string>(v: string | undefined, all: readonly T[], d: T | null) => (all.includes(v as T) ? (v as T) : d);
  const view: SupportView = { sort: pick(q.sort ?? remembered?.sort ?? undefined, SORTS, null), dd: pick(q.dd ?? remembered?.dd, DDS, 'all')!, kind: pick(q.kind ?? remembered?.kind, KIND_KEYS, 'all')!, aud: pick(q.aud ?? remembered?.aud, AUD_KEYS, 'all')! };
  const { all, profile, saved, pr, off, wm, autoAi, autoState } = await supportAll(sql, t, u.id, today);
  // #785 자동 판단 차례 — 자동 판단을 켠 회사(프로필 저장)·AI 켜짐·예산에 걸려 멈추지 않았을 때만 'AI 확인 중'
  const autoOn = saved && autoAi && aiEnabled() && process.env.SUPPORT_AUTO_AI !== 'off';
  let autoQueue = 0;
  if (autoOn && !autoState?.stopped) for (const x of all) if (autoCandidate(x, today)) { x.queued = true; autoQueue++; }
  const term = (q.q ?? '').trim().toLowerCase();
  const hit = (x: SupportItem) => !term || `${x.title} ${x.agency ?? ''} ${x.executor ?? ''} ${x.category ?? ''} ${x.target ?? ''}`.toLowerCase().includes(term);
  const open = (x: SupportItem) => isOpen(x, today);
  const isNo = (x: SupportItem) => x.final.verdict === 'no';
  const fitBase = (x: SupportItem) => fitBaseAt(x, today);
  const inTab: Record<string, (x: SupportItem) => boolean> = {
    fit: (x) => fitBase(x) && !isNo(x),
    closing: (x) => x.dday != null && x.dday >= 0 && x.dday <= 14 && !x.hidden && !isNo(x) && (!x.work || OPEN_WORK.includes(x.work.status)),
    list: (x) => x.listed && (!x.work || OPEN_WORK.includes(x.work.status)), // #784 이번 주 신청 목록(담은 것 — 신청·결과·포기로 넘어가면 빠짐)
    mine: (x) => !!x.work && OPEN_WORK.includes(x.work.status),
    results: (x) => !!x.work && !OPEN_WORK.includes(x.work.status),
    all: (x) => open(x) || !!x.work,
  };
  // 탭 숫자(맞춤 n)는 '해당 없음 보기'(showNo)와 무관 — 로컬 10/25 158차 확인: showNo=1 로 읽으면 맞춤 수가 112 → 880(숨긴 '해당 없음'까지 센 것)이 되던 것
  const counts = Object.fromEntries(Object.entries(inTab).map(([k, f]) => [k, all.filter((x) => f(x) && hit(x)).length]));
  // #788: 소상공인 칩은 우리 회사에 해당 없어도 보임(해당 없음 이유와 함께 — 대표가 소상공인 지원도 '확인') — 맞춤 탭은 '해당 없음'까지 담아 두고 칩·보기에 따라 거름
  const pool = all.filter((x) => (tab === 'fit' ? fitBase(x) : inTab[tab](x)) && hit(x));
  const noOk = (x: SupportItem, aud: string) => tab !== 'fit' || !!q.showNo || aud === 'small' || !isNo(x);
  let items = pool.filter((x) => noOk(x, view.aud));
  // #781 칩 숫자: D-day 칩은 고른 종류 안에서, 종류 칩은 고른 D-day 안에서 셈(신청·결과 탭은 칩 없음)
  const ddOk = (x: SupportItem, k: string) => k === 'all' || (k === 'open' ? x.dday == null : x.dday != null && x.dday >= 0 && x.dday <= Number(k.slice(1)));
  const kindOk = (x: SupportItem, k: string) => k === 'all' || x.kinds.includes(k as Kind);
  const audOk = (x: SupportItem, k: string) => k === 'all' || x.aud.includes(k);
  const chips = tab === 'results' ? null : { dd: Object.fromEntries(DDS.map((k) => [k, items.filter((x) => ddOk(x, k) && kindOk(x, view.kind) && audOk(x, view.aud)).length])),
    kind: Object.fromEntries(KIND_KEYS.map((k) => [k, items.filter((x) => kindOk(x, k) && ddOk(x, view.dd) && audOk(x, view.aud)).length])),
    aud: Object.fromEntries(AUD_KEYS.map((k) => [k, pool.filter((x) => noOk(x, k) && audOk(x, k) && ddOk(x, view.dd) && kindOk(x, view.kind)).length])) };
  if (chips) items = items.filter((x) => ddOk(x, view.dd) && kindOk(x, view.kind) && audOk(x, view.aud));
  const end = (x: SupportItem) => x.applyEnd ?? '9999-12-31';
  const sortUsed = tab === 'results' ? 'results' : view.sort ?? TAB_SORT[tab];
  const byFit = (a: SupportItem, b: SupportItem) => rankOf(a) - rankOf(b) || b.rule.score - a.rule.score || end(a).localeCompare(end(b));
  if (sortUsed === 'fit') items.sort(byFit);
  else if (sortUsed === 'deadline') items.sort((a, b) => end(a).localeCompare(end(b)) || rankOf(a) - rankOf(b)); // 마감 임박 — 상시·예산 소진(마감일 없음)은 맨 뒤
  else if (sortUsed === 'amount') items.sort((a, b) => (b.amountKrw ?? -1) - (a.amountKrw ?? -1) || byFit(a, b));
  else if (sortUsed === 'results') items.sort((a, b) => String(wm.get(b.id)?.updated_at ?? '').localeCompare(String(wm.get(a.id)?.updated_at ?? '')));
  else items.sort((a, b) => String(b.seen).localeCompare(String(a.seen)));
  const total = items.length; items = items.slice(0, Math.min(200, q.limit ?? 60));
  // #782 '규칙상 맞음 · AI 판단 전' 수(맞춤 탭 기준, 찾기·칩과 무관) · #784 프로필 빈칸 — 빈 칸 때문에 '확인 필요'로 남은 공고 수
  const fitOpenAll = all.filter((x) => fitBase(x) && !isNo(x));
  const pendingCount = fitOpenAll.filter((x) => x.pending).length;
  const blankOf = (k: string) => (k === 'profile' ? !pr : k === 'region_sido' ? !profile.region_sido : k === 'region_sigungu' ? !profile.region_sigungu : k === 'founded' ? !profile.founded
    : k === 'employees' ? profile.employees == null : k === 'size' ? !profile.size : k === 'industries' ? !profile.industries.length : k === 'certs' ? !profile.certs.length && !profile.certs_none : false);
  const needs = new Map<string, number>(); let needItems = 0;
  for (const x of fitOpenAll) { const ks = [...new Set(x.rule.flags.map((f) => f.need).filter((k): k is string => !!k && blankOf(k)))]; if (ks.length) needItems++; for (const k of ks) needs.set(k, (needs.get(k) ?? 0) + 1); }
  const blanks = { fields: [...needs.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: NEED_LABEL[k] ?? k, items: n })), items: needItems };
  const hiddenNo = tab === 'fit' && !q.showNo ? all.filter((x) => open(x) && !x.hidden && !x.work && isNo(x) && hit(x)).length : 0;
  const sources = await sql<{ slug: string; last_run_at: string | null; last_status: string | null; summary: string | null }[]>`select s.slug, s.last_run_at, s.last_status, r.summary from sales_collector_state s
    left join lateral (select summary from sales_collector_runs x where x.slug = s.slug order by started_at desc limit 1) r on true where s.slug = any(${Object.values(SOURCE_SLUG)})`;
  const aiOn = aiEnabled();
  // #787(대표 "K-Startup 에서만 발췌하는지?"): 출처별 열린 공고 수 + 마지막 수집 — 화면 위 한 줄
  const per = new Map<string, number>(); for (const x of all) if (open(x) && !x.hidden) per.set(x.source, (per.get(x.source) ?? 0) + 1);
  const bySource = { counts: Object.keys(SOURCE_LABEL).map((k) => ({ source: k, label: SOURCE_LABEL[k], n: per.get(k) ?? 0 })), lastAt: sources.map((s) => s.last_run_at).filter(Boolean).sort().pop() ?? null };
  return { tab, today, items, total, counts, hiddenNo, view, sortUsed, chips, kindLabel: KIND_LABEL, audLabel: AUD_LABEL, pendingCount, blanks, aiCostKrw: aiOn ? await aiCostKrw(sql, t) : null, bySource,
    auto: { on: autoOn, enabled: autoAi, saved, queue: autoQueue, stopped: autoOn ? autoState?.stopped ?? null : null, left: autoState?.left ?? 0, at: autoState?.at ?? null, done: autoState?.done ?? 0 },
    weeklyAiMax: Math.max(0, Number(process.env.SUPPORT_WEEKLY_AI_MAX ?? 5) || 0), profile: { saved, filled: !!pr, autoAi, region: profile.region_sido, sigungu: profile.region_sigungu, size: profile.size, founded: profile.founded, interests: profile.interests, brands: profile.brands },
    sources: sources.map((s) => ({ ...s, label: SOURCE_LABEL[Object.entries(SOURCE_SLUG).find(([, v]) => v === s.slug)?.[0] ?? ''] ?? s.slug })), off,
    canEdit: isAdmin(u), platformAdmin: !!u.platformAdmin, aiOn, people: await peopleOf(sql, t), statusLabel: STATUS_LABEL,
    keys: await supportKeyStatus().then((k) => ({ bizinfo: k.bizinfo.present, datago: k.datago.present })).catch(() => ({ bizinfo: false, datago: false })),
    weekly: await latestWeekly(sql, t) };
}
const isOpen = (x: SupportItem, today: string) => x.applyEnd == null || x.applyEnd >= today;
const fitBaseAt = (x: SupportItem, today: string) => isOpen(x, today) && !x.hidden && (!x.work || OPEN_WORK.includes(x.work.status));
/** #785 자동 판단 차례 — 열린 공고·숨김 아님·깨진 제목 아님·1차 규칙 '해당 없음' 아님 · AI 판단이 없거나 '예전 프로필 기준' · 자동 판단 3번 실패한 건 뺌 */
const autoCandidate = (x: SupportItem, today: string) => fitBaseAt(x, today) && !x.garbled && x.autoFail < 3 && (x.rule.verdict !== 'no'
  ? !x.ai || !!x.ai.stale || (!x.ai.effect && x.ai.verdict !== 'no') || x.ai.ruleAt === 'no' // #783 기대 효과 없는 예전 판단도 한 번 · 규칙이 '해당 없음'이던 때 판단한 것
  : !!x.ai && x.ai.verdict !== 'no' && x.ai.ruleAt !== 'no'); // 규칙은 '해당 없음'인데 AI 가 해당·확인 필요 — 규칙 판단을 함께 주고 한 번 다시
const AUTO_FP = '251'; // 자동 판단 차례 규칙이 바뀌면 올림 — 배포 뒤 첫 실행이 '그대로' 건너뛰지 않게
/** 회사 하나의 공고 전부(열린 것 + 진행 중) — 1차 규칙·AI 판단·진행을 붙이고 같은 공고는 하나로 */
async function supportAll(sql: Sql, t: string, uid: string, today: string) {
  const [{ profile, saved, autoAi, basisAt, autoState }, off, matches, works] = await Promise.all([profileOf(t, sql), disabledSources(sql, t),
    sql<Match[]>`select program_id, ai_verdict, ai_reasons, ai_brands, ai_docs, ai_summary, ai_amount, ai_at, hidden, ai_use, ai_schedule, ai_auto, auto_fail, ai_effect, listed_at, ai_rule_verdict from support_matches where tenant = ${t}`,
    sql<Work[]>`select w.id, w.program_id, w.status, w.owner_id, ou.name as owner_name, w.task_id, w.brands, w.applied_at::text, w.result_at::text, w.amount_awarded, w.result_memo, w.memo, w.updated_at from support_work w left join users ou on ou.id = w.owner_id where w.tenant = ${t}`]);
  const mm = new Map(matches.map((m) => [m.program_id, m])); const wm = new Map(works.map((w) => [w.program_id, w]));
  const workIds = works.map((w) => w.program_id);
  // 열린 공고(마감 전·마감 미정) + 우리 회사 진행 중인 것(마감 지나도)
  const rows = await sql<Prog[]>`select ${COLS(sql)} from support_programs p
    where (p.tenant is null or p.tenant = ${t}) and not (p.source = any(${off}))
      and ((p.apply_end is null or p.apply_end >= ${today}::date) and (p.tenant is not null or p.last_seen_at > now() - interval '45 days') or p.id = any(${workIds}::uuid[]))
    order by p.first_seen_at desc limit 5000`;
  const pr = saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null;
  // #787: 기관 공지 중 지원사업이 아닌 글(용역·설문·결과 발표 — 거르기 규칙을 넓히기 전에 들어온 것)은 진행 중이 아니면 빼고 봄
  const keep = rows.filter((p) => p.source !== 'watch' || !NOT_SUPPORT_RE.test(p.title) || wm.has(p.id));
  const all = dedupe(keep.map((p) => itemOf(p, ruleMatch(p, pr, today), mm.get(p.id), wm.get(p.id), today, uid, basisAt)));
  return { all, profile, saved, pr, off, wm, autoAi, basisAt, autoState };
}
async function programFor(sql: Sql, t: string, id: string, summaryLen = 20000): Promise<Prog> {
  if (!UUID.test(id)) throw notFound();
  const [p] = await sql<Prog[]>`select ${COLS(sql, summaryLen)} from support_programs p where p.id = ${id} and (p.tenant is null or p.tenant = ${t})`;
  if (!p) throw notFound('공고를 찾을 수 없습니다');
  return p;
}
export async function detailView(u: SessionUser, id: string) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  const p = await programFor(sql, t, id);
  const { profile, saved, basisAt } = await profileOf(t, sql);
  const [m] = await sql<Match[]>`select program_id, ai_verdict, ai_reasons, ai_brands, ai_docs, ai_summary, ai_amount, ai_at, hidden, ai_use, ai_schedule, ai_auto, auto_fail, ai_effect, listed_at, ai_rule_verdict from support_matches where tenant = ${t} and program_id = ${id}`;
  const [w] = await sql<Work[]>`select w.id, w.program_id, w.status, w.owner_id, ou.name as owner_name, w.task_id, w.brands, w.applied_at::text, w.result_at::text, w.amount_awarded, w.result_memo, w.memo, w.updated_at from support_work w left join users ou on ou.id = w.owner_id where w.tenant = ${t} and w.program_id = ${id}`;
  const log = w ? await sql`select l.from_status, l.to_status, l.note, l.changed_at, us.name as by from support_work_log l left join users us on us.id = l.changed_by where l.work_id = ${w.id} order by l.changed_at desc limit 30` : [];
  const [task] = w?.task_id ? await sql<{ id: string; title: string; status: string; due_date: string | null; total: number; done: number }[]>`select t.id, t.title, t.status, t.due_date::text,
    (select count(*)::int from task_checklist_items ci where ci.task_id = t.id) total, (select count(*)::int from task_checklist_items ci where ci.task_id = t.id and ci.done) done from tasks t where t.id = ${w.task_id} and t.deleted_at is null` : [];
  const pr = saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null;
  return { item: itemOf(p, ruleMatch(p, pr, today), m, w, today, u.id, basisAt), summary: p.summary, target: p.target, hashtags: p.hashtags ?? [], attachments: p.attachments ?? [], applyText: p.apply_text, bizYears: p.biz_years,
    log, task: task ?? null, canEdit: isAdmin(u), canEditProgram: !!p.tenant && (p.created_by === u.id || isAdmin(u)), aiOn: aiEnabled(), people: await peopleOf(sql, t), statusLabel: STATUS_LABEL };
}

// ---------------- AI 판단 ----------------
const SCHEMA = { type: 'object', additionalProperties: false, required: ['verdict', 'reasons', 'brands', 'docs', 'summary', 'amount', 'use', 'schedule', 'effect'], properties: {
  verdict: { type: 'string', enum: ['fit', 'maybe', 'no'] }, reasons: { type: 'array', items: { type: 'string' } }, brands: { type: 'array', items: { type: 'string' } },
  docs: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }, amount: { type: ['string', 'null'] },
  use: { type: 'array', items: { type: 'string' } }, schedule: { type: ['string', 'null'] },
  effect: { type: 'object', additionalProperties: false, required: ['receive', 'amount', 'selfPay', 'prepHours', 'perBusiness', 'confirm'], properties: { // #783 기대 효과
    receive: { type: 'string' }, amount: { type: ['string', 'null'] }, selfPay: { type: ['string', 'null'] }, prepHours: { type: ['number', 'null'] },
    perBusiness: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['brand', 'line'], properties: { brand: { type: 'string' }, line: { type: 'string' } } } },
    confirm: { type: 'array', items: { type: 'string' } } } } } };
/** #783 기대 효과 — 받는 것·우리 기준 예상 금액·자부담·준비 시간(시간)·브랜드·사업부마다 한 줄·신청 전에 확인할 회사 정보 */
export type Effect = { receive: string; amount: string | null; selfPay: string | null; prepHours: number | null; perBusiness: { brand: string; line: string }[]; confirm: string[] };
function effectOf(v: unknown, brands: string[]): Effect | null {
  if (!v || typeof v !== 'object') return null;
  const e = v as Record<string, unknown>; const str = (x: unknown, n: number) => (x == null || x === '' ? null : String(x).trim().slice(0, n) || null);
  const hours = Number(e.prepHours); const list = (x: unknown) => (Array.isArray(x) ? x : []);
  const out: Effect = { receive: str(e.receive, 200) ?? '', amount: str(e.amount, 120), selfPay: str(e.selfPay, 120), prepHours: Number.isFinite(hours) && hours > 0 ? Math.min(400, Math.round(hours * 2) / 2) : null,
    perBusiness: list(e.perBusiness).map((b) => ({ brand: String((b as any)?.brand ?? '').trim(), line: String((b as any)?.line ?? '').trim().slice(0, 200) })).filter((b) => b.line && brands.includes(b.brand)).slice(0, 6),
    confirm: list(e.confirm).map((x) => String(x ?? '').trim().slice(0, 120)).filter(Boolean).slice(0, 6) };
  return out.receive || out.amount || out.perBusiness.length || out.confirm.length ? out : null;
}
const profileText = (pr: Profile, today: string) => [
  `본점: ${[pr.region_sido, pr.region_sigungu].filter(Boolean).join(' ') || '(모름)'}`, `설립일: ${pr.founded ? `${pr.founded} (업력 ${yearsSince(pr.founded, today)}년)` : '(모름)'}`,
  `규모: ${pr.size ?? '(모름)'}${pr.employees != null ? ` · 상시 근로자 ${pr.employees}명` : ''}${pr.revenue_krw != null ? ` · 연 매출 약 ${Math.round(pr.revenue_krw / 1e8 * 10) / 10}억 원` : ''}`,
  `업종: ${pr.industries.join(', ') || '(모름)'}`, `키워드: ${pr.keywords.join(', ') || '-'}`, `보유 인증: ${pr.certs.join(', ') || (pr.certs_none ? '없음' : '없음(또는 모름)')}`,
  `브랜드·사업부: ${pr.brands.join(', ') || '-'}`, `관심 분야: ${pr.interests.join(', ') || '-'}`, pr.memo ? `회사 소개: ${pr.memo.slice(0, 600)}` : ''].filter(Boolean).join('\n');
const programText = (p: Prog) => [`공고명: ${p.title}`, `원천: ${SOURCE_LABEL[p.source] ?? p.source}`, p.agency && `소관 기관: ${p.agency}`, p.executor && `수행 기관: ${p.executor}`, p.category && `지원 분야: ${p.category}`,
  p.target && `지원 대상: ${p.target}`, p.biz_years && `업력 조건: ${p.biz_years}`, `지역: ${p.regions?.length ? p.regions.join(', ') : '전국 또는 표시 없음'}`,
  `신청 기간: ${p.apply_text ?? ([p.apply_start, p.apply_end].filter(Boolean).join(' ~ ') || '표시 없음')}`, p.amount && `지원 규모(공고 문구): ${p.amount}`, (p.hashtags ?? []).length && `해시태그: ${p.hashtags.join(', ')}`,
  `공고 내용:\n${(p.summary ?? '(본문 없음 — 제목·기관만 있음)').slice(0, 9000)}`].filter(Boolean).join('\n');
/** 공고 1건 AI 판단 — 회사 AI 한도(AI 세일즈)·사람별 한도. 결과는 회사별로 저장(다시 누르면 새로 판단) */
export async function analyzeProgram(u: SessionUser, id: string, provider: AiProvider = anthropicProvider({ tier: 'fast' }), opt: { auto?: boolean } = {}) {
  await assertSpace(u, 'sales');
  if (!aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다 — 플랫폼 운영자에게 요청해 주세요');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  let p = await programFor(sql, t, id);
  await (await import('../plans')).assertAiRequest(u, { legacy: true }); // 회사 월 AI 예산(원)·예전 달러 한도·요청 수
  await (await import('../ai/guard')).assertUserBudget(u, sql);
  await (await import('../ai/guard')).assertAiCredit(sql);
  if (p.source === 'watch' && !p.summary && p.url) { // 기관 공지: 본문을 한 번 읽어 둔다(같은 호스트만)
    const body = await watchDetailText(p.url).catch(() => null);
    if (body) { await sql`update support_programs set summary = ${body}, updated_at = now() where id = ${p.id}`; p = { ...p, summary: body }; }
  }
  const { profile, saved } = await profileOf(t, sql);
  const rule = ruleMatch(p, saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null, today);
  const brands = clean([...profile.brands, ...(await sql<{ name: string }[]>`select name from sales_business_categories where tenant = ${t} and active`).map((x) => x.name)]);
  const system = `워크인 AI 세일즈의 지원사업 검토 도우미입니다. 정부·지자체 지원사업 공고 1건과 신청을 검토하는 회사 프로필을 받습니다.
공고에 적힌 내용과 회사 프로필만 근거로 판단하고, 공고에 없는 조건·금액·서류는 지어내지 마세요. 모르는 것은 '공고문 확인 필요'라고 쓰세요. 한국어로.
[1차 규칙]은 낱말로 자동 판단한 참고입니다. 규칙이 '해당 없음'이라 한 조건(지역·대상·업종·업력 등)은 공고문에서 꼭 확인해, 맞으면 no, 규칙이 틀렸으면 그 근거를 reasons 첫 줄에 쓰세요.
JSON 으로만 답하세요:
- verdict: fit(자격이 맞고 회사 사업과 맞음) · maybe(조건 일부를 확인해야 함) · no(지역·업력·규모·대상 등 자격이 안 됨)
- reasons: 판단 근거 2~5줄. 한 줄마다 공고 조건과 회사 정보를 맞대어(예: "○○시 소재 중소기업 대상 — 본점 ○○시라 해당").
  공고에 있으면 꼭 대조할 자격: 본점 시·군 · 업력(창업기업 = 7년 이내) · 상시근로자 수 · 기업부설연구소/연구개발전담부서 · 벤처/이노비즈 인증 · SW사업자 신고 · 기출원 건 지원 불가(지식재산 — 선정·협약 전 출원 금지) · 중복 수혜 제한
- brands: 이 공고에 맞는 브랜드·사업부(아래 목록에서만 고름, 없으면 빈 배열): ${brands.join(', ') || '(없음)'}
- docs: 공고에 적힌 신청·제출 서류(최대 12개, 짧게). 공고에 서류 목록이 없으면 빈 배열
- summary: 공고 요약 2~3문장(무엇을, 누구에게, 얼마나)
- amount: 지원 규모 한 줄(공고 문구 그대로 요약), 없으면 null
- use: 우리 회사에 접목할 점 2~4줄 — 이 지원을 회사의 어떤 사업·브랜드에 어떻게 쓸 수 있는지(예: 온라인 광고비·특허 출원 비용·채용 인건비·설비·컨설팅), 공고 내용과 회사 프로필(업종·키워드·브랜드·관심 분야·회사 소개)에 근거해 구체적으로. 쓸 데가 없거나 자격이 안 되면 빈 배열
- schedule: 마감·일정 한 줄(신청 마감·발표·협약·사업 기간 — 공고에 적힌 날짜만), 없으면 null
- effect: 우리 회사가 볼 수 있는 효과(공고에 적힌 지원 내용과 회사 프로필로만, 자격이 안 되면 receive 에 '자격 안 됨'만 쓰고 나머지는 비움)
  - receive: 받는 것 한 줄(현금 지원·바우처·융자·무료 컨설팅·교육·공간·투자 연계·홍보 등 — 공고에 적힌 것)
  - amount: 우리 회사 기준 예상 금액 한 줄(공고의 한도·비율로, 근거를 짧게 — 예 "최대 720만 원(청년 1명 기준)"), 모르면 null
  - selfPay: 자부담 한 줄(비율·금액), 공고에 없으면 "공고문 확인"
  - prepHours: 신청 준비에 드는 시간(숫자, 시간 단위 — 서류 수·사업계획서·발표 여부로 어림), 모르면 null
  - perBusiness: 브랜드·사업부마다 효과 한 줄 [{brand, line}] (위 브랜드 목록에서만, 해당 없는 브랜드는 빼고)
  - confirm: 신청 전에 확인할 우리 회사 정보(최대 6개 — 프로필에 없거나 공고 조건과 맞는지 모르는 것, 예 "고용보험 피보험자 수 5명 이상인지")
오늘: ${today} (Asia/Seoul).`;
  const RV: Record<string, string> = { fit: '해당', maybe: '확인 필요', no: '해당 없음' };
  const ruleLines = rule.flags.filter((f) => f.level !== 'ok').map((f) => `- ${f.level === 'no' ? '해당 없음' : '확인'}: ${f.text}`).slice(0, 8);
  const ask = `[회사 프로필]\n${profileText(profile, today)}\n\n[1차 규칙] ${RV[rule.verdict]}${ruleLines.length ? `\n${ruleLines.join('\n')}` : ''}\n\n[공고]\n${programText(p)}`;
  let r;
  try { r = await provider.chat({ system, tools: [], format: SCHEMA, messages: [{ role: 'user', content: [{ type: 'text', text: ask }] }] }); }
  catch (e) { throw await (await import('../ai/guard')).onAiError(e, sql); }
  const usd = costUsd(r.model ?? provider.model, r.usage);
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${t}, ${u.id}, ${randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0}, ${r.usage.cache_creation_input_tokens ?? 0}, ${usd}, 'sales_support')`;
  if (r.stop_reason === 'refusal') throw badRequest('이 공고는 판단할 수 없습니다');
  const text = r.content.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  let j: any; try { j = JSON.parse(text); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.'); }
  const lines = (v: unknown, n: number, len: number) => (Array.isArray(v) ? v : []).map((x) => String(x ?? '').trim().slice(0, len)).filter(Boolean).slice(0, n);
  const verdict = ['fit', 'maybe', 'no'].includes(j.verdict) ? j.verdict : 'maybe';
  const out = { verdict, reasons: lines(j.reasons, 5, 300), brands: lines(j.brands, 6, 40).filter((b) => brands.includes(b)), docs: lines(j.docs, 12, 120), summary: String(j.summary ?? '').slice(0, 800) || null,
    amount: j.amount ? String(j.amount).slice(0, 120) : null, use: lines(j.use, 4, 300), schedule: j.schedule ? String(j.schedule).slice(0, 200) : null, auto: !!opt.auto, effect: effectOf(j.effect, brands) };
  await sql`insert into support_matches (tenant, program_id, ai_verdict, ai_reasons, ai_brands, ai_docs, ai_summary, ai_amount, ai_model, ai_cost_usd, ai_by, ai_at, ai_use, ai_schedule, ai_auto, ai_effect, ai_rule_verdict)
    values (${t}, ${p.id}, ${out.verdict}, ${sql.json(out.reasons)}, ${out.brands}, ${sql.json(out.docs)}, ${out.summary}, ${out.amount}, ${r.model ?? provider.model}, ${usd}, ${u.id}, now(), ${sql.json(out.use)}, ${out.schedule}, ${out.auto}, ${out.effect ? sql.json(out.effect as never) : null}, ${rule.verdict})
    on conflict (tenant, program_id) do update set ai_verdict = excluded.ai_verdict, ai_reasons = excluded.ai_reasons, ai_brands = excluded.ai_brands, ai_docs = excluded.ai_docs, ai_summary = excluded.ai_summary,
      ai_amount = excluded.ai_amount, ai_model = excluded.ai_model, ai_cost_usd = excluded.ai_cost_usd, ai_by = excluded.ai_by, ai_at = now(), ai_use = excluded.ai_use, ai_schedule = excluded.ai_schedule, ai_auto = excluded.ai_auto,
      ai_effect = excluded.ai_effect, ai_rule_verdict = excluded.ai_rule_verdict, auto_fail = 0, updated_at = now()`;
  await (await import('../ai/guard')).userBudgetAlerts(u, sql).catch(() => {});
  const { usdKrw } = await import('../ai/provider');
  return { ok: true, ai: { ...out, at: new Date().toISOString() }, costKrw: Math.max(1, Math.round(usd * usdKrw())) };
}
/** #782 '규칙상 맞음 · AI 판단 전' 공고를 맞춤 순 위에서 N건(5·10·20) AI 판단 — 관리자가 [몇 건 판단]을 눌렀을 때만(자동 판단은 꺼 둠). 5건씩, 한도에 걸리면 멈춤 */
export async function analyzeTop(u: SessionUser, n = 5) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('여러 건 판단은 관리자만');
  const v = await listView(u, { tab: 'fit', limit: 200, sort: 'fit', dd: 'all', kind: 'all' });
  const todo = v.items.filter((x) => x.pending).slice(0, Math.max(1, Math.min(20, Math.floor(n) || 5)));
  let done = 0, costKrw = 0; const errors: string[] = [];
  for (let i = 0; i < todo.length; i += 5) {
    const rs = await Promise.allSettled(todo.slice(i, i + 5).map((x) => analyzeProgram(u, x.id)));
    for (const r of rs) if (r.status === 'fulfilled') { done++; costKrw += r.value.costKrw; } else errors.push(String((r.reason as Error)?.message ?? r.reason));
    if (rs.some((r) => r.status === 'rejected' && ([402, 429].includes((r.reason as HttpError)?.status) || (r.reason as HttpError)?.code === 'ai_off'))) break; // 한도·크레딧 — 더 안 돌림
  }
  return { asked: todo.length, done, failed: errors.length, costKrw, error: errors[0] ?? null };
}

// ---------------- 진행(관심 → 신청 준비 → 신청 → 선정/탈락) ----------------
export const workInput = z.object({
  status: z.enum(['interest', 'preparing', 'applied', 'selected', 'rejected', 'dropped']).optional(),
  ownerId: z.string().uuid().nullable().optional(), brands: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), resultAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  amountAwarded: z.string().trim().max(100).nullable().optional(), resultMemo: z.string().trim().max(2000).nullable().optional(), memo: z.string().trim().max(2000).nullable().optional(),
});
const STEPS_INTEREST = ['공고문·자격 요건 확인', '신청 여부 결정(신청 준비로 바꾸기)'];
const STEPS_PREPARE = ['공고문·신청 양식 내려받기', '신청서 작성', '온라인 제출·접수 확인'];
/** 담당 업무 — 없으면 만들고(체크리스트), 신청 준비로 바뀌면 제목·마감·서류 체크리스트를 채운다 */
async function ensureTask(sql: Sql, u: SessionUser, p: Prog, w: { id: string; status: string; owner_id: string | null; task_id: string | null }, docs: string[]) {
  const today = ymd(); const prep = w.status === 'preparing';
  const due = p.apply_end ? (prep ? p.apply_end : (() => { const d = addDays(p.apply_end!, -7); return d < today ? (p.apply_end! < today ? today : p.apply_end!) : d; })()) : null;
  const title = `[지원사업] ${p.title.slice(0, 100)} — ${prep ? '신청 준비' : '검토'}`;
  const steps = prep ? [...docs.map((d) => `서류: ${d}`), ...(docs.length ? [] : ['준비 서류 목록 정리(공고문 기준)']), ...STEPS_PREPARE] : STEPS_INTEREST;
  if (w.task_id) {
    const [cur] = await sql<{ id: string; status: string }[]>`select id, status from tasks where id = ${w.task_id} and deleted_at is null`;
    if (cur) {
      if (prep) {
        const have = new Set((await sql<{ text: string }[]>`select text from task_checklist_items where task_id = ${cur.id}`).map((x) => x.text));
        const [{ n }] = await sql<{ n: number }[]>`select coalesce(max(sort), 0)::int n from task_checklist_items where task_id = ${cur.id}`;
        let k = n + 1; for (const s of steps) if (!have.has(s)) await sql`insert into task_checklist_items (task_id, text, sort) values (${cur.id}, ${s}, ${k++})`;
        await sql`update tasks set title = ${title}, due_date = coalesce(${due}::date, due_date), status = case when status = 'done' then 'todo' else status end, updated_at = now(), version = version + 1 where id = ${cur.id}`;
      }
      return cur.id;
    }
  }
  const { createTask } = await import('../tasks');
  const owner = w.owner_id ?? u.id;
  const desc = [`지원사업 공고에서 만든 업무입니다 — /s/sales/support?id=${p.id}`, p.agency && `기관: ${[p.agency, p.executor].filter(Boolean).join(' · ')}`, `신청 기간: ${p.apply_text ?? ([p.apply_start, p.apply_end].filter(Boolean).join(' ~ ') || '공고문 확인')}`,
    p.amount && `지원 규모: ${p.amount}`, p.url && `공고: ${p.url}`, '마감 7일·3일 전에 알림이 갑니다. 신청하면 지원사업 화면에서 [신청 완료]로 바꾸세요.'].filter(Boolean).join('\n');
  const r = await createTask(u, { title, description: desc, space: 'sales', assigneeId: owner, requestedById: u.id, dueDate: due, approvalRequired: false, tags: ['영업', '지원사업'], checklist: steps } as never, { quiet: owner === u.id, skipQuota: true });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'support', id: p.id, name: p.title.slice(0, 120) })} where id = ${r.id}`;
  if ((p.attachments ?? []).length) (await import('./autoAttach')).attachSourceFilesLater(u, { kind: 'support', id: p.id, taskIds: [r.id] }); // #507 공고 첨부 자동
  return r.id;
}
export async function saveWork(u: SessionUser, id: string, i: z.infer<typeof workInput>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const today = ymd();
  const p = await programFor(sql, t, id);
  if (i.ownerId && !(await peopleOf(sql, t)).some((x) => x.id === i.ownerId)) throw badRequest('영업 공간을 쓰는 사람만 담당으로 고를 수 있습니다');
  const [prev] = await sql<{ id: string; status: string; owner_id: string | null; task_id: string | null }[]>`select id, status, owner_id, task_id from support_work where tenant = ${t} and program_id = ${p.id}`;
  if (!prev && !i.status) throw badRequest('먼저 관심·신청 준비 중 하나를 고르세요');
  const status = i.status ?? prev!.status;
  const owner = i.ownerId !== undefined ? i.ownerId : prev?.owner_id ?? u.id;
  const v = { status, owner_id: owner, ...(i.brands ? { brands: clean(i.brands) } : {}), ...(i.memo !== undefined ? { memo: i.memo } : {}), ...(i.amountAwarded !== undefined ? { amount_awarded: i.amountAwarded } : {}),
    ...(i.resultMemo !== undefined ? { result_memo: i.resultMemo } : {}),
    applied_at: i.appliedAt !== undefined ? i.appliedAt : status === 'applied' && prev?.status !== 'applied' ? today : undefined,
    result_at: i.resultAt !== undefined ? i.resultAt : ['selected', 'rejected'].includes(status) && prev?.status !== status ? today : undefined };
  const set = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
  let w: { id: string; status: string; owner_id: string | null; task_id: string | null };
  if (prev) [w] = await sql<typeof w[]>`update support_work set ${sql(set as never)}, updated_by = ${u.id}, updated_at = now() where id = ${prev.id} returning id, status, owner_id, task_id`;
  else [w] = await sql<typeof w[]>`insert into support_work ${sql({ tenant: t, program_id: p.id, created_by: u.id, updated_by: u.id, ...set } as never)} returning id, status, owner_id, task_id`;
  if (!prev || prev.status !== status) await sql`insert into support_work_log (work_id, from_status, to_status, note, changed_by) values (${w.id}, ${prev?.status ?? null}, ${status}, ${i.resultMemo ?? i.memo ?? null}, ${u.id})`;
  // 업무: 관심·준비 = 만들기/채우기, 신청·결과·포기 = 열린 업무 완료
  let taskId = w.task_id;
  if (OPEN_WORK.includes(status) && (!prev || prev.status !== status || !w.task_id)) {
    const [m] = await sql<{ ai_docs: string[] }[]>`select ai_docs from support_matches where tenant = ${t} and program_id = ${p.id}`;
    taskId = await ensureTask(sql, u, p, w, Array.isArray(m?.ai_docs) ? m.ai_docs : []);
    if (taskId !== w.task_id) await sql`update support_work set task_id = ${taskId} where id = ${w.id}`;
  } else if (!OPEN_WORK.includes(status) && w.task_id) await sql`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = ${w.task_id} and status <> 'done' and deleted_at is null`;
  if (taskId && prev && owner && owner !== prev.owner_id && OPEN_WORK.includes(status)) { // 담당이 바뀌면 열린 업무도 넘김
    await sql`update tasks set assignee_id = ${owner}, updated_at = now(), version = version + 1 where id = ${taskId} and status <> 'done' and deleted_at is null`;
    await notify(sql, { userIds: [owner], type: 'assigned', space: 'sales', title: `지원사업 담당: ${p.title.slice(0, 60)}`, body: `${u.name}님이 담당으로 지정했습니다${p.apply_end ? ` — 마감 ${p.apply_end}` : ''}`, link: `/s/sales/support?id=${p.id}`, actorId: u.id, dedupeKey: `support:owner:${w.id}:${owner}` } as never).catch(() => {});
  }
  await audit(sql, u.id, 'support.work', 'support_program', p.id, { from: prev?.status ?? null, to: status }).catch(() => {});
  return detailView(u, p.id);
}
/** #784 이번 주 신청 목록에 담기·빼기(영업 공간 누구나 — 담은 사람·때 기록) */
export async function setListed(u: SessionUser, id: string, on: boolean) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  await sql`insert into support_matches (tenant, program_id, listed_at, listed_by) values (${t}, ${p.id}, ${on ? new Date() : null}, ${on ? u.id : null})
    on conflict (tenant, program_id) do update set listed_at = case when ${on} then coalesce(support_matches.listed_at, now()) else null end, listed_by = case when ${on} then coalesce(support_matches.listed_by, ${u.id}::uuid) else null end, updated_at = now()`;
  await audit(sql, u.id, on ? 'support.list_add' : 'support.list_remove', 'support_program', p.id, { title: p.title.slice(0, 80) }).catch(() => {});
  return { ok: true, listed: on };
}
/** #784 신청 목록 엑셀(CSV, 엑셀에서 바로 열림) — 마감 순, 셀 앞 수식 문자는 막음 */
export async function listCsv(u: SessionUser) {
  const v = await listView(u, { tab: 'list', limit: 200, sort: 'deadline', dd: 'all', kind: 'all' });
  const cell = (x: unknown) => { let s = String(x ?? '').replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(s)) s = `'${s}`; return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const V: Record<string, string> = { fit: '해당', maybe: '확인 필요', no: '해당 없음' };
  const head = ['공고명', '기관', '마감', 'D-day', '판단', '받는 것', '예상 금액', '자부담', '준비 시간(시간)', '사업별 효과', '신청 전 확인', '담당', '진행', '담은 날', '공고 원문'];
  const rows = v.items.map((x) => [x.title, [x.agency, x.executor && x.executor !== x.agency ? x.executor : null].filter(Boolean).join(' · '), x.applyEnd ?? x.applyText ?? '마감 미정', x.dday == null ? '' : x.dday === 0 ? 'D-day' : `D-${x.dday}`,
    x.ai ? `${V[x.ai.verdict]}(AI)` : `${V[x.rule.verdict] ?? ''}(1차 규칙)`, x.ai?.effect?.receive ?? '', x.ai?.effect?.amount ?? x.amount ?? '', x.ai?.effect?.selfPay ?? '', x.ai?.effect?.prepHours ?? '',
    (x.ai?.effect?.perBusiness ?? []).map((b) => `${b.brand}: ${b.line}`).join(' / '), (x.ai?.effect?.confirm ?? []).join(' / '), x.work?.ownerName ?? '', x.work?.statusLabel ?? '담음', x.listedAt ? ymd(new Date(x.listedAt)) : '', x.url ?? '']);
  return { name: `지원사업_신청목록_${v.today}.csv`, body: '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n', count: rows.length };
}
export async function setHidden(u: SessionUser, id: string, hidden: boolean) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  await sql`insert into support_matches (tenant, program_id, hidden) values (${t}, ${p.id}, ${hidden}) on conflict (tenant, program_id) do update set hidden = excluded.hidden, updated_at = now()`;
  return { ok: true, hidden };
}

// ---------------- 직접 입력(지난 신청 이력·목록에 없는 공고) ----------------
export const manualInput = z.object({
  title: z.string().trim().min(2, '공고명을 적어 주세요').max(300), agency: z.string().trim().max(100).nullable().optional(), url: z.string().trim().url().regex(/^https?:\/\//).nullable().optional().or(z.literal('')),
  applyStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), applyEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), amount: z.string().trim().max(100).nullable().optional(),
  summary: z.string().trim().max(5000).nullable().optional(), region: z.string().trim().max(10).nullable().optional(),
  status: z.enum(['interest', 'preparing', 'applied', 'selected', 'rejected', 'dropped']).optional(), appliedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  resultMemo: z.string().trim().max(2000).nullable().optional(), memo: z.string().trim().max(2000).nullable().optional(), brands: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});
export async function addManual(u: SessionUser, i: z.infer<typeof manualInput>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db();
  if (i.applyStart && i.applyEnd && i.applyStart > i.applyEnd) throw badRequest('신청 시작일이 마감일보다 늦습니다');
  const region = i.region && SIDO.includes(i.region) ? [i.region] : [];
  const [p] = await sql<{ id: string }[]>`insert into support_programs ${sql({ tenant: t, source: 'manual', source_id: randomUUID(), title: i.title, agency: i.agency || null, url: i.url || null, apply_start: i.applyStart ?? null, apply_end: i.applyEnd ?? null,
    apply_text: [i.applyStart, i.applyEnd].filter(Boolean).join(' ~ ') || null, amount: i.amount || null, summary: i.summary || null, regions: region, nationwide: !region.length, created_by: u.id } as never)} returning id`;
  await audit(sql, u.id, 'support.manual', 'support_program', p.id, { title: i.title.slice(0, 80), status: i.status ?? null }).catch(() => {});
  if (i.status) return saveWork(u, p.id, { status: i.status, appliedAt: i.appliedAt ?? undefined, resultMemo: i.resultMemo ?? undefined, memo: i.memo ?? undefined, brands: i.brands });
  return detailView(u, p.id);
}
export const manualPatch = manualInput.partial().omit({ status: true, appliedAt: true, resultMemo: true, memo: true, brands: true });
export async function editManual(u: SessionUser, id: string, i: z.infer<typeof manualPatch>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  if (!p.tenant || (p.created_by !== u.id && !isAdmin(u))) throw forbidden('직접 넣은 공고만, 넣은 사람·관리자가 고칠 수 있습니다');
  const v: Record<string, unknown> = {};
  if (i.title !== undefined) v.title = i.title; if (i.agency !== undefined) v.agency = i.agency || null; if (i.url !== undefined) v.url = i.url || null;
  if (i.applyStart !== undefined) v.apply_start = i.applyStart; if (i.applyEnd !== undefined) v.apply_end = i.applyEnd; if (i.amount !== undefined) v.amount = i.amount || null; if (i.summary !== undefined) v.summary = i.summary || null;
  if (i.region !== undefined) { const r = i.region && SIDO.includes(i.region) ? [i.region] : []; v.regions = r; v.nationwide = !r.length; }
  if (i.applyStart !== undefined || i.applyEnd !== undefined) { const s = i.applyStart !== undefined ? i.applyStart : p.apply_start; const e = i.applyEnd !== undefined ? i.applyEnd : p.apply_end; v.apply_text = [s, e].filter(Boolean).join(' ~ ') || null; }
  if (Object.keys(v).length) await sql`update support_programs set ${sql(v as never)}, updated_at = now() where id = ${p.id}`;
  return detailView(u, p.id);
}
export async function deleteManual(u: SessionUser, id: string) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db(); const p = await programFor(sql, t, id, 0);
  if (!p.tenant || (p.created_by !== u.id && !isAdmin(u))) throw forbidden('직접 넣은 공고만, 넣은 사람·관리자가 지울 수 있습니다');
  const [w] = await sql<{ task_id: string | null }[]>`select task_id from support_work where tenant = ${t} and program_id = ${p.id}`;
  if (w?.task_id) await sql`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = ${w.task_id} and status <> 'done' and deleted_at is null`;
  await sql`delete from support_programs where id = ${p.id} and tenant = ${t}`;
  await audit(sql, u.id, 'support.manual_delete', 'support_program', p.id, { title: p.title.slice(0, 80) }).catch(() => {});
  return { ok: true };
}

// ---------------- 주 1회 '이번 주 맞는 지원사업' 묶음 (#568, 대표 10/24 저녁) ----------------
export type WeeklyItem = { id: string; title: string; by: 'ai' | 'rule'; dday: number | null; applyEnd: string | null; agency: string | null; brands: string[]; use: string | null; auto: boolean };
type WeeklyRow = { id: number; week: string; items: WeeklyItem[]; ai_count: number; ai_failed: number; sent_to: number; created_at: string };
/** 그 주 월요일(KST) — 묶음은 회사·주마다 하나 */
export const weekMonday = (day: string) => { const d = new Date(Date.parse(`${day}T12:00:00+09:00`)); return addDays(day, -((d.getUTCDay() + 6) % 7)); };
async function latestWeekly(sql: Sql, t: string) {
  const [w] = await sql<WeeklyRow[]>`select id, week::text, items, ai_count, ai_failed, sent_to, created_at from support_weekly where tenant = ${t} order by week desc limit 1`;
  return w ? { week: w.week, items: Array.isArray(w.items) ? w.items : [], aiCount: w.ai_count, aiFailed: w.ai_failed, sentTo: w.sent_to, createdAt: w.created_at } : null;
}
/** 회사 관리자(대표 → 관리자 순) 한 명을 세션 없이 실행 주체로 — 자동 판단의 AI 사용량이 이 사람 이름으로 남는다 */
export async function adminActor(sql: Sql, t: string): Promise<SessionUser | null> {
  const [a] = await sql<{ id: string }[]>`select id from users where tenant = ${t} and status = 'active' and role in ('owner', 'admin') order by (role = 'owner') desc, created_at limit 1`;
  if (!a) return null;
  return (await import('../mktStudio')).actorFor(a.id).catch(() => null);
}
/**
 * 회사 하나의 주간 묶음: 1차 조건 통과(✅)인데 AI 판단이 없는 공고를 최대 N건(SUPPORT_WEEKLY_AI_MAX, 기본 5 — #785 뒤로는 새 공고 자동 판단(supportAutoTick)이 주 경로, 여기는 남은 것 채우기) 자동 판단(회사 AI 한도·사람별 한도·크레딧 안, 한도에 걸리면 멈춤)
 * → 맞는 공고(AI ✅, 없으면 1차 ✅) 상위 10건을 기록하고 관리자·관심/준비 담당에게 알림 1건(주마다 한 번). 프로필이 비어 있으면 묶지 않는다.
 */
export async function weeklyBundle(t: string, opt: { now?: Date; actor?: SessionUser; aiMax?: number; force?: boolean } = {}) {
  const sql = db(); const today = ymd(opt.now ?? new Date()); const week = weekMonday(today);
  const [exists] = await sql<{ id: number }[]>`select id from support_weekly where tenant = ${t} and week = ${week}::date`;
  if (exists && !opt.force) return { skipped: 'done', week };
  const actor = opt.actor ?? (await adminActor(sql, t));
  if (!actor) return { skipped: 'no_admin', week };
  const { profile, saved } = await profileOf(t, sql);
  if (!(saved || profile.region_sido || profile.industries.length || profile.interests.length)) return { skipped: 'no_profile', week };
  const max = Math.max(0, opt.aiMax ?? (Number(process.env.SUPPORT_WEEKLY_AI_MAX ?? 5) || 0));
  let aiCount = 0, aiFailed = 0, aiError: string | null = null; const auto = new Set<string>();
  if (aiEnabled() && max > 0) {
    const v = await listView(actor, { tab: 'fit', limit: 200, sort: 'fit', dd: 'all', kind: 'all' });
    for (const x of v.items.filter((y) => !y.ai && y.rule.verdict === 'fit').slice(0, max)) {
      try { await analyzeProgram(actor, x.id, undefined, { auto: true }); aiCount++; auto.add(x.id); }
      catch (e) {
        aiFailed++; aiError ??= String((e as Error)?.message ?? e).slice(0, 160);
        if ([402, 429].includes((e as HttpError)?.status) || (e as HttpError)?.code === 'ai_off') break; // 한도·크레딧 — 더 안 돌림
      }
    }
  }
  const v2 = await listView(actor, { tab: 'fit', limit: 200, sort: 'fit', dd: 'all', kind: 'all' });
  const items: WeeklyItem[] = v2.items.filter((x) => x.ai?.verdict === 'fit' && !x.final.conflict).slice(0, 10) // #649 ③: 주간 묶음은 AI 가 '맞음'으로 판정한 공고만(1차 규칙만 맞는 건은 '확인 중')
    .map((x) => ({ id: x.id, title: x.title, by: x.ai ? 'ai' : 'rule', dday: x.dday, applyEnd: x.applyEnd, agency: x.agency, brands: x.ai?.brands ?? [], use: x.ai?.use[0] ?? null, auto: auto.has(x.id) }));
  const admins = await sql<{ id: string }[]>`select id from users where tenant = ${t} and status = 'active' and role in ('owner', 'admin')`;
  const owners = await sql<{ owner_id: string }[]>`select distinct owner_id from support_work where tenant = ${t} and status in ('interest', 'preparing') and owner_id is not null`;
  const to = [...new Set([...admins.map((a) => a.id), ...owners.map((o) => o.owner_id)])];
  let sentTo = 0;
  if (items.length && to.length) {
    const top = items.slice(0, 3).map((x) => `${x.title.slice(0, 40)}${x.dday != null ? ` (D-${x.dday})` : ''}`).join(' · ');
    sentTo = (await notify(sql, { userIds: to, type: 'support_weekly', space: 'sales', title: `이번 주 맞는 지원사업 ${items.length}건`, body: `${top}${aiCount ? ` · AI 세일즈가 새로 판단 ${aiCount}건` : ''}`,
      link: '/s/sales/support?tab=fit', dedupeKey: `support_weekly:${t}:${week}`, push: true } as never).catch(() => [] as string[])).length;
  }
  await sql`insert into support_weekly (tenant, week, items, ai_count, ai_failed, sent_to) values (${t}, ${week}::date, ${sql.json(items)}, ${aiCount}, ${aiFailed}, ${sentTo})
    on conflict (tenant, week) do update set items = excluded.items, ai_count = support_weekly.ai_count + excluded.ai_count, ai_failed = support_weekly.ai_failed + excluded.ai_failed, sent_to = greatest(support_weekly.sent_to, excluded.sent_to), updated_at = now()`;
  return { week, items: items.length, aiCount, aiFailed, aiError, sentTo };
}
/**
 * #785(대표 10/28 23:00 "항상 지원사업 올릴 때 AI 비서 돌리세요"): 정기 실행마다(수집기 다음) 회사 프로필을 저장하고 자동 판단을 켠 회사의
 * 새 공고(1차 규칙 '해당 없음' 아님)·'예전 프로필 기준' 판단을 AI 로 — 회사 AI 예산·사람별 한도 안, 한 번에 최대 SUPPORT_AUTO_AI_MAX(기본 10)건을 5건씩, budgetMs 안에서.
 * 예산·한도·크레딧에 걸리면 그 회사는 '멈춤'(다음 실행 때 다시 해 봄, 화면 안내), 다른 실패는 공고마다 3번까지. 새 공고·프로필이 그대로면 공고를 다시 읽지 않음(fp)
 */
export async function supportAutoTick(opt: { budgetMs?: number; max?: number } = {}) {
  if (process.env.SUPPORT_AUTO_AI === 'off') return { skipped: 'off' };
  if (!aiEnabled()) return { skipped: 'ai_off' };
  const sql = db(); const t0 = Date.now(); const budget = opt.budgetMs ?? 25_000; const today = ymd();
  const max = Math.max(0, opt.max ?? (Number(process.env.SUPPORT_AUTO_AI_MAX ?? 10) || 0));
  const tenants = await sql<{ tenant: string; updated_at: string; basis_at: string | null; auto_state: AutoState | null }[]>`select sp.tenant, sp.updated_at, sp.basis_at, sp.auto_state from support_profiles sp join tenants t on t.id = sp.tenant
    where sp.auto_ai and 'sales' = any(t.spaces) and t.status = 'active' and not coalesce(t.is_test, false) order by sp.tenant limit 50`; // 시험·체험 조직은 빼기(로컬 10/28 23:50)
  const out: Record<string, unknown> = {};
  for (const tp of tenants) {
    const t = tp.tenant;
    if (Date.now() - t0 > budget) { out[t] = { skipped: 'time' }; continue; }
    // 새 공고·프로필이 지난번 그대로이고 남은 것·멈춤이 없으면 건너뜀(공고 5,000건을 15분마다 다시 읽지 않게)
    const [c] = await sql<{ n: number; last: string | null; m: string | null }[]>`select count(*)::int n, max(p.first_seen_at)::text last,
      (select max(updated_at)::text from support_matches where tenant = ${t}) m from support_programs p
      where (p.tenant is null or p.tenant = ${t}) and (p.apply_end is null or p.apply_end >= ${today}::date) and (p.tenant is not null or p.last_seen_at > now() - interval '45 days')`;
    const fp = `${AUTO_FP}|${today}|${c.n}|${c.last}|${c.m}|${new Date(tp.updated_at).toISOString()}|${tp.basis_at ? new Date(tp.basis_at).toISOString() : ''}`;
    const prev = tp.auto_state;
    if (prev && prev.fp === fp && !prev.left && !prev.stopped) { out[t] = { skipped: 'same' }; continue; }
    const actor = await adminActor(sql, t); if (!actor) { out[t] = { skipped: 'no_admin' }; continue; }
    const { all } = await supportAll(sql, t, actor.id, today);
    const todo = all.filter((x) => autoCandidate(x, today)) // 판단 없는 것 먼저 → 마감 가까운 순 → 새로 올라온 순
      .sort((a, b) => Number(!!a.ai) - Number(!!b.ai) || (a.applyEnd ?? '9999-12-31').localeCompare(b.applyEnd ?? '9999-12-31') || String(b.seen).localeCompare(String(a.seen)));
    let done = 0, failed = 0, i = 0; let stopped: string | null = null, error: string | null = null;
    const n = Math.min(max, todo.length);
    while (i < n && !stopped && Date.now() - t0 < budget) {
      const batch = todo.slice(i, Math.min(i + 5, n)); i += batch.length;
      const rs = await Promise.allSettled(batch.map((x) => analyzeProgram(actor, x.id, undefined, { auto: true })));
      for (const [k, r] of rs.entries()) {
        if (r.status === 'fulfilled') { done++; continue; }
        const e = r.reason as HttpError;
        if ([402, 429].includes(e?.status) || e?.code === 'ai_off') { stopped = e?.code || 'budget'; error = String(e?.message ?? e).slice(0, 200); continue; } // 한도 — 공고 실패로 안 셈
        failed++; error ??= String(e?.message ?? e).slice(0, 200);
        await sql`insert into support_matches (tenant, program_id, auto_fail) values (${t}, ${batch[k].id}, 1)
          on conflict (tenant, program_id) do update set auto_fail = support_matches.auto_fail + 1, updated_at = now()`;
      }
    }
    // 판단·실패로 support_matches 가 바뀌었으니 fp 는 다음 실행이 다시 계산(남은 것이 없으면 그때 '같음')
    const state: AutoState = { at: new Date().toISOString(), done, failed, left: Math.max(0, todo.length - done), stopped, error, fp: done || failed ? '' : fp };
    await sql`update support_profiles set auto_state = ${sql.json(state as never)} where tenant = ${t}`;
    out[t] = { done, failed, left: state.left, stopped };
  }
  return { tenants: tenants.length, out };
}
/** 정기 실행: 월요일(KST) 08시 이후 첫 tick 에 영업 공간을 켠 회사마다 한 번(SUPPORT_WEEKLY = '요일-시' 기본 '1-8', 'any' = 늘, 'off' = 안 함) */
export async function supportWeeklyTick(opt: { now?: Date } = {}) {
  const now = opt.now ?? new Date(); const gate = process.env.SUPPORT_WEEKLY ?? '1-8';
  if (gate === 'off') return { skipped: 'off' };
  if (gate !== 'any') {
    const [dow, hour] = gate.split('-').map(Number);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')?.value ?? ''); const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    if (wd !== dow || h < hour) return { skipped: 'time' };
  }
  const sql = db(); const week = weekMonday(ymd(now));
  const tenants = await sql<{ id: string }[]>`select t.id from tenants t where 'sales' = any(t.spaces) and t.status = 'active'
    and not exists (select 1 from support_weekly w where w.tenant = t.id and w.week = ${week}::date) order by t.id limit 50`;
  const out: Record<string, unknown> = {};
  for (const t of tenants) out[t.id] = await weeklyBundle(t.id, { now }).catch((e) => ({ error: String((e as Error)?.message ?? e).slice(0, 120) }));
  return { week, tenants: tenants.length, out };
}
/** [이번 주 묶음 지금 만들기] — 관리자. 이번 주 묶음을 다시 만들고(자동 판단 포함) 알림은 주마다 한 번만 */
export async function sendWeeklyManual(u: SessionUser) {
  await assertSpace(u, 'sales');
  if (!isAdmin(u)) throw forbidden('주간 묶음은 관리자만 만들 수 있습니다');
  const r = await weeklyBundle(tenantOf(u), { actor: u, force: true });
  if ('skipped' in r && r.skipped === 'no_profile') throw badRequest('회사 프로필(본점 지역·업종·관심 분야)을 먼저 채워 주세요');
  return { ...r, weekly: await latestWeekly(db(), tenantOf(u)) };
}

// ---------------- 알림·홈 카드 ----------------
/** 마감 7일·3일 전 담당자 알림(관심·신청 준비) — tick 마다, KST 08~20시에만. 3일 안에 처음 잡힌 건은 3일 전 알림 하나만 */
export async function supportTick(opt: { now?: Date } = {}) {
  const now = opt.now ?? new Date(); const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now)) % 24;
  const [h0, h1] = (process.env.SUPPORT_REMIND_HOURS ?? '8-20').split('-').map(Number); // 시험은 0-24
  if (hour < h0 || hour >= h1) return { sent: 0, skipped: 'quiet' };
  const sql = db(); const today = ymd(now);
  const rows = await sql<{ id: string; tenant: string; status: string; owner_id: string | null; created_by: string | null; remind7_at: string | null; remind3_at: string | null; program_id: string; title: string; apply_end: string }[]>`
    select w.id, w.tenant, w.status, w.owner_id, w.created_by, w.remind7_at, w.remind3_at, p.id as program_id, p.title, p.apply_end::text from support_work w join support_programs p on p.id = w.program_id
    where w.status in ('interest', 'preparing') and p.apply_end between ${today}::date and ${addDays(today, 7)}::date and (w.remind3_at is null and p.apply_end <= ${addDays(today, 3)}::date or w.remind7_at is null) limit 200`;
  let sent = 0;
  for (const r of rows) {
    const d = daysBetween(today, r.apply_end); const three = d <= 3;
    if (!three && r.remind7_at) continue;
    const to = [r.owner_id ?? r.created_by].filter(Boolean) as string[];
    if (to.length) {
      await notify(sql, { userIds: to, type: 'support_deadline', space: 'sales', title: `지원사업 마감 ${d === 0 ? '오늘' : `D-${d}`}: ${r.title.slice(0, 60)}`, body: `${STATUS_LABEL[r.status]} 상태 — 신청 마감 ${r.apply_end}${r.status === 'interest' ? ' · 신청할지 정해 주세요' : ' · 서류·신청서를 확인하세요'}`,
        link: `/s/sales/support?id=${r.program_id}`, dedupeKey: `support_deadline:${r.id}:${three ? 3 : 7}`, push: true } as never).catch(() => {});
      sent++;
    }
    if (three) await sql`update support_work set remind3_at = now(), remind7_at = coalesce(remind7_at, now()) where id = ${r.id}`;
    else await sql`update support_work set remind7_at = now() where id = ${r.id}`;
  }
  return { sent, checked: rows.length };
}
/** 영업 홈 카드 '마감 임박 지원사업 n건' — 7일 안 마감: 우리가 관심·준비 중인 것 + 맞춤(관심 분야 맞음, 숨김·해당 없음 제외) */
export async function supportHomeCard(t: string, sql: Sql = db()) {
  const today = ymd(); const until = addDays(today, 7);
  const { profile, saved } = await profileOf(t, sql);
  const pr = saved || profile.region_sido || profile.industries.length || profile.interests.length ? profile : null;
  const off = await disabledSources(sql, t);
  // #647(대표 10/25 22:20): 홈 상단 고정 카드 '이번 주 맞는 지원사업' — 7일 안 마감뿐 아니라 아직 신청할 수 있는 맞춤(fitOpen)도 함께 셈
  const rows = await sql<(Prog & { status: string | null; hidden: boolean | null; ai_verdict: string | null })[]>`select ${COLS(sql)}, w.status, m.hidden, m.ai_verdict from support_programs p
    left join support_work w on w.program_id = p.id and w.tenant = ${t} left join support_matches m on m.program_id = p.id and m.tenant = ${t}
    where (p.tenant is null or p.tenant = ${t}) and not (p.source = any(${off})) and p.apply_end >= ${today}::date order by p.apply_end limit 3000`;
  let mine = 0, fit = 0, fitOpen = 0, mineOpen = 0, pending = 0;
  for (const r of rows) {
    const soon = !!r.apply_end && String(r.apply_end).slice(0, 10) <= until;
    if (r.status) { if (OPEN_WORK.includes(r.status)) { mineOpen++; if (soon) mine++; } continue; }
    if (r.hidden || !pr || garbledText(r.title)) continue;
    // #649 ③: '맞는 지원사업'은 AI 가 판정한 것만 — 1차 규칙만 맞는 건은 '확인 중'으로 따로 셈
    if (r.ai_verdict) { if (r.ai_verdict === 'fit') { fitOpen++; if (soon) fit++; } continue; }
    if (ruleMatch(r, pr, today).verdict === 'fit') pending++;
  }
  return { closing: mine + fit, mine, fit, fitOpen, mineOpen, pending };
}
