-- 대표 10/24 #475 후속(공동 담당 다시 설계): "담당자가 따로 있고 공동담당자가 따로 있는 느낌 · 담당자인 대표는 완료 버튼을 누를 수 없음 ·
-- 내 업무를 완료 처리했더라도 다른 담당자들이 아직 완료를 안 하면 내 업무에서 사라지지 않도록".
-- 담당자가 여럿이면 모두 같은 무게: 누구나 [완료] = '내 몫 완료', 마지막 사람이 끝내면 업무 완료(검토 필수면 검토 요청).
-- 첫 담당자(tasks.assignee_id — 알림·통계 호환)의 내 몫 완료 시각. 다른 담당자는 task_assignees.done_at 그대로.
-- complete_rule 칸은 남겨 두지만 더 쓰지 않는다(칸 추가만, 지우지 않음).
alter table tasks add column if not exists assignee_done_at timestamptz;
