-- 359차(대표 11/04 저녁 결정 #965): 승인제 가입 — 공개 가입(이메일·소셜)으로 생긴 회사는 '승인 대기'.
-- 슈퍼관리자가 플랫폼 운영 › 가입 신청에서 [승인]해야 쓰기·초대가 열리고 14일 체험이 그때부터 시작된다. [거절]하면 사유와 함께 막힘.
-- 기존 회사(default·demo·플랫폼에서 만든 회사)는 모두 'approved'(기본값) — 외부 가입 회사는 11/04 기준 0곳.
alter table tenants add column if not exists signup_status text not null default 'approved';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_signup_status_check') then
    alter table tenants add constraint tenants_signup_status_check check (signup_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;
alter table tenants add column if not exists signup_info jsonb;                 -- 신청 정보: 회사·이름·연락처·인원·업종·유입(utm)·가입 경로(email·google·kakao·naver·apple)
alter table tenants add column if not exists signup_decided_at timestamptz;     -- 승인·거절한 때
alter table tenants add column if not exists signup_decided_by uuid references users(id) on delete set null;
alter table tenants add column if not exists signup_reason text;                -- 거절 사유(신청자에게 보임)
alter table tenants add column if not exists signup_notified_at timestamptz;    -- 슈퍼관리자에게 새 신청을 알린 때(한 번만)
create index if not exists tenants_signup_pending_idx on tenants (created_at) where signup_status = 'pending';
