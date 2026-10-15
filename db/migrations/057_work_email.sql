-- V21 메일 명함 E 줄: 로그인 이메일(개인 메일일 수 있음) 대신 업무 이메일. 비어 있으면 회사 메일 계정 주소. 추가형.
alter table users add column if not exists work_email text;
