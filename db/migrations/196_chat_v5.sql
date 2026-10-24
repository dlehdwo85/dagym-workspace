-- 메신저 3차(대표 10/20 "카톡 수준", docs/handoff/MESSENGER_KAKAO_LEVEL_2026-10-20.md C12·D14):
-- notify = 방별 알림 단계 — all(전체) · mention(멘션만) · off(끄기, 멘션도 안 옴·앱 배지에서도 빠짐).
-- 예전 '알림 끄기'(muted = 멘션은 옴)는 mention 으로 옮기고, muted 는 앞으로 notify <> 'all' 과 같이 맞춘다(옛 화면·옛 앱 호환)
alter table chat_members add column if not exists notify text not null default 'all';
alter table chat_members drop constraint if exists chat_members_notify_check;
alter table chat_members add constraint chat_members_notify_check check (notify in ('all', 'mention', 'off'));
update chat_members set notify = 'mention' where muted and notify = 'all';
-- D14 방장 권한: photo_key = 방 사진(대화방 파일과 같은 저장 키 chat/<회사>/<방>/…) · owner_only = 그룹 대화에서 방 이름·사진·초대·공지를 방장(·대표·관리자)만
alter table chat_rooms add column if not exists photo_key text;
alter table chat_rooms add column if not exists owner_only boolean not null default false;
