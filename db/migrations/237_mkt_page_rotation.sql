-- 312차 #867(대표 11/01 '페이지별로 홍보 목표를 정해서', docs/handoff/PAGE_GOALS_867 §2): 브랜드 '페이지별 주제' —
-- 주마다 한 페이지를 돌아가며 그 페이지 주제로 글을 쓰고, 글 끝에 그 페이지 링크(+utm)를 붙임. [{key, url, topics[]}], 비어 있으면 예전처럼 주제 풀.
alter table mkt_brands add column if not exists page_rotation jsonb not null default '[]'::jsonb;

-- 워크인 브랜드(기본 회사)만 처음 값: 업무관리 → 마케팅 자동화 → 입찰 수집 → 전자결재 → 협업(주마다 한 페이지).
-- 주제는 각 소개 페이지에 적힌 운영 기능에서만 뽑음. 이미 값이 있으면 건드리지 않음(브랜드 키트에서 고침).
update mkt_brands set page_rotation = '[
  {"key":"task-management","url":"https://www.work-in.dev/landing/task-management","topics":["한 줄로 업무 등록하고 담당·마감까지 한 번에","마감 전에 휴대폰으로 받는 알림과 검토 요청","매주 월요일 자동으로 모이는 주간 보고 초안"]},
  {"key":"marketing-automation","url":"https://www.work-in.dev/landing/marketing-automation","topics":["브랜드 키트 하나로 매주 게시물 시안 받기","승인함에서 승인만 하면 인스타그램·페이스북 예약 게시","메타 광고는 일시정지 초안까지, 집행은 승인 뒤"]},
  {"key":"bid-collection","url":"https://www.work-in.dev/landing/bid-collection","topics":["공공·아파트 입찰 공고를 매일 아침 한 번에","공고문 첨부에서 참가자격 바로 확인","고른 공고를 담당·마감이 든 업무로 넘기기"]},
  {"key":"e-approval","url":"https://www.work-in.dev/landing/e-approval","topics":["휴가·지출 결재를 휴대폰 알림에서 바로","팀·양식마다 정해 둔 결재선으로 한 번에 올리기","승인된 휴가가 연차 캘린더에 자동 등록"]},
  {"key":"collaboration","url":"https://www.work-in.dev/landing/collaboration","topics":["대화에서 바로 업무·일정 만들기","공지 읽음 현황 확인하고 다시 알림","자료실 문서를 여러 사람이 함께 고치기"]}
]'::jsonb
where tenant = 'default' and page_rotation = '[]'::jsonb and lower(regexp_replace(name, '\s', '', 'g')) in ('워크인', 'workin');
