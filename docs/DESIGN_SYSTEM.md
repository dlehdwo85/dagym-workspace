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
- 상태 표시(첨부·장소·기밀·일정 등록·판정 등)도 아이콘으로 — 메신저 이모지 고르기·업무 반응·화상회의 손들기만 이모지(#1113).

## AI 표시 (#1113, 대표 11/22 'AI 티 없애기')
- 반짝이(Sparkles)·마술봉(Wand)·로봇(Bot) 아이콘과 AI 전용 보라색을 쓰지 않습니다.
- AI 를 쓰는 기능은 `AiMark`(작은 'AI' 글자, 글자색을 따라감) 하나로 표시하고, 단추 글자는 하는 일로 씁니다(예: '✨ AI 초안' → '초안 쓰기' + AI 표식). 글자에 이미 'AI'가 있으면 표식을 덧붙이지 않습니다.
- AI 비서 단추·메뉴 아이콘은 `MessageSquareText`(대화)로 통일합니다.

## 모서리·그림자·움직임 (#1113)
- 모서리는 `rounded-card`(12px)·`rounded-input`(8px)·둥근 칩 `rounded-full` 셋만 — `rounded-2xl`/`3xl` 쓰지 않음(메신저 스티커 그림만 예외).
- 그림자는 `shadow-card`·`shadow-pop` 둘만 — `shadow-xl`/`2xl` 쓰지 않음. 흐림(backdrop-blur)·유리 효과 쓰지 않음(화면 가림 보호막만 예외).
- 움직임은 불러오는 중(돌기·뼈대)·메뉴/창/알림이 열릴 때(0.16~0.18초, ease-out)만. 튀어나오는 효과(overshoot)·장식용 움직임은 쓰지 않음. 0.3초 넘는 전환 없음, `motion-reduce` 존중.

## 공통 부품 (`src/components/ui.tsx`)
Button(primary·secondary·ghost·danger·accent) · IconButton(aria-label 필수) · Card · Kbd · Field · inputCls · Modal(모바일은 아래에서 올라오는 시트) · Toast(되돌리기 등 동작 버튼) · StatusBadge · PriorityTag · BrandDot · Avatar/AvatarStack · **DueChip**(오늘 파랑, 지남 빨강+며칠, 3일 이내 주황) · Skeleton · Empty(아이콘+설명+다음 행동) · ErrorBox · PageHeader

## 틀
- 데스크톱: 왼쪽 사이드바(접기, 즐겨찾는 프로젝트, 현장 운영·관리자 묶음) + **상단 바**(검색 Ctrl K · + 만들기(업무·일정·프로젝트) · 알림 · 계정 메뉴)
- 모바일: 상단 바(검색·계정) + **하단 탭 5개(홈·내 업무·[+]·캘린더·알림)**, + 는 탭 바 가운데
- 단축키: Ctrl K 검색, N 새 업무, ? 도움말, G→H/M/C 이동, 목록 ↑↓ Enter, Esc 닫기

## 겹침 금지 (대표 11/26 상시 규칙 — 모든 화면)
글자·칩·단추·아이콘은 서로 겹쳐 그려지지 않는다. 칸 밖으로 넘쳐 그려지는 일도 없다.
- 넘치면 이 순서로 처리한다: ① 줄바꿈 ② 말줄임(…) ③ 숨김(상세 화면에 있는 정보).
- flex·grid 자식 중 글자를 담는 것은 `min-w-0`.
- `shrink-0` + `whitespace-nowrap` 칩은 `max-w-full` 을 함께 쓰고, 칩 안 글자는 `min-w-0 truncate`(아이콘은 `shrink-0`). 예: 업무 줄 첨부 칩 `HWPX 2 · HWP 1 …`.
- 의도된 겹침만 예외: 아바타 묶음·아이콘 위 숫자 배지·떠 있는 메뉴·말풍선·창. 떠 있는 것(fixed·sticky·absolute)은 자기 층 안에서만 본다. 그 밖의 의도된 겹침에는 `data-overlap-ok` 표식을 붙인다.
- 자동 검사: `tests/e2e/overlap.mjs`(findOverlaps).
  - 보는 것: 실제 글자 상자끼리, 글자와 아이콘·입력칸, 작은 보이는 상자(칩·배지·단추)와 남의 글자·아이콘의 1px 넘는 겹침. 그리고 눈에 보이는 상자(테두리·배경·그림자) 밖으로 가로로 넘친 글자.
  - E2E '대표 11/26 겹침 금지': 375·412·1024·1880 × 주요 화면 14곳, 하나라도 있으면 실패. 검사기 자체 확인(일부러 넓힌 첨부 칩을 반드시 잡음)을 포함한다.
  - 운영 확인(prod-check): 같은 검사를 읽기 전용으로 돌린다.

## 낱말 중간 줄바꿈 금지 (대표 11/26 상시 규칙 — 모든 화면)
한글은 띄어쓰기에서만 줄을 바꾼다. 사람 이름·제목이 '이동 / 재님'처럼 낱말 가운데서 끊기지 않는다.
- 앱 전체 기본값: `body { word-break: keep-all; overflow-wrap: break-word; }`(`src/app/globals.css`). 칸보다 긴 한 낱말(주소·메일)만 어쩔 수 없을 때 끊는다.
- 이름 + '님' 같은 한 덩어리는 `whitespace-nowrap` span 으로 묶는다(예: 홈 인사말).
- 일부러 아무 데서나 끊어야 하는 곳(긴 주소·코드)은 `break-all` 과 함께 `data-break-ok` 표식을 붙인다.
- 자동 검사: `findWordBreaks`(`tests/e2e/overlap.mjs`).
  - 여러 줄로 감긴 글자에서 줄이 바뀌는 자리의 앞뒤가 모두 글자·숫자면 실패한다.
  - E2E '대표 11/26 겹침 금지'와 prod-check 가 휴대폰 폭(375·412)에서 함께 돌린다.
  - 검사기 자체 확인: 일부러 break-all 로 끊은 홈을 반드시 잡는다.
