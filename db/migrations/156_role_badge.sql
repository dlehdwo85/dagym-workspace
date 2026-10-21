-- 대표 10/20 15:05 (#101) 권한 배지 영어 직책: 회사마다 영어(CEO·Admin·Lead·Ops·Member·Guest, 기본) / 한글 / 끄기
alter table tenants add column if not exists role_badge text not null default 'en' check (role_badge in ('en', 'ko', 'off'));
