# 로컬 작업 기록 (로컬 Claude Code 담당 파일)

> 이 파일은 **로컬 세션만** 수정합니다(클라우드는 읽기만). 비밀값·토큰·비밀번호는 쓰지 않습니다.
> 형식: 날짜 · PC · 브랜치 · 한 일 · 결과/링크 · 다음

## 진행 기록
- (예) 2026-10-14 · DESKTOP-HQKVDIC · local/ops-setup · L-1 Vercel Import 완료 · 운영 주소 https://… · L-2 진행 예정
- 2026-10-13 · BOOK-29S4OTOLT7 · local/ops-setup · 로컬 도구 점검, Windows 에서 운영 빌드 실행·화면 검수, Google Calendar 로그인 화면 검수(읽기 전용) · 결과 [LOCAL_REVIEW.md](LOCAL_REVIEW.md), 캡처 `local-screens/` · 다음: Asana 로그인 후 L-11 마무리, 이어서 L-1(Vercel) 시작은 대표 결정·결제 필요

## 클라우드 요청 (로컬이 적고 클라우드가 처리)
근거와 재현은 [LOCAL_REVIEW.md](LOCAL_REVIEW.md) 3·4절.
- [R-1 높음] `scripts/migrate.mjs` Windows 경로 오류 — `fileURLToPath(import.meta.url)` 로 교체. 안 고치면 HANDOFF L-2 를 Windows 에서 실행할 수 없음
- [R-2 중간] 댓글 멘션 선택 시 입력창에 `@[이름](uuid)` 원문 노출 → 이름만 보이게
- [R-3 낮음] 멘션 목록에 업무를 볼 수 없는 사람이 나옴(서버는 알림을 조용히 제외) → 목록 필터 또는 안내 문구
- [R-4 낮음] 첨부 크기 1MB 미만이 "0.0MB" → KB 표시
- [R-5 낮음] 체크리스트 "추가" 버튼이 두 줄로 깨짐 → `whitespace-nowrap`
- [R-6 제안] 일정별 알림(기본값은 사용자 설정, 일정마다 덮어쓰기·여러 개) — Google Calendar 는 일정마다 여러 알림
- [R-7 제안] 반복 일정 종료 조건(종료일·횟수)과 "매월 N번째 ○요일" — API 는 RRULE 을 받으므로 화면만 추가
- [R-8 참고] 자동 시험이 Linux 전용 경로(`/tmp/claude-0`, `node_modules/.bin/next`, openssl)를 써서 Windows 에서 못 돎. 필수 아님 — 원하면 `os.tmpdir()`·`process.execPath`+`next/dist/bin/next` 로 바꾸면 로컬에서도 회귀 시험 가능

## 클라우드 회신 (클라우드는 이 파일 대신 NEXT_ACTION.md 의 "로컬 요청 처리" 절에 답합니다)
