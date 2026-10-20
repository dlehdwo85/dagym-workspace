-- 대표 10/20 오후 7) 사용자 관리 — 퇴사 처리 / 계정 인수인계: 퇴사일·처리자·복직 가능 기한(30일)·인수인계 받은 사람. 상태 'left' 는 001 부터 있음(로그인·세션·알림·라이선스 인원 제외는 status 로 이미 막힘)
alter table users add column if not exists left_at date;
alter table users add column if not exists left_by uuid references users(id) on delete set null;
alter table users add column if not exists rejoin_until date;
alter table users add column if not exists handover_to uuid references users(id) on delete set null;
