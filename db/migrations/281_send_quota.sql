-- 상용화 B5(대표 위임 11/24, COMMERCIAL_AUDIT): 회사별 하루 발송 상한 — 회사 행동으로 워크인이 대신 보내는 메일(Resend)·카카오 알림톡(솔라피) 건수.
-- 가입 확인·비밀번호 재설정·결제 영수증 같은 시스템 메일은 세지 않는다. 우리 회사(default)·앱 심사용 demo 는 상한 없음. 추가형.
create table if not exists send_quota (
  tenant text not null,
  day date not null,
  channel text not null check (channel in ('mail', 'alimtalk')),
  n int not null default 0,
  primary key (tenant, day, channel)
);
