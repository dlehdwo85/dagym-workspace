-- 로컬 검수(10/18): 마케팅 알림·승인 받는 사람 고르기(기본 = 관리자 전원) · 브랜드 '시험 모드'(알림은 실행한 사람에게만, [시험] 표시, 게시 확인 안 됨)
alter table mkt_settings add column if not exists notify_user_ids uuid[];
alter table mkt_brands add column if not exists test_mode boolean not null default false;
alter table mkt_contents add column if not exists is_test boolean not null default false;
