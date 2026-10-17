# 워크인 → 마케팅 운영실 SSO (V41 단계 4-1, F-6)

워크인 쪽은 배포됨. 운영실 쪽(마케팅 세션 담당)은 아래만 붙이면 됩니다. 비밀값은 저장소에 쓰지 않고 두 Vercel 프로젝트 env 에 **같은 값**으로 넣습니다.

## env
| 프로젝트 | 이름 | 값 |
|---|---|---|
| 워크인(dagym-workspace) | `MARKETING_SSO_SECRET` | 32자 이상 임의 문자열(대표가 생성·입력) |
| 워크인 | `MARKETING_SSO_URL` | 운영실 SSO 받는 주소. 기본 `https://dazim-hilink-integration.vercel.app/api/sso/workin` |
| 운영실 | `WORKIN_SSO_SECRET` | 위와 같은 값 |
| 운영실 | `WORKIN_URL` | `https://dagym-workspace.vercel.app` (또는 www.work-in.dev) |

`MARKETING_SSO_SECRET` 이 없으면 워크인 마케팅 공간 버튼은 예전처럼 운영실 주소를 엽니다(비밀번호 로그인).

## 흐름
1. 워크인 마케팅 공간 [마케팅 운영실 열기] → `GET /api/sso/marketing` (로그인·마케팅 공간 권한 필요, 없으면 404)
2. 워크인이 1회용 토큰을 만들어 `302 → MARKETING_SSO_URL?token=<token>`
   - 토큰 = `base64url(JSON 클레임).base64url(HMAC-SHA256(secret, 앞부분))`
   - 클레임: `iss:"workin"`, `aud:"marketing"`, `jti`, `sub`(워크인 사용자 id), `email`, `name`, `role`, `tenant`, `iat`, `exp`(= iat+60초)
3. 운영실 `/api/sso/workin` 은 **서버에서** 워크인에 확인 요청:
   ```
   POST {WORKIN_URL}/api/sso/marketing/verify
   headers: content-type: application/json, x-sso-secret: {WORKIN_SSO_SECRET}
   body: {"token": "<token>"}
   ```
   - 200 → `{ user: { id, email, name, role }, tenant, spaces }` → 운영실 세션 쿠키 발급 후 운영실 첫 화면으로.
   - 401(서명·만료·이미 씀·권한 없음) / 403(비밀값 틀림) → 로그인 실패 화면.
   - 같은 토큰은 **한 번만** 통과(jti 를 워크인 DB 에 기록). 운영실이 직접 HMAC 을 검사해도 되지만, 1회 사용 보장은 이 확인 호출로 합니다.
4. 운영실 공용 비밀번호는 SSO 로 들어가는 것을 대표가 확인한 뒤 폐지(F-6).

## 주의
- 토큰은 주소에 실려 가므로 운영실은 받자마자 확인하고 `history.replaceState`/리다이렉트로 주소에서 지웁니다(로그·리퍼러 노출 방지).
- `role`: owner·admin·manager·staff 등 워크인 역할 그대로. 운영실 권한 매핑은 운영실에서.
- 시험: 워크인 `tests/api/sso.test.mjs`(발급·302·위조 401·두 번째 401·만료 401·비밀값 틀림 403·미배정 404).
