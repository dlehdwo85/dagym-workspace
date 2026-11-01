-- 303차 #869(대표 11/01 '단색 배경 글자 장' 반려): 사진이 모자랄 때 단색 바탕 + 글자 장·블로그 도표형 카드로 채울지(예전 방식).
-- 기본 false = 채우지 않음 — 사진 없는 카드 장은 빼고, 블로그는 도표형 카드 대신 자료 요청 카드. 켜면 예전처럼 채움
alter table mkt_settings add column if not exists plain_fill boolean not null default false;
