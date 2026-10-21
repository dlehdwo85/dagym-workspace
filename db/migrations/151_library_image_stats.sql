-- 대표 10/21 12:20 피드 일관성 신호: 이미지 톤 통계(밝기·채도·색온도·구도)를 파일마다 한 번만 계산해 보관 — 운영실·운영 검토가 다시 읽기만 한다.
alter table library_files add column if not exists image_stats jsonb;
