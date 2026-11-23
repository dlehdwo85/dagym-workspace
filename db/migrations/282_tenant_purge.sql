-- 상용화 B4(대표 위임 11/24, docs/research/TENANT_DELETE_EXPORT_2026-11-24.md): 회사 영구 삭제 = 실제 파기.
-- tenants.purge = 파기 진행 상태({state: queued|rows|files|done, rows: {표: 지운 줄}, files: 지운 파일 수, errors: [...]}) — 정기 실행이 이어서 처리.
-- tenant_purge_files = 회사 자료를 지우기 전에 모아 둔 파일 저장소 열쇠(회사 경로 밖에 있는 첨부 등) — 다 지우면 비워짐. 추가형.
alter table tenants add column if not exists purge jsonb;
create table if not exists tenant_purge_files (
  tenant text not null,
  key text not null,
  primary key (tenant, key)
);
