# AI 도구 추가 안내 — 대표 보고용 (2026-10-23)

- 대상: 대표가 보낸 온라인테크트리 자료 5종에 나온 스킬·플러그인·MCP, 그리고 추가 요청 3건(레플리카 스킬, 무료 모델, 메타 광고 자동 세팅)입니다.
- 근거: 자세한 조사와 보안 검토는 [AI_KIT_RESEARCH_2026-10-23.md](AI_KIT_RESEARCH_2026-10-23.md)에 있습니다. 이 문서는 "무엇을 넣었고, 직접 넣으려면 어떻게 하는지"만 짧게 정리합니다.
- GPT 쪽 설치 경로는 OpenAI 공식 문서(developers.openai.com의 Codex 스킬·MCP 문서, help.openai.com)로 확인했습니다. 확인하지 못한 부분은 [미확인]으로 표시했습니다.

## 1. 한눈에

| 구분 | 도구 |
|---|---|
| **이미 넣음**(회사 공통 키트) | Emil 디자인 스킬 3개, 레플리카 스킬의 비교 도구 3개, 우리가 만든 스킬 3개, 에이전트 7개, 공통 규칙 1개 |
| **홈페이지에만 넣음** | Taste 스킬(다짐·하이링크 홈페이지 시안용) |
| **참고만** | Awesome Design(유명 회사 디자인 규칙 모음) — 우리 디자인 기준 문서의 형식만 참고 |
| **보류**(따로 시험한 뒤 결정) | Impeccable, HyperFrames, 인스타그램 스킬 원본(한국어판으로 대체), Canva |
| **넣지 않음** | Blotato(워크인 게시 기능과 겹치고 유료), 무료·저가 모델로 Claude Code 돌리기(품질 저하) |
| **이미 있음** | Playwright(브라우저 자동화), Higgsfield(영상·이미지), Computer use(PC 조작) |

## 2. 도구별 설명과 추가 방법

### 넣은 것

| 도구 | 무엇을 하나 | Claude에 넣는 법 | GPT에 넣는 법 |
|---|---|---|---|
| **Emil Kowalski 스킬 3개**<br>(emil-design-eng, break-ui, review-animations) | 애니메이션·마감 품질 기준. 화면을 일부러 깨 보는 검사, 움직임 검수 | 회사 저장소 3곳에는 이미 들어 있음. 개인 PC 전체에 넣으려면 `git clone https://github.com/emilkowalski/skills` 후 `skills/` 안의 폴더 3개를 `C:\Users\User\.claude\skills\`에 복사 | **Codex**: 같은 폴더 3개를 `~/.agents/skills/`(개인) 또는 저장소의 `.agents/skills/`에 복사 → 대화창에서 `$emil-design-eng`로 부름. 스킬 파일 형식(SKILL.md)이 Claude와 같아 그대로 씁니다 |
| **레플리카 스킬**(일부만) | 원래는 "어떤 앱이든 복제"하는 스킬 11개입니다. 우리는 비교 도구 3개만 가져왔습니다: 화면 배치 차이(imgdiff), 기능 점수(parity), 글자 대비(contrast) | 회사 키트의 `kit-reference-match` 스킬과 `kit-reference-matcher` 에이전트에 들어 있음. 원본 전체 시험: Claude Code에서 `/plugin marketplace add Jakeschincariol/replica-skill` → `/plugin install replica-skill@replica-skill` | Codex: `git clone https://github.com/Jakeschincariol/replica-skill` 후 `replica-*` 폴더를 `~/.agents/skills/`에 복사 |
| **우리 스킬 3개**(새로 만듦) | `kit-reference-match`: "○○처럼" 요청을 실제 화면 기준으로 대조<br>`kit-design-system`: 'AI 티' 점검표, 3개 화면폭 검사<br>`kit-ko-copy`: 한국어 광고 문구 기준(14일 무료 체험, 명의, 금지어, 채널별 틀) | 저장소 `.claude/skills/`에 들어 있음. 새 저장소: `bash scripts/sync-kit.sh <저장소 경로>` 한 줄 | 같은 폴더를 저장소 `.agents/skills/`에 복사하면 Codex에서도 동작 |
| **에이전트 7개**(새로 만듦) | 디자인 검수, 레퍼런스 대조, 운영 확인, 마케팅 문구 검수, 영업 데이터 검수, 광고 집행 관리, 대표 요청 누락 검수 | 저장소 `.claude/agents/`에 들어 있음. 클라우드·노트북 세션 모두 자동으로 읽음 | 에이전트 파일 형식은 Claude 전용입니다. GPT에서는 같은 역할 설명을 저장소의 `AGENTS.md`(Codex가 읽는 지시 파일)에 옮겨 적어 씁니다 |
| **Taste 스킬** | 랜딩 페이지 시안 전문. 디자인 방향 3개를 뽑고 3개 화면폭으로 고침 | 다짐·하이링크 홈페이지 저장소의 `kit/claude-company-kit` 브랜치에만 넣음. 워크인에는 과해서 넣지 않음(한 번에 30~45분·토큰 많음) | Codex: `git clone https://github.com/Leonxlnx/taste-skill` 후 `skills/taste-skill` 폴더를 `.agents/skills/`에 복사 |

### 참고만 / 보류 / 넣지 않음

| 도구 | 무엇을 하나 | 판정과 이유 | 직접 시험하려면 |
|---|---|---|---|
| **Awesome Design** | 스트라이프·리니어 같은 유명 회사의 디자인 규칙 문서(DESIGN.md) 모음 | **참고만** — 남의 브랜드를 그대로 쓰면 법적 위험. 우리 기준 문서의 목차·형식만 참고했습니다 | 설치 불필요. getdesign.md에서 읽기만 |
| **Impeccable** | 디자인 검수 명령 모음(플러그인) | **보류** — 품질은 가장 체계적입니다. 다만 편집할 때마다 자동 실행되는 훅, 처음 실행 때 외부 실행 파일 내려받기, 사용 통계 전송이 있습니다. "끝나면 바로 운영 배포" 규칙과 충돌할 위험이 있어 별도 시험 폴더에서만 씁니다 | `/plugin marketplace add pbakaus/impeccable` → `/plugin install impeccable@impeccable` (통계 끄기: `DO_NOT_TRACK=1`) |
| **HyperFrames** | 무료 HTML→영상 제작 | **보류** — 글·숫자 위주 짧은 영상을 Higgsfield 크레딧 없이 만들 여지가 있습니다. 사용 통계가 기본으로 켜져 있어 노트북 별도 폴더에서 1~2편 시험 후 결정합니다 | `claude plugin marketplace add heygen-com/hyperframes` → `claude plugin install hyperframes@hyperframes` |
| **인스타그램 스킬** | 릴스 대본·훅 점수·캡션 검사 | **한국어판으로 대체** — 규칙이 영어 기준입니다. 구조만 가져와 `kit-ko-copy`(한국어 금지어·훅 공식·채널별 틀)로 만들었습니다 | (원본) `/plugin marketplace add Jakeschincariol/instagram-agent-skill` |
| **Canva** | 캔바 디자인 검색·생성·내보내기(공식 MCP) | **보류** — 요금제별 기능 조건이 문서마다 다릅니다. 팀이 캔바를 실제로 쓰면 그때 연결합니다 | Claude: `claude mcp add --transport http canva https://mcp.canva.com/mcp` / Codex: `codex mcp add canva --url https://mcp.canva.com/mcp` |
| **Blotato** | 여러 SNS 동시 게시 | **넣지 않음** — 워크인에 이미 인스타·페이스북·스레드·유튜브·블로그 게시가 있고, 월 $29부터입니다. 계정 토큰을 외부에 또 맡기게 됩니다 | — |
| **무료·저가 모델로 Claude Code** | Claude 대신 DeepSeek·GLM·Kimi·로컬 모델 연결 | **넣지 않음** — 같은 환경에서 잰 점수가 Claude 64.8% 대 GLM 41.8%로 차이가 큽니다. 클라우드 세션에서는 아예 못 쓰고, 회사 코드가 해외 업체로 갑니다. 비용은 Claude 안에서 가벼운 일을 Sonnet·Haiku에 맡기는 방식으로 줄입니다(에이전트 3개에 이미 적용) | 꼭 시험하려면 로컬 Ollama만, 회사 저장소가 아닌 폴더에서 |

## 3. GPT(ChatGPT·Codex) 공통 안내

- **Codex**(OpenAI의 코딩 도구: 터미널·VS Code·데스크톱 앱)
  - 스킬: Claude와 같은 SKILL.md 형식을 씁니다. 개인은 `~/.agents/skills/<이름>/`, 저장소는 `.agents/skills/<이름>/`에 폴더를 넣고 Codex를 다시 켭니다. `$이름`이나 `/skills`로 부릅니다. GitHub 주소로 받을 때는 Codex 안에서 `$skill-installer <GitHub 폴더 주소>`를 씁니다.
  - MCP: `codex mcp add <이름> --url <https 주소>` 또는 `~/.codex/config.toml`에 `[mcp_servers.<이름>]`과 `url = "..."`을 적습니다. 터미널과 VS Code가 설정을 같이 씁니다.
  - 지시 파일: 저장소 맨 위의 `AGENTS.md`(Claude의 CLAUDE.md에 해당)와 개인용 `~/.codex/AGENTS.md`를 읽습니다.
- **ChatGPT 웹·앱**
  - 직접 만든 MCP 연결과 '스킬'은 공식 안내상 Business·Enterprise·Edu 요금제에서 관리자 권한에 따라 쓸 수 있습니다. 개인 Plus·Pro에서 되는지는 [미확인]입니다.
  - 연결은 설정의 앱·플러그인 메뉴에서 서버 주소를 넣는 방식입니다. 회사 계정 토큰이 걸린 연결은 새 통합 설정이므로 대표 승인 뒤에 합니다.
- 우리 회사 작업은 Claude(클라우드 세션 + 노트북 세션) 중심이라, GPT 쪽은 필요할 때 위 경로로 같은 스킬 폴더를 복사해 쓰는 것으로 충분합니다.

## 4. 대표 요청별 결과

| 요청 | 결과 |
|---|---|
| 자료 분석 → 추가할 것과 설치법 | 이 문서 + 조사 보고서. 넣을 것은 회사 키트로 설치 완료 |
| 워크인에 도입 | 워크인 저장소 `.claude/`에 키트 적용(커밋 2c65580f). 클라우드 개발 세션도 같은 스킬·에이전트를 씁니다 |
| 다짐·하이링크 홈페이지에 디자인 스킬 5개 → 검수·디벨롭 | 두 홈페이지 저장소에 키트 + Taste 스킬 브랜치를 올리고 각 홈페이지 세션에 "검수 → 디벨롭"을 지시했습니다. 결과는 각 세션이 보고합니다 |
| 메타 광고 자동 세팅 → 워크인 마케팅 | 설계를 클라우드에 전달했습니다: 소재 올리기 → 정책 점검 → 일시정지 상태로 캠페인 생성 → 승인함 → 승인하면 집행. 먼저 메타 API 버전을 올립니다(지금 쓰는 v21은 광고 쓰기에 만료됨). 실제 광고비가 드는 시험은 대표 승인 뒤에 합니다 |
| AI 레벨 3 | 에이전트 7개를 "만들기 → 검수 → 확인 → 승인" 체인으로 묶었습니다. 예) 화면 개편: 레퍼런스 대조 → 구현 → 디자인 검수 → 운영 확인. 광고: 문구 검수 → 일시정지 초안 → **대표 승인** → 리드 유입 확인 |
| 무료 모델 | 품질이 떨어져 넣지 않습니다(2장 표) |
| 레플리카 스킬 + 레퍼런스 재검수 | 비교 도구를 키트에 넣었습니다. 지금까지 레퍼런스 요청 52건을 재검수했습니다: 반영 26 · 일부 22 · 미반영 4. 빈 곳 12묶음은 클라우드에 개발 요청했습니다([REFERENCE_REAUDIT_2026-10-23.md](REFERENCE_REAUDIT_2026-10-23.md)) |
| 새 저장소에도 공통 적용 | 비공개 저장소 `dlehdwo85/claude-company-kit`이 원본입니다. 새 저장소는 `bash scripts/sync-kit.sh <경로>` 한 줄로 같은 스킬·에이전트가 붙습니다 |
| AI 빌드업 테크트리 영상 | 13편 중 12편 자막 분석([TECHTREE_VIDEOS_2026-10-23.md](TECHTREE_VIDEOS_2026-10-23.md)). 광고 문구 구조·채널별 틀은 키트에 반영했고, 워크인 마케팅 개선 7건은 클라우드에 요청했습니다 |

## 5. 대표 결정이 필요한 것

1. **Meta 공식 광고 MCP 연결**(무료 베타): Claude에서 말로 캠페인을 보고 다루는 사내 운영용입니다. 새 통합 설정이라 승인이 필요합니다.
2. **광고 자동 세팅 실제 시험**: 자사 계정에 하루 예산을 작게 잡아 며칠만 합니다. 메타 규칙상 캠페인 총 한도는 최소 약 $100 상당으로 걸어야 하지만, 실제 지출은 하루 예산 × 기간만큼입니다. 광고비가 들어 승인이 필요합니다.
3. **(선택) 키트 스킬을 claude.ai 계정 스킬로도 올리기**: 저장소 밖의 대화(웹·앱 채팅)에서도 같은 기준을 쓰게 됩니다. 계정 설정 변경입니다.
