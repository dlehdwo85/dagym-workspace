-- #1141(대표 11/24 '완료한 입찰 업무의 일정이 캘린더에 남음'): 입찰 넘기기로 만든 일정 ↔ 입찰 업무 연결 (추가형)
-- hide_when_done = 이 일정에 연결된 업무가 모두 끝나면 캘린더·홈에서 숨김('완료 보기'를 켜면 취소선으로 보임)
alter table event_tasks add column if not exists hide_when_done boolean not null default false;

-- 이미 만든 입찰 일정 되살리기: sales_work_records.data.bid_events({일정 종류: 일정 id}) ↔ data.bid_task_id(업무 id) — 같은 회사 일정·업무만
-- #1144(대표 11/24): '입찰 마감'(close, 없으면 '참가신청 마감' apply) 일정 하나는 날짜 맞춤(sync) — 일정을 옮기면 업무 마감도, 업무 마감을 바꾸면 일정도.
--   현장설명회·개찰 등 나머지는 연결만(sync 아님)
with recs as (
  select w.tenant,
    case when (w.data->>'bid_task_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (w.data->>'bid_task_id')::uuid end as task_id,
    case when jsonb_typeof(w.data->'bid_events') = 'object' then w.data->'bid_events' else '{}'::jsonb end as evs
  from sales_work_records w
  where w.data ? 'bid_task_id'
), pairs as (
  select r.tenant, r.task_id, v.key,
    case when v.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v.value::uuid end as event_id,
    (v.key = 'close' or (v.key = 'apply' and not (r.evs ? 'close'))) as sync
  from recs r cross join lateral jsonb_each_text(r.evs) v
  where r.task_id is not null
)
insert into event_tasks (event_id, task_id, role, sync, hide_when_done)
select distinct on (p.event_id, p.task_id) p.event_id, p.task_id, 'link', p.sync, true
from pairs p
join events e on e.id = p.event_id
join calendars c on c.id = e.calendar_id and c.tenant = p.tenant
join tasks t on t.id = p.task_id
join users cu on cu.id = t.created_by and cu.tenant = p.tenant
where p.event_id is not null
order by p.event_id, p.task_id, p.sync desc
on conflict (event_id, task_id) do update set hide_when_done = true, sync = event_tasks.sync or excluded.sync;
