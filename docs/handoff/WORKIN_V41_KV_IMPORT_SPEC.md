# 마케팅 운영실 → 워크인 데이터 이관: 내보내기 API 사양 (사본, 데이터 없음)

원본: dlehdwo85/dazim-hilink-integration main d611c91 docs/marketing/OPS_EXPORT_API_SPEC.md (마케팅 세션 작성). 대표 승인(2026-10-18 워크인 대화): 운영실 데이터 이관 승인. 운영실 쪽 구현·배포는 마케팅 세션이 대표 직접 확인 후 진행.

워크인(클라우드) 할 일: 가져오기 작업 — 회사 지정·멱등·미리보기 후 적용·건수/SHA 대조. env: OPS_EXPORT_URL(운영실 주소), OPS_EXPORT_TOKEN(대표 입력, 운영실과 같은 값). mkt:call-records:v1 은 전화번호 개인정보 → 워크인 저장 시 권한(마케팅 공간 관리자)·보관기간 정책 적용.

---

# 운영실 데이터 내보내기 API — 사양 (초안, 미구현)

2026-10-18 · 목적: 워크인 V41 4-2 운영실 KV 데이터 이관 (워크인 저장소가 공개라 파일로 옮기지 않음).
상태: **사양만.** 구현·배포는 이 저장소 세션에서 대표 직접 승인 후. 쓰기 동결·운영실 읽기 전용 전환 시점은 워크인 가져오기 준비가 끝난 뒤 대표가 다시 확인.

## 1. 주소
| 메서드 | 경로 | 내용 |
|---|---|---|
| GET | `/api/marketing/export/manifest` | 내보낼 키 목록 · 키별 건수 · 바이트 · 해시(SHA-256) · 생성 시각 |
| GET | `/api/marketing/export?key=<키>&cursor=<n>` | 키 하나의 내용. 목록형은 500건씩 페이지 |

- GET 만. POST·PUT·DELETE 는 405. 응답에 `Cache-Control: no-store`.
- Preview 배포에서는 404 (Preview 가 운영 KV 를 공유하므로 운영 도메인에서만 응답).

## 2. 인증 (서버 간 전용)
- 전용 비밀값 `OPS_EXPORT_TOKEN` (Worker 비밀값과 별개). 값은 대표가 운영실·워크인 Vercel 에 직접 입력 — 채팅·저장소에 쓰지 않음.
- 요청 헤더:
  - `X-Export-Ts`: 유닉스 초. 서버 시각과 ±300초 밖이면 401.
  - `X-Export-Sig`: `hex(HMAC-SHA256(OPS_EXPORT_TOKEN, "<Ts>\n<경로+쿼리>"))`.
- 같은 서명 재사용 거절(KV 에 5분 기록). 실패는 감사 로그에 남김(값 없이).
- 브라우저 CORS 없음 (Access-Control-* 헤더를 내지 않음).

## 3. 응답 JSON
manifest:
```json
{ "ok": true, "generatedAt": "2026-10-18T01:00:00.000Z", "frozen": false,
  "keys": [ { "key": "mkt:posts:v1", "kind": "list", "count": 312, "bytes": 845120, "sha256": "…" } ] }
```
export:
```json
{ "ok": true, "key": "mkt:posts:v1", "kind": "list", "total": 312, "cursor": 0, "next": 500,
  "items": [ … ], "sha256": "<이 키 전체의 해시 — manifest 와 같아야 함>" }
```
- `kind`: `list`(JSON 배열) · `object`(JSON 객체) · `string`.
- `next` 가 null 이면 끝. 가져오는 쪽은 건수·해시를 manifest 와 대조.
- `frozen`: 쓰기 동결 중이면 true (동결 전 복사는 연습용으로만).

## 4. 내보내는 키 (V41 F-4)
| 구분 | 키 |
|---|---|
| 일일 결정 | `mkt:daily:decisions:v1` |
| 수정 요청 | `mkt:revisions:v1` |
| 요청 | `mkt:requests:v1` |
| 게시물 | `mkt:posts:v1` |
| 일정 | `mkt:schedule:v1` |
| 제작 | `mkt:production:v1` · `mkt:media-outputs:v1` · `mkt:media-approval:v1` · `mkt:media:v1` |
| 광고 | `mkt:ads:structure-decision:v1` · `mkt:ads:apply-log:v1` |
| 전화 문의 | `mkt:call-records:v1` (**개인정보 — 전화번호 포함**) · `mkt:call-clicks:v1` |
| 자료실 | `mkt:library:v1` (파일 자체는 Blob 주소로만, 파일 복사 없음) |
| 대표 처리 | `mkt:owner:actions:done:v1` |
| 계획 상태 | `mkt:plan-state:v1` · `mkt:plan:active:v1` · `mkt:approvals:dynamic:v1` |

## 5. 내보내지 않는 키
- `test:` 접두사, `mkt:daily:fixture:v1`
- 잠금·일회성: `mkt:publish-lock:*` · `mkt:ads:apply-lock:v1` · `mkt:requests:lock:*` · `mkt:exec:claim:*` · `mkt:loginfail:*`
- TTL 업로드·임시: `mkt:draft:*` · `mkt:ads:apply-preview:v1`
- 비밀·접근: `mkt:access:v1` · `mkt:meta:pages:v1`(페이지 토큰 포함)
- 운영 로그: `mkt:navlog` · `mkt:clientlog:v1` · `mkt:routine:*` · `mkt:search:health:*` · `mkt:publish-sweep:v1` · `mkt:daily-ops:v1`
- 실행 Job(`mkt:exec:*`): 이관 시점에 진행 중 Job 이 0 이어야 하므로 내보내지 않음 — 필요하면 별도 결정.

## 6. 전환 순서
1. 가져오기 연습: 동결 없이 manifest·export 로 복사 → 건수·해시 대조.
2. 대표 확인 → 쓰기 동결(`frozen: true`, 운영실 쓰기 API 423).
3. 최종 복사 → 건수·해시 대조 → 워크인 쪽 전환.
4. 운영실 읽기 전용 유지. 문제 시 동결 해제로 되돌림 (데이터 삭제 없음).
