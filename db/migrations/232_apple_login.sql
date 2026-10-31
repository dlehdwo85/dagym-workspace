-- 299차 #858(대표 10/31 '애플로 로그인 개발 진행해주세요'): Apple로 로그인
-- 제공자 허용값에 apple 더하기(넓히기만) · Apple 토큰(계정 삭제 때 해지에 씀 — App Store 5.1.1(v))은 암호화해 보관
alter table user_identities drop constraint if exists user_identities_provider_check;
alter table user_identities add constraint user_identities_provider_check check (provider in ('google', 'kakao', 'naver', 'apple'));
alter table user_identities add column if not exists secret text;
alter table oauth_pending add column if not exists secret text;
