-- V14 28번: 검토 요청이 오면 지시자에게 "[검토] 원 업무" 업무를 자동으로 — 원 업무당 하나(다시 요청하면 다시 연다). 추가형.
alter table tasks add column if not exists review_of uuid references tasks(id) on delete set null;
create unique index if not exists tasks_review_of_uq on tasks(review_of) where review_of is not null;
