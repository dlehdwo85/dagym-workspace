-- V13: 메뉴 권한(메뉴 × 등급, 사람별 예외) · GPT Custom Action 끄기 (추가형)
create table if not exists menu_role_perms (
  menu text not null,
  role text not null,
  level text not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (menu, role)
);
create table if not exists menu_user_perms (
  menu text not null,
  user_id uuid not null references users(id) on delete cascade,
  level text not null,
  updated_by uuid references users(id),
  updated_at timestamptz not null default now(),
  primary key (menu, user_id)
);
-- GPT Custom Action 토큰은 모두 무효 (매출 입력은 엑셀/CSV·자료로 입력(AI)으로)
update api_tokens set revoked_at = now() where revoked_at is null;
