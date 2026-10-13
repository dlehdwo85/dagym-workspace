-- V8 3번: 개인 템플릿(만든 사람만 봄) + 기본 담당/지시자 (추가형)
alter table templates add column if not exists personal boolean not null default false;
-- 처음 쓰는 회사를 위한 본사 공용 시작 템플릿 (같은 이름이 없을 때만)
insert into templates (name, description, payload)
select v.name, v.descr, v.payload::jsonb from (values
  ('현장 점검', '현장 방문 점검 — 사진 증빙·체크리스트', '{"title":"현장 점검","priority":"normal","approvalRequired":false,"dueInDays":3,"checklist":["시설·장비 상태 사진","안전 점검(소방·전기)","청결 상태","특이사항 기록"]}'),
  ('입찰 준비', '입찰 공고 확인부터 제출까지', '{"title":"입찰 준비","priority":"high","approvalRequired":false,"dueInDays":7,"checklist":["공고문·자격 요건 확인","현장 설명회 참석","견적·제안서 작성","내부 검토","서류 제출"]}'),
  ('견적서 발송', '견적 작성·검토·발송', '{"title":"견적서 발송","priority":"normal","approvalRequired":false,"dueInDays":2,"checklist":["요구 사항 정리","견적 금액 산정","대표 검토","고객에게 발송","수신 확인"]}')
) as v(name, descr, payload)
where not exists (select 1 from templates t where t.name = v.name and not t.archived);

-- V8 8번 미리 알림: 업무별 알림(분 전, 최대 3개, null = 기본), 사용자 기본값(시간 있는 업무, 기본 60분 전) / 일정 기본값은 10분 전으로
alter table tasks add column if not exists reminder_minutes int[];
alter table user_settings add column if not exists task_reminder_minutes int not null default 60;
alter table user_settings alter column event_reminder_minutes set default 10;
