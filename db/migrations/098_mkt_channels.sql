-- 상용화 ⑤-2(대표 결정 10/19: 구독형 통합 게시 API 미사용, 모든 채널 직접 연동). 회사별 게시 채널 켜기/끄기 + 연결 계정 점검 정보.
create table if not exists mkt_channel_settings (
  tenant text not null references tenants(id) on delete cascade,
  channel text not null,                  -- instagram·facebook·threads·youtube·tiktok·x·linkedin·pinterest·naver_blog·kakao_channel·naver_place
  enabled boolean not null default true,
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tenant, channel)
);
-- owner_ext_id: 연결한 사람의 플랫폼 사용자 id(Meta 데이터 삭제 콜백이 이 값으로 지움). info: 연결 전 점검 결과(관리자 여부·인스타 연결 등) — 비밀값 없음
alter table mkt_publish_accounts add column if not exists owner_ext_id text;
alter table mkt_publish_accounts add column if not exists info jsonb not null default '{}';
create index if not exists mkt_publish_accounts_owner on mkt_publish_accounts (provider, owner_ext_id);
