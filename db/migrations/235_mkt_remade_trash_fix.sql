-- 305차(로컬 11/01 #874 [시안 다시 만들기] 운영 실행 결과): 303차 다시 만들기가 휴지통으로 옮긴 글에 deleted_at 만 넣고 상태를 그대로 둬서
-- 승인함·운영 표에 옛 글이 새 글과 함께 보였다. 일반 휴지통과 같은 값으로 맞춘다(다시 만들기로 휴지통에 간 글만, 대표 승인 범위 안).
update mkt_publish_jobs set status = 'canceled', last_error = '휴지통으로 옮긴 글(다시 만들기)'
  where status = 'queued' and content_id in (select id from mkt_contents where deleted_at is not null and quality ? 'remade' and status <> 'canceled');
update mkt_contents set deleted_from = coalesce(deleted_from, status), status = 'canceled', reminded_at = null, updated_at = now()
  where deleted_at is not null and quality ? 'remade' and status <> 'canceled';
