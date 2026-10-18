-- 로컬 검수(10/18): 크레딧 원장에 기록 당시 콘텐츠 제목을 남김(다시 만들기로 제목이 바뀌어도 예전 줄은 그때 제목). 예전 줄은 빈칸 → 화면에서 지금 제목으로
alter table mkt_credit_ledger add column if not exists title text;
