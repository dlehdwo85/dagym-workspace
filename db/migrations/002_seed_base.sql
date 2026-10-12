-- 기본 브랜드·본사·회사 캘린더·초기 업무 템플릿 (실제 현장·직원 데이터는 넣지 않는다)
insert into brands (id, name, color, sort) values
  ('dagym', '다짐', '#ea580c', 1),
  ('hilink', '하이링크', '#2563eb', 2),
  ('bodylab', 'BODY LAB', '#059669', 3)
on conflict (id) do nothing;

insert into org_units (id, parent_id, brand_id, type, name, sort)
values ('00000000-0000-0000-0000-000000000001', null, null, 'hq', '본사', 0)
on conflict (id) do nothing;

insert into calendars (type, name, color) values ('company', '회사 일정', '#0f766e')
on conflict do nothing;

insert into templates (name, description, payload) values
('현장 점검', '정기 현장 점검과 조치 사항 기록', '{
  "title": "[현장 점검] ",
  "description": "점검 일시, 점검자, 주요 지적 사항과 조치 계획을 기록합니다.",
  "priority": "normal", "approvalRequired": true, "dueInDays": 3, "tags": ["점검"],
  "checklist": ["시설·기구 안전 상태 확인", "청결 상태 확인", "비상구·소방 설비 확인", "직원 근무 상태 확인", "지적 사항 사진 첨부", "조치 계획 작성"]
}'),
('회원 민원', '회원 민원 접수부터 처리 결과 회신까지', '{
  "title": "[회원 민원] ",
  "description": "민원 접수 경로, 회원 정보(필요 최소한), 민원 내용, 처리 결과를 기록합니다.",
  "priority": "high", "approvalRequired": true, "dueInDays": 2, "tags": ["민원"],
  "checklist": ["민원 내용 확인 및 회원 1차 응대", "사실 관계 확인", "처리 방안 결정", "회원에게 처리 결과 안내", "재발 방지 조치 기록"]
}'),
('GX 개강 준비', 'GX 프로그램 신규 개강 준비', '{
  "title": "[GX 개강] ",
  "description": "프로그램명, 강사, 시간표, 정원, 홍보 일정을 기록합니다.",
  "priority": "normal", "approvalRequired": true, "dueInDays": 14, "tags": ["GX"],
  "checklist": ["강사 섭외·계약", "시간표 확정", "정원·예약 방식 결정", "홍보물 제작", "회원 공지", "장비·음향 점검", "첫 수업 진행 확인"]
}'),
('계약 갱신', '위탁·임대·공급 계약 갱신', '{
  "title": "[계약 갱신] ",
  "description": "계약 상대방, 현 계약 만료일, 변경 조건, 결재 경로를 기록합니다.",
  "priority": "high", "approvalRequired": true, "dueInDays": 30, "tags": ["계약"],
  "checklist": ["현 계약서·조건 확인", "변경 요청 사항 정리", "상대방 협의", "내부 결재", "계약서 날인·보관", "관련 부서 공유"]
}'),
('제안서 제출', '위탁운영·영업 제안서 작성 및 제출', '{
  "title": "[제안서] ",
  "description": "발주처, 제출 마감, 제출 방식, 필수 서류를 기록합니다.",
  "priority": "high", "approvalRequired": true, "dueInDays": 10, "tags": ["제안"],
  "checklist": ["공고·요구사항 분석", "목차·전략 수립", "초안 작성", "가격·운영 계획 검토", "대표 검토", "최종본 제출", "제출 확인증 보관"]
}'),
('시설 보수', '시설·기구 고장 접수 및 보수', '{
  "title": "[시설 보수] ",
  "description": "고장 위치, 증상, 사진, 업체, 비용, 완료 확인을 기록합니다.",
  "priority": "normal", "approvalRequired": true, "dueInDays": 7, "tags": ["시설"],
  "checklist": ["고장 내용·사진 등록", "사용 중지 안내 부착", "업체 견적 요청", "보수 진행", "보수 결과 확인·사진 첨부"]
}'),
('신규 직원 교육', '신규 입사자 온보딩 교육', '{
  "title": "[신규 교육] ",
  "description": "입사자, 소속, 교육 담당자, 교육 일정을 기록합니다.",
  "priority": "normal", "approvalRequired": true, "dueInDays": 14, "tags": ["교육"],
  "checklist": ["업무 계정 초대", "회사 소개·규정 안내", "현장 안전 교육", "회원 응대 교육", "시스템 사용 교육", "교육 완료 확인서"]
}'),
('월간 보고', '월간 운영 실적 보고', '{
  "title": "[월간 보고] ",
  "description": "보고 대상 월, 매출·회원·민원·이슈 요약을 정리합니다.",
  "priority": "normal", "approvalRequired": true, "dueInDays": 5, "tags": ["보고"],
  "checklist": ["매출·회원 수치 집계", "민원·이슈 정리", "다음 달 계획 작성", "보고서 첨부", "대표 보고"],
  "recurrence": "FREQ=MONTHLY;BYMONTHDAY=5"
}');
