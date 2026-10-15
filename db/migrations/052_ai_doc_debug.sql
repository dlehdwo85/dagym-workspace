-- V22 운영 실패 진단: 문서 작업 단계별 기록(stop_reason·블록 종류·찾은 파일 수·마지막 글 앞부분·컨테이너) — 비밀값 없음
alter table ai_doc_jobs add column if not exists debug jsonb;
