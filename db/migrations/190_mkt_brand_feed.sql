-- #544(대표 10/24 '바디랩 표지가 다 똑같다 · 바탕 글자 위에 또 글자 · 브랜드별 레퍼런스와 비교해 개선한 뒤 승인 다시'): 브랜드 키트 '피드 틀'.
-- 서버가 그리는 자동 시안의 틀(브랜드마다 3~4종, 최근 3개와 같은 틀·같은 사진 금지)·색(바탕·보조·포인트·글자)·머리줄·아래 연락처 줄·시리즈 머리말.
-- {style: 'trust', templates: ['title','list','photo_fade','grid4'], palette: {bg, bg2, accent, text}, header, contact, kicker}
-- 틀을 하나 이상 고른 브랜드는 '초안 보관'(186 auto_hold)이 풀려 자동 시안이 승인함으로 간다. 칸 추가만(값은 브랜드 키트 화면에서 — 회사 이름·색을 코드에 넣지 않음).
alter table mkt_brands add column if not exists feed jsonb not null default '{}'::jsonb;
