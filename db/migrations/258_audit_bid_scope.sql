-- 407차 후속(노트북 11/14 확인: 행위자 없는 '입찰 결과 자동 반영' 4건이 회사 미상으로 들어감):
-- 새 기록은 detail.tenant 로 그 회사 기록이 되지만(407차 코드), 과거 기록에는 회사 표시가 없다.
-- → 그 공고를 진행 기록으로 가진 회사가 한 곳뿐이면 그 회사의 기록으로 옮긴다(둘 이상이면 그대로 플랫폼 운영 화면에만).
update audit_logs a set tenant = x.tenant
from (
  select coalesce(w.ref_id, w.data->>'notice_id') as nid, min(w.tenant) as tenant
  from sales_work_records w
  where coalesce(w.ref_id, w.data->>'notice_id') is not null
  group by 1 having count(distinct w.tenant) = 1
) x
where a.action = 'sales.bid_result' and a.actor_id is null and a.tenant is null and a.target_id = x.nid;
