-- #948(대표 11/04 '앱·웹 속도 정기 검침'): ① 30분마다 핵심 API·로그인 화면 응답 시간을 서버가 스스로 재어 기록(perf_probes)
-- ② 실제 사용자의 화면 첫 표시·목록 표시 시간(웹·앱 구분)을 하루 단위 히스토그램으로 모아 p75 를 냄(perf_screens — 사람·회사·브라우저 식별값 없음)
-- ③ 기준(API 1.5초·화면 3초)을 2번 연속 넘으면 플랫폼 운영자 알림(notifications.type = perf_alert) ④ 주간 요약 메일 1통(perf_weekly 로 같은 주 중복 방지)
create table if not exists perf_probes (
  id bigserial primary key,
  at timestamptz not null default now(),
  round int not null,                 -- 같은 검침 묶음 번호(분 단위)
  target text not null,               -- health · login · tasks · hub · bids · approvals · messages (src/lib/perf.ts PERF_TARGETS)
  ms int not null,                    -- 응답까지 걸린 시간(본문까지 다 받은 시각)
  status int not null default 0,      -- HTTP 상태(0 = 응답 없음·시간 초과)
  ok boolean not null default true    -- 200~399
);
create index if not exists perf_probes_target_at on perf_probes (target, at desc);
create index if not exists perf_probes_at on perf_probes (at);

create table if not exists perf_screens (
  day date not null,                  -- 서울 날짜
  client text not null,               -- web · app
  screen text not null,               -- 화면 이름(주소 꼴, id 는 :id 로 바꿈 — /tasks/:id)
  metric text not null,               -- first(첫 표시) · list(목록·자료까지 표시)
  n int not null default 0,
  sum_ms bigint not null default 0,
  max_ms int not null default 0,
  h int[] not null default array_fill(0, array[16]), -- 히스토그램(경계 src/lib/perf.ts PERF_BUCKETS)
  primary key (day, client, screen, metric)
);

create table if not exists perf_weekly (
  week date primary key,              -- 월요일
  sent_at timestamptz not null default now(),
  recipients int not null default 0
);
