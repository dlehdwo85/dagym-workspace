#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand). 종료 코드 0 = 빌드 건너뜀, 1 = 빌드.
# docs/·*.md·tests/ 만 바뀐 커밋은 운영 빌드를 쓰지 않는다 (하루 배포 한도 절약, R-14).
# 비교 기준은 마지막으로 배포된 커밋(VERCEL_GIT_PREVIOUS_SHA) — 여러 커밋을 한 번에 올려도 코드 변경을 놓치지 않는다.
# 기준 커밋을 못 찾으면(얕은 clone 등) 안전하게 빌드한다.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=50 origin "$base" 2>/dev/null || true
fi
# 로컬 10/19(빌드 CPU 가 요금 대부분): 얕은 clone 에 마지막 배포 커밋이 없어 매번 빌드되던 것 — 이력을 더 받아 다시 찾고,
# 그래도 없으면 최근 10개 커밋 중 하나라도 코드가 바뀌었으면 빌드(여러 커밋을 한 번에 올려도 코드 변경을 놓치지 않게, 보수적으로)
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then git fetch --quiet --deepen=50 2>/dev/null || true; fi
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  n=$(git rev-list --count HEAD 2>/dev/null || echo 1); k=$(( n > 10 ? 10 : n - 1 ))
  if [ "$k" -lt 1 ]; then echo "기준 커밋 없음 → 빌드"; exit 1; fi
  echo "기준 $base 없음 → 최근 $k 개 커밋과 비교"; base="HEAD~$k"
fi
# 같은 커밋 재배포(환경변수만 바꾼 Redeploy 등)는 비교할 변경이 없으므로 항상 빌드
if [ "$(git rev-parse "$base^{commit}")" = "$(git rev-parse HEAD)" ]; then echo "같은 커밋 재배포 → 빌드"; exit 1; fi
# 운영 화면에 영향 없는 것: 문서·기록(docs/·*.md)·시험(tests/)·CI 설정(.github/)
if git diff --quiet "$base" HEAD -- . ':(exclude)docs' ':(exclude)*.md' ':(exclude)tests' ':(exclude).github'; then
  echo "문서·시험만 변경 ($base..HEAD) → 빌드 건너뜀"; exit 0
fi
echo "코드 변경 있음 → 빌드"; exit 1
