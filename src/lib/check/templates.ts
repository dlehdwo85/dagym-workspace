/**
 * 점검 템플릿(코드에 든 자료 — 프롬프트 B 부록 2·3).
 * - 공통 기본(common): 어느 업종이든 지점·사업장이 있으면 해당되는 것만. 모든 회사에 설치.
 * - 업종 템플릿: 가입 때 고른 업종에 맞는 것만 설치(관리자가 나중에 더 넣을 수 있음). 업종 낱말은 여기 자료에만 둔다(화면·공통 코드에는 없음).
 * - 특정 회사 이름·브랜드·업체 이름은 넣지 않는다. 기본 회사 전용 설정(부록 4)은 그 회사 자료로만 넣는다(코드에 없음).
 * 열쇠(key)는 다시 설치해도 겹치지 않게 하는 이름표 — 한 번 내보낸 열쇠는 바꾸지 않는다.
 */
import type { Cycle, Method } from './guide';

export type TplItem = {
  key: string; title: string; category: string; places?: string[]; method: Method; methodNote?: string; pass: string; blind: string[];
  fix: { note: string; dueDays?: number; external?: boolean }; cycle: Cycle; share?: boolean;
};
export type CheckTemplate = { key: string; name: string; description: string; categories?: { key: string; name: string; icon?: string }[]; placeTypes: { key: string; name: string }[]; items: TplItem[] };

/** 공통 분야 8개 — 업종 템플릿의 항목도 이 분야 열쇠를 쓴다 */
const CATEGORIES = [
  { key: 'clean', name: '청결', icon: 'sparkles' }, { key: 'facility', name: '시설·설비', icon: 'building' }, { key: 'equipment', name: '장비·기기', icon: 'wrench' },
  { key: 'safety', name: '안전', icon: 'shield' }, { key: 'service', name: '고객 응대', icon: 'smile' }, { key: 'ready', name: '서비스 준비', icon: 'clock' },
  { key: 'notice', name: '안내·게시물', icon: 'megaphone' }, { key: 'record', name: '업무 기록', icon: 'clipboard' },
];

const COMMON: CheckTemplate = {
  key: 'common', name: '공통 기본', description: '어느 업종이든 쓰는 기본 점검 항목 20개',
  categories: CATEGORIES,
  placeTypes: [{ key: 'entrance', name: '출입구·로비' }, { key: 'restroom', name: '화장실' }, { key: 'customer', name: '고객 이용 공간' }, { key: 'staff', name: '직원 공간' }, { key: 'storage', name: '창고' }, { key: 'desk', name: '안내 데스크' }],
  items: [
    { key: 'entrance-floor', title: '출입구 바닥', category: 'clean', places: ['entrance'], method: 'look', pass: '먼지·물기·이물 없음', blind: ['매트 아래', '모서리'], fix: { note: '즉시 청소', dueDays: 0 }, cycle: 'daily', share: true },
    { key: 'restroom', title: '화장실', category: 'clean', places: ['restroom'], method: 'look', pass: '바닥 물기·냄새 없음, 휴지·비누 채워짐', blind: ['세면대 아래', '칸막이 하단'], fix: { note: '즉시 청소·보충', dueDays: 0 }, cycle: 'daily', share: true },
    { key: 'mirror-glass', title: '거울·유리문', category: 'clean', places: ['entrance', 'customer'], method: 'look', methodNote: '비스듬히 보기', pass: '손자국·얼룩 없음', blind: ['하단', '손잡이 주변'], fix: { note: '다시 닦은 뒤 사진', dueDays: 1 }, cycle: 'weekly', share: true },
    { key: 'trash', title: '쓰레기통', category: 'clean', places: ['customer', 'staff', 'restroom'], method: 'look', pass: '넘치지 않음, 냄새 없음', blind: ['직원 공간 쓰레기통'], fix: { note: '비우기', dueDays: 0 }, cycle: 'daily', share: true },
    { key: 'corners', title: '구석·가구 뒤', category: 'clean', places: ['customer', 'storage'], method: 'look', pass: '거미줄·먼지 뭉침 없음', blind: ['선반 뒤', '하단 틈'], fix: { note: '청소 일정 등록', dueDays: 7 }, cycle: 'weekly', share: true },
    { key: 'lighting', title: '조명', category: 'facility', method: 'look', pass: '꺼지거나 깜빡이는 등 없음', blind: ['창고', '복도 끝'], fix: { note: '교체 요청', dueDays: 3 }, cycle: 'monthly' },
    { key: 'hvac', title: '냉난방', category: 'facility', places: ['customer'], method: 'record', methodNote: '기록 확인 + 체감', pass: '운영 기준 온도 준수, 필터 청소 주기 지킴', blind: ['필터'], fix: { note: '필터 청소, 기준 안내', dueDays: 7 }, cycle: 'monthly' },
    { key: 'labels', title: '번호표·부착물', category: 'facility', places: ['customer'], method: 'look', pass: '떨어지거나 들뜬 것 없음', blind: ['사물함·좌석 번호표'], fix: { note: '다시 붙이기', dueDays: 3 }, cycle: 'weekly' },
    { key: 'floor-wall', title: '바닥·벽 파손', category: 'facility', places: ['entrance', 'customer'], method: 'look', pass: '들뜸·파손 없음', blind: ['출입 경사로', '계단'], fix: { note: '건물 관리처 연락', dueDays: 7, external: true }, cycle: 'monthly' },
    { key: 'customer-device', title: '고객용 기기', category: 'equipment', places: ['customer'], method: 'operate', pass: '정상 작동, 이상 소음 없음', blind: ['기기 뒤편 먼지'], fix: { note: '정비 또는 AS 요청', dueDays: 7 }, cycle: 'monthly' },
    { key: 'fire-exit', title: '소화기·비상구', category: 'safety', method: 'look', pass: '소화기 압력 정상, 비상구 통로 막힘 없음', blind: ['통로 적재물'], fix: { note: '즉시 치움', dueDays: 0 }, cycle: 'monthly', share: true },
    { key: 'first-aid', title: '구급함', category: 'safety', places: ['desk', 'staff'], method: 'look', pass: '유효기한 내 물품 구비', blind: ['소모품 유효기한'], fix: { note: '보충', dueDays: 7 }, cycle: 'monthly', share: true },
    { key: 'privacy', title: '개인정보 노출', category: 'safety', places: ['desk', 'customer'], method: 'look', pass: '고객 이름·연락처가 보이는 곳에 없음', blind: ['사물함 이름표', '데스크 메모'], fix: { note: '가림 처리', dueDays: 0 }, cycle: 'monthly', share: true },
    { key: 'complaints', title: '고객 문의·불만 처리', category: 'service', places: ['desk'], method: 'record', pass: '접수 → 공감·기록 → 처리 권한 확인 → 보고 → 진행 안내 → 결과 안내 기록', blind: ['작은 문의 미기록'], fix: { note: '응대 방법 안내', dueDays: 3 }, cycle: 'monthly' },
    { key: 'opening', title: '영업 준비', category: 'ready', places: ['customer'], method: 'look', pass: '영업 시작 전 준비 완료', blind: ['조명·음악·온도'], fix: { note: '준비 순서 다시 안내', dueDays: 1 }, cycle: 'daily' },
    { key: 'posters', title: '게시물', category: 'notice', places: ['entrance', 'customer'], method: 'look', pass: '최신 내용, 훼손 없음, 지난 게시물 없음', blind: ['지난 행사 포스터'], fix: { note: '교체·철거', dueDays: 3 }, cycle: 'weekly' },
    { key: 'regular-notice', title: '정기 안내 발송', category: 'notice', method: 'record', pass: '정한 주기에 발송', blind: ['발송 누락'], fix: { note: '발송', dueDays: 1 }, cycle: 'monthly' },
    { key: 'promo', title: '홍보물 내용', category: 'notice', method: 'record', pass: '가격만이 아니라 혜택·대상·담당자 경력이 드러남', blind: ['가격만 강조'], fix: { note: '수정', dueDays: 7 }, cycle: 'monthly' },
    { key: 'report-due', title: '업무 보고 기한', category: 'record', method: 'record', pass: '기한 내 제출 또는 연장 요청', blind: ['무응답 지연'], fix: { note: '확인 요청', dueDays: 1 }, cycle: 'monthly' },
    { key: 'backup', title: '부재 시 대체자', category: 'record', method: 'record', pass: '휴가·부재 시 대체자 지정', blind: ['미지정'], fix: { note: '지정', dueDays: 3 }, cycle: 'monthly' },
  ],
};

const FITNESS: CheckTemplate = {
  key: 'fitness', name: '운동시설', description: '운동 공간·기구·수업 기록',
  placeTypes: [{ key: 'gym', name: '운동 공간' }, { key: 'stretch', name: '스트레칭 공간' }, { key: 'locker-room', name: '탈의실' }, { key: 'lockers', name: '사물함' }],
  items: [
    { key: 'treadmill', title: '러닝머신', category: 'equipment', places: ['gym'], method: 'operate', methodNote: '1분 주행해 보기', pass: '벨트가 가운데에 있고 이상 소음 없음, 모터 덮개에 먼지 없음', blind: ['모터 덮개 안쪽', '벨트 가장자리'], fix: { note: '정비 또는 AS 요청', dueDays: 7 }, cycle: 'weekly' },
    { key: 'stepper', title: '계단식 운동기구', category: 'equipment', places: ['gym'], method: 'operate', pass: '작동 소음 없음, 윤활 상태 양호', blind: ['발판 연결부'], fix: { note: '윤활·정비 요청', dueDays: 7 }, cycle: 'monthly' },
    { key: 'weight-adjust', title: '웨이트 기구 조절부', category: 'equipment', places: ['gym'], method: 'operate', pass: '의자·높이 조절이 부드럽게 움직이고 고정됨', blind: ['고정 핀', '레일 먼지'], fix: { note: '윤활 또는 부품 교체 요청', dueDays: 7 }, cycle: 'monthly' },
    { key: 'mat-floor', title: '매트·바닥', category: 'facility', places: ['gym', 'stretch'], method: 'look', pass: '부착물 잔여·파손·들뜸 없음', blind: ['기구 아래', '매트 이음매'], fix: { note: '보수 또는 교체 요청', dueDays: 7 }, cycle: 'weekly', share: true },
    { key: 'guide-signs', title: '운동 방법·상담 신청 안내', category: 'notice', places: ['gym'], method: 'look', pass: '운동 방법과 상담 신청 안내가 보이는 곳에 붙어 있음', blind: ['훼손되거나 가려진 안내문'], fix: { note: '다시 붙이기', dueDays: 3 }, cycle: 'monthly' },
    { key: 'class-log', title: '수업 기록 작성', category: 'record', method: 'record', pass: '수업마다 기록이 남아 있음', blind: ['당일 미작성'], fix: { note: '작성 요청', dueDays: 1 }, cycle: 'weekly' },
    { key: 'first-guide', title: '신규 고객 첫 안내 진행 기록', category: 'service', method: 'record', pass: '신규 고객마다 첫 안내 진행 기록이 있음', blind: ['등록만 하고 첫 안내가 빠진 고객'], fix: { note: '첫 안내 일정 잡기', dueDays: 3 }, cycle: 'weekly' },
  ],
};

const COMMUNITY: CheckTemplate = {
  key: 'community', name: '아파트·건물 커뮤니티 시설', description: '독서실·도서관·골프연습장·사우나 등 공용 시설',
  placeTypes: [{ key: 'reading-room', name: '독서실' }, { key: 'library', name: '작은도서관' }, { key: 'golf-range', name: '골프연습장' }, { key: 'screen-golf', name: '스크린 골프룸' }, { key: 'cafe', name: '카페' }, { key: 'sauna', name: '사우나' }],
  items: [
    { key: 'reading-seats', title: '독서실 좌석·사물함', category: 'facility', places: ['reading-room'], method: 'look', pass: '좌석·사물함 번호가 고정돼 있고 이용자 이름이 가려져 있음', blind: ['사물함 이름표'], fix: { note: '다시 붙이기·가림 처리', dueDays: 3 }, cycle: 'weekly' },
    { key: 'library-shelves', title: '도서관 책장·바닥', category: 'clean', places: ['library'], method: 'look', pass: '책장 뒤·바닥에 이물 없음', blind: ['책장 뒤', '하단 틈'], fix: { note: '청소', dueDays: 3 }, cycle: 'weekly', share: true },
    { key: 'golf-net', title: '골프 타석 그물·줄', category: 'facility', places: ['golf-range'], method: 'look', pass: '그물·줄이 찢어지거나 늘어진 곳 없음, 그물 뒤에 공이 남아 있지 않음', blind: ['그물 뒤 공'], fix: { note: '공 회수, 그물 보수 요청', dueDays: 7 }, cycle: 'weekly' },
    { key: 'screen-bottom', title: '스크린 하단', category: 'clean', places: ['screen-golf'], method: 'look', pass: '스크린 하단에 부착물 잔여 없음', blind: ['스크린 하단 모서리'], fix: { note: '제거·청소', dueDays: 3 }, cycle: 'weekly', share: true },
    { key: 'odor', title: '실내 냄새', category: 'clean', method: 'record', methodNote: '기록 확인 + 체감', pass: '불쾌한 냄새 없음, 방역 업체 분사 주기를 지킴', blind: ['환기가 안 되는 방'], fix: { note: '환기, 방역 업체 일정 확인', dueDays: 3, external: true }, cycle: 'monthly' },
    { key: 'program-open', title: '프로그램 개설 절차', category: 'record', method: 'record', pass: '최소 인원 → 선결제 → 개강 확정 순서를 지킴', blind: ['인원이 모자란데 개강'], fix: { note: '절차 안내', dueDays: 3 }, cycle: 'monthly' },
    { key: 'eligibility', title: '고객 자격 확인 절차', category: 'service', places: ['desk'], method: 'record', pass: '이용 자격 확인 절차를 지킴', blind: ['동반 이용자'], fix: { note: '절차 안내', dueDays: 3 }, cycle: 'monthly' },
  ],
};

const CAFE: CheckTemplate = {
  key: 'cafe', name: '카페·음료', description: '제조 공간·홀·재료 관리',
  placeTypes: [{ key: 'bar', name: '바(제조 공간)' }, { key: 'hall', name: '홀' }],
  items: [
    { key: 'ingredients', title: '재료 유통기한·폐기 기록', category: 'safety', places: ['bar', 'storage'], method: 'record', methodNote: '기록 확인 + 직접 보기', pass: '유통기한 지난 재료 없음, 폐기 기록이 남아 있음', blind: ['냉장고 안쪽', '개봉한 시럽·소스'], fix: { note: '폐기한 뒤 기록', dueDays: 0 }, cycle: 'daily', share: true },
    { key: 'machine-clean', title: '제빙기·커피머신 청소', category: 'equipment', places: ['bar'], method: 'record', methodNote: '기록 확인 + 직접 보기', pass: '정한 청소 주기를 지킴', blind: ['제빙기 내부', '스팀 노즐'], fix: { note: '청소한 뒤 기록', dueDays: 1 }, cycle: 'weekly', share: true },
    { key: 'sales-log', title: '시간대별 판매 기록', category: 'record', method: 'record', pass: '시간대별 판매 기록이 남아 있음', blind: ['마감 직전 누락'], fix: { note: '기록 요청', dueDays: 1 }, cycle: 'weekly' },
    { key: 'hall-tables', title: '홀 테이블·의자', category: 'clean', places: ['hall'], method: 'look', pass: '테이블·의자에 얼룩·부스러기 없음', blind: ['의자 등받이', '테이블 다리'], fix: { note: '즉시 닦기', dueDays: 0 }, cycle: 'daily', share: true },
  ],
};

export const CHECK_TEMPLATES: Record<string, CheckTemplate> = { common: COMMON, fitness: FITNESS, community: COMMUNITY, cafe: CAFE };
/** 가입 때 고른 업종(src/lib/industries.ts 의 이름) → 함께 설치할 업종 템플릿 */
export const INDUSTRY_CHECK_TEMPLATE: Record<string, string> = { '운동·피트니스': 'fitness', '시설관리·용역': 'community', '건설·시설관리': 'community', '외식·카페': 'cafe' };
export const templatesForIndustries = (industries: (string | null | undefined)[]) => ['common', ...new Set(industries.map((x) => INDUSTRY_CHECK_TEMPLATE[x ?? '']).filter(Boolean))];
