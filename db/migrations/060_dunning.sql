-- V28 부록 B2 미납 처리(던닝): 결제 실패 → 3·7일 재시도 → 7일 미납 읽기 전용 → 30일 미납 이용 중지(로그인 시 결제 안내만) → 결제하면 즉시 복구. 데이터는 지우지 않음. 추가형.
alter table tenant_subscriptions add column if not exists billing_lock text check (billing_lock is null or billing_lock in ('read_only', 'suspended'));
alter table tenant_subscriptions add column if not exists billing_grace_until timestamptz;   -- 플랫폼 운영자가 준 유예(이 시각까지 잠그지 않음)
