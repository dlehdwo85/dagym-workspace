# 마케팅 고객 게시 경로 설계 (상용화 ⑤) — 2026-10-18 초안

> 상태: **설계 초안 · 코드 없음.** 외부 플랫폼 정책·권한 이름·할당량은 제출 직전 공식 문서로 다시 확인한다(아래 "확인 필요" 표시).
> 원칙: 게시는 **승인된 버전만**, 사람이 마지막 [게시]를 누른다(자동 게시는 회사 설정으로 켜는 선택 기능, 기본 꺼짐). 시험 콘텐츠(is_test)는 게시 불가. 실패하면 **이미 올라갔는지 먼저 확인한 뒤에만** 다시 시도한다(운영실 SNS 게시 정책과 같음).

## 0. 공통 구조(워크인)

| 항목 | 설계 |
|---|---|
| 연결 계정 | `mkt_publish_accounts` (tenant, provider = meta_ig·meta_fb·youtube·naver_blog, external_id, label, brand_id, token_enc(AES-GCM, crypto.ts), scopes, expires_at, status, last_error) — 회사 관리자만 연결·해제 |
| 게시 작업 | `mkt_publish_jobs` (content_id, version, account_id, status = queued·running·verify·done·failed·canceled, idempotency_key = content_id:version:account_id, external_post_id, permalink, attempts, last_error, requested_by) — 같은 키는 한 번만 |
| 게시 흐름 | 승인된 버전 → [게시](관리자) → job queued → tick 이 실행 → 성공이면 `markPublished`(게시 주소 자동 기록) / 시간 초과·모호한 오류면 **verify**(최근 게시물에서 같은 캡션·미디어를 찾아 확인) → 없을 때만 1회 재시도 |
| 토큰 | 만료 전 tick 이 갱신. 갱신 실패 → 계정 status=error + 받는 사람 알림(하루 1번) |
| 권한 | 게시·계정 연결 = 회사 관리자. 직원은 결과만 봄. 다른 회사 계정·작업은 404 |
| 감사 | 연결·해제·게시 요청·재시도는 audit_logs |
| 데이터 삭제 | 계정 해제 시 토큰 즉시 삭제, 회사 탈퇴 시 전부 삭제(플랫폼 데이터 삭제 콜백도 같은 함수) |

## 1. Meta (Instagram·Facebook 페이지) — 심사가 가장 오래 걸리므로 먼저

**방식**: 고객 회사가 자기 Facebook 계정으로 OAuth 로그인 → 관리하는 페이지·연결된 Instagram 비즈니스(프로페셔널) 계정 선택 → 워크인 서버가 Graph API 로 게시.
- Instagram: 미디어 컨테이너 생성(`/{ig-user-id}/media`, image_url·caption) → 게시(`/{ig-user-id}/media_publish`). 여러 장은 carousel, 릴스는 media_type=REELS(영상 URL은 공개 접근 가능해야 함 → 워크인 저장소의 짧은 서명 URL).
- Facebook 페이지: `/{page-id}/photos` 또는 `/feed` (페이지 액세스 토큰).
- 게시 한도: Instagram 계정당 24시간 게시 수 제한 있음(확인 필요 — `content_publishing_limit` 으로 조회 가능).

**필요 권한(확인 필요 — 제출 직전 Meta 문서로 확정)**: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`, (페이지 게시 시) `pages_manage_posts`, 비즈니스 자산 접근 시 `business_management`.

**앱 심사 준비물(지금 만들 수 있는 것부터)**
1. 개인정보 처리방침·서비스 약관 공개 URL(워크인 /legal 에 있음 — Meta 데이터 사용 문구 추가 필요)
2. 데이터 삭제 콜백 URL 또는 삭제 안내 페이지(`/api/marketing/publish/meta/data-deletion` 설계)
3. 앱 아이콘·이름·카테고리, 앱 도메인(work-in.dev), OAuth 리디렉션 URI(`/api/marketing/publish/meta/callback`)
4. **권한별 사용 설명 + 화면 녹화(screencast)**: 연결 → 페이지·IG 계정 선택 → 승인된 콘텐츠 [게시] → 인스타그램에 올라간 결과 확인 → 연결 해제. 시험 계정(검수자용 로그인 정보)은 심사 양식에만 입력하고 저장소에는 두지 않는다.
5. 비즈니스 인증(Business Verification) — 대표 진행(사업자 정보 필요)
6. 앱을 Live 모드로 전환하기 전까지는 앱 역할(개발자·테스터)에 등록된 계정만 연결 가능 → 우리 회사 계정으로 먼저 실연동 시험

**대표 결정 필요**: Meta 앱을 새로 만들지(워크인 전용) / 운영실 기존 앱을 옮길지, 비즈니스 인증 주체.

## 2. YouTube (쇼츠·영상)

- YouTube Data API v3 `videos.insert`(재개 가능한 업로드), OAuth 범위 `https://www.googleapis.com/auth/youtube.upload`.
- **확인 필요**: Google 감사(API 서비스 감사)를 통과하기 전 미인증 프로젝트로 올린 영상은 비공개로 고정됨 → 감사 신청 자료(용도·화면 녹화) 준비.
- 할당량: 기본 하루 10,000 단위, 업로드 1건 약 1,600 단위(확인 필요) → 하루 약 6건. 회사가 늘면 할당량 증설 신청.
- OAuth 동의 화면 검증(민감 범위) 필요 — 개인정보처리방침·도메인 소유 확인.
- 기존 Google 캘린더 동기화와 **별도 OAuth 클라이언트**로 분리(범위 최소화, 캘린더 동기화는 선택 기능이라 영향 없게).

## 3. 네이버 블로그 — 공식 쓰기 API 없음 → 게시 도우미

- 공식 글쓰기 API 가 없으므로(확인 필요 — 예전 API 종료) 서버 자동 게시는 하지 않는다. 브라우저 자동화·비공식 API 는 **약관 위반·계정 제재 위험**이라 쓰지 않는다.
- **게시 도우미**: 승인된 원고를 [제목 복사]·[본문 복사(네이버 편집기에 맞는 서식)]·[사진 한꺼번에 내려받기(순서 번호)]·[네이버 블로그 글쓰기 열기] 버튼으로 제공 → 사람이 붙여 넣고 올린 뒤 **게시 주소를 붙여 넣어 게시 확인**(지금의 markPublished 와 같음).
- 화면에 위험 고지: "네이버는 자동 게시를 허용하지 않아 직접 올립니다. 같은 글을 여러 블로그에 반복 게시하면 저품질 판정 위험이 있습니다."

## 4. 단계 제안

| 단계 | 내용 | 외부 의존 |
|---|---|---|
| 5-1 | 공통 구조(표 2개·job·verify·감사) + 네이버 게시 도우미 | 없음 — 바로 가능 |
| 5-2 | Meta 연결·게시(개발 모드, 우리 회사 계정으로 실연동) + 심사 녹화·제출 | Meta 앱·비즈니스 인증(대표) |
| 5-3 | YouTube 업로드(비공개 시험) + 감사 신청 | Google Cloud 프로젝트·동의 화면 검증 |
| 5-4 | 회사별 자동 게시(선택, 기본 꺼짐): 승인된 칸이 게시 시각이 되면 job 생성 | 5-2·5-3 심사 통과 후 |

시험 기록 원칙: 가짜 서버(가짜 Graph API·가짜 YouTube)로 통과한 시험은 "구조 시험"으로만 기록하고, 실연동 완료는 실제 계정 게시 확인 후에만 적는다.
