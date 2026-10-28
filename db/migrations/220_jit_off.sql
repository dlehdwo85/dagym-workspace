-- 238차(#742 대표 10/28 '화면 전환이 느림'): 이 앱이 쓰는 DB 역할의 Postgres JIT(질의 컴파일)를 끈다.
-- 업무 건수 칩·업무 목록·홈 요약처럼 하위 질의가 많은 큰 SQL 은 예상 비용이 커서 JIT 가 켜지는데, 시험 DB 측정에서
-- 실행 5ms 짜리 질의가 컴파일에만 1.3초를 썼다(/api/tasks/counts 1.2초 → 44ms, /api/projects 0.43초 → 24ms, /api/dashboard 0.61초 → 40ms).
-- 결과는 같고 실행 방식만 다르다. 새 접속부터 적용. 되돌리기: alter role current_user reset jit;
-- 권한이 없는 환경이면 알림만 남기고 넘어간다(배포를 막지 않음) — 적용 여부는 /api/health 의 dbJit 로 확인
do $$
begin
  execute 'alter role current_user set jit = off';
exception when others then
  raise notice 'jit off 를 적용하지 못했습니다: %', sqlerrm;
end $$;
