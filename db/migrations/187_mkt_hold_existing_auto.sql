-- 로컬 10/24 10:58(대표 원문 '레퍼런스 업체와 비교해 개선시킨 뒤 승인 다시 올릴 것'): 이미 승인 대기에 있던 자동 시안과 '미뤄진 글'도 초안 보관으로 내림.
-- 초안 보관을 켠 회사(186 auto_hold)만 · 정기 자동 제작 글(auto)만. 승인 대기는 로컬이 짚은 4건(바디랩 10/25 2건·워크인 10/26 2건)만,
-- '미뤄진 글'(보류 + 날짜 비움)은 모두. 사람이 만든 글·사람이 [승인 요청]한 글·수정 요청·대표가 보류한 글은 그대로. 승인함 '초안 보관'에서 [승인 요청]으로 되돌림.
update mkt_contents c
set status = 'draft', reminded_at = null, updated_at = now(),
    quality = coalesce(c.quality, '{}'::jsonb) || jsonb_build_object('held', jsonb_build_object('at', now(), 'reason', 'template', 'from', c.status))
where c.auto
  and exists (select 1 from mkt_settings s where s.tenant = c.tenant and s.auto_hold)
  and c.quality->'submitted' is null
  and ((c.status = 'pending' and c.id::text like any (array['c24da858%', '2dd53eb7%', 'c333aca1%', '942dc77d%']))
    or (c.status = 'hold' and c.quality->'postponed' is not null));
