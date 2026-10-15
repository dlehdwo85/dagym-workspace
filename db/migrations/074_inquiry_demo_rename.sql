-- HILINK 플랫폼 문의 자동 체크리스트 "데모 일정" → "플랫폼 시연 일정 잡기 (온라인·방문)" (체험 계정과 헷갈림). 아직 체크하지 않은 항목만
update task_checklist_items set text = '플랫폼 시연 일정 잡기 (온라인·방문)'
  where text = '데모 일정' and not done and task_id in (select task_id from inquiries where task_id is not null);
