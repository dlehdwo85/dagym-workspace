-- 로컬 검수(2026-10-17) 정리 중 잘못 소프트 삭제한 자료실 자동 저장 사본 1건 복구. 원 업무 첨부·저장 파일은 그대로였음.
-- 대상: 업무 첨부 자동 저장(source = task_attach) 사본 중 그 제목, 10/16 이후에 지워진 것만. 데이터 정정(추가형, 지우지 않음).
update library_files set deleted_at = null
 where title = '하이링크_개인정보처리기준_책임체계_안내' and source = 'task_attach'
   and deleted_at is not null and deleted_at >= '2026-10-16';
