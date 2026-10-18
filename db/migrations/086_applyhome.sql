-- V41 단계 3: 청약홈 분양정보(15098547) 신규단지 수집기 — 영업관리 세션에서 이식(업종 중립 수집, 회사별 필터는 데이터 설정).
-- prospects.detail: 원천별 핵심 칸 정리본(공급 세대·시행사·시공사·입주 예정월·접수·발표·계약 등). raw 는 원본 그대로.
alter table prospects add column if not exists detail jsonb;
update data_sources set endpoint = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1'
  where code = '15098547' and endpoint is null;
