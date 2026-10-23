-- 앱 1.1.3 알림창 버튼(#130·#478): 기기(푸시 토큰)마다 앱이 할 수 있는 일(caps, 예: android-actions-1)
-- android-actions-1 앱에는 notification 없이 data 만 보내 앱이 버튼 달린 알림을 직접 그린다(옛 앱은 지금처럼)
alter table push_subscriptions add column if not exists caps text[] not null default '{}';
