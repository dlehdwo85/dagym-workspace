# 워크인 Meta 앱 만들기 — 담당 직원용 안내 (2026-10-19)

대표 계정이 Meta 보호 조치로 개발자 등록이 막혀, 오래 쓴 Facebook 계정을 가진 직원이 대신 만든다.
비밀값(앱 시크릿)은 이 문서·저장소·단체방에 적지 않는다. 대표에게만 따로 전달 → 대표가 Vercel 에 직접 입력.

## 1. 개발자 등록 (본인 휴대폰, 10분)
1. 휴대폰 **Facebook 앱** → 개인 프로필 상태인지 확인(페이지로 전환돼 있으면 개인으로 바꾸기)
2. 메신저에서 나에게 `https://developers.facebook.com/async/registration/` 보내고, 그 링크를 앱 안에서 열기
3. 이메일 코드 입력 → 역할은 "개발자" 선택 → 완료
   - "평소 사용하지 않는 기기" 창이 뜨면 더 시도하지 말고 알려 주기

## 2. 앱 만들기 (PC 권장 — 평소 Facebook 쓰는 브라우저)
1. https://developers.facebook.com/apps → [앱 만들기]
2. 앱 이름: **워크인 (WorkIn)** · 연락 이메일: 회사 공용 메일
3. 사용 사례: "Instagram·Facebook 콘텐츠 게시/관리" 계열 선택(화면 문구는 Meta 개편에 따라 다를 수 있음 — 막히면 화면 캡처)
4. 비즈니스 포트폴리오: 하이링크(없으면 "나중에")
5. 만들어진 뒤 **앱 설정 → 기본 설정**에서 **앱 ID** 를 로컬(Claude)에게, **앱 시크릿 코드** 는 대표에게만 전달

## 3. 그 다음 (로컬·대표)
- 대표 보호 조치가 풀리면 대표를 앱 관리자로 추가 → 소유권 이전
- 리디렉션 URI·개인정보처리방침·데이터 삭제 URL·권한(인스타 게시·페이지 관리·스레드)·비즈니스 인증(하이링크)·앱 심사 제출은 로컬이 안내
- 대표가 Vercel(dagym-workspace) 에 META_APP_ID·META_APP_SECRET 입력 → 재배포

## 4. 진행 기록
- 2026-10-19 김소담 부사장 계정으로 개발자 등록·앱 생성 완료. 앱 ID 1116805710803016 (공개값) → 워크인 Vercel META_APP_ID 입력(로컬). META_APP_SECRET 은 대표 입력 대기.
- 김소담 부사장이 앱 대시보드에 넣을 값:
  - 앱 설정 › 기본 설정: 앱 도메인 `work-in.dev` · 개인정보처리방침 URL `https://www.work-in.dev/privacy` · 사용자 데이터 삭제 → 콜백 `https://www.work-in.dev/api/marketing/publish/meta/data-deletion` · 카테고리 "비즈니스 및 페이지"
  - 로그인 설정(Facebook 로그인 for Business/Instagram) › 유효한 OAuth 리디렉션 URI `https://www.work-in.dev/api/marketing/publish/callback/meta`
  - 이용 사례 추가: Threads API
  - 앱 역할 › 역할: 대표 계정 보호 조치가 풀리면 관리자로 추가
