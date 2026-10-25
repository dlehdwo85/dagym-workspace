// #602(대표 10/25 "수집기 상태나 이런 건 슈퍼관리자만. 고객은 연동 방법과 과정만", docs/handoff/SUPER_ADMIN_SCOPE_2026-10-25.md):
// 고객사(관리자·직원)에게 가는 API 응답에서 원인·오류 문장·원가·모델 이름·외부 서비스 이름·공용 실행 기록·원천 주소를 서버가 아예 빼고,
// 고객 문구는 이 한 곳(CUSTOMER_COPY)에서 만든다. 화면에서 숨기는 것으로 끝내지 않는다(§1). 우리 회사(내부 테넌트)는 예외 — 지금처럼 전부 본다.
import { tenantOf, type SessionUser } from './types';

/** 우리 회사(다짐·하이링크) 테넌트 — 내부 직원은 운영 정보를 그대로 본다 */
export const INTERNAL_TENANT = 'default';

/** 원인·원가·모델·외부 서비스 이름까지 전부 보는 사람: 슈퍼관리자(platformAdmin = SUPER_ADMIN_EMAILS 기준, 142차) 또는 내부 테넌트 사람 */
export const seesInternals = (u: Pick<SessionUser, 'platformAdmin' | 'tenant' | 'isDemo'>) => !!u.platformAdmin || tenantOf(u) === INTERNAL_TENANT;

/** 고객에게 보이는 문구 사전 — 상태 3가지 + 방법 + 결과. 오류 원인·HTTP 코드·서비스 이름은 여기 없다 */
export const CUSTOMER_COPY = {
  connected: '연결됨',
  disconnected: '연결 안 됨',
  applyNeeded: '신청 필요',
  off: '잠시 중단',
  /** 공공데이터 원천 연결 방법 — 키는 운영사가 넣고, 고객은 상태만 본다 */
  howPublicData: '공공데이터포털(data.go.kr)에서 이 자료의 활용신청이 승인되면 자동으로 연결됩니다. 신청·승인은 운영사가 진행하며, 연결되면 매일 새 공고가 들어옵니다.',
  howWatch: '감시할 게시판 주소가 등록되면 자동으로 연결됩니다(운영사 설정).',
  received: (n: number) => `받았습니다 ${n.toLocaleString('ko-KR')}건`,
  notReceived: '못 받았습니다 — 연결을 확인해 주세요',
  /** 수집 누락 경고(회사 관리자 몫) 한 줄 */
  todayMissed: '오늘 새 공고를 받지 못했습니다. 데이터 설정에서 연결을 확인해 주세요',
  productionFailed: '만들지 못했습니다 — [AI 다시 만들기]를 눌러 주세요',
  reconnect: '다시 연결 필요',
} as const;

/** 외부 서비스·모델 이름이 든 문장을 고객용으로 — 원인은 지우고 '외부 서비스'로만 */
const EXTERNAL = /anthropic|claude(?:-[a-z0-9.-]+)?|openai|gpt-?[0-9a-z.-]*|higgsfield|nicepay|나이스페이|resend|오퍼스|소네트|하이쿠|opus|sonnet|haiku/gi;
export function customerText(s: string | null | undefined): string | null {
  if (!s) return s ?? null;
  return s.replace(EXTERNAL, '외부 서비스').replace(/HTTP\s?\d{3}/gi, '연결 오류').replace(/\b(40[1-4]|50[0-4])\b/g, '연결 오류').replace(/\$\s?\d[\d,.]*/g, '').replace(/\s{2,}/g, ' ').trim() || null;
}

/** 수집기 한 줄 상태: 키가 없으면 '신청 필요', 플랫폼에서 껐으면 '잠시 중단', 아니면 '연결됨'(마지막이 실패면 '연결 안 됨') */
export function collectorState(c: { globalEnabled: boolean; missingKeys: number; lastStatus: string | null }): 'connected' | 'disconnected' | 'apply_needed' | 'off' {
  if (!c.globalEnabled) return 'off';
  if (c.missingKeys > 0) return 'apply_needed';
  return c.lastStatus === 'failed' ? 'disconnected' : 'connected';
}
