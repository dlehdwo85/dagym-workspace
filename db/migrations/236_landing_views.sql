-- 311차 #867(대표 11/01 '페이지별 홍보 목표'): 소개 페이지별 방문 수 — 날짜(서울)·페이지별 숫자만(개인정보·브라우저 id 없음).
-- 같은 브라우저의 같은 페이지는 하루 1번만 셈(브라우저 쪽에서). 가입은 tenants.signup_utm->>'page'(첫 방문 소개 페이지).
create table if not exists landing_views (
  day date not null,
  page text not null,
  n integer not null default 0,
  primary key (day, page)
);
