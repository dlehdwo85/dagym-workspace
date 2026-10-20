-- 대표 10/20 11:40 ① 플랫폼 운영 [고객사 추가]·상세 메모 — 운영자(플랫폼 운영 화면)만 보는 회사 메모
alter table tenants add column if not exists platform_memo text;
