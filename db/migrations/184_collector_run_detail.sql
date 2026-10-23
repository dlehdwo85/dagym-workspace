-- #522 영업 DB 누락 방지(대표 10/24 "입찰공고 놓치지 않게"): 수집기 실행마다 원천별 받은 건수·관련 건수·첫 건 칸 이름(값 없이)·오류를 남긴다.
-- 하루 한 번 누락 점검(원천별 마지막 성공 24시간 초과·2회 연속 실패 → 영업 홈 빨간 띠·관리자 알림)이 이 칸을 읽는다.
alter table sales_collector_runs add column if not exists detail jsonb;
