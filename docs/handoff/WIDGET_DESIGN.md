# 휴대폰 바탕화면 위젯 — 1차 시안·API 규격 (2026-10-20, 클라우드 → 로컬 네이티브)

대표 지시: 듀오링고처럼 가입 때 "위젯 추가" 단계가 있는 위젯. 네이티브(Android AppWidget·iOS WidgetKit)는 로컬, 클라우드는 API·딥링크·그림·가입 안내 단계.
그림: `docs/screens/widget-design.png` (원본 `docs/handoff/widget-design.html`, 브라우저로 열면 실제 크기).

## 위젯 3종
| | 크기 | 내용 | 탭/동작 |
|---|---|---|---|
| ① 오늘 할 일 | 중간 2:1 (Android 4×2 · iOS systemMedium) | 날짜 머리 + 지남/오늘/승인 대기 수, 업무 최대 4줄(체크박스·공간 색 점·제목·마감: 지난 건 빨간 "지남", 시각, 완료는 취소선) + "+n건 더" + 다음 일정 한 줄 | 줄 탭 → `workos://tasks/{id}` · 체크 → `POST /api/widget/tasks/{id}/done` → 응답 status 로 즉시 갱신 · 머리 탭 → `workos://tasks` · 다음 일정 탭 → `workos://calendar?view=timeGridDay` |
| ② 다음 일정 | 작은 1:1 (2×2 · systemSmall) | 다음 일정 시각 크게 + 제목 + "📍 이동 n분 · n시간 뒤", 없으면 "남은 일정 없음"과 내일 첫 일정 | 탭 → `workos://calendar?view=timeGridDay` |
| ③ 빠른 추가 | 작은 1:1 | 버튼 4개: 업무·음성·AI 비서·일정 | `workos://tasks?new=1` · `workos://tasks?new=1&voice=1` · `workos://assistant` · `workos://calendar?quick=1` |

- 왼쪽 세로 띠 = 지금 공간 색(업무 #0F766E · 영업 #2563EB · 마케팅 #7C3AED). 점 색도 같은 규칙, 지난 업무는 #DC2626. 다크 모드 색은 그림 두 번째 카드.
- 글꼴: 시스템 기본(한글 가독), 제목 13sp, 보조 11sp. 로그아웃 상태면 "워크인에 로그인하세요" 한 줄 + 앱 열기.
- 갱신: 15분마다 + 앱이 저장할 때(브로드캐스트/WidgetCenter.reloadAllTimelines). 응답은 `cache-control: private, max-age=900` — 그대로 캐시해도 됨.

## API
### `GET /api/widget/today` (Bearer 앱 세션 토큰 또는 쿠키)
```json
{ "date": "2026-10-20",
  "tasks": [{ "id": "uuid", "title": "강남점 소방 점검 대응", "due": "지남|오늘|14:00|10/22", "late": true, "done": false, "color": "#0F766E", "priority": "high" }],
  "events": [{ "title": "현장 미팅", "time": "15:00|종일", "allDay": false }],
  "counts": { "late": 1, "today": 4, "approvals": 2 },
  "next": { "time": "15:00", "title": "현장 미팅" } ,
  "links": { "task": "workos://tasks/{id}", "newTask": "workos://tasks?new=1", "today": "workos://calendar?view=timeGridDay", "ai": "workos://assistant" } }
```
- tasks: 내 담당, 완료 아님 + 오늘 완료한 것, 지난 것 → 높음/긴급 → 마감 시각 순, 최대 5. 제목 40자, 전체 2KB 안.
- events: 오늘 남은 일정(시작 15분 전까지 포함) 최대 3. next: 아직 시작 안 한 가장 가까운 시각 일정(없으면 null).
- counts.approvals = 내가 지시한 검토 중 업무 + 내게 온 결재 단계(pending).
- 401 이면 로그인 안내. 권한 범위는 앱과 같다(다른 회사·남의 업무 없음).

### `POST /api/widget/tasks/{id}/done`
- 완료 토글: 진행 중 → `done`(검토 필요 업무는 `review`), 완료 → `in_progress`. 응답 `{ ok, status, version }`. 남의 업무 403, 없는 업무 404. 권한·검토 규칙은 업무 화면과 같음(updateTask).

## 딥링크(앱 스킴 `workos://`, 기존 appUrlOpen 처리 그대로: 스킴·호스트를 떼고 경로로 이동)
- `workos://tasks/{id}` 업무 상세 · `workos://tasks?new=1` 등록 창 · `workos://tasks?new=1&voice=1` 음성 등록(등록 창에서 바로 🎤) · `workos://calendar?view=timeGridDay` 오늘 · `workos://calendar?quick=1` 빠른 일정 · `workos://assistant` AI 비서.
- 앱에서 `?new=1`·`voice=1`·`quick=1` 은 각 화면의 기존 주소 처리(등록 창 자동 열기)를 쓴다 — 없으면 알려 주세요, 클라우드가 붙입니다.

## 가입·첫 실행 안내(V32-5 투어와 같이, 다음 묶음)
- 투어 마지막 단계 "바탕화면에 위젯 추가하기": Android `AppWidgetManager.requestPinAppWidget`(앱이 네이티브 브리지 노출 → 웹이 호출), iOS 는 안내 그림(길게 누르기 → + → 워크인). 웹은 건너뜀. 설정 › 알림 아래 '위젯' 항목에서 다시 보기.

## 로컬 네이티브 할 일
- Android: AppWidgetProvider 3개(4×2·2×2·2×2), RemoteViews 레이아웃(위 그림), WorkManager 15분 갱신 + 앱 저장 시 갱신, 체크 → PendingIntent → 백그라운드 POST(세션 토큰은 앱 저장소) → 응답 뒤 다시 그림. 로그인 토큰 없으면 로그인 카드.
- iOS: WidgetKit Extension(App Group 으로 세션 토큰 공유), TimelineProvider 15분, AppIntent 로 체크(iOS 17+), 딥링크 `widgetURL`.
- 네이티브 브리지: `requestPinWidget()`(Android) → 투어 단계에서 호출.
