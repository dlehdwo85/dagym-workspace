-- 224차 #457 관심 검색어 AI 추천: 마지막 추천(근거 숫자·놓친 공고 후보)과 월 1회 정기 추천을 한 달에 한 번만 돌리는 표시. 추가형
alter table sales_settings add column if not exists kw_suggestion jsonb;
alter table sales_settings add column if not exists kw_monthly text; -- 정기 추천을 돌린 달(YYYY-MM)
