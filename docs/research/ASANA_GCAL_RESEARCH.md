# Asana × Google Calendar 기능 조사 — COMPANY-WORK-OS 반영안

- 대상 서비스: COMPANY-WORK-OS (주식회사 다짐 / 하이링크 / BODY LAB 사내 업무·일정 관리)
- 조사일: 2026-10-12
- 조사 방법: Playwright(Chromium 1194, headless) 실제 브라우저로 공개 페이지를 방문했습니다. 뷰포트는 1280×800(데스크톱)과 390×844(모바일, iPhone UA)이며 로그인은 하지 않았습니다. 본문 텍스트 추출 결과와 리다이렉트 체인을 기록했습니다.
  - 스크립트: `/tmp/claude-0/research-scripts/crawl.js` (저장소 밖 임시 경로)
  - 스크린샷: `docs/research/screens/*.png` (10장, 총 약 0.9MB)
- 범례(확인 방법)
  - **공개페이지**: 마케팅·제품 페이지를 직접 방문해 확인했습니다.
  - **도움말**: 공식 도움말 문서를 방문해 본문으로 확인했습니다. 실제 앱 UI는 보지 않았습니다.
  - **미검증**: 로그인해야 확인할 수 있습니다. 대표(또는 지정 계정)의 인증이 필요합니다.

---

## 0. 로그인 없이 앱 URL에 접근하면 어떻게 되는가 (실측)

| URL | 리다이렉트 체인 (실측) | 결과 화면 | 스크린샷 |
|---|---|---|---|
| `https://app.asana.com/` | 302 → `https://app.asana.com/-/login` | Asana 로그인 페이지 (title "로그인 - Asana") | `screens/asana_app_login_redirect_1280.png` |
| `https://calendar.google.com/` (데스크톱) | 302 → `/calendar/u/0/r` → 302 `accounts.google.com/ServiceLogin?service=cl&passive=1209600…` → **200 `workspace.google.com/intl/ko/products/calendar/`** | 로그인 폼이 아니라 **Google Workspace의 Calendar 마케팅 페이지**가 뜹니다 (passive 로그인 확인이 실패하면 제품 소개로 보냄) | `screens/gcal_no_login_redirect_1280.png` |
| `https://calendar.google.com/` (모바일 UA) | 302 → 301 `/calendar` → 302 `/calendar/gp?hl=ko` → 302 `accounts.google.com/ServiceLogin…` → 200 `workspace.google.com/intl/ko/products/calendar/` | 위와 같으며, 모바일 레이아웃에 "로그인" 버튼이 있습니다 | `screens/gcal_no_login_redirect_390.png` |

> 결론: accounts.google.com을 거치기는 하지만 `passive=1209600`(조용한 세션 확인)이 실패하면 **로그인 폼 대신 마케팅 페이지로 떨어집니다**. 실제 캘린더 UI(월/주/일 뷰, 수정 다이얼로그 등)는 로그인 전에는 전혀 볼 수 없습니다.

---

## 1. 공개 페이지 조사 (로그인 없이 확인)

### 1-1. 방문한 페이지 목록

| 구분 | URL | HTTP | 비고 |
|---|---|---|---|
| Asana 홈 | https://asana.com/ko | 200 | `/ko`로 자동 로케일 리다이렉트 |
| Asana 기능 | https://asana.com/ko/features | 200 | |
| Asana 작업 기능 | https://asana.com/ko/features/project-management/tasks | 200 | |
| Asana 프로젝트 보기 | https://asana.com/ko/features/project-management/project-views | 200 | "칸반 보드, 목록, 타임라인, 캘린더 또는 간트 차트" / 스크린샷 `asana_project_views_1280.png` |
| Asana 요금 | https://asana.com/ko/pricing | 200 | Personal US$0(최대 2명), 목록·보드·캘린더 보기 포함 |
| Asana 구 기능 URL (timeline/boards/calendar/approvals/my-tasks/mobile) | asana.com/features/… | **404** | 사이트 개편으로 사라진 URL. 도움말로 대체 조사 |
| Asana 도움말 홈 | https://help.asana.com/ → `/s/?language=en_US` | 200 | Salesforce Experience Cloud 기반(Shadow DOM)이라 본문은 shadow-root를 순회해 추출 |
| Asana 도움말 15건 | 아래 기능표의 출처 열 참조 | 200 | 전부 비로그인 열람 가능 |
| Google Calendar 고객센터 | https://support.google.com/calendar/?hl=ko | 200 | |
| Google Calendar 도움말 11건 | 아래 기능표의 출처 열 참조 | 200 | 데스크톱/Android/iOS 탭(`co=GENIE.Platform=…`)별로 방문 |

주요 출처 약어:

| 약어 | URL |
|---|---|
| A-create | https://help.asana.com/s/article/create-tasks-in-asana?language=en_US |
| A-types | https://help.asana.com/s/article/different-types-of-tasks?language=en_US |
| A-fields | https://help.asana.com/s/article/task-fields?language=en_US |
| A-approve | https://help.asana.com/s/article/approvals?language=en_US |
| A-ctype | https://help.asana.com/s/article/custom-task-types?language=en_US |
| A-sched | https://help.asana.com/s/article/scheduling-tasks-using-start-dates-due-dates-and-times?language=en_US |
| A-dep | https://help.asana.com/s/article/task-dependencies?language=en_US |
| A-board | https://help.asana.com/s/article/board-view?language=en_US |
| A-timeline | https://help.asana.com/s/article/timeline?language=en_US |
| A-proj | https://help.asana.com/s/article/managing-projects?language=en_US |
| A-rules | https://help.asana.com/s/article/automate-how-work-moves-through-stages?language=en_US |
| A-mytasks | https://help.asana.com/s/article/views-in-my-tasks?language=en_US |
| A-inbox | https://help.asana.com/s/article/stay-informed-with-your-asana-inbox?language=en_US |
| A-notif | https://help.asana.com/s/article/notification-settings?language=en_US |
| A-mobile | https://help.asana.com/s/article/getting-started-with-asana-s-mobile-app?language=en_US |
| G-create | https://support.google.com/calendar/answer/72143 (Desktop/Android) |
| G-recur | https://support.google.com/calendar/answer/37115 (Desktop/iOS) |
| G-delete | https://support.google.com/calendar/answer/37113 (ko/en) |
| G-invite | https://support.google.com/calendar/answer/37161 |
| G-rsvp | https://support.google.com/calendar/answer/37135 |
| G-notif | https://support.google.com/calendar/answer/37242 |
| G-work | https://support.google.com/calendar/answer/7638168 (Desktop/Android) |
| G-views | https://support.google.com/calendar/answer/6110849 |

### 1-2. 기능표

| 기능 | Asana 동작 | Google Calendar 동작 | 확인 방법 | 우리 서비스 반영 방식 |
|---|---|---|---|---|
| 업무/일정 생성 진입점 | 상단 바 `+ Create`, 프로젝트의 `+ Add task`, 섹션 옆 `+` 등 3가지 (A-create) | 왼쪽 위 `만들기` 클릭 또는 빈 시간 클릭, 빠른 일정 만들기 (G-create). Android는 `만들기 → 일정` 또는 빈 시간 탭 | 도움말 | 전역 `+` 버튼 하나에서 업무/일정을 고르게 합니다(Android Calendar처럼 "일정↔할 일" 전환 탭). 목록·캘린더 빈 칸 클릭으로 빠른 생성 |
| 담당자 | 업무당 **담당자 1명**만 가능 (A-types: "Each task can only have one assignee") | 담당자 개념 없음. 주최자 + 참석자 | 도움말 | `assignee_id` 단일 필드. 여러 명이 필요하면 하위 업무로 나눔 |
| 협업자(팔로워) | 협업자 여러 명 추가 가능. 완료나 섹션 이동 시 알림 (A-fields, A-board). 협업자에서 빠지면 언팔로우되지만 @멘션은 계속 받음 (A-inbox) | 참석자(필수/선택) 추가, 이메일 주소만으로 초대 가능 (G-invite) | 도움말 | `task_watchers` N:M. 업무 생성자·담당자는 자동 등록, 수동 해제 허용 |
| 하위 업무 | 담당자·마감일을 따로 가짐. **부모의 프로젝트·담당자를 상속하지 않음** (A-timeline) | 없음 | 도움말 | `parent_task_id` 1단계 우선. 상속 없이 생성하되 UI 기본값으로 부모 값을 제안 |
| 섹션 | 프로젝트 안 그룹/단계(예: To do / In progress / Done). 비어 있어야 삭제 가능 (A-board, A-proj) | 없음(캘린더 단위가 비슷한 역할) | 도움말 | `project_sections`. 보드 뷰의 열 = 섹션 |
| 사용자 정의 상태 | Custom task types: 상태값·색상과 **어떤 상태가 완료로 치는지** 지정. 규칙 트리거로 사용. Project admin/Editor만 생성. Starter 이상 (A-ctype) | 없음 | 도움말 | 회사 공통 상태 세트(요청→진행→검토→완료/반려)를 `status` enum + `is_done` 매핑으로 관리하고 프로젝트별 확장 허용 |
| 승인 업무 | 업무를 "Mark as Approval"로 전환. 결과는 승인 / 변경 요청 / 반려 3가지, 미완료는 "pending". **담당자 외 누구나 완료 가능**(제한하려면 comment-only 프로젝트). 하위 업무도 승인으로 만들 수 있음. Advanced 이상 (A-approve) | 없음 | 도움말 | `task_type = approval`. 결정 3종 + 코멘트 필수. **승인은 지정된 승인자만 하도록 서버에서 권한 검사**(Asana보다 엄격하게) |
| 반복 업무 | 마감일 → `Set to repeat` → 매주/매월/매년/주기적/사용자 지정. **완료하면 다음 업무를 복제**하고 캘린더에는 다음 회차만 보임. 코멘트를 뺀 모든 필드와 하위 업무를 복사. "주기적" 반복은 마지막 완료일 기준. 부모와 하위 업무를 동시에 반복하면 기하급수적으로 복제되므로 금지 (A-sched) | 반복 일정은 RRULE 기반이며 **최대 730개 회차** (G-recur) | 도움말 | 업무: "완료 시 다음 회차 생성" 방식(Asana 모델). 일정: RRULE 시리즈 + 예외(인스턴스) 모델(GCal 모델). 둘을 섞지 않음 |
| 의존성 | Blocked by / Blocking. 타임라인에서 커넥터를 드래그해 설정. 선행 업무가 완료되거나 마감일이 바뀌면 후행 담당자에게 알림. 선행이 여러 개면 **모두 완료됐을 때 1회만** 알림. Starter 이상 (A-dep) | 없음 | 도움말 | `task_dependencies(blocker_id, blocked_id)`. 2단계 기능으로 둠 |
| 목록/보드/캘린더/타임라인 뷰 | 프로젝트에서 List·Board·Timeline·Calendar 뷰를 언제든 전환. 날짜 없는 업무는 타임라인의 "Unscheduled"에 표시 (A-proj, A-timeline) | 일·주·월·연도·일정(Schedule)·4일 뷰. 고른 뷰가 기본 뷰로 저장됨 (G-views) | 공개페이지 + 도움말 | MVP는 목록·보드·월/주 캘린더. 타임라인(간트)은 이후 단계. 마지막으로 쓴 뷰를 사용자별로 기억 |
| 내 작업(My Tasks) | 나에게 배정된 업무 모음. List/Board/Calendar, 저장된 뷰 탭, 7일 캘린더, Unscheduled 사이드바에서 드래그해 날짜 지정 (A-mytasks) | "일정" 뷰가 가장 비슷한 개념 | 도움말 | 홈 = "내 업무 + 오늘 일정" 통합 화면. 마감일 없는 업무는 사이드 패널에 표시 |
| 시작일/시간 | Due date, due time, 시작일·시작 시간 범위(Starter 이상) (A-sched) | 종일 일정 / 시간 일정, 시간대 | 도움말 | 업무는 `due_date`(+선택 `due_time`, `start_date`). 일정은 `start/end` + `all_day` + `tz` |
| 종일 일정 | — | "종일 일정 만들기" 옵션 (G-create). 종일 일정에는 새 시간 제안 불가 (G-rsvp) | 도움말 (세부 UI는 미검증) | `all_day=true`이면 날짜만 저장(시간대 영향 없음) |
| 참석/RSVP | — | 예 / 아니요 / 미정. 메모 추가, **새로운 시간 제안**(참석자 200명 초과 일정·종일 일정은 불가). 응답하면 주최자에게 알림 (G-rsvp) | 도움말 | 1단계: 참석/불참/미정 + 메모. 시간 제안은 2단계 |
| 부재중(OOO) | — | 부재 기간 동안 **모든 회의를 자동 거절**. 거절 메시지 설정, 반복 가능. 종일이거나 근무 시간을 넘겨야 함. 직장/학교 계정만 해당 (G-work) | 도움말 | "휴가/외근" 일정 유형. 기간 중 새로 초대되면 경고하고 자동 응답(옵션) |
| 근무 위치/근무 시간 | — | 요일별 근무 시간·기본 근무 위치(사무실/재택 등)를 설정하며 관리자가 끌 수 있음 (G-work) | 도움말 | 지점(다짐/하이링크/BODY LAB) 단위 근무지 표시. 출퇴근 관리와는 분리 |
| 반복 일정 수정/삭제 범위 | — | **이 일정 / 이 일정 및 향후 일정 / 모든 일정** 3가지. "이후 일정" 또는 "모든 일정"으로 삭제하면 **휴지통에 가지 않아 복원 불가**. 다른 사람이 만든 반복 일정에서는 범위 선택지가 나오지 않음 (G-delete). 수정할 때도 저장 후 "업데이트를 적용할 반복 일정을 선택"하는 단계가 있음 (G-recur) | 도움말 (다이얼로그 실물은 미검증) | 같은 3범위 다이얼로그를 구현합니다. "이후 일정" = 원 시리즈를 UNTIL로 자르고 새 시리즈를 생성. 범위 삭제는 소프트 삭제 + 30일 복원(GCal보다 안전하게) |
| 휴지통 | 삭제된 업무 복구(도움말 목록에 있음) | 삭제한 일정은 30일 동안 휴지통에 보관하며 컴퓨터에서만 복원 가능 (G-delete) | 도움말 | `deleted_at` 소프트 삭제 30일 |
| 알림 채널 | Inbox(알아야 할 것) vs My Tasks(해야 할 것) 분리. Inbox: 정렬·필터·보관·북마크, 방해 금지(DND), 알림 받을 시간대 예약. 이메일 4종(일일 요약/활동/멘션만/주간). 브라우저 알림(Chrome/Firefox/Edge). 업무 배정·코멘트·협업자 추가·@멘션 시 알림 (A-inbox, A-notif) | 알림 수단은 휴대전화·웹·이메일. **캘린더 단위 기본 알림**(일반 일정 / 종일 일정 따로)을 정하고 일정별로 덮어쓰기. "예/미정으로 응답한 경우에만 알림" 옵션. 다시 알림(snooze)은 Chrome만 (G-notif) | 도움말 | 앱 내 알림함(보관/읽음) + 푸시 + 이메일 요약. 사용자 기본 리마인더(일반/종일 분리) + 일정별 덮어쓰기. 야간 방해 금지 시간대 |
| 모바일 | 하단 탭(Inbox, My tasks 등). 오프라인으로 작업하고 온라인이 되면 동기화. iOS 음성으로 업무 생성. 월요일 아침 "Weekly focus" 프롬프트. 푸시는 기본 ON (A-mobile, 검색 결과의 iOS/Android 문서) | Android: `만들기 → 일정`, 위로 스와이프해 세부 정보 입력, 일/3일/주 뷰, 빈 시간 탭 후 드래그로 길이 조절 (G-create Android) | 도움말 (앱 실물은 미검증) | 하단 탭 4개(홈/업무/캘린더/알림). 빠른 추가는 바텀시트. 오프라인 읽기 캐시 |
| 규칙/자동화 | 커스텀 필드나 상태가 바뀌면 섹션 이동·담당자 지정·승인 전환 등을 자동 처리 (A-rules) | 없음 | 도움말 | 2단계: "상태=검토 → 승인자에게 배정 + 알림" 같은 고정 규칙 몇 개만 하드코딩 |
| 멀티홈 | 한 업무를 최대 20개 프로젝트에 소속시킴(복제 아님) (A-fields) | 한 일정이 여러 캘린더에 표시됨(참석자) | 도움말 | MVP는 업무당 프로젝트 1개. 회사 간 공유는 "공유 프로젝트"로 해결 |

### 1-3. 화면 흐름 (텍스트 다이어그램)

#### (1) 업무 등록 → 담당자 배정 → 상태 변경 → 완료/승인

```
[+ 새 업무] (전역 버튼 / 프로젝트 섹션 '+' / 내 업무 빠른 추가)
   │  제목* · 프로젝트/섹션 · 담당자(1명) · 마감일(+시간) · 설명 · 협업자 · 유형(일반/승인)
   ▼
[저장] ──► 담당자에게 알림(앱 알림함 + 푸시) · 협업자 자동 등록(생성자·담당자)
   ▼
[업무 상세 패널]
   ├─ 상태 변경: 요청 → 진행중 → 검토요청 ──(규칙)──► 승인자 배정 + 알림
   ├─ 하위 업무 추가 (각자 담당자/마감일, 부모 값은 '제안'만 함)
   ├─ 코멘트 / @멘션 → 멘션된 사람 알림함
   └─ 의존성(Blocked by) → 선행이 모두 완료되면 1회 알림
   ▼
 ┌ 일반 업무: [완료 ✓] → 협업자에게 완료 알림 → 기본 목록에서 숨김(필터로 보기) / 재오픈 가능
 └ 승인 업무: 승인자만 [승인] [변경 요청] [반려] 중 선택 (+코멘트 필수)
        ├ 승인 → 완료 처리(녹색) → 요청자에게 알림
        ├ 변경 요청(주황) → 담당자에게 되돌림, 상태=진행중
        └ 반려(빨강) → 완료(반려) 처리, 사유 기록
```

#### (2) 반복 업무 (Asana 모델)

```
[업무 상세] → 마감일 → [반복 설정]
   매일/매주(요일 체크)/매월(N개월마다)/매년/완료 후 N일(주기형)
   ▼
캘린더·목록에는 '다음 회차 1건'만 표시
   ▼
[완료 ✓] ──► 서버가 다음 회차 업무를 생성
              · 코멘트를 뺀 필드·하위 업무 복사
              · 다음 마감일 = 규칙 기준(주기형은 완료일 기준)
   ▼
[반복 해제] 또는 마감일 삭제 → 더 이상 생성하지 않음
※ 부모가 반복 중이면 하위 업무의 반복 설정을 UI에서 막음
```

#### (3) 반복 일정 수정 — 3가지 범위 (Google Calendar 모델)

```
[반복 일정 인스턴스 클릭] → [수정] → 변경 → [저장]
   ▼
┌──────── 반복 일정 수정 ────────┐
│ ○ 이 일정                       │ → 해당 회차만 예외(override) 레코드 생성
│ ○ 이 일정 및 향후 일정          │ → 원 시리즈 RRULE에 UNTIL=(이 회차 직전) 설정
│                                 │   + 이 회차부터 새 시리즈 생성(변경 반영)
│ ○ 모든 일정                     │ → 시리즈 마스터 수정(기존 예외는 유지할지 확인)
│            [취소] [확인]        │
└─────────────────────────────────┘
 삭제도 같은 3범위. GCal은 '이후/모든'으로 삭제하면 복원 불가 → 우리는 30일 소프트 삭제
 내가 주최자가 아닌 반복 일정: 범위 선택 없이 '내 캘린더에서 이 회차 제거(=불참)'만 가능
```

#### (4) 알림

```
이벤트 발생(배정·멘션·코멘트·상태변경·승인요청/결정·일정 초대/변경·리마인더 시각 도달)
   ▼
수신자 계산(담당자 · 협업자 · 승인자 · 참석자) − 행위자 본인
   ▼
사용자 설정 필터(유형별 ON/OFF · 방해 금지 시간 · '참석/미정 일정만 리마인드')
   ▼
 ├─ 앱 알림함 저장 (읽음/보관/북마크)  ← 항상
 ├─ 푸시 (FCM → Android / APNs, 웹푸시) ← 즉시성 있는 것만
 └─ 이메일 일일 요약 (선택)
리마인더: 사용자 기본값(일반 일정 10분 전, 종일 일정 전날 09:00 등) → 일정별 덮어쓰기
```

#### (5) 모바일 화면

```
┌───────────── 390×844 ─────────────┐
│ 상단: 회사 전환(다짐/하이링크/BODY LAB) · 검색 │
│                                     │
│ [홈] 오늘 일정 타임라인 + 내 업무(오늘/지연/예정) │
│ [업무] 내 업무 · 프로젝트 → 목록/보드 전환    │
│ [캘린더] 일 / 3일 / 주 / 월, 빈 시간 탭 → 생성 │
│ [알림] 알림함(필터: 멘션/배정/승인요청)       │
│                                     │
│            (+) FAB → 바텀시트: 업무 | 일정 탭 │
└──── 하단 탭: 홈 · 업무 · 캘린더 · 알림 ────┘
업무 상세 = 전체 화면 시트(상태 칩, 담당자, 마감, 하위 업무, 코멘트 입력창 고정)
승인 업무 = 하단 고정 [승인][변경요청][반려] 버튼
```

### 1-4. 스크린샷 목록 (`docs/research/screens/`)

| 파일 | 내용 | 뷰포트 |
|---|---|---|
| asana_project_views_1280.png | Asana 프로젝트 보기 기능 페이지 | 1280×800 |
| asana_app_login_redirect_1280.png | app.asana.com → 로그인 페이지 | 1280×800 |
| asana_help_create_tasks_1280.png | 도움말: Create tasks | 1280×800 |
| asana_help_approvals_1280.png | 도움말: Approvals (사용 가능 플랜 표시) | 1280×800 |
| asana_help_mobile_390.png | 도움말: 모바일 앱 | 390×844 |
| gcal_no_login_redirect_1280.png | calendar.google.com 비로그인 → Workspace 마케팅 페이지 | 1280×800 |
| gcal_no_login_redirect_390.png | 위와 같은 상황의 모바일 화면 | 390×844 |
| gcal_help_create_event_1280.png | 도움말: 일정 만들기 | 1280×800 |
| gcal_help_create_event_390.png | 도움말: 일정 만들기(Android 탭) | 390×844 |
| gcal_help_recurring_1280.png | 도움말: 반복 일정 만들기 | 1280×800 |

---

## 2. 로그인 후 검수 (미검증 — 대표 인증 필요)

아래 항목은 로그인해야 하므로 이번 조사에서는 **확인하지 않았습니다**. 계정 생성·로그인·자격 증명 입력은 하지 않았습니다.

| # | 검수 항목 | 로그인이 필요한 URL | 확인할 포인트 |
|---|---|---|---|
| L1 | Asana 업무 상세 패널 실물 (필드 순서, 담당자 선택 UX) | https://app.asana.com/ | 담당자 typeahead, 협업자 자동 추가 규칙 |
| L2 | Asana 승인 업무 버튼·아이콘 색 | https://app.asana.com/ (Advanced 체험판 필요) | 승인/변경요청/반려 UI, 알림 문구 |
| L3 | Asana 사용자 정의 상태(Custom task types) 생성 화면 | https://app.asana.com/ (Starter 이상) | 상태 → 완료 매핑 UI |
| L4 | Asana 반복 설정 팝오버 | https://app.asana.com/ | 주기형/사용자 지정 옵션 문구 |
| L5 | Asana Inbox 필터·보관·DND 스케줄 | https://app.asana.com/ | 알림 유형 목록 |
| L6 | Asana 모바일 앱 하단 탭·빠른 추가 | iOS/Android 앱 (로그인 필요) | 탭 구성, 오프라인 동작 |
| L7 | Google Calendar 월/주/일/일정 뷰 실물 | https://calendar.google.com/ | 밀도, 종일 일정 표시 영역 |
| L8 | 반복 일정 "이 일정 / 이 일정 및 향후 일정 / 모든 일정" 다이얼로그 실물 | https://calendar.google.com/ | 수정 vs 삭제 문구 차이, 기존 예외 처리 |
| L9 | 참석자 추가·RSVP·새 시간 제안 UI | https://calendar.google.com/ | 게스트 권한 체크박스(수정/초대/목록 보기) |
| L10 | 부재중(OOO)·근무 위치 | https://calendar.google.com/ (**Workspace 계정**만 해당) | 자동 거절 메시지, 반복 OOO |
| L11 | 기본 알림(캘린더별 일반/종일) 설정 화면 | https://calendar.google.com/calendar/r/settings | 기본값 수치 |
| L12 | Google Calendar 모바일 앱 | Android/iOS 앱 | 생성 바텀시트, 스와이프 상세 |

> 진행 방법 제안: 대표가 직접 로그인한 상태에서 화면을 공유하거나 스크린샷을 보내 주는 방식으로 L1~L12를 확인합니다. 에이전트에게 자격 증명을 주지 않습니다.

---

## 3. 우리 서비스 설계 시사점 (요약)

1. **업무 ≠ 일정**: 업무는 "완료 시 다음 회차 생성"(Asana), 일정은 "RRULE 시리즈 + 인스턴스 예외"(GCal)로 데이터 모델을 분리합니다.
2. **담당자 1명 + 협업자 N명**: Asana 원칙을 따릅니다. 승인은 Asana(누구나 완료 가능)보다 엄격하게 지정 승인자만 할 수 있게 합니다.
3. **반복 일정 3범위 다이얼로그는 필수**입니다. 범위 삭제는 복원할 수 있게 해서 GCal의 약점을 보완합니다.
4. **알림함(알아야 할 것)과 내 업무(해야 할 것)를 분리**합니다. 리마인더 기본값은 캘린더 단위로 두고 일정별로 덮어쓸 수 있게 합니다.
5. **모바일**은 하단 4탭 + FAB 바텀시트로 구성하고, 승인 버튼은 엄지 영역에 고정합니다.
