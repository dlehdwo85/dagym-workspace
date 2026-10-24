-- #543 영업 공고 [원문] 404(로컬 10/24): 차세대 나라장터는 옛 입찰공고 주소(…/ep/invitation/publish/bidInfoDtl.do?bidno=…&bidseq=…)가
-- '요청하신 페이지를 찾을수 없습니다' → 저장된 원천 줄의 주소를 새 형식 …/link/PNPE027_01/single/?bidPbancNo=…&bidPbancOrd=… 로(로컬이 새 형식 정상 확인).
-- 수집기·화면·당일 메일도 새 형식을 쓴다(src/lib/sales/sourceLink.ts). 데이터만 고치고 칸은 그대로(추가형).
update sales_src_rows
set row = jsonb_set(row, '{source_url}', to_jsonb(
      'https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=' || (regexp_match(row->>'source_url', '[?&]bidno=([^&#]+)', 'i'))[1]
      || '&bidPbancOrd=' || coalesce((regexp_match(row->>'source_url', '[?&]bidseq=([^&#]+)', 'i'))[1], '000')))
where row->>'source_url' ~* '^https?://(www\.)?g2b\.go\.kr(:[0-9]+)?/ep/invitation/publish/bidInfoDtl\.do\?'
  and row->>'source_url' ~* '[?&]bidno=[^&#]+';
