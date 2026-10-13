#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json ignoreCommand). 종료 코드 0 = 빌드 건너뜀, 1 = 빌드.
# docs/·*.md 만 바뀐 커밋은 운영 빌드를 쓰지 않는다 (하루 배포 한도 절약, R-14).
# 비교 기준은 마지막으로 배포된 커밋(VERCEL_GIT_PREVIOUS_SHA) — 여러 커밋을 한 번에 올려도 코드 변경을 놓치지 않는다.
# 기준 커밋을 못 찾으면(얕은 clone 등) 안전하게 빌드한다.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then
  git fetch --quiet --depth=50 origin "$base" 2>/dev/null || true
fi
if ! git cat-file -e "$base^{commit}" 2>/dev/null; then echo "기준 커밋 없음 → 빌드"; exit 1; fi
if git diff --quiet "$base" HEAD -- . ':(exclude)docs' ':(exclude)*.md'; then
  echo "문서만 변경 ($base..HEAD) → 빌드 건너뜀"; exit 0
fi
echo "코드 변경 있음 → 빌드"; exit 1
