-- #615 ①(로컬 10/25 18:00 자료실 사진·영상 131건 재분류 뒤): '마케팅/…' 폴더에 있는데 공간이 마케팅이 아닌 자료 → 마케팅 공간으로.
-- 자동 제작 사진 고르기(mktPhotos)는 space = 'marketing' 만 보므로, 폴더만 옮긴 실사가 시안 바탕·블로그 사진 후보에 안 잡히던 것. 삭제된 자료 제외, 데이터만 고침(구조 변경 없음).
update library_files set space = 'marketing', updated_at = now()
 where deleted_at is null and space <> 'marketing' and (folder = '마케팅' or folder like '마케팅/%');
