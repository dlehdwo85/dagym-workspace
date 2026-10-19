# 운영실 이관 자료 → 워크인 마케팅 화면 매핑 (2026-10-19 초안)

> 상태:
> - 운영실 KV 19개 키는 회사별로 `ops_import_items` 에 원본 그대로 옮겼다(10/19 운영 적용 19/19). 자료실 1건은 이미 옮겼다.
> - 이번 단계에서는 원본을 볼 수 있는 화면만 만들었다: 마케팅 › 설정 › **운영실 기록**(관리자). 키별 건수, 칸 구조(이름·채워진 수·종류, 값 없음), 원본 표를 50건씩 보여 준다.
> - 정식 표 변환(아래 3절)은 **운영 데이터의 실제 칸 이름을 확인한 뒤** 한다. 칸 구조 API 로 확인한다: `GET /api/marketing/imported?view=fields`(관리자, 값은 내보내지 않음).
> - 원칙:
>   - 변환은 추가형으로 한다. 원본(ops_import_items)은 지우지 않는다.
>   - 같은 원본 항목은 한 번만 변환한다. 변환 행에 `src_key`·`src_idx` 를 남긴다.
>   - 변환한 콘텐츠는 승인 흐름에 다시 들어가지 않는다. 상태를 그대로 옮기고, 시험 데이터가 아니라 '이관' 표시를 붙인다.

## 1. 키별로 보여 줄 자리(제안)

| 운영실 키 | 이름 | 워크인 자리 | 변환 대상 표 |
|---|---|---|---|
| mkt:posts:v1 (28) | 게시물 | 콘텐츠 캘린더 · 게시됨 | mkt_contents(status=published, published_url, published_at) + mkt_publish_jobs(provider=manual, '이관') |
| mkt:schedule:v1 | 게시 일정 | 콘텐츠 캘린더 · 예정 | mkt_contents(scheduled_at, status=approved/pending) |
| mkt:requests:v1 (43) | 제작 요청 | 승인 대기 · 콘텐츠 | mkt_production_requests(요청) → 시안이 있으면 mkt_contents(status 매핑), 요청 메모는 첫 버전 note |
| mkt:production:v1 | 제작 진행 | 콘텐츠 상태 | 위 콘텐츠의 상태·담당 |
| mkt:revisions:v1 | 수정 이력 | 콘텐츠 버전 | mkt_versions(version 순서) |
| mkt:daily:decisions:v1 · mkt:media-approval:v1 · mkt:owner:actions:done:v1 · mkt:approvals:dynamic:v1 | 결정·승인 기록 | 콘텐츠 상세 › 결정 기록 | mkt_decisions(approve/changes/hold, 결정한 사람 = 대표) |
| mkt:media:v1 · mkt:media-outputs:v1 · mkt:library:v1 | 미디어 | 자료실(마케팅 폴더) | library_files(파일이 있는 것만), 콘텐츠 버전의 media_ids 연결 |
| mkt:call-records:v1 (번호 가림) | 전화 기록 | 전화 문의 | mkt_calls(phone=가린 번호, source='운영실 이관') |
| mkt:call-clicks:v1 · first-seen | 전화 버튼 클릭 | 월간 보고 · 전화 문의 지표 | 집계만 옮김(일자별 클릭 수) — 새 표 또는 mkt_report 원천 |
| mkt:ads:structure-decision:v1 · mkt:ads:apply-log:v1 | 광고 결정·반영 기록 | 광고 운영(V44) 변경 기록 | V44 의 mkt_ad_changes(status=applied, '이관') — V44 표가 생긴 뒤 |
| mkt:plan-state:v1 · mkt:plan:active:v1 | 계획 | 자동 제작 설정 | 브랜드·규칙 참고용으로 보여 주기만(자동 변환 안 함 — 설정은 사람이 다시 확인) |

## 2. 순서

1. (완료) 운영실 기록 화면과 칸 구조 API.
2. 로컬이 운영 화면의 칸 구조(키별 칸 이름·채워진 수)를 전달한다. 값은 보내지 않는다.
3. 클라우드가 키별 변환 함수를 만든다. 순서: 게시물 → 요청 → 일정 → 결정 → 전화 기록.
   - 플랫폼 관리 '운영실 이관'에 [미리보기 변환](건수·매핑 결과 표) → [변환 적용] 버튼을 둔다.
   - 같은 항목을 다시 적용해도 중복되지 않는다.
4. 운영에서 미리보기를 확인한 뒤 적용한다. 콘텐츠 캘린더에 게시물 28건과 요청 43건이 보이는지 검수한다.

## 3. 상태 매핑(칸 이름 확인 후 확정)

- 운영실 상태 → 워크인
  - 게시됨·published → published
  - 승인·approved → approved
  - 대기·검토·pending → pending
  - 수정 요청 → changes
  - 보류 → hold
  - 취소·삭제 → canceled
- 모르는 값은 pending 으로 넣고 원본 상태를 note 에 남긴다.
- 채널: instagram·facebook·blog(네이버)·youtube·threads, 그 밖은 other.
- 날짜는 Asia/Seoul 기준으로 해석한다(시각이 없으면 10:00).

## 4. 변환 구현(2026-10-19, 로컬이 보낸 운영 칸 구조 기준)

- 화면: 마케팅 › 설정 › 운영실 기록 › **워크인 화면으로 옮기기**. [미리보기]는 아무것도 쓰지 않고 다음을 보여 준다.
  - 건수
  - 원본 상태 값 → 워크인 상태 매핑표
  - 채널별 건수
  - 확인이 필요한 브랜드 코드
  - 표본 8건
- [옮기기]를 누르면 만든다. 같은 원본은 `mkt_contents (tenant, src_key, src_ref)` 고유 조건으로 한 번만 만든다(100 마이그레이션). 알림은 보내지 않는다.
- posts(28) → 콘텐츠:
  - 채널은 channels[0] 기준이고, 나머지 채널은 버전 메모에 적는다.
  - 본문 = instagramCaption(페이스북이면 facebookText) + hashtags.
  - 게시 주소는 results 안의 첫 permalink/url.
  - 캘린더 날짜는 게시일 또는 만든 날.
  - assetIds 는 개수만 메모에 남긴다(원본 화면에서 확인).
- daily:decisions(42 항목) → 콘텐츠:
  - 제목 '10/15 하이링크 피드'. 브랜드 코드는 hl=하이링크, dg=다짐이고, **그 밖의 코드(bl 등)는 대문자 그대로 — 확인 필요**.
  - 종류 → 채널: feed·photo·collage·reels → 인스타그램, blog → 블로그, shorts → 유튜브.
  - history[] 와 production.history·decisions(itemId 같은 것)을 결정 기록(승인·수정 요청·보류)으로 옮긴다.
  - url 이 있으면 게시 주소로 쓴다.
- requests(43) → `mkt_ops_requests` → 승인 대기 화면 아래 '이전 요청 기록(운영실)'(접힘). 마케팅 공간 사람이면 누구나 본다.
- revisions(35)·approvals:dynamic·ads:apply-log·plan·schedule·media 는 원본 화면에서만 본다(전후 값이 콘텐츠 버전과 1:1 이 아님). ads:apply-log 는 V44 변경 기록 표가 생긴 뒤 옮길지 정한다.
- 상태 매핑(원본 값 문자열 기준):
  - publish/posted/live/done/complete → 게시됨
  - approv/confirm/ok/schedul/ready → 승인
  - change/revis/reject → 수정 요청
  - hold/pause → 보류
  - cancel/delet/archiv/skip → 취소
  - draft → 초안
  - 그 밖은 승인 대기
  - **운영에서 미리보기 매핑표를 확인한 뒤 옮길 것**
