-- 데모(체험) 조직·계정 격리 표시. is_demo 조직·사용자는 밖을 볼 수 없고, 대표·본사 화면에도 섞이지 않는다. 추가형.
-- (체험하기 로그인 자체는 대표 확인 대기 — 이 마이그레이션은 격리 기준 열만 추가)
alter table org_units add column if not exists is_demo boolean not null default false;
alter table users add column if not exists is_demo boolean not null default false;
