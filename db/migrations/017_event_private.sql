-- WORKIN_V4: 일정 비공개(다른 사람에게는 "바쁨"으로만). 본사 사람끼리 개인 일정 기본 공개. 추가형.
alter table events add column if not exists is_private boolean not null default false;
