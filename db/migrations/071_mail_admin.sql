-- V32 6 회사 기본 메일: 직원이 회신 주소(업무 이메일)를 바꿀 수 있는지 — 회사 관리자가 정함(기본 허용)
alter table tenants add column if not exists allow_staff_reply_to boolean not null default true;
