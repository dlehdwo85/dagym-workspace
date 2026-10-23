-- #454 영상 끝 화면·자막 브랜드 키트: { logoFileId(자료실 이미지), headline(끝 화면 한 줄), cta(예: 14일 무료 체험 · work-in.dev), endColor(#RRGGBB), fontFileId(자료실 OTF/TTF — 비우면 Noto Sans KR Bold) }. 추가형.
alter table mkt_brands add column if not exists video jsonb not null default '{}'::jsonb;
