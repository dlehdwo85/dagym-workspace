-- #1128(대표 11/23 '올리는 건 자유롭게 하되 최대 용량을 정할 수 있으면'): 파일 한 개 최대 크기(MB) — 회사 관리자가 50·200·1024·2048 중에서.
-- 비어 있으면 2048(플랫폼 최대 2GB, 영상 포함 같은 값). 회사 전체 저장 한도(요금제 storageGb)는 그대로. 추가형.
alter table tenants add column if not exists file_max_mb int;
