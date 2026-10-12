# 디자인 시스템 (2026-10-13, UIUX_REVIEW 대응)

모든 화면은 아래 토큰과 공통 부품만 씁니다. 새 화면을 만들 때 색·글꼴·아이콘을 따로 정하지 않습니다.

## 글꼴
- **Pretendard Variable** (npm `pretendard`, dynamic subset — 화면에 쓰인 글자 범위만 내려받음, 외부 CDN 없음). `src/app/layout.tsx` 에서 CSS 포함.
- Windows 에서도 맑은 고딕이 아니라 Pretendard 로 보입니다(E2E 가 `document.fonts.check` 로 확인).
- 숫자는 `tabular-nums`. 크기: 11(2xs)·12·13·14(본문)·16·20·24·30.

## 색 (`tailwind.config.ts`, CSS 변수는 `globals.css :root`)
| 토큰 | 값 | 용도 |
|---|---|---|
| brand | #1F3A5F (50~800) | 주요 버튼, 사이드바(800), 선택 상태 |
| accent | #3B82F6 | 링크, 포커스 테두리, 오늘 표시 |
| canvas / surface / line | #F7F8FA / #FFF / #E5E7EB | 배경 / 카드 / 경계 |
| ink / ink-2 / ink-3 | #111827 / #4B5563 / #9CA3AF | 본문 / 보조 / 흐린 글자 |
| 상태 | 예정 slate · 진행 blue · 검토 amber · 보류 zinc · 완료 emerald · 지연 red | `STATUS_TONE` — 배지·보드 열 머리·타임라인 막대·도넛 |
| 우선순위 | 긴급 red · 높음 orange · 낮음 slate (보통은 표시 안 함) | `PriorityTag` 깃발 |
| 브랜드 | 다짐 orange · 하이링크 blue · BODY LAB emerald | `BRAND_TONE` |
| 사람 | 이름 해시 → 8색 | `Avatar` |

모서리: 카드 12px(`rounded-card`), 입력 8px(`rounded-input`). 그림자: `shadow-card`, 떠 있는 패널 `shadow-pop`.

## 아이콘
`lucide-react` 하나만 사용합니다. 글자 기호(☑ ☰ ▦)와 컬러 이모지(🔔 💬 📎)는 쓰지 않습니다.

## 공통 부품 (`src/components/ui.tsx`)
Button(primary·secondary·ghost·danger·accent) · IconButton(aria-label 필수) · Card · Kbd · Field · inputCls · Modal(모바일은 아래에서 올라오는 시트) · Toast(되돌리기 등 동작 버튼) · StatusBadge · PriorityTag · BrandDot · Avatar/AvatarStack · **DueChip**(오늘 파랑, 지남 빨강+며칠, 3일 이내 주황) · Skeleton · Empty(아이콘+설명+다음 행동) · ErrorBox · PageHeader

## 틀
- 데스크톱: 왼쪽 사이드바(접기, 즐겨찾는 프로젝트, 현장 운영·관리자 묶음) + **상단 바**(검색 Ctrl K · + 만들기(업무·일정·프로젝트) · 알림 · 계정 메뉴)
- 모바일: 상단 바(검색·계정) + **하단 탭 5개(홈·내 업무·[+]·캘린더·알림)**, + 는 탭 바 가운데
- 단축키: Ctrl K 검색, N 새 업무, ? 도움말, G→H/M/C 이동, 목록 ↑↓ Enter, Esc 닫기
