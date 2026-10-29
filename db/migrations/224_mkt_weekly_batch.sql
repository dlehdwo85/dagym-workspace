-- 267차(대표 #795 10/29 18:45 "승인을 올릴 때 두서없이 올리지 말고 수정 및 보완할 수 있는 시간까지 고려해서 올려주세요 —
-- 일주일에 3번 올라가면 주 단위로만 올리거나 3일 전부터 올려서 검수 후 게시될 수 있도록"): 승인 올리는 방식 + 승인 마감 며칠 전. 추가만.
--  approval_mode: weekly = 주 단위 묶음(batch_dow 요일 batch_hour 시에 다음 주 월~일 게시분을 한 번에 승인함에) / lead = 게시 lead_days 일 전 lead_hour 시에 한 건씩(예전)
--  deadline_days: 승인 마감 = 게시 deadline_days 일 전 approval_hour:00(0 = 게시 당일 — 예전)
alter table mkt_settings add column if not exists approval_mode text not null default 'lead' check (approval_mode in ('weekly', 'lead'));
alter table mkt_settings add column if not exists batch_dow int not null default 4 check (batch_dow between 0 and 6);       -- 0=일 … 6=토 (기본 목)
alter table mkt_settings add column if not exists batch_hour int not null default 10 check (batch_hour between 0 and 23);
alter table mkt_settings add column if not exists deadline_days int not null default 0 check (deadline_days between 0 and 7);
-- 올린 묶음(회사·주 월요일) — 한 번 올린 주의 늦은 원고는 바로 승인함으로
create table if not exists mkt_batches (
  tenant text not null references tenants(id) on delete cascade,
  week date not null,
  released_at timestamptz not null default now(),
  n int not null default 0,
  primary key (tenant, week)
);
-- 지금 자동 제작 규칙을 쓰는 회사(마감을 바꾼 적 없는 곳): 주 단위 묶음(목 10:00) + 승인 마감 게시 전날 18:00 — 규칙이 없는 회사·새 회사는 예전 방식 그대로(설정 화면에서 고름)
update mkt_settings set approval_mode = 'weekly', deadline_days = 1, approval_hour = 18 where approval_hour = 9 and deadline_days = 0 and tenant in (select distinct tenant from mkt_rules);
-- 그 회사의 아직 만들지 않은 자동 칸: 원고 만드는 때 = 그 주 묶음(앞 주 목 10:00) 4시간 전, 이미 지났으면 지금(다음 정기 실행이 한 번에 만들어 묶음으로 올림)
update mkt_contents c set produce_at = greatest(now(), (date_trunc('week', c.scheduled_at at time zone 'Asia/Seoul') - interval '4 days' + interval '6 hours') at time zone 'Asia/Seoul')
  where c.auto and c.status = 'draft' and c.produced_at is null and c.produce_at is not null and c.scheduled_at is not null
    and c.tenant in (select tenant from mkt_settings where approval_mode = 'weekly' and batch_dow = 4 and batch_hour = 10);
