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

export const AI_CONSENT_COPY = {
  title: 'AI 기능을 쓰기 전에 알려 드립니다',
  lead: '워크인의 AI 기능은 답을 만들기 위해 내용을 바깥 AI 회사로 보냅니다. 아래를 읽고 정해 주세요.',
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
  agree: '동의하고 AI 쓰기',
  refuse: '동의하지 않음',
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
  auto: '켜면 회사에 들어온 문의 내용 등을 AI가 자동으로 요약·정리합니다. 이때 그 내용이 Anthropic(미국)으로 전송됩니다. 끄면 자동 요약·정리 없이 원래 내용만 보입니다.',
};
/** 서버가 막을 때 돌려주는 한 줄(화면은 이 코드를 보고 동의 창을 띄운다) */
export const AI_CONSENT_MSG = 'AI 기능은 동의한 뒤에 쓸 수 있습니다 — 설정 › 개인정보·AI 에서 켤 수 있습니다.';
