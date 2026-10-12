# 운영 안내 (배포·환경·비용·백업·장애 대응)

## 1. 구성
| 구성 요소 | 선택 | 이유 |
|---|---|---|
| 웹·API | Next.js 15 (App Router) on **Vercel**, 리전 icn1(서울) | 기존 다짐·하이링크 서비스와 같은 방식이라 대표가 이미 쓰는 Vercel 계정을 재사용합니다 |
| DB | PostgreSQL (Neon 또는 Supabase, 서울·도쿄 리전 권장) | 표준 SQL이라 백업·복원이 쉽습니다. `prepare:false`로 커넥션 풀러와 호환됩니다 |
| 파일 | S3 호환 저장소 (Cloudflare R2 권장) | 서버가 권한을 확인한 뒤 120초짜리 서명 URL을 발급합니다. 업로드는 서명된 PUT으로 받습니다 |
| 정기 실행 | GitHub Actions `tick.yml`, 10분 주기, OIDC 인증(비밀값 없음) | 기존 ops-scheduler 방식을 재사용합니다. 대표 PC가 꺼져도 동작하고, 공개 저장소는 무료입니다 |
| 보조 정기 실행 | Vercel Cron 하루 1회 (`vercel.json`) | GitHub 장애에 대비한 안전망입니다 |
| 웹 푸시 | VAPID (web-push) | PC·Android 크롬, iOS 홈 화면 웹앱 |
| 앱 푸시 | Firebase Cloud Messaging HTTP v1 | Android·iOS 공통 |

## 2. 환경 구분
- **개발**: 로컬 PostgreSQL + `.env.local`. 파일은 로컬 디스크(`.data/uploads`)에 저장합니다.
- **검수(Preview)**: Vercel Preview 배포. 운영 DB와 **다른** `DATABASE_URL`(Neon 브랜치 등)을 Preview 환경에만 지정해야 합니다.
- **운영(Production)**: `main` 브랜치에서 Vercel Production으로 배포합니다.

## 3. 환경 변수 (값은 Vercel에만 저장하고, 저장소에는 넣지 않습니다)
| 이름 | 필수 | 설명 |
|---|---|---|
| DATABASE_URL | ✅ | PostgreSQL 연결 문자열 (풀러 주소 권장) |
| APP_URL | ✅ | 운영 주소, 예: https://dagym-workspace.vercel.app |
| APP_SECRET | ✅ | 32자 이상 임의 문자열 (토큰 서명·암호화). (선택 기능 Google 동기화를 켠 경우, 바꾸면 Google 연결을 다시 해야 합니다) |
| SETUP_SECRET | 최초 1회 | `/setup`에서 대표 계정을 만들 때 쓰고, 만든 뒤에는 지웁니다 |
| CRON_SECRET | ✅ | Vercel Cron 인증용 (Vercel이 자동으로 Bearer 헤더에 넣어 보냅니다) |
| SCHEDULER_REPO | — | 기본값 `dlehdwo85/dagym-workspace` (OIDC 토큰 검증) |
| S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY | ✅ 운영 | 파일 저장소. 버킷 CORS에 운영 주소의 PUT을 허용해야 합니다 |
| VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT | 권장 | `npx web-push generate-vapid-keys` |
| FCM_SERVICE_ACCOUNT_JSON | 앱 푸시 | Firebase 서비스 계정 JSON 한 줄 |
| FEATURE_GOOGLE_SYNC, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET | ❌ 선택 기능 | 기본 꺼짐. 켤 때만 `1` + OAuth 클라이언트(리디렉션 URI `{APP_URL}/api/google/callback`) |
| ANDROID_CERT_SHA256, APPLE_TEAM_ID | 앱 링크 | 앱 서명 후 |
| PRIVACY_CONTACT, COMPANY_NAME | 권장 | 개인정보처리방침 표시 |

DB 스키마는 `npm run db:migrate`(=`node scripts/migrate.mjs`)로 적용하고, 이미 적용된 파일은 건너뜁니다. 배포 전에 반드시 실행하세요.

## 4. 배포 절차와 복구 경로
1. 기능 브랜치를 푸시하면 CI(타입 검사 → 빌드 → API 시험 49건 → 브라우저 E2E 18건)가 돌고, Vercel Preview가 만들어집니다.
2. 마이그레이션 파일이 바뀌었으면 **운영 DB 백업**(`backup.yml` 수동 실행)을 먼저 하고, `DATABASE_URL=<운영> npm run db:migrate`를 실행합니다. 마이그레이션은 추가형으로만 작성합니다.
3. `main`에 병합하면 Vercel Production이 배포됩니다. `/api/health`의 `commit` 값이 새 커밋인지 확인합니다.
4. **되돌리기**: Vercel → Deployments에서 이전 배포의 "Promote to Production"을 누르면 즉시 되돌아갑니다. DB를 되돌려야 하면 아래 5번의 복원 절차를 따릅니다.

## 5. 백업·복원
- 자동: `backup.yml`이 매일 03:20(KST)에 `pg_dump`로 백업을 떠서 AES-256-GCM으로 암호화한 뒤 S3 호환 저장소 `db-backups/`에 올립니다. 매주 토요일(UTC)과 수동 실행 때는 임시 DB에 **실제로 복원**해 건수를 비교합니다.
- 필요한 GitHub Secrets: `PROD_DATABASE_URL`, `BACKUP_PASSPHRASE`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `BACKUP_S3_BUCKET`
- 수동 복원: `RESTORE_DATABASE_URL=<대상> BACKUP_PASSPHRASE=... node scripts/restore.mjs <파일|db-backups/키>`. 운영 DB를 덮어쓰려면 `CONFIRM_OVERWRITE=yes`까지 지정해야 합니다. 새 DB에 복원한 뒤 `DATABASE_URL`을 바꾸는 방식을 권장합니다.
- 파일: 첨부는 화면에서 삭제해도 저장소 객체를 지우지 않고 DB에 삭제 표시만 합니다. 그래서 DB를 복원하면 파일 참조도 함께 살아납니다. R2 버킷 삭제 권한은 대표만 갖도록 합니다.
- 복원 시험 기록: TEST_REPORT.md "백업·복원" 항목

## 6. 감시와 장애 대응
| 신호 | 위치 | 대응 |
|---|---|---|
| 헬스체크 실패 | `tick.yml`이 10분마다 `/api/health`를 확인하고, 실패하면 GitHub가 저장소 소유자에게 메일을 보냅니다 | Vercel 상태와 DB 상태를 확인합니다 |
| 정기 실행 지연 | 관리자 → 운영 상태의 "스케줄러 N분 전 실행", `/api/health`의 `scheduler.healthy` | Actions 탭에서 `tick`을 수동 실행합니다 |
| 오류 | 관리자 → 운영 상태의 오류 기록(`error_logs`) | |
| 푸시 실패 | 운영 상태의 푸시 발송 통계. 실패분은 2·4·8·16분 간격으로 최대 5회 다시 보내고, 무효 토큰은 자동으로 비활성화합니다 | |
| (선택) Google 동기화 | 3회 연속 실패하면 사용자에게 알림을 보냅니다. 운영 상태와 사용자 설정 화면에 이력이 남습니다 | 사용자가 "지금 동기화" 또는 "다시 연결"을 누릅니다 |
| 서버 재시작·네트워크 장애 | 정기 작업은 잠금(job_locks)으로 중복 실행을 막고, 모든 생성 요청은 Idempotency-Key로 중복을 막습니다 | 조치 불필요 (E2E ⑨ 검증) |

## 7. 월 운영비 예상 (2026-10 기준, 세부 근거는 docs/research/PLATFORM_REQUIREMENTS.md)
| 항목 | 금액 | 청구 방식 | 비고 |
|---|---|---|---|
| Vercel Pro | $20/월 (1명) | 매월 자동 | Hobby 요금제는 상업적 사용이 금지되어 있습니다 |
| PostgreSQL | $0 (Neon/Supabase 무료) → 필요 시 $19~25/월 | 매월 | 무료 요금제는 용량·PITR 제한이 있어, 자체 일일 백업으로 보완합니다 |
| Cloudflare R2 | 10GB 까지 $0, 이후 $0.015/GB·월 | 사용량 | |
| GitHub Actions | $0 | — | 공개 저장소 기준. **비공개로 바꾸면** 10분 주기 정기 실행이 무료 2,000분을 넘으므로 주기를 30분으로 늘리거나 유료가 됩니다 |
| Firebase FCM | $0 | — | |
| Apple Developer | $99/년 | 매년 자동 | iOS 앱 |
| Google Play | $25 | 1회 | Android 앱 |
| **합계(최소)** | **약 $20/월 + $99/년 + $25(1회)** | | 약 3만 원/월 + 연 14만 원 |

실제 비용은 Vercel → Settings → Billing / Usage, Neon·Supabase → Billing, Cloudflare → R2 → Metrics, App Store Connect·Play Console 결제 내역에서 확인합니다.

## 8. 보안 메모
- 비밀번호는 scrypt 해시로 저장합니다. 같은 이메일로 15분 안에 10번 실패하면 잠깁니다.
- 세션 쿠키는 httpOnly·SameSite=Lax·Secure이고, 변경 요청은 Origin을 검사해 CSRF를 막습니다.
- 권한은 모든 API·첨부 다운로드·검색·알림 생성에서 서버가 확인합니다. 다른 현장 데이터는 존재 여부도 숨깁니다(404).
- 저장소가 **공개(public)** 상태입니다. 비밀값은 들어 있지 않지만 회사 코드가 공개되어 있으니 비공개 전환 여부를 정해 주세요(7번의 Actions 비용 메모 참고).

## 9. 배포 직후 점검과 앱 업로드
- 점검: `node scripts/verify-prod.mjs https://<운영주소>`를 실행합니다(헬스·정기 실행·S3·보안 헤더·권한 차단·개인정보처리방침·앱 링크). 점검 계정으로 로그인까지 확인하려면 `SMOKE_EMAIL`·`SMOKE_PASSWORD`를 함께 줍니다.
- 앱 업로드: GitHub Actions → `release` → 버전을 입력하고 실행합니다. Secrets가 없으면 "설정 대기" 경고를 남기고 끝납니다. 필요한 Secrets 목록은 `.github/workflows/release.yml` 맨 위에 있습니다.
