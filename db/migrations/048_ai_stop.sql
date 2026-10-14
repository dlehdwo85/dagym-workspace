-- V19 부록 A2: AI 비서 [멈춤] — 멈춘 질문은 status 'stopped' 로 남긴다(대화 문맥에는 넣지 않음). 추가형(허용 값만 늘림)
alter table ai_messages drop constraint if exists ai_messages_status_check;
alter table ai_messages add constraint ai_messages_status_check check (status in ('ok','blocked','error','stopped'));
