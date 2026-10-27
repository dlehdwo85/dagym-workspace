# 실 결제 상점 전환 절차 (2026-10-28 · 로컬 192차 확인 후속)

로컬 확인(10/28 02:45): 플랫폼 운영 › 결제 시험 상태 상자에 '운영 결제: 시험 상점 — 고객 결제도 실제로 청구되지 않습니다'. 판매 전에 실 상점으로 바꿔야 한다.
**운영 환경 변경이므로 대표 승인 뒤 로컬이 한다. 값(상점 번호·키)은 이 문서·저장소·대화에 쓰지 않는다 — 대표가 Vercel 에 붙여넣는다.**

## 한 줄

Vercel Production 에 실 상점 키 4개(`NICEPAY_PAY_MID`·`NICEPAY_PAY_KEY`·`NICEPAY_BILL_MID`·`NICEPAY_BILL_KEY`)가 있는지 확인 → Production 에 `NICEPAY_API_BASE` 가 **없는지** 확인 → `NICEPAY_MODE=live` 를 Production 에만 추가 → 다시 배포 → 상태 상자 '운영 결제: 실 상점 — 실제로 청구됩니다' 확인 → [실결제 100원 시험](1시간 뒤 자동 취소) 1번 → 되돌리기는 `NICEPAY_MODE` 를 지우고 다시 배포.

## 순서(자세히)

| 순서 | 할 일 | 이름 | 비고 |
|---|---|---|---|
| 1 | 결제창 상점 키 확인 | `NICEPAY_PAY_MID` · `NICEPAY_PAY_KEY` | 예전 이름 `NICEPAY_MID` · `NICEPAY_MERCHANT_KEY` 도 읽지만 새 이름을 쓴다 |
| 2 | 정기결제(빌링) 상점 키 확인 | `NICEPAY_BILL_MID` · `NICEPAY_BILL_KEY` | 예전 이름 `NICEPAY_BILLING_MID` · `NICEPAY_BILLING_KEY`. 넷 중 하나라도 없으면 결제 칸이 닫힌다 |
| 3 | 시험용 주소가 없는지 확인 | `NICEPAY_API_BASE` | 가짜 시험 서버 주소용 — Production 에 있으면 실 결제가 엉뚱한 곳으로 간다 |
| 4 | 실 상점으로 전환 | `NICEPAY_MODE=live` | **이것 하나로 전환**. live 가 아니면 모든 회사 결제가 공개 시험 상점(또는 `NICEPAY_TEST_*`)으로 간다 |
| 5 | 다시 배포 | — | 환경변수는 다시 배포해야 반영 |
| 6 | 확인 | — | 플랫폼 운영 › 결제 시험: 상태 상자 '실 상점', [실결제 100원 시험](운영자·하루 3번·1시간 뒤 자동 취소)으로 승인·취소 확인 |
| 7 | 되돌리기 | `NICEPAY_MODE` 삭제 | 다시 배포하면 시험 상점으로 돌아감 |

- 결제 시험 회사(플랫폼 › 결제 시험)는 live 여도 늘 시험 상점을 쓴다(실 상점 번호·키를 쓰지 않음).
- 간편결제 `NICEPAY_EASY_PAY` 는 대표 결정 전에는 넣지 않는다(기본 꺼짐).
- 확인 못함(클라우드): 운영 Vercel 에 위 키가 실제로 들어 있는지 — 클라우드는 운영 설정을 읽지 않는다.
