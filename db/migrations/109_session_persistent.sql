-- 로컬 10/19(대표) 자동 로그인: 웹 '로그인 유지'(30일 갱신형) / 끄면 브라우저 세션 쿠키 + 1일, 갱신 없음. 앱은 항상 유지
alter table sessions add column if not exists persistent boolean not null default true;
