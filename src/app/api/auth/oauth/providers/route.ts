import { handler } from '@/lib/api';
import { enabledProviders } from '@/lib/oauth';

/** 가입·로그인·초대 화면에 보일 소셜 버튼(키가 있는 제공자만) */
export const GET = handler(async () => ({ providers: enabledProviders() }), { public: true });
