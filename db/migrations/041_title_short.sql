-- V14 24번: 직책 약칭(CEO·CPO 등). 비어 있으면 화면은 기존 직책(title)을 쓴다. 추가형.
alter table users add column if not exists title_short text;
