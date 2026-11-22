-- #1121(대표 11/22): 직원 계정 하나에 같은 SNS 는 한 계정만(카카오 계정 2개 연결 막기). 화면·서버에서도 막고, DB 에도 한 번 더.
-- 이미 같은 사람·같은 SNS 가 2개 이상 들어간 줄이 있으면 색인을 만들지 않고 넘어감(배포가 멈추지 않게) — 서버 검사가 새 중복은 막음.
do $$
begin
  if not exists (select 1 from user_identities group by user_id, provider having count(*) > 1) then
    create unique index if not exists user_identities_user_provider on user_identities(user_id, provider);
  end if;
end $$;
