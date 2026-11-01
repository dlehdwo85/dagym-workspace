-- 315차(로컬 11/01 314차 확인: 다짐 요가·GX 수업 사진에 여러 명 얼굴이 보이는데 사진 AI 설명이 '얼굴 없음' → 영상 장면에 그대로 들어감):
-- 사람이 2명 이상이거나(people >= 2) 사람이 있고 설명에 단체·그룹·여러 명·회원들이 든 사진은 얼굴 있음으로 봄(src/lib/mktPhotos.ts groupShown 과 같은 규칙).
-- 얼굴 자리(faceBoxes)를 모르니 자동 시안·블로그 본문·사진 영상에서 빠지고, 사진 AI 설명 칸 [얼굴 위치 다시 읽기] 대상이 됨(누를 때만 AI 비용).
-- facesBy = 'people' 으로 이 규칙이 바꾼 사진을 표시(AI 판정 원래 값은 false).
update library_files
set vision = vision || jsonb_build_object('faces', true, 'facesBy', 'people')
where vision ? 'caption'
  and coalesce(vision->>'faces', 'false') <> 'true'
  and (
    (case when vision->>'people' ~ '^[0-9]+$' then (vision->>'people')::int else 0 end) >= 2
    or ((case when vision->>'people' ~ '^[0-9]+$' then (vision->>'people')::int else 0 end) >= 1
      and (coalesce(vision->>'caption', '') || ' ' || coalesce(vision->>'scene', '') || ' ' || coalesce(vision->>'tags', '')) ~ '(단체|그룹|여러 ?명|회원들)')
  );
