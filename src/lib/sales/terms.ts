/**
 * 대표 10/21 12:00 영업 재편 6) (#408): 업종 중립 문구·온보딩 업종 템플릿.
 * 영업 공간의 메뉴명·칸 이름·예시 문구는 회사 업종 템플릿에서 가져온다 — 코드에 우리 회사(시설 위탁 운영) 용어를 기본값으로 박지 않는다.
 * 서버·클라이언트 공용(DB 접근 없음). 회사 값은 tenants.sales_template(null = industries 로 추정, 그래도 없으면 '일반').
 */
export const SALES_TEMPLATES = ['facility', 'construction', 'it', 'general'] as const;
export type SalesTemplate = (typeof SALES_TEMPLATES)[number];

export type SalesTerms = {
  template: SalesTemplate; label: string; desc: string;
  /** 짧은 종류 이름 — 배지·태그·진행 현황표·자동 업무 설명 */
  kind: { bid: string; building: string; facility: string; vendor: string; lead: string };
  /** 허브 탭·요약 타일 */
  buildingsTab: string; facilitiesTab: string; vendorsTab: string;
  /** 상세 칸 이름 */
  unitName: string; facilityName: string; office: string; operator: string;
  /** 홈 '오늘 할 일' 묶음 이름 */
  todo: { followUp: string; facilities: string; vendors: string };
  /** 입력 칸 예시(placeholder) — 회사 이름·브랜드 없이 업종 기준 */
  examples: { industry: string; product: string; business: string; keywords: string; excludes: string; aiProfile: string };
};

const T: Record<SalesTemplate, SalesTerms> = {
  facility: {
    template: 'facility', label: '시설 운영·위탁', desc: '아파트·커뮤니티·체육시설 위탁 운영, 시설 관리',
    kind: { bid: '입찰', building: '신규단지', facility: '시설', vendor: '협력사', lead: '리드' },
    buildingsTab: '신규 현장', facilitiesTab: '준공·입주 시설', vendorsTab: '협력사 등록',
    unitName: '단지명', facilityName: '시설명', office: '관리사무소', operator: '현 위탁사',
    todo: { followUp: '입찰·신규단지 후속', facilities: '준공시설 연락', vendors: '협력사 등록 할 일' },
    examples: { industry: '예: 아파트 커뮤니티 운영 / 헬스장 / 시설 관리', product: '주력 상품·서비스(예: 커뮤니티 시설 위탁 운영)', business: '예: 커뮤니티 운영', keywords: '주민공동시설, 커뮤니티, 피트니스, 출입통제', excludes: '어린이집, 급식, 주차',
      aiProfile: '예: 우리는 아파트 커뮤니티 시설을 위탁 운영합니다. 관리사무소·입주자대표회의가 고객이고…' },
  },
  construction: {
    template: 'construction', label: '건설·시공', desc: '건설·리모델링·인테리어·설비 시공',
    kind: { bid: '입찰', building: '신규 현장', facility: '준공 현장', vendor: '협력사', lead: '리드' },
    buildingsTab: '신규 현장', facilitiesTab: '준공 현장', vendorsTab: '협력사 등록',
    unitName: '현장명', facilityName: '현장명', office: '발주처 담당', operator: '현 시공사',
    todo: { followUp: '입찰·현장 후속', facilities: '준공 현장 연락', vendors: '협력사 등록 할 일' },
    examples: { industry: '예: 건설 / 리모델링 / 인테리어 / 설비', product: '주력 상품·서비스(예: 상가 리모델링 시공)', business: '예: 리모델링', keywords: '공사, 유지보수, 리모델링, 개보수', excludes: '설계 공모, 감리',
      aiProfile: '예: 우리는 공공·민간 건물 리모델링을 시공합니다. 발주처 시설 담당자와 관리사무소가 고객이고…' },
  },
  it: {
    template: 'it', label: 'IT·소프트웨어', desc: '소프트웨어 개발·SI·SaaS·IT 서비스',
    kind: { bid: '입찰', building: '신규 프로젝트', facility: '운영 고객', vendor: '파트너사', lead: '리드' },
    buildingsTab: '신규 프로젝트', facilitiesTab: '운영 중 고객', vendorsTab: '파트너 등록',
    unitName: '프로젝트명', facilityName: '고객사명', office: '담당 부서', operator: '현 공급사',
    todo: { followUp: '입찰·프로젝트 후속', facilities: '운영 고객 연락', vendors: '파트너 등록 할 일' },
    examples: { industry: '예: 소프트웨어 개발 / SI / SaaS', product: '주력 상품·서비스(예: 업무 관리 SaaS 구독)', business: '예: 시스템 구축', keywords: '시스템 구축, 유지보수, 소프트웨어, 플랫폼', excludes: '하드웨어 납품, 장비 구매',
      aiProfile: '예: 우리는 중소기업용 업무 관리 소프트웨어를 만듭니다. 총무·IT 담당자가 고객이고…' },
  },
  general: {
    template: 'general', label: '일반', desc: '업종을 정하지 않은 회사 — 중립 용어',
    kind: { bid: '입찰', building: '신규 기회', facility: '기존 거래처', vendor: '협력사', lead: '리드' },
    buildingsTab: '신규 기회', facilitiesTab: '기존 거래처', vendorsTab: '협력사 등록',
    unitName: '거래처명', facilityName: '거래처명', office: '담당 부서', operator: '현 거래처',
    todo: { followUp: '입찰·신규 기회 후속', facilities: '기존 거래처 연락', vendors: '협력사 등록 할 일' },
    examples: { industry: '예: 업태·종목(사업자등록증)', product: '주력 상품·서비스', business: '예: 주력 사업', keywords: '관심 검색어를 쉼표로', excludes: '제외할 검색어를 쉼표로',
      aiProfile: '예: 우리는 ○○을 합니다. 주요 고객은 ○○이고…' },
  },
};

export const salesTemplateList = () => SALES_TEMPLATES.map((code) => ({ code, label: T[code].label, desc: T[code].desc }));
export const termsOf = (code: SalesTemplate): SalesTerms => T[code];
export const isSalesTemplate = (v: unknown): v is SalesTemplate => (SALES_TEMPLATES as readonly string[]).includes(String(v));

/** 회사 업종(industries·industry)으로 템플릿 추정 — 온보딩에서 업종만 골라도 영업 화면 용어가 맞춰진다 */
export function inferSalesTemplate(industries: readonly string[] | null | undefined): SalesTemplate {
  const s = (industries ?? []).filter(Boolean).join(' ');
  if (!s) return 'general';
  if (/운동|피트니스|헬스|스포츠|체육|커뮤니티|시설|위탁|관리|숙박|레저|요가|수영/.test(s)) return 'facility';
  if (/건설|건축|시공|인테리어|토목|전기|설비|리모델링|조경/.test(s)) return 'construction';
  if (/IT|소프트웨어|SI|SaaS|앱|웹|개발|정보통신|플랫폼|데이터/i.test(s)) return 'it';
  return 'general';
}
/** 회사 업종 목록: industries[](여러 개)가 있으면 그것만, 없으면 예전 industry 한 칸 */
export const tenantIndustries = (t: { industries?: string[] | null; industry?: string | null } | null | undefined): string[] => (t?.industries?.length ? t.industries : t?.industry ? [t.industry] : []);
/** 저장값(null 이면 추정) → 용어 */
export function salesTermsFor(saved: string | null | undefined, industries: readonly string[] | null | undefined): SalesTerms & { auto: boolean } {
  const auto = !isSalesTemplate(saved);
  return { ...termsOf(auto ? inferSalesTemplate(industries) : (saved as SalesTemplate)), auto };
}
export const DEFAULT_TERMS = termsOf('general');
