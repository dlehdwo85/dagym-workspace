# 알림 자동 발송 점검 결과·수정 요청 (2026-10-13 16:50, 로컬)

대표 질문: "업무가 배정되거나 마감이 다가올 때 담당자에게 알림이 자동으로 가는가?"

## 점검 결과 (운영 1c3e0e2 기준, 코드·health·Vercel·Actions 확인)
| 경우 | 앱 안 알림(종) | 휴대폰 푸시 |
|---|---|---|
| 새 업무 만들며 배정 | 즉시 | 즉시 (`api/tasks/route.ts` → `after(dispatchPending)`) |
| 기존 업무 담당자 변경(PATCH) | 즉시 | **정기 실행(tick) 때까지 대기** — `api/tasks/[id]` 에 `dispatchPending` 없음 |
| 마감 임박(24시간 전)·오늘 마감·기한 지남(09시) | **tick 이 돌아야 생성** | 〃 |

- **정기 실행이 사실상 멈춤**: health `scheduler.healthy=false`, 마지막 tick 03:53Z(4시간 전). GitHub Actions `tick.yml` 10분 예약은 GitHub 가 대부분 건너뜀(오늘 예약 실행 2회뿐).
- **Vercel Cron(매일 00:00 UTC = 09:00 KST)은 401로 실패 중으로 판단**: Vercel 환경 변수에 `CRON_SECRET` 이 없음(이름 목록 확인) → `api/cron/tick` 인증 불가.

## 요청 (클라우드)
1. 업무 수정 API(`PATCH /api/tasks/[id]`, reorder 로 담당자 바뀌는 경우, 댓글·검토 요청 등 notify 하는 모든 쓰기)에 `after(() => dispatchPending())` 추가.
2. **요청 편승 정기 실행**: 로그인 사용자의 API 요청 시 마지막 tick 이 10분 넘었으면 `after()` 로 `runTick('piggyback')` (DB advisory lock 으로 중복 방지). 직원이 하루 한 번이라도 앱을 열면 09시 알림·임박 알림이 나감.
3. Vercel Cron 인증: `CRON_SECRET` 이 있으면 지금처럼, 대표가 Vercel 에 `CRON_SECRET` 을 넣으면 매일 09시 확정 실행(로컬이 대표 승인 받아 등록 안내).
4. 운영 상태 화면에 "마지막 정기 실행 n분 전 / 원인(GitHub·Vercel·편승)" 표시.
- 시험: 담당자 변경 직후 deliveries 가 pending 으로 남지 않음, 편승 tick 1회만 실행.
