-- 189차(대표 #685 "자료실 사진이 모자라면 실사를 참고해 실사풍으로 생성 — 크레딧 한도 안에서"): 추가형.
-- 회사 설정 '사진이 모자라면 실사 참고로 생성' — 기본 꺼짐(돈이 드는 일이라 관리자가 켬). 켜면 정기 실행이 서버 시안의 빈 사진 칸(표지·카드뉴스 장)을
-- 같은 브랜드 실사(얼굴 없는 사진)를 참고 사진으로 실사풍 생성해 채움 — 한 글에 2장까지, 주·월 크레딧 한도 안. 생성 사진은 자료실 '마케팅/AI 생성(실사 참고)'(source ai_ref).
alter table mkt_settings add column if not exists photo_gen boolean not null default false;
