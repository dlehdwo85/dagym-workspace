-- 270차 #808·#809(대표 10/29 '요금제 AI 영상 월 2편이라는 게 슈퍼관리자는 무한임에도 2편밖에 못 만든다는 건가요?'): 우리 회사(내부) 마케팅 제작 상한을
-- 요금제 숫자(크레딧·영상 편수·재생성 횟수) 대신 '월 실제 비용 한도(원)'로. 비우면(null) 지금처럼 요금제 숫자 — 값은 대표가 정한 뒤 넣음. 추가만.
alter table mkt_settings add column if not exists cost_cap_krw int check (cost_cap_krw is null or cost_cap_krw >= 0);
