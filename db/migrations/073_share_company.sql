-- V34 A5 자료 받기 화면(/d)에 "보낸 회사"를 메일·문자에서 고른 회사로 (기본 회사가 아니라)
alter table share_links add column if not exists company_key text;
