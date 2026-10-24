-- #466(대표 결정 10/23): 무료 범위 = 14일 체험(5명 무료 폐지). 가입은 이미 14일 체험(17차, signup.ts)이고,
-- 요금표(관리 › 사용량·요금제 기준표, 소개 사이트 AI 한 줄 /api/public/ai-plans)에 남아 있던 '무료 · 5명까지' 줄만 공개 목록에서 내린다.
-- 이 요금제를 이미 쓰는 회사가 있으면 그대로 둔다(한도 계산은 공개 여부와 무관). 되돌리려면 public = true. 데이터만(칸 추가 없음).
update plans set public = false, updated_at = now() where code = 'w_free' and public;
