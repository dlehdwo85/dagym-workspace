# 업무·일정 관리 (COMPANY-WORK-OS)

주식회사 다짐 · 하이링크 · BODY LAB 임직원 전용 업무·일정 관리 서비스. 웹(PC·모바일)과 Android·iOS 앱이 같은 계정·데이터를 씁니다.

- 요구사항·완료 기준: [REQUIREMENTS.md](REQUIREMENTS.md)
- 현재 상태: [WORK_STATUS.md](WORK_STATUS.md) · 다음 작업: [NEXT_ACTION.md](NEXT_ACTION.md) · 시험: [TEST_REPORT.md](TEST_REPORT.md)
- 운영(배포·비용·백업): [docs/OPERATIONS.md](docs/OPERATIONS.md) · 앱 배포: [docs/APP_RELEASE.md](docs/APP_RELEASE.md)
- 안내서: [직원용](docs/GUIDE_STAFF.md) · [관리자용](docs/GUIDE_ADMIN.md)
- 조사: [docs/research](docs/research)

```bash
npm ci && cp .env.example .env.local && npm run db:migrate && npm run dev
```
