import { H, LegalDoc } from '@/components/Legal';
export const metadata = { title: 'AI 이용 안내' };

export default function AiNotice() {
  return (
    <LegalDoc title="AI 기능 이용 안내">
      <p>워크인의 AI 비서·말로 등록·자료로 업무 만들기·매출 분석 기능은 외부 AI 처리 업체(Anthropic, OpenAI)의 API 를 사용합니다.</p>
      <H>무엇이 전송되나요</H>
      <p>AI 에게 보낸 문장, 함께 첨부한 파일, 그리고 답에 필요한 범위의 업무·일정 정보(본인이 볼 수 있는 것만)가 전송됩니다.</p>
      <H>어떻게 쓰이나요</H>
      <p>요청에 답하는 데만 쓰이며, 업체의 모델 학습에 쓰이지 않는 API 로 전송합니다. AI 가 만든 업무·일정은 이용자가 “확인”을 눌러야 반영됩니다.</p>
      <H>정확성</H>
      <p>AI 의 답은 틀릴 수 있습니다. 중요한 결정 전에는 원본 자료를 확인하세요.</p>
      <H>기록과 관리</H>
      <p>AI 대화는 이용자 본인 화면에 보관되며, 팀 공간에서는 권한이 있는 관리자가 사용 내역을 볼 수 있습니다. 보관 기간이 지나면 자동 삭제됩니다.</p>
      <H>끄기</H>
      <p>AI 기능을 쓰지 않으면 아무것도 전송되지 않습니다. 팀 관리자는 메뉴 권한에서 AI 비서를 끌 수 있습니다.</p>
    </LegalDoc>
  );
}
