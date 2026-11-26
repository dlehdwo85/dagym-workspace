-- 대표 11/27(로컬): 회사 자격 표 — 공고 참가자격(체육 지도 자격 1급·2급 인원, 자본금)과 대조해 카드에 '자격 부족' 표시(숨기지 않음).
-- 값은 회사마다 영업 맞춤 설정에서 넣는다(공개 저장소에 회사 자격을 적지 않음). 빈 칸 = 모름(대조 안 함)
alter table sales_bid_prefs add column if not exists quals jsonb not null default '{}'::jsonb;
