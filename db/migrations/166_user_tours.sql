-- #77(대표 10/16) 처음 사용 안내(코치마크 투어): 사람별·화면별 1번 — 본 기록은 서버(기기가 바뀌어도 다시 안 뜸)
create table if not exists user_tours (
  user_id uuid not null references users(id) on delete cascade,
  tour_id text not null check (tour_id ~ '^[a-z][a-z0-9_-]{0,39}$'),
  seen_at timestamptz not null default now(),
  primary key (user_id, tour_id)
);
-- 이미 써 본 사람(로그인한 적 있음)은 '처음'이 지났으므로 자동으로 띄우지 않는다 — 도움말·프로필 메뉴 [사용 안내 다시 보기]로 볼 수 있음
insert into user_tours (user_id, tour_id)
  select u.id, t.id from users u cross join (values ('home'), ('tasks'), ('calendar'), ('messages'), ('library'), ('assistant'), ('task')) as t(id)
  where u.last_login_at is not null
on conflict do nothing;
