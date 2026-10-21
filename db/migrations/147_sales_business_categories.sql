-- 대표 10/21 12:00 영업 재편 4): 회사 '관심 사업(카테고리)' 설정 — 공고 사업별 탭·필터와 행 적합 배지는 이 표에서 계산한다(코드에 회사 이름 없음).
-- 상용화 규칙: 다른 업종 회사도 그대로 쓰므로 첫 회사(default)의 값만 자료로 심는다.
create table if not exists sales_business_categories (
  id uuid primary key default gen_random_uuid(),
  tenant text not null,
  key text not null,
  name text not null,
  color text not null default '#2563EB',
  keywords text[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant, key)
);
insert into sales_business_categories (tenant, key, name, color, keywords, sort) values
  ('default', 'dagym', '다짐', '#7C3AED', array['다짐', 'dagym', '헬스', '피트니스', '체육시설', '스포츠센터', '체육관', '수영장', '운동시설'], 1),
  ('default', 'hilink', '하이링크', '#2563EB', array['하이링크', 'hilink', 'hi-link', '커뮤니티', '위탁운영', '위탁 운영', '입주민', '관리사무소', '커뮤니티센터'], 2)
on conflict (tenant, key) do nothing;

-- 로컬 10/21 11:45: M1 게시 뒤 삭제 감지 — 작업에 삭제 확인 시각·마지막 점검 시각, 콘텐츠에 '게시 삭제됨' 시각
alter table mkt_publish_jobs add column if not exists deleted_at timestamptz;
alter table mkt_publish_jobs add column if not exists checked_at timestamptz;
alter table mkt_contents add column if not exists published_deleted_at timestamptz;
