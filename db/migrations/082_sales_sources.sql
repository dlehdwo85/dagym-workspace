-- V41 단계 3(V40) 영업 데이터 확장: 원천 카탈로그(공용) · 회사별 원천 설정(필터만) · 수집 데이터(공용 1벌) · 회사별 진행 기록. 추가형.
-- 원천 데이터는 우리 data.go.kr 키(DATA_GO_KR_SERVICE_KEY)로 한 번 모아 모든 회사가 같이 보고, 회사마다 다른 것은 켠 원천·검색어·지역·제외어와 진행 상태·메모뿐.
create table if not exists data_sources (
  code text primary key,
  name text not null,
  provider text not null,
  kind text not null default 'api',
  dataset_no text,
  refresh text,
  license text not null default 'free',      -- free(제한 없음) · kogl1(출처표시) · kogl3(변경금지) · noncommercial(서비스 제외)
  grp text,                                  -- 업종 묶음(V40 §2)
  category text not null default 'other',    -- permit(행안부 인허가 공통 수집기) · check(정리용) · other
  endpoint text,                             -- 호출 주소(운영에서 확인 후 플랫폼 운영자가 넣음)
  params jsonb not null default '{}',
  field_map jsonb not null default '{}',
  collect boolean not null default false,    -- 수집기 켬(플랫폼 운영자)
  last_run_at timestamptz, last_count int, last_error text,
  updated_at timestamptz not null default now()
);
insert into data_sources (code, name, provider, kind, dataset_no, refresh, license, grp, category) values
  ('15081808', '국세청 사업자등록 상태조회', '국세청', 'api', '15081808', '실시간', 'free', '공통', 'check'),
  ('15012005', '소상공인 상가(상권)정보', '소상공인시장진흥공단', 'api', '15012005', '실시간', 'free', '소상공인·상가', 'other'),
  ('3046071', '국민연금 가입 사업장 내역', '국민연금공단', 'api', '3046071', '실시간', 'free', '공통', 'other'),
  ('15129462', '나라장터 발주계획현황', '조달청', 'api', '15129462', '실시간', 'free', '공통', 'other'),
  ('15129468', '나라장터 조달요청', '조달청', 'api', '15129468', '실시간', 'free', '공공조달', 'other'),
  ('15129427', '나라장터 계약정보', '조달청', 'api', '15129427', '실시간', 'free', '공공조달', 'other'),
  ('15155077', '생활_체력단련장업', '행정안전부', 'api', '15155077', '일간', 'free', '시설관리·위탁운영', 'permit'),
  ('15155071', '생활_종합체육시설업', '행정안전부', 'api', '15155071', '일간', 'free', '시설관리·위탁운영', 'permit'),
  ('15155038', '생활_수영장업', '행정안전부', 'api', '15155038', '일간', 'free', '시설관리·위탁운영', 'permit'),
  ('15154949', '자원환경_건물위생관리업', '행정안전부', 'api', '15154949', '일간', 'free', '시설관리·위탁운영', 'permit'),
  ('15154982', '자원환경_소독업', '행정안전부', 'api', '15154982', '일간', 'free', '시설관리·위탁운영', 'permit'),
  ('15155168', '식품_집단급식소', '행정안전부', 'api', '15155168', '일간', 'free', '식품·외식', 'permit'),
  ('15155159', '식품_위탁급식영업', '행정안전부', 'api', '15155159', '일간', 'free', '식품·외식', 'permit'),
  ('15154916', '식품_일반음식점', '행정안전부', 'api', '15154916', '일간', 'free', '식품·외식', 'permit'),
  ('15154921', '식품_휴게음식점', '행정안전부', 'api', '15154921', '일간', 'free', '식품·외식', 'permit'),
  ('15155150', '식품_식품제조가공업', '행정안전부', 'api', '15155150', '일간', 'free', '제조·공장', 'permit'),
  ('15154458', '건강_병원', '행정안전부', 'api', '15154458', '일간', 'free', '의료·요양', 'permit'),
  ('15154874', '건강_의원', '행정안전부', 'api', '15154874', '일간', 'free', '의료·요양', 'permit'),
  ('15155124', '문화_숙박업', '행정안전부', 'api', '15155124', '일간', 'free', '숙박·관광', 'permit'),
  ('15154948', '생활_대규모점포', '행정안전부', 'api', '15154948', '일간', 'free', '보안·IT', 'permit'),
  ('15155066', '기타_물류창고업체', '행정안전부', 'api', '15155066', '일간', 'free', '물류·운송', 'permit'),
  ('15154963', '생활_통신판매업', '행정안전부', 'api', '15154963', '일간', 'free', '소상공인·상가', 'permit'),
  ('15001698', '병원정보서비스', '건강보험심사평가원', 'api', '15001698', '실시간', 'kogl1', '의료·요양', 'other'),
  ('15051043', '요양기관 개폐업 정보', '건강보험심사평가원', 'api', '15051043', '실시간', 'kogl1', '의료·요양', 'other'),
  ('15059029', '장기요양기관 검색', '국민건강보험공단', 'api', '15059029', '실시간', 'free', '의료·요양', 'other'),
  ('15058856', '장기요양기관 시설별 상세', '국민건강보험공단', 'api', '15058856', '실시간', 'free', '의료·요양', 'other'),
  ('15057332', '공동주택 단지 목록', '국토교통부', 'api', '15057332', '실시간', 'free', '시설관리·위탁운영', 'other'),
  ('15058453', '공동주택 기본 정보', '국토교통부', 'api', '15058453', '실시간', 'free', '시설관리·위탁운영', 'other'),
  ('15098547', '청약홈 분양정보', '한국부동산원', 'api', '15098547', '실시간', 'free', '부동산·신축', 'other'),
  ('15057999', 'LH 분양임대공고 상세', '한국토지주택공사', 'api', '15057999', '실시간', 'free', '부동산·신축', 'other'),
  ('15134735', '건축HUB 건축물대장', '국토교통부', 'api', '15134735', '월간', 'free', '건설·인테리어', 'other'),
  ('15061362', '키스콘 건설업체정보', '국토교통부', 'api', '15061362', '실시간', 'free', '건설·인테리어', 'other'),
  ('3048029', '물류창고업 등록정보', '국토교통부', 'api', '3048029', '실시간', 'free', '물류·운송', 'other'),
  ('15043184', '금융위 기업기본정보', '금융위원회', 'api', '15043184', '실시간', 'free', '공통', 'other'),
  ('15158963', '대학알리미 대학 기본정보', '한국대학교육협의회', 'api', '15158963', '실시간', 'free', '교육', 'other'),
  ('15087611', '공장등록 생산정보', '한국산업단지공단', 'api', '15087611', '실시간', 'free', '제조·공장', 'other')
on conflict (code) do nothing;

create table if not exists tenant_data_sources (
  tenant text not null references tenants(id) on delete cascade,
  source_code text not null references data_sources(code) on delete cascade,
  enabled boolean not null default true,
  keywords text[] not null default '{}',
  regions text[] not null default '{}',
  excludes text[] not null default '{}',
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, source_code)
);
create table if not exists sales_settings (
  tenant text primary key references tenants(id) on delete cascade,
  industry text, region text,
  setup_done_at timestamptz,
  last_suggestion jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists prospects (
  id bigserial primary key,
  source_code text not null references data_sources(code) on delete cascade,
  ext_id text not null,
  name text not null,
  address text, sido text, sigungu text,
  status text,                -- 영업·폐업 등 원천 값 그대로
  opened_on date, closed_on date,
  category text,
  lat double precision, lng double precision,
  raw jsonb,
  base_date date,             -- 데이터 기준일
  fetched_at timestamptz not null default now(),
  unique (source_code, ext_id)
);
create index if not exists prospects_opened_idx on prospects(opened_on desc);
create index if not exists prospects_sido_idx on prospects(sido);
create table if not exists tenant_prospects (
  tenant text not null references tenants(id) on delete cascade,
  prospect_id bigint not null references prospects(id) on delete cascade,
  status text not null default 'new' check (status in ('new', 'contacting', 'lead', 'skip')),
  memo text,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, prospect_id)
);
