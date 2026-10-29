-- 269차 #807(대표 10/29 — 결정 #466 10/23 '5명 무료' 폐지 → 14일 무료 체험): 워크인 브랜드 키트(소개·제품·주간 주제·말투·사실 카드·주제 풀·예시·목소리·피드)와
-- 그 브랜드의 자동 제작 규칙 주제에 남은 옛 요금 문구를 '14일 무료 체험'으로. 다른 브랜드는 안 건드림(다짐의 '5명까지 무료 체험 수업' 같은 말은 다른 뜻).
-- 이미 만든 시안·게시 글은 그대로(올리기 전 검사가 막음 — mktQuality OLD_FREE). 남은 곳은 GET /api/marketing/old-price 로 확인.
create or replace function pg_temp.fix_free(s text) returns text language sql immutable as $$
  -- '무료로' → '14일 무료 체험으로'(받침), 그 밖 → '14일 무료 체험'
  select regexp_replace(regexp_replace(regexp_replace(s, '(5\s*[명인]\s*(까지|이하)?\s*(영구|평생)?|(영구|평생))\s*무료(\s*체험)?로', '14일 무료 체험으로', 'g'),
    '5\s*[명인]\s*(까지|이하)?\s*(영구|평생)?\s*무료(\s*체험)?', '14일 무료 체험', 'g'), '(영구|평생)\s*무료', '14일 무료 체험', 'g')
$$;
update mkt_brands set
  intro = pg_temp.fix_free(intro), products = pg_temp.fix_free(products), weekly_topic = pg_temp.fix_free(weekly_topic), tone = pg_temp.fix_free(tone),
  facts = pg_temp.fix_free(facts::text)::jsonb, examples = pg_temp.fix_free(examples::text)::jsonb, voice = pg_temp.fix_free(voice::text)::jsonb, feed = pg_temp.fix_free(feed::text)::jsonb,
  topic_pool = coalesce((select array_agg(pg_temp.fix_free(x) order by o) from unnest(topic_pool) with ordinality u(x, o)), '{}')
where name ~* '워크인|work-?in'
  and concat_ws(' ', intro, products, weekly_topic, tone, facts::text, examples::text, voice::text, feed::text, array_to_string(topic_pool, ' ')) ~ '5\s*[명인]\s*(까지|이하)?\s*(영구|평생)?\s*무료|(영구|평생)\s*무료';
update mkt_rules r set topic_hint = pg_temp.fix_free(topic_hint)
where topic_hint ~ '5\s*[명인]\s*(까지|이하)?\s*(영구|평생)?\s*무료|(영구|평생)\s*무료'
  and exists (select 1 from mkt_brands b where b.id = r.brand_id and b.name ~* '워크인|work-?in');
