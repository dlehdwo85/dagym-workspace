-- V24 음성 등록 인식률: 회사별로 사람이 고친(또는 되돌린) 음성 보정 기록 — "노태" → "노태2단지" 같은 짝을 다음부터 바로 적용
create table if not exists voice_lexicon (
  tenant text not null,
  heard text not null,          -- 인식된 말(공백 없앤 형태)
  fixed text not null,          -- 바꿀 말
  hits int not null default 0,  -- 받아들인 횟수
  rejected boolean not null default false, -- 사람이 되돌림 → 다시 적용 안 함
  updated_at timestamptz not null default now(),
  primary key (tenant, heard, fixed)
);
