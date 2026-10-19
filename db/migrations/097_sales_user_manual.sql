-- 로컬 요청(10/19): 이메일로 짝을 못 찾은 원본 사용자를 관리자가 워크인 사용자에 직접 연결 — 다시 가져와도 유지
alter table sales_user_map add column if not exists manual boolean not null default false;
