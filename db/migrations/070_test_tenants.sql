-- V32 1 결제 시험 회사: 로그인 계정 없이 회사만, 가입 퍼널·매출 집계·자동 결제에서 뺀다
alter table tenants add column if not exists is_test boolean not null default false;
