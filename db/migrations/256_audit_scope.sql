-- 407차 범용화(대표 11/14 결정 '가안'): 감사 기록을 회사별로 본다.
--   다짐 회사 화면 = 다짐 계정의 기록만 · 다른 회사 = 자기 회사 기록만 · 다른 회사 기록과 플랫폼 운영 행위 = 플랫폼 운영 화면(대표 계정 전용)에서만
-- audit_logs.tenant = 이 기록이 보일 회사. null = 어느 회사 화면에도 안 보임(플랫폼 운영 화면에만).
alter table audit_logs add column if not exists tenant text;

-- 규칙(쓰기·과거 기록 채우기가 같은 함수를 쓴다):
--  ① 플랫폼 운영 행위(platform.* · 지원 모드 접속) → null
--  ② 행위자가 있으면 행위자의 회사. 단, 다룬 대상(회사·사람·detail.tenant)이 다른 회사면 운영 행위로 보고 null
--  ③ 행위자가 없으면: 대상이 사람 → 그 사람의 회사 · 대상이 회사 → 그 회사 · detail.tenant → 그 회사 · 현장 매출(revenue.*) → 기본 회사 · 그 밖(누구 것인지 알 수 없음) → null
create or replace function audit_scope(p_actor uuid, p_action text, p_target_type text, p_target_id text, p_detail jsonb) returns text
language plpgsql stable as $$
declare a text; t text; dt text;
begin
  if p_action like 'platform.%' or p_action in ('support.request', 'support.start', 'support.end') then return null; end if;
  dt := nullif(p_detail->>'tenant', '');
  if dt is not null and not exists (select 1 from tenants where id = dt) then dt := null; end if;
  if p_target_type = 'tenant' and p_target_id is not null then
    select id into t from tenants where id = p_target_id;
  elsif p_target_type = 'user' and p_target_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    select tenant into t from users where id = p_target_id::uuid;
  end if;
  t := coalesce(t, dt);
  if p_actor is not null then
    select tenant into a from users where id = p_actor;
    if a is null then return null; end if;
    if t is not null and t <> a then return null; end if;
    return a;
  end if;
  if t is not null then return t; end if;
  if p_action like 'revenue.%' then return 'default'; end if;
  return null;
end $$;

create or replace function audit_logs_scope_trg() returns trigger language plpgsql as $$
begin
  if new.tenant is null then new.tenant := audit_scope(new.actor_id, new.action, new.target_type, new.target_id, new.detail); end if;
  return new;
end $$;
drop trigger if exists audit_logs_scope on audit_logs;
create trigger audit_logs_scope before insert on audit_logs for each row execute function audit_logs_scope_trg();

-- 과거 기록도 같은 규칙으로
update audit_logs set tenant = audit_scope(actor_id, action, target_type, target_id, detail) where tenant is null;
create index if not exists audit_logs_tenant_id on audit_logs (tenant, id desc);
