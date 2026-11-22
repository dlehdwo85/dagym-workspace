import { handler } from '@/lib/api';
import { enabledProviders } from '@/lib/oauth';
import { appUrl } from '@/lib/mail';

/**
 * 가입·로그인·초대 화면에 보일 소셜 버튼(키가 있는 제공자만).
 * 대표 11/19 결정(애플 11/15 반려 뒤): 아이폰·아이패드 앱은 이메일 로그인만 — 앱 표시(WorkInApp)가 있고 안드로이드가 아니면 빈 목록. 웹·안드로이드 앱은 그대로
 */
export const GET = handler(async ({ req }) => {
  const ua = req.headers.get('user-agent') ?? '';
  // #1114: start 주소의 정식 호스트(APP_URL) — 앱의 시스템 브라우저가 처음부터 정식 주소를 엶(예전 주소가 한 번 보였다 넘어가던 것)
  return { providers: /WorkInApp/i.test(ua) && !/Android/i.test(ua) ? [] : enabledProviders(), base: appUrl() };
}, { public: true });
