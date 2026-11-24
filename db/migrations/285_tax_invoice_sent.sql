-- #1163 ⑤(대표 11/24 D-20): 세금계산서 상태 '요청 → 발행 → 보냄' — 보낸 때(sent_at)만 더한다(추가형).
-- 상태 칸(status)은 그대로 requested·issued·canceled, '보냄' = issued 이고 sent_at 이 있음. 운영자가 바꾸고 감사 기록(tax_invoice.mark). 자동 발행은 하지 않는다.
alter table tax_invoice_requests add column if not exists sent_at timestamptz;
