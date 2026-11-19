import { H, LegalDoc } from '@/components/Legal';
import { AI_CONSENT_COPY as C, aiRecipients } from '@/lib/ai/consentCopy';
import { sttConfigured } from '@/lib/ai/stt';
export const metadata = { title: 'AI 이용 안내' };
export const dynamic = 'force-dynamic'; // 받는 곳은 지금 켜진 기능 기준(받아쓰기 키가 생기면 한 줄 늘어남)

/** AI 동의(대표 11/19 — 애플 5.1.2): 동의 창과 같은 글(src/lib/ai/consentCopy.ts)로 무엇을·어디로·왜 보내는지 */
export default function AiNotice() {
  const stt = sttConfigured();
  return (
    <LegalDoc title="AI 기능 이용 안내">
      <p>워크인의 AI 기능(AI 비서, 말로 업무 등록, 업무 도우미, 메일·문자 초안, 자료 자동 정리 등)은 바깥 AI 회사의 서비스를 사용합니다. <b>동의한 사람만</b> 쓸 수 있고, 동의하기 전에는 내용을 바깥으로 보내지 않습니다.</p>
      <H>{C.whatTitle}</H>
      <ul className="list-disc pl-5">{C.what(stt).map((x) => <li key={x}>{x}</li>)}</ul>
      <p>본인이 볼 수 있는 업무·일정·자료만 답에 쓰입니다.</p>
      <H>{C.whereTitle}</H>
      <ul className="list-disc pl-5" data-testid="ai-notice-recipients">{aiRecipients(stt).map((r) => <li key={r.name}><b>{r.name}</b>({r.country}) — {r.what}</li>)}</ul>
      <H>어떻게 쓰이나요</H>
      <p>요청에 답하는 데만 쓰이며, 받는 회사의 이용 조건에 따라 그 회사 AI를 가르치는 데 쓰이지 않습니다. AI 가 만든 업무·일정은 이용자가 “확인”을 눌러야 반영됩니다.</p>
      <H>정확성</H>
      <p>AI 의 답은 틀릴 수 있습니다. 중요한 결정 전에는 원본 자료를 확인하세요.</p>
      <H>기록과 관리</H>
      <p>AI 대화는 이용자 본인 화면에 보관되며, 팀 공간에서는 권한이 있는 관리자가 사용 내역을 볼 수 있습니다. 보관 기간이 지나면 자동 삭제됩니다.</p>
      <H>동의와 끄기</H>
      <p>처음 한 번 동의를 묻고, <b>설정 › 개인정보·AI</b> 에서 언제든 끌 수 있습니다. 끄면 그때부터 내 내용을 바깥 AI 회사로 보내지 않습니다. 동의하지 않아도 업무·일정·메신저·결재는 그대로 쓸 수 있습니다.</p>
      <p>회사 관리자는 메뉴 권한에서 AI 비서를 끌 수 있습니다. 사람이 누르지 않아도 도는 자동 요약·정리(“{C.autoLabel}”)는 관리 › 회사 정보에서 켜고 끕니다.</p>
    </LegalDoc>
  );
}
