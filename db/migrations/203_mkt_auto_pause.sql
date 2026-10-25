-- 대표 10/25 22:20 결정 15-16(지시서 docs/handoff/MARKETING_REWORK_2026-10-25.md §3-7 2, 로컬 23:10 요청 B):
-- 마케팅실 전면 디벨롭 동안 자동 생성(정기 칸 만들기·제작·밤사이 비서·주간 계획·운영 제안 카드)을 멈춘다 — 대표가 방향을 승인하면 운영실 설정에서 끈다.
-- 사람이 직접 누르는 [지금 만들기]·[승인 요청]·수정 요청 반영은 그대로.
alter table mkt_settings add column if not exists auto_pause boolean not null default false;
-- 지금 자동 생성이 도는 회사(규칙이 있는 곳)는 켠 상태로 시작 — 설정 줄이 없는 회사도 줄을 만들어 켠다
update mkt_settings set auto_pause = true where tenant in (select distinct tenant from mkt_rules);
insert into mkt_settings (tenant, auto_pause)
  select distinct r.tenant, true from mkt_rules r where not exists (select 1 from mkt_settings s where s.tenant = r.tenant)
  on conflict (tenant) do update set auto_pause = true;
