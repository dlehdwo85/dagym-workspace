# AI 레벨 3 도구 조사 보고서

- 작성일: 2026-10-23
- 대상: 온라인테크트리 PDF 5종에 나온 도구 + 대표 추가 요청 3건(클로드 레플리카 스킬, 무료 모델로 Claude Code 쓰기, 메타 광고 자동 세팅)
- 조사 방식: GitHub 저장소는 `gh api`(읽기 전용)로 README·SKILL.md·plugin.json·스크립트·훅 원문을 직접 읽음. 공식 문서는 code.claude.com, developers.facebook.com 등에서 직접 확인. 나머지는 Perplexity 검색으로 보완하고, 직접 확인하지 못한 내용은 **[미확인]** 으로 표시함. 아무것도 설치하지 않았고 저장소 파일도 고치지 않음. 별점·최근 커밋은 2026-10-23 GitHub API 기준.

---

## 0. 한눈에 보는 결론

| 항목 | 판정 | 이유 한 줄 |
|---|---|---|
| A-1 Awesome Design (awesome-design-md / getdesign.md) | **부분 도입**(참고 자료로만) | 실행 코드 없는 마크다운 모음. 남의 브랜드를 그대로 베끼면 법적 위험 → 우리 회사 DESIGN.md를 만들 때 참고용 |
| A-2 Impeccable | **보류**(별도 시험 저장소에서만) | 품질은 좋지만 자동 훅·외부 실행 파일 내려받기·사용 통계 전송이 있고, 라이브 모드는 `app/layout.tsx`에 스크립트를 넣음. "끝나면 바로 main 배포" 규칙과 충돌 위험 |
| A-3 Taste skill | **보류** | 랜딩 페이지 특화. 한 번 만드는 데 30~45분·수십만 토큰. PDF에 나온 `high-end-visual-design` 은 다른 저장소로 옮겨짐 |
| A-4 Emil Kowalski skills | **도입 권장** | 순수 문서형(실행 코드 없음), MIT. 애니메이션·마감 품질을 올리는 데 바로 쓸 수 있음 |
| A-5 Instagram agent skill | **보류**(한국어로 다시 만들어 일부 도입) | 실행 도구는 안전하지만 규칙이 영어 기준. 구조만 가져와 한국어판을 우리 키트에 |
| A-6 HyperFrames | **보류**(노트북에서 시험) | 무료 오픈소스 HTML→영상. 사용 통계가 기본으로 켜져 있고 HeyGen 유료 기능 안내가 스킬 안에 들어 있음 |
| A-7 Playwright MCP | **유지** | 이미 사용 중 |
| B 클로드 레플리카 스킬 | **부분 도입** | "Replica skill"(Jakeschincariol/replica-skill)이 이름까지 일치. 단 커밋 1개짜리 초기판 → 정찰·디자인 측정·비교 점수 부분만 가져와 우리 '레퍼런스 대조' 에이전트로 |
| C 무료/저가 모델로 Claude Code | **비권장**(주 작업) / 공개 자료 요약 같은 잡일만 로컬 시험 | 같은 Claude Code 환경에서 점수 차이 큼(64.8% 대 41.8%), 클라우드 세션은 아예 불가, 코드가 해외 업체로 감. 비용은 Claude Haiku/Sonnet 하위 에이전트로 줄이는 게 맞음 |
| D 메타 광고 자동 세팅 | **도입 권장**(단계적) | 워크인 안에 "소재 올리기 → 일시정지 상태로 캠페인 생성 → 승인함 → 승인 시 집행"으로 구현. Meta 공식 Ads MCP(공개 베타)는 사내 운영용으로 시험 |
| E Blotato | **비권장** | 워크인에 이미 게시 기능이 있음. 월 $29부터, 네이버 블로그·카카오 지원 확인 안 됨 |
| E Canva | **보류** | 공식 MCP는 있으나 요금제별 기능 조건이 문서마다 다름 |
| E Higgsfield / Computer use / Record & Replay | **유지·대체** | 이미 연결됨. Record & Replay는 맥 전용 → Claude in Chrome의 "워크플로 녹화"로 대체 |
| F 회사 키트 | **도입 권장** | 비공개 저장소 1개를 원본으로 두고, 각 저장소 `.claude/`에 복사(클라우드 호환) + 노트북 전용 플러그인. 저장소 설정의 플러그인은 클라우드 세션에서 설치되지 않는다는 점을 공식 문서로 확인함 |

---

## A. PDF에 나온 GitHub 스킬·플러그인

### A-1. Awesome Design (VoltAgent/awesome-design-md, getdesign.md)

**실제로 하는 일**
- 유명 서비스(Stripe, Linear, Notion, Apple 등)의 색·글꼴·간격·부품 규칙을 정리한 `DESIGN.md` 파일 모음. 저장소에는 84개 브랜드 폴더가 있고 각 폴더에 `DESIGN.md`(약 24~41KB)가 들어 있음 ([저장소](https://github.com/VoltAgent/awesome-design-md), README "Collection").
- 각 브랜드 폴더의 README는 "자세한 내용은 getdesign.md로 옮김"이라고 적혀 있고 ([예: linear.app](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/README.md)), 사이트에는 550개 이상이 있음. 그중 45개 선별본은 월 $99 구독("Catalog Pass") ([getdesign.md/design-md-pass](https://getdesign.md/design-md-pass)).
- 스킬도 플러그인도 아님. 그냥 문서를 프로젝트에 넣고 "이 문서대로 만들어"라고 시키는 방식 (README "How to Use").

**Claude Code 설치 방법**
- 직접 복사: `design-md/<브랜드>/DESIGN.md` 를 저장소 루트에 두고 CLAUDE.md에서 참조.
- CLI: `npx getdesign@latest add stripe` → 현재 폴더에 `./DESIGN.md` 생성 ([getdesign.md/stripe/design-md](https://getdesign.md/stripe/design-md)).

**코드 실행 여부**
- 저장소 자체: 마크다운뿐(실행 코드 없음). 문서 안의 실행 지시는 `npx @google/design.md lint DESIGN.md` 한 줄 정도 ([linear.app DESIGN.md "Iteration Guide"](https://github.com/VoltAgent/awesome-design-md/blob/main/design-md/linear.app/DESIGN.md)).
- `getdesign` CLI(npm 0.6.26): 설치 후 스크립트(postinstall) 없음. 브랜드 문서는 패키지 안에 들어 있고, `add` 성공 시 `https://getdesign.md/api/cli/downloads` 로 브랜드명·버전·Node 버전·OS를 보냄. 끄려면 `GETDESIGN_DISABLE_TELEMETRY=1` ([패키지 원문 src/cli.mjs](https://unpkg.com/getdesign@0.6.26/src/cli.mjs)). CLI 소스는 GitHub 저장소에 없고 npm 배포본으로만 확인함.

**라이선스·활동**: MIT, 별 122,979 / 포크 13,649, 최근 푸시 2026-10-14.

**안전·주의점**
- 프롬프트 주입 같은 문구는 발견 못함.
- 저장소 스스로 "공개 CSS 값을 추출한 것이며 각 사이트의 시각적 정체성에 대한 소유권은 주장하지 않는다"고 적음 (README "License"). 우리 서비스에 남의 브랜드 문서를 그대로 쓰면 상표·외관(트레이드 드레스) 문제가 될 수 있음.

**판정: 부분 도입** — 우리 워크인·다짐·하이링크 각자의 `DESIGN.md`를 만드는 **형식 참고**로만 사용. 남의 브랜드 문서를 그대로 적용하지 않음. CLI보다 직접 복사가 간단하고 통계 전송도 없음.

---

### A-2. Impeccable (pbakaus/impeccable, impeccable.style)

**실제로 하는 일**
- 스킬 1개(`/impeccable`) 안에 명령 24개(`init`, `audit`, `critique`, `polish`, `typeset`, `layout`, `colorize`, `quieter`, `bolder`, `live` 등)와 "AI가 만든 티 나는 디자인"을 잡는 규칙 62개 ([README](https://github.com/pbakaus/impeccable#readme)). `init`이 `PRODUCT.md`를 만들고 이후 명령들이 그걸 읽음.
- 하위 에이전트 4개 동봉(asset-producer, documenter, finish-reviewer, manual-edit-applier) (`plugin/agents/`).
- 버전 4.7.0, 엔진 바이너리 0.1.16 ([plugin.json](https://github.com/pbakaus/impeccable/blob/main/plugin/.claude-plugin/plugin.json), `scripts/VERSION`).

**Claude Code 설치 방법** (README "Installation")
- 설치 도구: `npx impeccable install` (감지한 하네스·범위를 묻고, Claude Code에는 프로젝트의 `.claude/settings.local.json`에 훅까지 설치. `--providers=claude --scope=project|global`, 훅 생략은 `--no-hooks`).
- 플러그인: `/plugin marketplace add pbakaus/impeccable` 후 `/plugin install impeccable@impeccable` (README는 "/plugin 목록에서 설치"라고만 적음. 설치 ID는 문서 규칙상 `항목이름@마켓이름`).
- 직접 복사: 프로젝트는 `cp -r dist/claude-code/.claude your-project/`, 전역은 `cp -r dist/claude-code/.claude/* ~/.claude/` (단, `dist/`는 저장소에 없음 → 사이트 ZIP 사용).

**코드 실행 여부 (중요)**
- **훅 3개**가 자동 실행: SessionStart, PostToolUse(Edit|Write), Stop 때마다 `scripts/impeccable hook` 실행 ([plugin/hooks/hooks.json](https://github.com/pbakaus/impeccable/blob/main/plugin/hooks/hooks.json)).
- 실행기(`scripts/impeccable`)는 처음 실행될 때 GitHub 릴리스에서 OS별 실행 파일을 `~/.impeccable/bin/0.1.16/`로 **내려받아 실행**. 같은 릴리스의 `.sha256` 파일로 검증 ([launcher 원문](https://github.com/pbakaus/impeccable/blob/main/plugin/skills/impeccable/scripts/impeccable)). 같은 곳에서 받은 체크섬이라 전송 오류는 막아도 릴리스 자체가 오염되면 못 막음.
- README가 직접 경고: "Claude Code에서 설치된 훅은 모델 도구 승인과 별개로 실행된다. 첫 편집이나 Stop 때 엔진을 내려받을 수 있다" (README "Design hook"). 끄려면 `claude --settings '{"disableAllHooks": true}'`.
- **사용 통계**: 새 디자인을 시작할 때 impeccable.style의 "roll API"를 항상 호출(기능의 일부). 기록을 끄려면 `npx impeccable telemetry off`, `DO_NOT_TRACK=1`, `IMPECCABLE_NO_TELEMETRY=1`, 또는 프로젝트 `.impeccable/config.json`에 `"telemetry": false`. 꺼도 호출은 하되 "기록하지 말라"고만 전달 (README "Telemetry", [telemetry.rs](https://github.com/pbakaus/impeccable/blob/main/crates/context/src/telemetry.rs)). 프로젝트 이름·코드는 보내지 않는다고 명시.
- **라이브 모드**(`/impeccable live`): Next.js App Router면 `app/layout.tsx`의 `</body>` 앞에 스크립트를 넣고, CSP가 있으면 `next.config`에 `http://localhost:8400` 허용(개발 모드 한정)을 추가 ([live-setup.md](https://github.com/pbakaus/impeccable/blob/main/.claude/skills/impeccable/reference/live-setup.md)).

**라이선스·활동**: Apache-2.0, 별 85,021 / 포크 5,072, 최근 푸시 2026-10-23(매우 활발). 저장소 크기 약 0.8GB(GitHub API size, 이력 포함) — 마켓으로 추가하면 이 저장소를 복제함 [얕은 복제 여부 미확인].

**안전·주의점**
- 스킬 문서에서 프롬프트 주입 문구는 발견 못함.
- 워크인은 "끝나면 바로 main에 푸시 = 운영 배포" 규칙이라, 라이브 모드가 넣은 스크립트나 CSP 수정이 실수로 커밋되면 바로 운영에 나감. 매 편집마다 도는 훅은 응답 맥락도 늘림.

**판정: 보류** — 디자인 검수 품질은 이 목록에서 가장 체계적. 다만 자동 훅·외부 바이너리·통계 전송이 있어 **워크인 저장소에는 넣지 않고**, 별도 시험 저장소(또는 다짐/하이링크 홈페이지 저장소의 별도 브랜치)에서 `--no-hooks`, `DO_NOT_TRACK=1`로 2주 써보고 결정. 문서형 대안으로는 Anthropic 공식 마켓의 `frontend-design@claude-plugins-official`(스킬 1개, 실행 코드 없음)이 있음 ([공식 마켓 저장소](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design)).

---

### A-3. Taste skill (Leonxlnx/taste-skill)

**실제로 하는 일**
- 현재 저장소에는 스킬 **1개**만 있음. 설치 이름은 `design-taste-frontend`(폴더명 `skills/taste-skill`, 플러그인 v2.1.4). 247개 사이트 연구를 바탕으로 디자인 방향 3개를 뽑아 고르게 하고, 공개 이미지 보관소에서 실제 사진을 찾아 쓰고, 실제 브라우저로 3개 화면폭 검사 후 스크린샷을 보며 3회까지 고침 ([README "How v2 works"](https://github.com/Leonxlnx/taste-skill#readme)).
- README 표현으로 **한 번 만드는 데 30~45분, 수십만 토큰**.
- PDF에 나온 `high-end-visual-design`은 [Leonxlnx/taste-skill-classics](https://github.com/Leonxlnx/taste-skill-classics)(별 11, MIT)의 `skills/soft-skill`로 이동함 (README "Moved skills").

**Claude Code 설치 방법** (README "Install")
- `npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"` (Claude Code만 고르려면 `-a claude-code`, 전역은 `-g`, 윈도우에서 심볼릭 링크 문제를 피하려면 `--copy` — [skills CLI 문서](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)).
- 플러그인: `/plugin marketplace add Leonxlnx/taste-skill` → `/plugin install taste-skill@taste-skill` (스킬이 `taste-skill:` 이름공간으로 들어감).
- 옛 스킬: `npx skills add https://github.com/Leonxlnx/taste-skill-classics --skill "high-end-visual-design"`.

**코드 실행 여부**
- Node 22+ 스크립트(`draw.mjs`, `assets.mjs`, `inspect.mjs`, `lint.mjs`, `scenes.mjs`) 실행. `lib/cdp.mjs`가 Chrome/Edge를 임시 프로필로 띄움. `assets.mjs`는 Openverse, Wikimedia Commons, 메트로폴리탄 박물관, 시카고 미술관, archive.org, NASA API에서 이미지 검색·다운로드 ([assets.mjs](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/scripts/assets.mjs)).
- 훅 없음, postinstall 없음. 주요 스크립트의 URL을 검사한 범위에서는 사용 통계 전송 코드를 찾지 못함.
- 프로젝트에 `.taste-skill/` 작업 폴더를 만들고 사용자 홈에 기록 파일을 남김(`draw.mjs` writeHist).

**라이선스·활동**: MIT, 별 101,160 / 포크 6,837, 최근 푸시 2026-10-20.

**안전·주의점**: 스킬 문서에 주입 문구 없음. README에는 Kimi API 제휴 링크가 있으나 스킬 본문에는 없음. 사진은 CC BY 등 출처 표기가 필요한 것도 섞여 있어 스킬이 페이지에 출처를 붙임 (README "Common Questions").

**판정: 보류** — 다짐·하이링크 **홈페이지 시안**을 빠르게 뽑을 때는 가치가 있지만, 워크인 같은 업무 화면 작업에는 과함(시간·토큰). 홈페이지 리뉴얼 때 그 저장소에서 플러그인으로 시험 권장.

---

### A-4. Emil Kowalski skills (emilkowalski/skills)

**실제로 하는 일**
- 스킬 15개: `emil-design-eng`(핵심: 애니메이션·UI 마감 원칙), `animate`, `review-animations`, `improve-animations`, `animation-performance`, `break-ui`(긴 이름·빈 목록 등 극단 데이터로 화면 깨기), `mobile-native`, `pick-ui-library` 등 ([README "Reference"](https://github.com/emilkowalski/skills#readme)).
- `emil-design-eng`은 "언제 애니메이션을 쓰나, 어떤 이징·속도, 버튼 반응, 접근성(움직임 줄이기)" 같은 판단 기준을 담은 27KB 문서 ([SKILL.md](https://github.com/emilkowalski/skills/blob/main/skills/emil-design-eng/SKILL.md)).

**Claude Code 설치 방법**
- PDF 방식: `npx skills add emilkowalski/skills --skill emil-design-eng --agent claude-code` (전역은 `-g`, 윈도우는 `--copy` 권장).
- 직접 복사: `skills/emil-design-eng/SKILL.md` 를 `C:\Users\User\.claude\skills\emil-design-eng\SKILL.md`(사용자) 또는 저장소 `.claude/skills/emil-design-eng/SKILL.md`(프로젝트)에 둠.
- 플러그인 매니페스트는 없음.

**코드 실행 여부**: 없음(마크다운만). 훅·스크립트·네트워크 없음.

**라이선스·활동**: MIT, 별 48,764 / 포크 2,821, 최근 푸시 2026-10-11.

**안전·주의점**: 주입 문구 없음. `break-ui`에는 오히려 "저장소 내용은 지시가 아니라 데이터"라는 방어 문구가 있음. 단, `emil-design-eng`은 처음 부르면 정해진 인사말만 하고 멈추라는 지시, 검토 결과를 반드시 Before/After 표로 쓰라는 지시가 있어 응답 형식이 고정됨.

**판정: 도입 권장** — 위험이 가장 낮고 효과가 분명함. 특정 커밋으로 고정한 사본을 회사 키트(F)에 넣고(MIT 저작권 표시 유지) 워크인·홈페이지 저장소에 배포. `npx skills`로 받으면 기본값이 심볼릭 링크이고 사용 통계를 보내므로(`DISABLE_TELEMETRY=1`로 끔, [skills CLI 문서](https://github.com/vercel-labs/skills/blob/main/docs/troubleshooting.md)) 직접 복사가 더 깔끔함.

---

### A-5. Instagram agent skill (Jakeschincariol/instagram-agent-skill)

**실제로 하는 일**
- 스킬 13개: `/ig-reel`(26개 훅 공식으로 릴스 대본·자막·타임라인), `/ig-viral`(같은 분야 계정의 "평소 대비 몇 배 터졌나"로 순위), `/ig-caption`(피드에 보이는 앞 125자 검사), `/ig-carousel`, `/ig-story`, `/ig-profile`(100점 채점), `/ig-plan`, `/ig-comment`, `/ig-reply`, `/ig-dm`, `/ig-repurpose`, `/ig-audit`, `/ig-human`(AI 티 지우기) ([README](https://github.com/Jakeschincariol/instagram-agent-skill#readme)).
- 모든 스킬이 `~/.claude/instagram/voice.md`(말투·입장·금지 주제·증거 숫자)를 읽음 ([templates/voice.md](https://github.com/Jakeschincariol/instagram-agent-skill/blob/main/templates/voice.md)).
- README: "당신이 '예'라고 하기 전엔 아무것도 게시하지 않는다. 이 스킬들은 쓰기만 한다."

**Claude Code 설치 방법**
- 플러그인: `/plugin marketplace add Jakeschincariol/instagram-agent-skill` → `/plugin install instagram-agent@instagram-agent-skill` (README에는 `/plugin install instagram-agent`로만 적혀 있음).
- 직접 복사: `git clone https://github.com/Jakeschincariol/instagram-agent-skill.git` 후 `cp -r instagram-agent-skill/skills/ig-* ~/.claude/skills/` (프로젝트용은 저장소 `.claude/skills/`).

**코드 실행 여부**
- 파이썬 표준 라이브러리 도구 6개(README는 5개로 표기): `hookscore.py`, `beats.py`, `caption.py`, `detect.py`, `humanize.py`, `swipe.py`. import를 검사한 결과 네트워크·하위 프로세스 사용 없음.
- 훅 없음. 단 `/ig-viral`은 유튜브 쇼츠 자료를 위해 `python3 -m yt_dlp ...` 실행을 안내함(yt-dlp는 동봉 안 됨 → 설치가 필요해짐) ([ig-viral SKILL.md](https://github.com/Jakeschincariol/instagram-agent-skill/blob/main/skills/ig-viral/SKILL.md)).

**라이선스·활동**: MIT, 별 2,476 / 포크 552. 커밋 2개(2026-09-13 하루) — 사실상 1회 공개 후 유지보수 없음.

**안전·주의점**
- 좋은 점: "사용자 대신 인스타에 로그인하지 말 것, 비밀번호 묻지 말 것, 자동 수집(크롤링) 금지, 영상이 아니라 공식만 베낄 것" 같은 규칙이 스킬에 명시됨.
- 주의: README 첫 설치법이 "이 주소를 Claude에 붙여넣고 '설치해'라고 하라"는 방식 — 검토 없이 외부 코드를 설치하게 만드는 습관이라 회사에서는 쓰지 말 것.
- 실무상 한계: 금지 단어 목록(`slop.json`)·말하기 속도(분당 150~200단어)·훅 공식이 **영어 기준**이라 한국어 릴스에는 그대로 안 맞음.

**판정: 보류(한국어로 다시 만들어 일부 도입)** — 구조(대본→훅 점수→캡션 검사→AI 티 지우기)와 안전 규칙은 좋음. 워크인 마케팅 품질 검사(`src/lib/mktQuality.ts`)와 겹치는 부분이 있으니, 아이디어를 가져와 **한국어 금지어·한국어 훅 공식·다짐/하이링크 말투 파일**로 우리 키트의 마케팅 스킬을 만드는 쪽을 권장.

---

### A-6. HyperFrames (heygen-com/hyperframes)

**실제로 하는 일**
- HTML로 영상을 만드는 HeyGen의 오픈소스 프레임워크. 시간축을 한 프레임씩 넘기며 헤드리스 Chrome으로 찍고 FFmpeg로 MP4를 만듦. 자막·오버레이·차트·전환 등 약 450개 부품 카탈로그 ([README](https://github.com/heygen-com/hyperframes#readme)).
- 라이선스상 렌더링 수수료 없음("no per-render fees", README "Why HyperFrames?").
- Claude Code용 스킬 7개(핵심 4개: `hyperframes`, `hyperframes-cli`, `hyperframes-registry`, `media-use`).

**Claude Code 설치 방법** (README "Quick Start")
- 플러그인: `claude plugin marketplace add heygen-com/hyperframes` → `claude plugin install hyperframes@hyperframes`, 사용은 `/hyperframes:hyperframes`.
- 스킬만: `npx skills add heygen-com/hyperframes` 또는 `npx hyperframes skills update`.

**코드 실행 여부**
- 스킬이 `npx hyperframes <명령>`(플러그인일 땐 `plugin-cli.mjs`)을 실행시키며, 첫 호출 때 해당 버전 CLI를 npm에서 내려받음 ([plugin-installation.md](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/plugin-installation.md)).
- **사용 통계 기본 켜짐**(PostHog). 끄려면 `hyperframes telemetry disable`, `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1` ([policy.ts](https://github.com/heygen-com/hyperframes/blob/main/packages/cli/src/telemetry/policy.ts), [media-use telemetry.mjs](https://github.com/heygen-com/hyperframes/blob/main/skills/media-use/scripts/lib/telemetry.mjs)).
- 플러그인 자체에 Claude Code 훅은 없음(루트에 `hooks/` 없음).
- 음성·아바타·음악 일부는 HeyGen 유료 기능(`heygen` CLI 로그인 또는 API 키). 스킬에 "직접 고른 유료 호출은 실행 전 확인"이라는 규칙이 있음 ([media-use SKILL.md](https://github.com/heygen-com/hyperframes/blob/main/skills/media-use/SKILL.md)).

**라이선스·활동**: Apache-2.0, 별 70,056 / 포크 6,340, 최근 푸시 2026-10-23(하루 여러 번 릴리스, v0.8.186). 플러그인 원본이 저장소 전체(파일 약 1만 개, 약 0.5GB)라 설치·갱신이 무거울 수 있음 [추정].

**안전·주의점**: 주입 문구는 없지만 **상업적 유도 문구**가 스킬에 들어 있음(렌더 후 HeyGen 데스크톱 앱 "Framey" 안내, 남은 요금제 사용량 확인 등 — [hyperframes SKILL.md](https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md)).

**판정: 보류(노트북에서 시험)** — 워크인 마케팅은 지금 Higgsfield 크레딧으로 영상을 만들고 있음(`src/lib/mktAuto.ts`의 크레딧 실측 주석). "글·숫자 위주 짧은 영상"을 HyperFrames로 무료 렌더링하면 크레딧을 줄일 여지가 있음. 통계 끄고 별도 폴더에서 1~2편 시험 후 결정.

---

### A-7. Playwright MCP (microsoft/playwright-mcp)

이미 `playwright`(운영 프로필), `playwright-extension` 서버로 사용 중. Apache-2.0, 별 38,516, 최근 푸시 2026-10-22 ([저장소](https://github.com/microsoft/playwright-mcp)). Anthropic 공식 마켓에도 `external_plugins/playwright`로 올라가 있음.

**판정: 유지.**

---

### A 공통: `npx skills` 도구에 대해

여러 스킬이 Vercel의 `skills` CLI(npm 1.7.4, MIT)로 설치를 안내함. 확인한 사실:
- Node 22.20 이상 필요. 기본은 현재 프로젝트(`.claude/skills/`)에 설치, `-g`면 `~/.claude/skills/` ([README](https://github.com/vercel-labs/skills#readme), [agents.md](https://github.com/vercel-labs/skills/blob/main/docs/agents.md)).
- 기본은 **심볼릭 링크**, `--copy`로 복사 ([commands.md](https://github.com/vercel-labs/skills/blob/main/docs/commands.md)). 윈도우와 클라우드 세션에서는 복사본이 안전함.
- 익명 사용 통계를 보냄. `DISABLE_TELEMETRY=1` 또는 `DO_NOT_TRACK=1`로 끔 ([troubleshooting.md](https://github.com/vercel-labs/skills/blob/main/docs/troubleshooting.md)).

### A 판정 요약
- **도입 권장**: Emil skills(문서형, 고정 사본으로).
- **부분 도입**: Awesome Design(우리 DESIGN.md 형식 참고용).
- **보류**: Impeccable(격리 시험), Taste(홈페이지 시안 때만), Instagram(한국어 재작성), HyperFrames(노트북 시험).
- **유지**: Playwright MCP.
- 공통 원칙: 외부 플러그인은 자동 갱신을 켜지 말고 커밋을 고정해서 쓰기. 공식 문서도 "플러그인은 사용자 권한으로 임의 코드를 실행할 수 있고, 자동 갱신되면 검토한 파일이 바뀔 수 있다"고 경고함 ([Plugin security](https://code.claude.com/docs/en/plugins/security)).

---

## B. "클로드 레플리카 스킬" 후보

대표가 말한 이름과 정확히 일치하는 것을 찾음: **Jakeschincariol/replica-skill — "The Replica skill"**. 인스타 스킬(A-5)과 같은 제작자라, 같은 PDF 작가가 다룬 것으로 보임 ([저장소](https://github.com/Jakeschincariol/replica-skill), [FollowAgents 소개](https://followagents.com/zh/agents/replica-skill)).

### 후보 1. Replica skill (Jakeschincariol/replica-skill)
- **하는 일**: "어떤 앱이든 복제하는" 스킬 11개를 순서대로 실행: `recon`(화면 목록·흐름·부품·추정 데이터 구조·기능표) → `architect` → `design`(스크린샷을 측정해 색 역할·글자 크기·8px 간격을 토큰으로) → `build` → `backend` → `test`(Playwright 시험) → `diff`(원본 대비 기능 점수·레이아웃 차이) → `entrepreneur`(원본 사용자 불만 리뷰 분석) → `brand`(새 이름·색으로 바꾸고 원본 흔적 검사) → `launch` → `deploy` ([README](https://github.com/Jakeschincariol/replica-skill#readme)).
- **실행 도구**: 표준 라이브러리 파이썬 6개(`imgdiff.py` 색을 무시한 레이아웃 비교, `parity.py` 필수/권장/선택 가중 점수, `reviews.py`, `contrast.py` 명도 대비, `sweep.py` 원본 이름·도메인·색 잔존 검사, `listing.py`). import 검사 결과 네트워크 없음.
- **규칙**: "기능과 사용 흐름만 새로 만든다(클린룸). 원본 코드·로고·상표·문구·비공개 API는 가져가지 않는다. 공개 페이지와 본인 계정만 본다. 출시 전 반드시 리브랜딩" (README "Fine print", [replica-recon SKILL.md](https://github.com/Jakeschincariol/replica-skill/blob/main/replica-recon/SKILL.md), [replica-design SKILL.md](https://github.com/Jakeschincariol/replica-skill/blob/main/replica-design/SKILL.md)). `deploy`는 "사용자가 가라고 하기 전엔 운영에 올리지 않는다".
- **설치**: `/plugin marketplace add Jakeschincariol/replica-skill` → `/plugin install replica-skill@replica-skill` (명령은 `/replica-skill:replica-recon` 형태). 또는 `git clone https://github.com/Jakeschincariol/replica-skill.git` 후 `cp -r replica-skill/replica-* ~/.claude/skills/`.
- **성숙도**: MIT, 별 4,692 / 포크 829지만 **커밋 1개(2026-10-03 v1.0)**. 시험 코드(tests/)는 있음. 초기판.
- **우리에게 맞는 부분**: "글로싸인처럼", "아사나처럼" 같은 요청(최근 커밋 #463 전자계약 글로싸인 비교 등)에 `recon`의 기능표(features.csv), `design`의 토큰 측정, `diff`의 점수·레이아웃 비교, `brand`의 원본 흔적 검사가 그대로 쓸모 있음. `build/backend/deploy`는 우리 스택·배포 규칙과 겹치거나 충돌하므로 쓰지 않음.

### 후보 2. AI Website Cloner Template (JCodesMore/ai-website-cloner-template)
- **하는 일**: Next.js 16 템플릿 저장소 + `/clone-website <url>` 명령. 브라우저로 원본을 데스크톱·모바일 폭에서 살펴보고 섹션별로 다시 만든 뒤, 같은 화면폭·스크롤 위치에서 비교하며 고침 ([SKILL.md](https://github.com/JCodesMore/ai-website-cloner-template/blob/master/.agents/skills/clone-website/SKILL.md), [README](https://github.com/JCodesMore/ai-website-cloner-template#readme)).
- **핵심 차이**: "원본의 실제 문구와 실제로 불러오는 글꼴·이미지·SVG·영상 파일을 쓰라"고 지시 → 픽셀 수준 복제(남의 자산 포함). 사내 학습·분석용으로는 강력하지만 **그대로 서비스에 쓰면 저작권 문제**.
- **설치**: 템플릿을 새 저장소로 만든 뒤 그 저장소에서 `/clone-website https://example.com`. Node 24+ 필요. 플러그인 아님.
- **성숙도**: MIT, 별 37,187 / 포크 5,447, v0.6.1(2026-10-05), 활발.

### 후보 3. 스크린샷→화면 1:1 재현 스킬들
- 예: OneWave-AI `screenshot-to-code`(`npx skills add onewave-ai/claude-skills --skill screenshot-to-code --agent claude-code`, [claudeskills.info](https://claudeskills.info/ko/skills/onewave-ai/claude-skills/screenshot-to-code/)), agentspec `image-to-ui`, SSIM 점수로 비교하는 `Filtar2000/match-reference`(별 1), `voidmatcha/ui-clone-skills`(별 15) ([GitHub 검색](https://github.com/topics/image-to-code)).
- 대부분 별이 적고 유지보수 이력이 짧음. 아이디어(같은 화면폭에서 렌더 → 비교 → 큰 차이부터 수정 → 확인 못한 건 '확인 안 됨'이라고 말하기)는 좋음.

### B 판정: **부분 도입**
- 바로 쓰기보다 **우리 키트에 "레퍼런스 대조" 스킬 + 에이전트를 직접 만들기**를 권장(F의 `kit-reference-matcher`).
  - 정찰·기능표는 replica의 `recon` 형식(features.csv 필수/권장/선택) 차용
  - 레이아웃 비교는 replica의 `imgdiff.py`(MIT, 출처 표기) + Playwright 스크린샷
  - "로고·브랜드색·문구 복제 금지, 워크인 토큰만 사용" 검사를 기본 규칙으로
- replica-skill 원본은 노트북에서 개인 범위로 시험 설치 정도는 괜찮음(실행 코드가 표준 라이브러리 파이썬뿐). AI Website Cloner는 **별도 폐기용 저장소에서 분석용**으로만.

---

## C. 무료·저가 모델로 Claude Code 돌리기

### C-1. 공식 입장과 구조
- Claude Code는 `ANTHROPIC_BASE_URL`(주소) + `ANTHROPIC_AUTH_TOKEN` 또는 `ANTHROPIC_API_KEY`(인증)로 다른 "게이트웨이"를 쓸 수 있음. 영구 설정은 `~/.claude/settings.json`의 `env` 블록 ([Connect to an LLM gateway](https://code.claude.com/docs/en/llm-gateway-connect)).
- 하지만 공식 문서 문장 그대로: "Anthropic은 어떤 게이트웨이를 통해서도 Claude Code를 Claude가 아닌 모델로 보내는 것을 지원하지 않는다" ([Other LLM gateways](https://code.claude.com/docs/en/llm-gateway)).
- 게이트웨이 인증을 켜면 claude.ai 구독 한도 대신 그 업체 요금으로 과금됨. **클라우드 세션(claude.ai/code)에는 게이트웨이 설정이 적용되지 않음.** 주소가 Anthropic이 아니면 Remote Control도 꺼짐 (같은 문서 "Slack, cloud sessions, and Remote Control").

### C-2. 실제 선택지 (2026-10 기준)

| 방법 | 설정 요지 | 가격 | 데이터 |
|---|---|---|---|
| **Ollama(로컬)** | `ollama launch claude` 또는 `ANTHROPIC_BASE_URL=http://localhost:11434`, `ANTHROPIC_AUTH_TOKEN=ollama`, `ANTHROPIC_API_KEY=""`, `claude --model qwen3.5`. 문맥 64K 이상 권장 ([Ollama 문서](https://docs.ollama.com/integrations/claude-code)) | 토큰 요금 없음(PC 성능 필요) | 로컬이면 밖으로 안 나감. 단 Ollama 클라우드 모델을 고르면 나감 |
| **LM Studio(로컬)** | `ANTHROPIC_BASE_URL=http://localhost:1234` 등 ([LM Studio 문서](https://lmstudio.ai/docs/integrations/claude-code)) [Perplexity 경유, 원문 미열람] | 없음 | 로컬 |
| **OpenRouter** | `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `ANTHROPIC_AUTH_TOKEN=$OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY=""`. 문서 스스로 "Anthropic 1P 제공자에서만 동작 보장"이라고 함 ([OpenRouter 문서](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration)) | 무료 모델 있음(무료 등급 하루 50회, $10 이상 충전 시 1,000회 — [Perplexity 경유] ) | 제공자마다 로그·학습 정책이 다름, 계정에서 "학습하는 제공자 제외" 설정 필요 ([provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging)) |
| **DeepSeek** | `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic` ([가이드](https://api-docs.deepseek.com/guides/anthropic_api/)) | `deepseek-flash`(V4.1-Flash) 입력 $0.15/출력 $0.60(비혼잡), `deepseek-v4-pro` $0.66/$1.98(비혼잡). 혼잡 시간은 2배 ([가격표](https://api-docs.deepseek.com/quick_start/pricing)) | 개인정보처리방침상 기술 학습·개선에 쓸 수 있고(설정에서 거부 가능), 서버는 중국 ([방침](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)) |
| **Z.ai GLM 코딩 플랜** | `ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic`, 모델 `glm-5.3` / `glm-5.3-flash` ([Z.ai 문서](https://docs.z.ai/devpack/tool/claude)) | 월 $18부터(5시간·주간 한도) ([개요](https://docs.z.ai/devpack/overview)), API는 GLM-5.3 $1.4/$4.4 ([가격](https://docs.z.ai/guides/overview/pricing)) | 학습 미사용 주장은 [미확인] |
| **Moonshot Kimi** | `ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic`, `kimi-k3[1m]`, 하이쿠 자리에 `kimi-k2.7-code`(생각 모드 강제) ([Kimi 문서](https://platform.kimi.ai/docs/guide/claude-code-kimi)) | K3 $3/$15 [미확인: 공식 표가 안 읽힘] | 약관상 서비스 개선에 사용 가능 [Perplexity 경유] |
| **MiniMax** | `ANTHROPIC_BASE_URL=https://api.minimax.io/anthropic` [Perplexity 경유] | M3.1-Flash $0.15/$0.60, M3 $0.30/$1.20 ([가격](https://platform.minimax.io/docs/pricing/overview)) | 학습 관련 문구가 좁음 [Perplexity 경유] |
| **Alibaba Qwen(DashScope)** | 코딩 플랜 전용 주소·키가 따로 있음 [Perplexity 경유, 원문 미열람] | 국제판 코딩 플랜 Pro 월 $50 [미확인] | 별도 동의 없이 학습 안 함, 보존 최대 30일 [미확인] |
| **claude-code-router(CCR)** | 로컬 중계 프로그램(지금은 데스크톱 앱 v3.1.3, 기본 `http://127.0.0.1:3456`). 작업 종류별로 다른 모델에 나눠 보냄 ([README](https://github.com/musistudio/claude-code-router#readme)) | 중계 자체는 무료(MIT, 별 37,812) | 결국 위 업체들로 전송됨. README 후원사 목록에 "Claude API 재판매" 성격 사이트가 섞여 있음 → 절대 쓰지 말 것 |
| LiteLLM / y-router | LiteLLM은 사내 게이트웨이용. y-router는 보관(archived) 상태 | — | — |

### C-3. 무엇이 깨지나
- **품질(가장 중요)**: 같은 Claude Code 환경으로 잰 Terminal-Bench 4.0 점수(2026-10-12 기준): Claude Opus 5.5 **64.8%**, GLM-5.3 **41.8%**, GLM-5.3-Flash 35.8%, Qwen3.8-Max 27.0% ([developertoolkit.ai 정리](https://developertoolkit.ai/en/ecosystem/models/open-weight/); 공식 [tbench.ai](https://www.tbench.ai/leaderboard)는 화면이 스크립트로 그려져 직접 확인 못함 → 2차 출처). 업체가 자랑하는 Terminal-Bench 2.1의 88~90점은 포화된 옛 버전이라 비교 불가.
- **도구 호출**: 같은 형식으로 연결돼도 모델이 파일 편집 대신 말로만 답하는 경우가 흔함. Ollama는 강제 도구 선택·지연 로딩 도구를 완전 지원하지 않고, 웹 검색 등 호스팅 도구도 "완전 지원 아님" ([Ollama 문서](https://docs.ollama.com/integrations/claude-code)).
- **베타 기능 충돌**: Claude Code가 보내는 최신 필드(context_management, effort, 적응형 생각 등)를 업체가 거부하면 400 오류. `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1` 등으로 기능을 꺼야 함 ([호환성 가이드](https://code.claude.com/docs/en/llm-gateway-protocol)).
- **캐싱·문맥**: 프롬프트 캐시 표시가 전달 안 되면 매번 전액 과금. 문맥 한도가 작으면 긴 작업 중간에 무너짐.
- **우리 환경 특유**: 클라우드 세션에서는 아예 못 씀. 노트북에서 켜면 구독 대신 그 업체로 과금되고 Remote Control·음성 입력이 꺼짐.

### C-4. 비용을 줄이는 올바른 방법 (품질 유지)
- Claude 안에서 모델을 나눠 쓰기: 하위 에이전트 파일에 `model: haiku` 또는 `model: sonnet`(또는 `CLAUDE_CODE_SUBAGENT_MODEL`)을 지정 ([Subagents](https://code.claude.com/docs/en/sub-agents)). 탐색·로그 읽기·형식 정리는 Haiku, 검수는 Sonnet, 설계·최종 판단은 Opus.
- 참고 API 가격(100만 토큰당): Opus 5.5 $4/$20, Sonnet 5.5 $2/$10, **Haiku 5.5 $0.10/$0.50**(10만 토큰 이하 프롬프트) ([Anthropic 가격표](https://platform.claude.com/docs/en/about-claude/pricing)). Haiku 5.5는 DeepSeek Flash(비혼잡 $0.15/$0.60)와 비슷하거나 싸면서 호환성 문제·해외 전송 문제가 없음. 구독으로 쓰는 경우엔 돈 대신 사용 한도를 아끼는 효과.

### C 판정: **비권장**(주 작업) / 제한적 시험만
- 품질 손실을 받아들이지 않는다는 조건이면, 코드 작업을 비-Claude 모델로 돌리는 것은 권하지 않음(점수 격차, 클라우드 불가, 코드·고객 데이터 해외 전송).
- 꼭 시험하려면: **로컬 Ollama만**, 회사 저장소가 아닌 별도 폴더에서, 공개 자료 요약 같은 잡일에 한정. DeepSeek·Kimi 등 해외 API에는 회사 코드와 고객 정보를 보내지 않음.

---

## D. 메타 광고 자동 세팅 (소재 넣으면 캠페인 자동 생성)

### D-1. 쓸 수 있는 통로

| 통로 | 할 수 있는 일 | 상태·비용 | 근거 |
|---|---|---|---|
| **Meta 공식 Ads MCP 서버** `https://mcp.facebook.com/ads` | 자연어로 캠페인·광고 세트·광고 생성/수정, 리포트, 카탈로그, 신호 진단, A/B 시험 | **공개 베타**(2026-04-29 발표), 무료. 2026-07-16부터 개발자 앱도 연결 가능(`ads_mcp_management` 권한, 남의 비즈니스 관리 시 앱 검수+고급 접근). 쓰기에 삭제도 포함 | [Meta 발표](https://www.facebook.com/business/news/meta-ads-ai-connectors/), [개발자 문서](https://developers.facebook.com/documentation/ads-commerce/ads-ai-connectors/ads-mcp-server/ads-mcp-server-overview), [PPC Land](https://ppc.land/meta-opens-ads-mcp-to-any-app-cutting-integration-code-to-zero/) |
| **Marketing API 직접 호출** | `/act_{id}/adimages`·`/advideos`(소재 업로드) → `/campaigns` → `/adsets` → `/adcreatives` → `/ads` | 무료(광고비만). 워크인이 이미 이 방식으로 성과를 읽고 있음 | [캠페인 레퍼런스](https://developers.facebook.com/docs/marketing-api/reference/ad-account/campaigns/) |
| **Pipeboard meta-ads-mcp** | 캠페인·세트·광고·소재 생성, 이미지 업로드, 예산 수정. 새로 만든 건 기본 일시정지 | 호스팅형 무료(주 30회)·Pro $29.90·Premium $99·Agency $199/월. 소스는 BSL 1.1(2029-01-01 Apache 전환), 별 1,325 | [README](https://github.com/pipeboard-co/meta-ads-mcp#readme), [LICENSE](https://github.com/pipeboard-co/meta-ads-mcp/blob/main/LICENSE), [가격](https://pipeboard.co/pricing) |
| Windsor.ai MCP(이미 연결됨) | 캠페인·세트·광고 생성/일시정지/예산 변경 가능, 소재 업로드는 목록에 없음 | 유료 구독 | [Perplexity 경유, windsor.ai 문서] |
| GoMarble facebook-ads-mcp-server | 읽기 위주(생성 도구 문서화 안 됨) | MIT | [저장소](https://github.com/gomarble-ai/facebook-ads-mcp-server) [Perplexity 경유] |

주의: Pipeboard README는 토큰을 주소 뒤에 붙이는 방식(`?token=...`)을 안내함 — 주소에 비밀값을 넣으면 기록에 남을 수 있어 권하지 않음. Meta 공식 MCP의 "새 광고는 기본 일시정지"는 Perplexity가 Meta 도움말을 근거로 들었지만 도움말 본문을 직접 읽지 못해 **[미확인]**.

### D-2. 권한·심사 요건 (공식 문서 확인)
- 자사 광고 계정만 관리하면 `ads_read`·`ads_management`의 **표준 접근(standard access)으로 충분**. 다른 회사 계정을 관리하려면 **고급 접근**(앱 검수), 민감 데이터면 **비즈니스 인증** 필요 ([Authorization](https://developers.facebook.com/docs/marketing-api/overview/authorization/)).
- Marketing API 접근 등급: 기본 "Limited access"는 **개발용, 실제 광고주 운영용 아님**. "Full access"는 앱 검수 후이며, 최근 15일간 Marketing API 호출 500회 이상이 조건 (같은 문서).
- 캠페인 생성 필수값: `special_ad_categories`(배열, 해당 없으면 `[]`). 목표는 `OUTCOME_LEADS`·`OUTCOME_TRAFFIC` 등 6종. **생성 시 상태는 ACTIVE 또는 PAUSED만 가능.** 캠페인 지출 한도 `spend_cap`은 최소 미화 $100 상당 ([캠페인 레퍼런스](https://developers.facebook.com/docs/marketing-api/reference/ad-account/campaigns/)).
- 채용 광고는 `EMPLOYMENT` 등 특별 카테고리 선언이 필요할 수 있음(국가별 적용 범위는 [미확인] — 집행 전 확인).

### D-3. 워크인 현재 상태 (코드에서 확인)
- 메타 성과 읽기: OAuth 범위 `ads_read`, `graph.facebook.com/v21.0/act_{id}/insights` 호출 (`src/lib/marketingAds.ts` 16·24·121·363행).
- 리드 광고 연결: 요청 권한에 이미 `ads_management` 포함 — `META_LEAD_SCOPES = ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata', 'ads_management']` (`src/lib/metaLeads.ts` 25행). 즉 개발 모드 앱이어도 앱 역할이 있는 사람의 자사 계정이면 광고 생성 권한은 받을 수 있는 구조.
- 콘텐츠 승인함·승인자·마감·품질 검사 흐름이 이미 있음 (`src/components/marketing/ApprovalCard.tsx`, `src/lib/mktAuto.ts`의 `approvers`, `qualityCheck`).
- **버전 문제(추가 발견)**: 코드 전체가 `v21.0`을 씀(`marketingAds.ts`, `metaLeads.ts`, `mktPublish.ts`, `mktChannels.ts`). Marketing API v21.0은 **2025-09-09에 만료**됐고 v24.0도 2026-10-06 만료 ([Marketing API 버전표](https://developers.facebook.com/docs/marketing-api/marketing-api-changelog/versions/)). 만료 버전 호출은 영향 없는 엔드포인트(예: insights 읽기)만 자동 상향되고, 영향 받는 엔드포인트(예: 광고 세트 쓰기)는 `#2635` 오류로 실패 ([Meta 블로그](https://developers.facebook.com/blog/post/2024/04/16/upcoming-change-in-marketing-api-version-deprecation/)). Graph API v21.0 자체는 2027-01-21까지 ([Graph 버전표](https://developers.facebook.com/docs/graph-api/changelog/versions/)). → 새 광고 생성 기능은 **v25.0 이상(현재 v26.0)** 으로 작성해야 하고, 기존 호출도 올리는 게 안전.

### D-4. 워크인에 넣는 안전한 설계 ("소재 넣기 → 자동 캠페인")
1. **입력**: 마케팅 화면에서 소재(이미지·영상)와 짧은 지시(브랜드, 목적=리드/방문, 지역=단지 반경, 기간, **승인 예산 상한**)를 올림.
2. **자동 품질 검사**: 기존 `qualityCheck`(금지어·확인 안 된 숫자·자리표시 등) + 메타 정책 점검(특별 카테고리 필요 여부, 리드 양식의 개인정보처리방침 링크).
3. **초안 생성(돈 안 나감)**: 서버에서 `/adimages`·`/advideos` 업로드 → 캠페인·광고 세트·광고를 **모두 `status=PAUSED`** 로 생성, 캠페인에 `spend_cap` 설정. 생성된 ID와 미리보기를 DB에 "광고 초안"으로 저장.
4. **승인함**: 기존 승인 카드에 "광고 초안" 종류 추가. 하루 예산·총 상한·기간·타깃·소재 미리보기를 한 화면에.
5. **집행**: 승인권자(대표/지정 승인자)가 승인하면 서버가 상한 이하인지 다시 확인한 뒤 ACTIVE로 전환. 이 전환 경로는 서버(`src/lib/access.ts`)에서만 허용하고, 승인 기록·감사 로그 필수.
6. **사후 관리**: 기존 성과 동기화로 리드 단가 감시. "기준 초과 시 자동 일시정지"는 돈을 아끼는 방향이라 자동 허용, **예산 증액은 항상 승인 필요**.
7. **토큰**: 비즈니스 관리자 시스템 사용자 토큰(필요한 광고 계정만 연결), 서버 암호화 저장(기존 `secret_enc` 방식), 화면·주소에 노출 금지.
8. **단계**: (1) 자사 계정(다짐·하이링크)에만 개발 모드로 → (2) 실제 집행 늘면 Full access 신청 → (3) 워크인 고객사 계정까지 열려면 `ads_management` 고급 접근 + 앱 검수 + 비즈니스 인증(하이링크 명의).
- **사내 운영용 별도 경로**: Claude에서 Meta 공식 Ads MCP를 써서 대표가 말로 캠페인을 다루는 것도 가능(무료 베타). 단 연결 자체가 "새 통합 설정"이라 대표 승인 필요(회사 운영 규칙의 하드 게이트). 쓰기 도구는 매번 확인을 받도록 권한을 `ask`로 두고, 메타 쪽 역할도 최소 권한으로. Claude Code 연결 명령 예: `claude mcp add --transport http meta-ads https://mcp.facebook.com/ads` [지원 클라이언트 목록 미확인].

### D 판정: **도입 권장(단계적)**
- 1순위: 워크인 자체 구현(Marketing API v25+/v26, 전부 PAUSED 생성 → 승인함 → 승인 시 집행). 비용은 광고비뿐이고 기존 승인함·품질 검사·성과 동기화를 재사용.
- 2순위: Meta 공식 Ads MCP는 사내 운영 보조로 시험(대표 승인 후). Pipeboard는 여러 광고 매체를 한 번에 다룰 때나 고려(유료, BSL 라이선스).
- 선행 작업: 메타 API 버전을 v21.0 → v25.0 이상으로 올리기.

---

## E. Blotato · Canva · Higgsfield · Computer use 대체재

| 도구 | 확인한 사실 | 우리 상황 | 판정 |
|---|---|---|---|
| **Blotato** (`https://mcp.blotato.com/mcp`) | 요금: Starter $29, Creator $97, Agency $499/월. API·MCP는 유료 플랜에 포함, 7일 체험에는 제외 ([가격](https://www.blotato.com/pricing)). 인증은 OAuth 또는 `blotato-api-key` 헤더, 지원 플랫폼 9개(목록 전부는 확인 못함) ([MCP 문서](https://help.blotato.com/start-with-an-ai-agent/mcp)) | 워크인이 이미 인스타·페이스북·스레드·유튜브·네이버 블로그 게시 흐름을 가짐(`ApprovalCard.tsx` 채널 목록). 네이버·카카오 지원은 확인 안 됨 | **비권장**(중복, 계정 토큰을 외부에 또 맡김) |
| **Canva** (`https://mcp.canva.com/mcp`) | 공식 MCP, Claude Code 지원. 디자인 검색·생성·자동 채우기·PNG/PDF 내보내기. 자동 채우기·브랜드 템플릿의 요금제 조건이 문서마다 다름(Pro 이상 vs Enterprise) ([도구 문서](https://www.canva.dev/docs/apps/mcp/tools/), [AI Connector](https://www.canva.com/ai-connector/)) [Perplexity 경유] | 팀이 캔바로 디자인을 실제로 하고 있으면 가치 있음 | **보류**(실사용 확인 후) |
| **Higgsfield** | 이미 MCP 연결됨(광고 스튜디오·쇼츠·틱톡 게시 등 도구 다수). 가격 페이지는 스크립트로 그려져 확인 못함 [미확인] | ChatGPT용 Higgsfield 플러그인과 같은 기능을 이미 보유 | **유지** |
| **Computer use** | Claude Code 데스크톱에 이미 computer-use 도구가 있음(이 노트북에서 확인), Claude in Chrome·Playwright도 있음 | ChatGPT의 Computer Use 플러그인 불필요 | **유지** |
| **Record & Replay** | ChatGPT 데스크톱의 Codex 기능, **맥(macOS) 전용**, Computer Use 필요, EU·영국·스위스 제외(2026-06-18) ([OpenAI 릴리스 노트](https://help.openai.com/en/articles/10128477-chatgpt-enterprise-and-edu-release-notes)) | 노트북이 윈도우라 사용 불가. Claude in Chrome의 **"Record a workflow"** 로 녹화 → 단축 명령 저장 → 예약 실행 가능(클래식 사이드 패널 한정) ([Claude 도움말](https://support.claude.com/en/articles/12012173-get-started-with-claude-in-chrome)) | **대체** |
| **HyperFrames** | A-6 참고 | — | **보류**(시험) |

**판정 요약**: 새로 돈 드는 연결은 추가하지 않음. Blotato 비권장, Canva 보류, 나머지는 이미 있는 것으로 충분.

---

## F. 회사 키트 구조와 "레벨 3" 에이전트

### F-1. 공식 문서로 확인한 사실 (설계의 전제)
1. **마켓 파일 형식**: 저장소의 `.claude-plugin/marketplace.json`. 필수 필드는 `name`, `owner`, `plugins` 배열. 각 항목은 `name`과 `source`(예: `"./plugins/이름"` 상대경로, 또는 `{ "source": "github", "repo": "소유자/저장소" }`, `git-subdir`, `url`, `archive`, `npm`) ([Create a marketplace](https://code.claude.com/docs/en/plugin-marketplaces)).
2. **플러그인 형식**: `.claude-plugin/plugin.json`(필수 필드는 `name`뿐, 없어도 로드됨). 기본 폴더 `skills/`, `agents/`, `commands/`, `hooks/hooks.json`, `.mcp.json`, `bin/`, `monitors/monitors.json`, `settings.json`(효력 있는 키는 `agent`, `subagentStatusLine`뿐). 경로 변수 `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` ([Add components](https://code.claude.com/docs/en/plugins/components)).
3. **설정 키**: 마켓 등록 `extraKnownMarketplaces`, 켜기 `enabledPlugins`(`"플러그인@마켓": true`). 조직 강제는 관리 설정의 `strictKnownMarketplaces`(허용 목록), `blockedMarketplaces`, 마켓 항목의 `autoUpdate`. 별칭 `additionalMarketplaces`/`allowedMarketplaces`는 v2.1.232 이상 ([Manage plugins for your organization](https://code.claude.com/docs/en/plugins/org)).
4. **비공개 저장소 접근**: Claude Code는 자체 git 토큰이 없고 PC에 저장된 git 자격을 씀. GitHub은 `gh auth login` 후 `gh auth setup-git`. `GITHUB_TOKEN` 환경변수만으로는 백그라운드 갱신이 인증되지 않음. 자동 갱신은 기본 꺼짐(`/plugin` → Marketplaces → Enable auto-update) ([Host a marketplace](https://code.claude.com/docs/en/plugins/host-marketplace)).
5. **저장소별 설정**: 저장소 `.claude/settings.json`의 `extraKnownMarketplaces`는 폴더 신뢰 후 적용, 마켓 안 상대경로 플러그인은 그대로 로드 ([org 문서 "Require plugins per repository"](https://code.claude.com/docs/en/plugins/org)).
6. **가장 중요한 제약 — 클라우드 세션**: "클라우드 세션은 저장소 `.claude/settings.json`이 켜는 플러그인을 설치하지 않는다(나열한 마켓 포함)." 사용자 `~/.claude/skills`·`agents`·사용자 범위 플러그인도 안 들어감. 반대로 **저장소의 `CLAUDE.md`, `.claude/rules/`, `.claude/skills/`, `.claude/agents/`, `.claude/commands/`, `.claude/settings.json`의 훅·권한, `.mcp.json`은 들어감** ([Cloud environments "What carries over"](https://code.claude.com/docs/en/cloud-environments), [Install plugins "Cloud session"](https://code.claude.com/docs/en/plugins/install)).
7. **claude.ai 계정 스킬**: claude.ai에서 켠 스킬은 클라우드 세션·Cowork·(같은 계정으로 로그인한) 터미널에 동기화됨(터미널은 `~/.claude/skills/synced/`). 업로드 경로: Customize → Skills → + → Create skill → Upload a skill. 단 claude.ai 업로드는 프런트매터를 `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`만 허용(다른 필드는 오류) ([Skills](https://code.claude.com/docs/en/skills), [Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)).
8. **Team/Enterprise라면**: 관리자(Owner)가 claude.ai의 서버 관리 설정에 `extraKnownMarketplaces`/`enabledPlugins`를 넣으면 클라우드 세션도 그걸 받아 플러그인을 설치함 (org 문서 "When each surface applies the plugin keys").
9. **클라우드 프로젝트 스레드**: 프로젝트 안의 클라우드 스레드는 루트 `CLAUDE.md`·`.claude/CLAUDE.md`·`.claude/rules/`만 읽고 저장소 스킬·에이전트는 안 읽음 (Cloud environments 문서 주석) → 그런 곳에는 claude.ai 계정 스킬이 필요.

→ 결론: "비공개 마켓 + 각 저장소 settings.json에서 켜기"만으로는 **클라우드 세션에서 동작하지 않음**. 그래서 아래처럼 섞어서 설계.

### F-2. 권장 구조: "원본 저장소 1개 + 각 저장소에 복사 + 노트북 전용 플러그인"

**1) 비공개 저장소 `dlehdwo85/claude-company-kit`** (원본)
```
claude-company-kit/
├── .claude-plugin/marketplace.json      # 노트북 전용 플러그인 목록
├── kit/                                  # 모든 저장소에 복사할 원본
│   ├── skills/
│   │   ├── kit-workin-design/SKILL.md    # 워크인 DESIGN.md 규칙(우리 것)
│   │   ├── kit-reference-match/          # B에서 말한 레퍼런스 대조
│   │   │   ├── SKILL.md
│   │   │   └── scripts/imgdiff.py        # replica-skill(MIT) 사본, 출처 표기
│   │   ├── kit-ko-copy/SKILL.md          # 한국어 문구·광고 표현 기준
│   │   └── emil-design-eng/SKILL.md      # 외부 MIT 사본(고정 커밋, LICENSE 동봉)
│   └── agents/
│       ├── kit-design-reviewer.md
│       ├── kit-reference-matcher.md
│       ├── kit-prod-verifier.md
│       ├── kit-marketing-qa.md
│       ├── kit-sales-data-qa.md
│       └── kit-ads-launch-gate.md
├── plugins/
│   └── kit-local-ops/                    # 노트북에서만 쓰는 것(운영 브라우저 확인 등)
│       ├── .claude-plugin/plugin.json
│       └── skills/…
├── vendor/                               # 외부 원본 스냅숏 + 커밋 SHA + LICENSE
└── scripts/sync-kit.sh                   # kit/ → 각 저장소 .claude/ 로 복사
```

`marketplace.json` 예시(형식은 공식 문서 기준):
```json
{
  "name": "dagym-kit",
  "description": "다짐·하이링크·워크인 공용 Claude Code 도구(노트북 전용)",
  "owner": { "name": "dlehdwo85" },
  "plugins": [
    {
      "name": "kit-local-ops",
      "source": "./plugins/kit-local-ops",
      "description": "운영 프로필 브라우저로 배포 확인 등 노트북 전용 기능"
    }
  ]
}
```
`plugins/kit-local-ops/.claude-plugin/plugin.json` 예시:
```json
{ "name": "kit-local-ops", "version": "0.1.0", "description": "노트북 전용 운영 확인 도구" }
```
(마켓 항목 이름과 plugin.json의 `name`은 같게 — 다르면 설치 오류, 공식 문서 "Keep the entry name and the manifest name the same")

**2) 각 저장소(워크인, 다짐 홈페이지, 하이링크 홈페이지 …)에는 복사본을 커밋**
- `scripts/sync-kit.sh <저장소경로>`가 `kit/skills/*` → `<저장소>/.claude/skills/`, `kit/agents/*` → `<저장소>/.claude/agents/`로 복사하고 `.claude/kit.lock`에 키트 커밋 SHA를 기록. 파일 머리에 "claude-company-kit에서 생성 — 여기서 고치지 말 것" 표시.
- 이렇게 하면 노트북·클라우드·협업자 모두 같은 스킬·에이전트를 씀(클라우드에서 확인된 유일한 공통 경로).
- 이 복사 작업은 로컬 세션 담당으로 정하고, 워크인 CLAUDE.md의 담당 구역 표에 `.claude/skills/kit-*`, `.claude/agents/kit-*`를 추가하는 것을 권장(지금 표에는 `.claude/` 담당이 없음).
- 같은 내용을 플러그인으로도 켜면 노트북에서 `kit-core:…`와 복사본이 이중으로 보이므로, **공용 스킬·에이전트는 복사본 한 가지로만** 운영.

**3) 노트북 사용자 설정** `C:\Users\User\.claude\settings.json`에 추가(기존 내용과 병합):
```json
{
  "extraKnownMarketplaces": {
    "dagym-kit": {
      "source": { "source": "github", "repo": "dlehdwo85/claude-company-kit" }
    }
  },
  "enabledPlugins": {
    "kit-local-ops@dagym-kit": true
  }
}
```
- 사전 준비: `gh auth setup-git` (현재 `gh`는 dlehdwo85로 로그인돼 있음을 확인). 자동 갱신은 `/plugin` → Marketplaces → dagym-kit → Enable auto-update. (`autoUpdate` 키는 관리 설정 예시로만 문서화돼 있어 사용자 설정에서의 동작은 [미확인])
- 외부 플러그인(Impeccable 등)을 쓰게 되더라도 사용자 범위에 두고 자동 갱신은 끈 채 검토 후 수동 갱신.

**4) 저장소 없이 클라우드에서도 필요한 개인 스킬** → claude.ai 계정 스킬로 업로드(F-1의 7번, 프런트매터 제한 주의).

**5) 나중에 Team/Enterprise로 가면** → 서버 관리 설정에 `extraKnownMarketplaces`/`enabledPlugins`를 넣어 클라우드까지 플러그인으로 통일 가능.

### F-3. 레벨 3을 위한 커스텀 에이전트 6개

에이전트 파일 형식(공식): `.claude/agents/<이름>.md`, 프런트매터 `name`(필수), `description`(필수), 선택 `tools`, `disallowedTools`, `model`(sonnet/opus/haiku/fable/전체 ID/inherit), `permissionMode`, `skills`(시작 시 스킬 주입), `mcpServers`, `hooks`, `memory`, `effort`, `isolation: worktree`, `color` 등 ([Subagents](https://code.claude.com/docs/en/sub-agents)). 플러그인으로 배포한 에이전트는 `hooks`·`mcpServers`·`permissionMode`가 무시됨 → 저장소 복사본 방식이 유리.

| 에이전트 | 모델 | 도구(권장) | 역할 요약 |
|---|---|---|---|
| `kit-design-reviewer` | inherit | Read, Grep, Glob, Bash(스크린샷) | 화면 변경 검수 |
| `kit-reference-matcher` | inherit | Read, Grep, Glob, Bash, WebFetch | 레퍼런스 대비 기능·레이아웃 대조 |
| `kit-prod-verifier` | sonnet | Read, Grep, Bash, WebFetch | main 푸시 후 운영 확인 |
| `kit-marketing-qa` | sonnet | Read, Grep, Glob | 게시물·광고 문구 검수 |
| `kit-sales-data-qa` | sonnet | Read, Grep, Bash(읽기 전용 조회) | 영업·리드 데이터 검수 |
| `kit-ads-launch-gate` | inherit | Read, Grep, Bash | 광고 초안 체인의 관리자 |

1. **kit-design-reviewer (디자인 검수자)** — 화면을 바꾼 커밋마다 우리 `DESIGN.md`(워크인 토큰·부품 규칙)와 대조해 색·간격·글자 위계·상태(빈 화면·오류·로딩)·모바일 폭·키보드 접근성을 확인하고, 실제 화면을 3개 폭(모바일·태블릿·데스크톱)으로 찍어 Before/After 표로 보고한다. Emil 스킬의 애니메이션 기준을 `skills:`로 미리 넣어 두고, 고치지 않고 "무엇을 왜 고쳐야 하는지"만 낸다(편집은 메인이 함).

2. **kit-reference-matcher (레퍼런스 대조자)** — "글로싸인처럼", "아사나처럼" 같은 요청에서 공개 페이지·도움말·본인 계정 스크린샷만으로 화면 목록과 기능표(필수/권장/선택)를 만들고, 구현 후에는 같은 화면폭 스크린샷을 `imgdiff.py`로 비교해 기능 점수와 레이아웃 차이 영역을 낸다. 상대 로고·브랜드 색·문구·비공개 API를 가져다 쓴 흔적이 있으면 실패로 판정한다(replica-skill 규칙 차용).

3. **kit-prod-verifier (운영 확인자)** — main에 푸시된 직후 Vercel 배포가 끝났는지, https://www.work-in.dev 의 핵심 화면·API가 정상인지, 콘솔 오류·느린 응답이 없는지 확인하고, TEST_REPORT 형식으로 "통과/실패 + 증거(주소·스크린샷·응답 코드)"를 남긴다. 배포 승격·설정 변경·데이터 삭제는 절대 하지 않으며, 노트북에서는 Playwright(운영 프로필)로, 클라우드에서는 HTTP 확인만 한다.

4. **kit-marketing-qa (마케팅 콘텐츠 검수자)** — 게시물·릴스 대본·광고 문구를 내보내기 전에 표시광고법상 과장·효능 단정, 확인 안 된 숫자, AI 생성 인물을 실제 후기처럼 쓰는 것, 채우지 않은 자리표시, 브랜드 명의 혼동(워크인 판매·결제는 하이링크 명의, 다짐은 본사)을 검사하고, 메타 광고라면 특별 카테고리 필요 여부와 리드 양식 개인정보 링크까지 본다. 워크인 `mktQuality`의 금지어 규칙을 기준으로 삼고 "통과/수정 요청" 두 가지로만 답한다.

5. **kit-sales-data-qa (영업 데이터 검수자)** — 영업 리드·고객 데이터에서 중복, 전화·이메일 형식 오류, 출처(메타 리드 광고 등) 누락, 단계 역행, 담당자 미지정을 찾고, 개인정보가 주소·로그·외부 전송에 섞이지 않았는지 확인한다. 읽기 전용 조회만 쓰고 수정은 제안 목록으로만 낸다.

6. **kit-ads-launch-gate (광고 집행 관리자)** — D의 체인을 지휘하는 관리자 에이전트로, 소재와 지시를 받아 마케팅 검수자에게 문구 검수를 맡기고, 통과하면 일시정지 상태 초안 생성을 요청하고, 예산 상한·기간·타깃을 요약해 승인함에 올린다. 스스로 집행(ACTIVE 전환)이나 예산 증액은 하지 않으며, 대표 승인 기록이 있을 때만 다음 단계로 넘긴다.

예시 파일 `.claude/agents/kit-prod-verifier.md`:
```markdown
---
name: kit-prod-verifier
description: main 에 푸시한 직후 운영(https://www.work-in.dev)에서 실제로 동작하는지 확인할 때 사용. 배포·승격·설정 변경은 하지 않는다.
tools: Read, Grep, Glob, Bash, WebFetch
model: sonnet
color: green
---
당신은 운영 확인 담당이다.
1. 마지막 커밋과 Vercel 배포 상태를 확인한다.
2. 핵심 화면과 API 를 차례로 열어 응답 코드·콘솔 오류·표시 문구를 확인한다.
3. 결과를 "통과/실패, 확인한 주소, 증거" 표로 남긴다. 확인하지 못한 것은 "확인 못함"이라고 쓴다.
금지: 배포 승격, 환경변수·웹훅 변경, 데이터 삭제, 결제·광고 집행.
```

**"레벨 3"으로 묶는 방법**
- **관리자 = 메인 세션**: 메인 세션이 위 에이전트들에게 일을 나눠 주고 결과를 다음 에이전트에 넘김. 예) 화면 개편: 레퍼런스 대조자 → (메인 구현) → 디자인 검수자 → 운영 확인자. 광고: 마케팅 검수자 → 광고 집행 관리자(초안) → **사람 승인** → 운영 확인자·영업 데이터 검수자(리드 유입 확인).
- **에이전트 팀**(여러 세션이 서로 대화)은 실험 기능이라 기본 꺼짐(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), `-p` 비대화 모드에선 안 되고, 분할 화면은 윈도우 터미널 미지원(같은 창 안 방식은 가능), 토큰을 훨씬 많이 씀 ([Agent teams](https://code.claude.com/docs/en/agent-teams)). → 처음엔 하위 에이전트로 시작하고, 조사·검토처럼 병렬이 유리한 일에만 팀을 시험.
- 플러그인에는 여러 하위 에이전트를 순서대로 돌리는 `workflows/*.js`도 넣을 수 있음 ([Add components](https://code.claude.com/docs/en/plugins/components)) [세부 문서 미검토].
- 안전장치: 저장소 `.claude/settings.json` 훅(클라우드에서도 동작)으로 비밀값 파일 커밋 차단 같은 규칙을 거는 것을 권장.

### F 판정: **도입 권장**
- 원본 저장소 1개(`claude-company-kit`) + 각 저장소 `.claude/`에 복사(클라우드 호환) + 노트북 전용 플러그인 마켓 + 필요 시 claude.ai 계정 스킬. 에이전트 6개로 "만들기 → 검수 → 확인 → 승인" 체인을 고정하면 대표가 말한 레벨 3(관리자 에이전트와 결과 연쇄)에 해당.
- 저장소 설정의 플러그인만으로 통일하는 안은 **클라우드에서 작동하지 않음**(공식 문서 확인) — Team/Enterprise 전환 시에만 재검토.

---

## 부록 1. 진행 순서 제안 (대표 결정이 필요한 곳 표시)

1. `claude-company-kit` 비공개 저장소 만들기, 에이전트 6개·`kit-workin-design`·Emil 스킬 사본 넣기 → 워크인에 복사·커밋 (로컬 담당)
2. 워크인 `DESIGN.md` 작성(awesome-design-md 형식 참고, 우리 토큰 기준)
3. 레퍼런스 대조 스킬로 다음 "○○처럼" 요청 1건 시범
4. 메타 API 버전 v21.0 → v25.0 이상 상향(클라우드 담당 영역 `src/`라 LOCAL_LOG "클라우드 요청"으로 전달)
5. 광고 초안 기능(전부 PAUSED + 승인함) 구현 → 자사 계정으로 소액 시험 — **대표 승인 필요(광고비)**
6. Meta 공식 Ads MCP 연결 시험 — **대표 승인 필요(새 통합 설정)**
7. Impeccable·HyperFrames는 별도 폴더에서 통계 끄고 2주 시험 후 재판단

## 부록 2. 확인하지 못한 것
- Meta 공식 Ads MCP의 "기본 일시정지", 지원 클라이언트 목록(도움말 본문을 읽지 못함)
- Terminal-Bench 4.0 공식 표(스크립트 렌더링) — 2차 출처 수치 사용
- Kimi K3 가격, Z.ai 코딩 플랜의 학습 미사용 주장, Alibaba·MiniMax 일부 조건, LM Studio 설정
- Higgsfield 요금표
- 마켓 추가 시 대형 저장소(Impeccable·HyperFrames)를 얕게 복제하는지 여부
- 사용자 설정의 `extraKnownMarketplaces`에서 `autoUpdate` 키가 먹는지 여부
- 채용 광고 특별 카테고리의 한국 적용 범위
