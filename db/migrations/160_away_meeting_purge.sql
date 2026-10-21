-- 대기열 소형 3건 (2026-10-22 클라우드)
-- V35 2 2차 (#76) 부재중 설정: 기간·자동 응답 문구·대리인·알림 보류 — presence '부재', 담당자 규칙 부재 대체, 푸시 보류 + 복귀 요약(1회)
alter table user_settings add column if not exists away_from date;
alter table user_settings add column if not exists away_to date;
alter table user_settings add column if not exists away_note text;
alter table user_settings add column if not exists away_deputy_id uuid references users(id) on delete set null;
alter table user_settings add column if not exists away_hold boolean not null default true;   -- 부재(직접 설정·연차) 중 푸시 보류, 돌아오면 요약 1건
alter table user_settings add column if not exists away_summary_at timestamptz;
-- V30 ⑪ (#111) 일정에 화상 회의 링크 칸
alter table events add column if not exists meeting_url text;
-- V15-6 (#279) 탈퇴 30일 뒤 실제 삭제: 남은 개인정보(전화·회사 메일·설정·알림·세션·푸시) 정리 시각
alter table users add column if not exists purged_at timestamptz;
