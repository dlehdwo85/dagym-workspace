import { handler, body } from '@/lib/api';
import { leadPageInput, setLeadPage } from '@/lib/metaLeads';

/** 광고 2차 ① 페이지별 리드 광고 받기 켜기/끄기(관리자) — 끄면 페이지의 앱 설치(웹후크)도 지움 */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => setLeadPage(user, params.id, await body(req, leadPageInput)));
