/**
 * AI 동의(대표 11/19 결정 — 애플 11/15 반려 5.1.2: 바깥 AI 로 보내기 전에 무엇을·누구에게 보내는지 알리고 허락을 받을 것).
 * 화면과 서버가 함께 쓰는 글·판 번호를 여기 한곳에 둔다(글을 고칠 때 이 파일만).
 *
 * 받는 곳은 **지금 실제로 보내는 곳만** 적는다(로컬 11/19: 운영에 받아쓰기 키가 없어 OpenAI 로는 아무것도 안 감).
 * 받아쓰기를 켜는 날 받는 곳이 늘면 판 번호가 달라져 모든 사람에게 다시 묻는다.
 */
export const AI_CONSENT_KIND = 'ai_share';
export const AI_CONSENT_CODE = 'ai_consent';
/** 글의 뜻이 바뀌면(보내는 것·받는 곳·목적) 올린다 → 모든 사람에게 다시 물음 */
const NOTICE = '2026-11';
/** stt = 회의 녹음 받아쓰기(OpenAI)가 켜져 있는지 */
export const aiNoticeVersion = (stt: boolean) => `${NOTICE}${stt ? '+stt' : ''}`;

export type AiRecipient = { name: string; country: string; what: string };
export const aiRecipients = (stt: boolean): AiRecipient[] => [
  { name: 'Anthropic', country: '미국', what: "'Claude'라는 AI를 만드는 회사. 글과 파일을 읽고 답을 만듭니다." },
  ...(stt ? [{ name: 'OpenAI', country: '미국', what: '회의 녹음을 글로 바꿀 때만 씁니다.' }] : []),
];
export const aiRecipientNames = (stt: boolean) => aiRecipients(stt).map((r) => `${r.name}(${r.country})`).join('·');
/** 나라 없이 이름만 — 동의 창의 펼치지 않은 본문(나라·항목은 [자세히 보기] 안과 처리방침·AI 이용 안내에 그대로) */
export const aiRecipientShort = (stt: boolean) => aiRecipients(stt).map((r) => r.name).join('·');

export const AI_CONSENT_COPY = {
  // 대표 11/19 밤(운영 창을 보고): "굳이 필요한가 · 미국으로 유출되는 느낌" → 사실은 그대로 두고 순서와 양을 바꿈.
  // 펼치지 않아도 보이는 것 = 한 문장(무엇을 위해·누구에게) + 세 줄(가르치는 데 안 씀 · 안 쓰면 안 보냄 · 다른 기능은 그대로). 항목·나라·까닭은 [자세히 보기] 안.
  // 받는 곳 이름은 펼치지 않은 본문에도 둔다(애플 5.1.2 '누구에게'). 판 번호는 그대로(뜻이 바뀌지 않음 — 이미 정한 사람에게 다시 묻지 않음).
  title: 'AI 기능 사용 안내',
  lead: (stt: boolean) => `AI 비서·자동 정리 같은 AI 기능은 답을 만들 때만, 그때 필요한 내용만 AI 회사(${aiRecipientShort(stt)})에 보내 처리합니다.`,
  points: [
    '보낸 내용은 AI를 가르치는 데 쓰이지 않습니다.',
    'AI 기능을 쓰지 않으면 내 내용은 보내지 않습니다.',
    '동의하지 않아도 업무·일정·메신저·결재는 그대로 씁니다.',
  ],
  /** 대표 11/20 #1086: 가입·초대 수락·요금제 동의 목록의 한 줄(약관처럼 — 자세한 것은 접어 둠) */
  lineLabel: 'AI 기능 이용 동의',
  line: (stt: boolean) => `답을 만들 때 필요한 내용만 AI 회사(${aiRecipientShort(stt)})에 보내 처리`,
  lineMore: '자세히',
  /** 국외 이전 고지(개인정보 보호법 28조의8 ②) — 처리방침 5절과 같은 내용. 받는 곳·나라·항목·목적은 위 절들, 여기는 이전 시기·방법·보유 기간 */
  transferTitle: '국외 이전',
  transfer: (stt: boolean) => [
    `받는 곳·나라: ${aiRecipientNames(stt)}`,
    '항목·목적: 위 "무엇을 보내나요"·"왜 보내나요"의 내용',
    '이전 시기·방법: AI 기능을 쓸 때마다 암호화된 인터넷 연결(HTTPS)로 전송',
    '보유 기간: 위탁 계약 종료 또는 탈퇴 시까지',
  ],
  more: '자세히 보기',
  moreHint: '무엇을 · 어디로 · 왜',
  whatTitle: '무엇을 보내나요',
  what: (stt: boolean) => [
    'AI에게 쓴 글과 말한 내용',
    'AI에게 붙인 파일·사진',
    '답에 필요한 내 업무·일정·자료 내용 (예: "이번 주 내 업무 정리해 줘" → 내 업무 목록)',
    ...(stt ? ['회의록을 만들 때는 회의 녹음'] : []),
    '자료실에 올린 파일(자동으로 이름을 붙이고 분류할 때)',
  ],
  whereTitle: '어디로 보내나요',
  whyTitle: '왜 보내나요',
  why: (stt: boolean) => [
    '질문에 답하고, 글을 정리·요약하고, 말한 내용을 업무로 바꾸기 위해서입니다.',
    `${stt ? '두 회사' : '이 회사'}의 이용 조건에 따라, 보낸 내용은 그 회사 AI를 가르치는 데 쓰이지 않습니다.`,
  ],
  declineTitle: '동의하지 않으면',
  decline: [
    'AI 기능만 쓸 수 없습니다. 업무·일정·메신저·결재는 그대로 씁니다.',
    '내 내용은 바깥으로 나가지 않습니다.',
    '언제든 설정 › 개인정보·AI 에서 바꿀 수 있습니다.',
  ],
  /**
   * 대표 11/23 #1087: AI 동의 필수 — AI 처리는 워크인의 핵심 기능. 웹·안드로이드 앱은 가입·초대 수락 목록의 [필수] 줄 + 아직 동의하지 않은 사람은 들어오면 동의 화면(닫기·나중에 없음).
   * 아이폰 앱은 1.2.0 심사 통과 전까지 예전 그대로(선택 · 창 제목·단추 글자 그대로 — 애플 5.1.1(iv) 반려 위험). 판 번호는 그대로(보내는 것·받는 곳·목적이 같음 — 이미 동의한 사람에게 다시 묻지 않음).
   */
  requiredTag: '[필수]',
  optionalTag: '[선택]',
  corePoint: 'AI 처리는 워크인의 핵심 기능이라 꼭 동의를 받습니다.',
  requiredTitle: 'AI 기능 이용 동의(필수)',
  requiredLead: '워크인을 계속 쓰려면 아래 내용에 동의해 주세요.',
  requiredDecline: [
    'AI 처리는 워크인의 핵심 기능이라, 동의하지 않으면 워크인을 쓸 수 없습니다.',
    'AI 기능을 쓰지 않으면 내 내용은 보내지 않습니다.',
    '동의를 거두려면 탈퇴해야 합니다(설정 › 계정 — 회사 계정은 회사 관리자에게 삭제 요청).',
  ],
  requiredAgree: '동의하고 계속',
  requiredLogout: '로그아웃',
  requiredSetting: '필수 동의 — 워크인의 핵심 기능이라 끌 수 없습니다. 동의를 거두려면 탈퇴해야 합니다.',
  requiredMissing: 'AI 기능 이용 동의(필수)에 체크해 주세요',
  agree: 'AI 기능 쓰기',
  refuse: '쓰지 않기',
  later: '나중에 정하기',
  /** 동의하지 않은 사람이 AI 단추를 눌렀을 때 */
  blockedTitle: 'AI 기능은 동의한 뒤에 쓸 수 있습니다',
  blocked: (stt: boolean) => `내용을 바깥 AI 회사(${aiRecipientNames(stt)})로 보내야 답을 만들 수 있습니다.`,
  blockedOpen: '내용 보고 정하기',
  /** 설정 › 개인정보·AI */
  settingLabel: 'AI 기능 사용',
  setting: (stt: boolean) => `켜면 AI에게 쓴 글·붙인 파일·답에 필요한 업무 내용이 ${aiRecipientNames(stt)}로 전송됩니다. 끄면 그때부터 보내지 않습니다.`,
  /** 회사 관리자 — 사람이 누르지 않아도 도는 자동 작업 */
  autoLabel: '회사 자료 자동 AI 처리',
  auto: '켜면 사람이 누르지 않아도 AI가 회사 자료(들어온 문의, 올린 매출 자료, 영업·마케팅 자료)를 자동으로 요약·정리합니다. 이때 그 내용이 Anthropic(미국)으로 전송됩니다. 끄면 이런 자동 작업은 AI 없이 돌거나 쉽니다.',
};
/** 서버가 막을 때 돌려주는 한 줄(화면은 이 코드를 보고 동의 창을 띄운다) */
export const AI_CONSENT_MSG = 'AI 기능은 동의한 뒤에 쓸 수 있습니다 — 설정 › 개인정보·AI 에서 켤 수 있습니다.';
/** 대표 11/23 #1087: 가입·초대 수락에서 AI 동의를 빼고 보냈을 때(웹·안드로이드 — 아이폰 앱 요청은 예외) */
export const AI_REQUIRED_MSG = 'AI 기능 이용에 동의해 주세요(필수 — 워크인의 핵심 기능입니다)';
/** 아이폰 앱 요청인지(앱이 붙이는 표시 WorkInApp + 안드로이드 아님) — 서버에서 동의 필수 예외를 가릴 때 */
export const isIosAppUa = (ua: string | null | undefined) => /WorkinApp/i.test(ua ?? '') && !/Android/i.test(ua ?? '');
