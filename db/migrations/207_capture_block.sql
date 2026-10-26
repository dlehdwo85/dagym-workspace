-- #626 화면 캡처 차단(대표 10/25 20:05, docs/research/CAPTURE_BLOCK_DESIGN_2026-10-25.md): 회사별 스위치 — null/true = 기본 규칙(우리 회사·체험·슈퍼관리자는 허용, 외부 고객사는 차단), false = 플랫폼 운영이 끔(사유는 capture_note·감사 기록)
alter table tenants add column if not exists capture_block boolean;
alter table tenants add column if not exists capture_note text;
