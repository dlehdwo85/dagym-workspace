-- #235 ⓒ 자료실 마케팅 사진 AI 설명(사진마다 한 번): 한 줄 설명·장면·태그·종류(실사/그래픽/화면/그림/문서)·글자 양·홍보물·읽히는 글자·사람 수·얼굴·화질
-- 실패하면 { error, tries } 로 남겨 세 번까지만 다시 시도
alter table library_files add column if not exists vision jsonb;
