-- D-18 보호조치(로컬 11/24 위임 — 신고와 무관하게 할 것: docs/legal/LBS_BUSINESS_PLAN_2026-11-24.md 부록 ③④⑤⑥). 추가형.
-- ③ 출퇴근 좌표를 앱 수준으로 암호화해 저장할 칸(위도·경도 평문 칸은 비워 둠 — 예전 평문은 정기 실행이 암호화해 옮김)
alter table attendance add column if not exists in_loc_enc text;
alter table attendance add column if not exists out_loc_enc text;

-- ④ 위치정보 이용·제공 사실 확인자료 위·변조 방지
--  · 고치기 금지(사람 계정을 지워 subject/viewer 가 비는 것만 허용 — on delete set null)
--  · 지우기는 1년 지난 기록만, 정기 실행이 그 거래 안에서 'app.location_purge' 표시를 켰을 때만
create or replace function location_logs_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.id = old.id and new.tenant = old.tenant and new.kind = old.kind and new.purpose is not distinct from old.purpose
       and new.detail = old.detail and new.day = old.day and new.created_at = old.created_at
       and (new.subject_user_id is not distinct from old.subject_user_id or new.subject_user_id is null)
       and (new.viewer_user_id is not distinct from old.viewer_user_id or new.viewer_user_id is null) then
      return new;
    end if;
    raise exception 'location_logs 는 고칠 수 없습니다(위치정보 이용·제공 사실 확인자료)';
  end if;
  if old.created_at < now() - interval '1 year' and coalesce(current_setting('app.location_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'location_logs 는 1년이 지나기 전에는 지울 수 없습니다(위치정보 이용·제공 사실 확인자료)';
end $$;
drop trigger if exists location_logs_guard on location_logs;
create trigger location_logs_guard before update or delete on location_logs for each row execute function location_logs_guard();

-- ④ 매일 요약 해시(앞날 해시를 이어 붙인 사슬) — 지난 기록이 바뀌거나 빠지면 다시 셈한 값과 달라짐
create table if not exists location_log_digests (
  day date primary key,               -- 서울 날짜(확인자료의 day)
  rows int not null,
  digest text not null,               -- sha256(앞날 digest + 그날 기록들)
  prev_digest text,
  created_at timestamptz not null default now()
);

-- ⑤⑥ 월 점검 기록은 audit_logs(lbs.monthly_check) 에 남긴다(별도 표 없음)
