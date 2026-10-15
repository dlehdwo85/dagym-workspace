'use client';
import { useState } from 'react';
import Link from 'next/link';
import { HelpCircle } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, Field, PageHeader, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

const FAQ: [string, string][] = [
  ['업무는 어떻게 만들어요?', '아래 + 버튼(휴대폰) 또는 위쪽 "만들기"(PC) → 업무. 목록 묶음 끝 "업무 추가" 줄에 바로 써도 됩니다. "내일 3시 김민수 견적서"처럼 쓰면 날짜·담당자를 알아봅니다. 🎤 음성 등록도 됩니다.'],
  ['여러 사람에게 같은 업무를 주려면?', '담당자 선택에서 여러 명을 체크하면 "n명에게 각각 만들기"로 사람마다 1건씩 만들어집니다.'],
  ['업무 상태는 누가 바꾸나요?', '진행 상태(확인·진행 중·검토 요청·완료)는 담당자만 바꿉니다. 지시자·관리자는 검토 요청을 승인(완료)하거나 반려하고, 보류할 수 있습니다.'],
  ['알림이 안 와요', '설정 → 알림에서 앱 알림을 켜고, 휴대폰 설정에서 워크인 알림이 허용되어 있는지 확인하세요. 일정·마감 미리 알림은 휴대폰에 예약되어 인터넷이 없어도 울립니다.'],
  ['구글·아웃룩 캘린더에서 보고 싶어요', '설정 → 캘린더 구독 주소를 만들어 캘린더 앱에 "URL로 추가"하세요(읽기 전용).'],
  ['파일이 안 올라가요', '실패하면 이유가 빨간 글씨로 보입니다. 인터넷 연결을 확인하고 다시 올려 주세요. 계속되면 아래 문의에 그 문구를 붙여 보내 주세요.'],
  ['AI 비서는 무엇을 하나요?', '자료실·업무·일정을 내 권한 안에서 찾아 답하고, 사진·PDF를 읽어 업무를 정리해 줍니다. 업무 만들기·첨부 같은 변경은 [확인]을 눌러야 반영됩니다.'],
  ['비밀번호를 잊었어요', '회사 관리자에게 재설정 링크를 요청하세요.'],
];
const NEWS: [string, string][] = [
  ['2026-10-14', '자료로 업무 일괄 생성(AI), 끌어 놓기 업로드, 2단계 인증, 캘린더 구독 주소, 도움말·문의'],
  ['2026-10-14', '상태 칩(진행 전 · 확인 전/확인함·진행 중·검토·보류·완료), 검토 요청 즉시 알림·알림에서 승인'],
  ['2026-10-14', '휴대폰 예약 알림, 회사 자료실·AI 비서, 사용량·요금제'],
];

/** V12 3번 도움말·문의 · 업데이트 소식 · 서비스 상태 */
export default function HelpPage() {
  const mine = useApi<{ tickets: any[] }>('/api/support');
  const [f, setF] = useState({ category: 'question', subject: '', body: '' });
  async function send(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/support', { body: { ...f, page: document.referrer || undefined } }); setF({ category: 'question', subject: '', body: '' }); mine.reload(); toast.ok('문의를 보냈습니다 — 답변이 오면 알림으로 알려 드립니다'); }
    catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="도움말·문의" icon={HelpCircle} sub={<>자주 묻는 질문과 문의. 서비스 상태는 <Link href="/status" className="text-brand-600 underline">상태 페이지</Link>에서 볼 수 있습니다.</>} />
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">자주 묻는 질문</h2>
        <div className="mt-2 divide-y divide-line">{FAQ.map(([q, a]) => <details key={q} className="py-2"><summary className="cursor-pointer text-sm font-medium">{q}</summary><p className="mt-1 text-sm text-ink-2">{a}</p></details>)}</div>
      </section>
      <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="support-form">
        <h2 className="text-sm font-semibold">문의 남기기</h2>
        <form onSubmit={send} className="mt-2 space-y-2">
          <div className="flex gap-2">
            <select className={cx(inputCls, 'w-32')} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="문의 종류">
              <option value="question">사용 문의</option><option value="bug">오류 신고</option><option value="billing">요금·결제</option><option value="idea">제안</option>
            </select>
            <input className={inputCls} placeholder="제목" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} aria-label="문의 제목" required minLength={2} />
          </div>
          <textarea className={cx(inputCls, 'min-h-[100px]')} placeholder="무엇을 하다가 어떤 문제가 있었는지 적어 주세요(오류 문구가 있으면 그대로)" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} aria-label="문의 내용" required minLength={2} />
          <div className="flex justify-end"><Button type="submit">보내기</Button></div>
        </form>
        {!!mine.data?.tickets.length && (
          <ul className="mt-3 divide-y divide-line text-sm" data-testid="my-tickets">
            {mine.data.tickets.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex justify-between gap-2"><b className="font-medium">{t.subject}</b><span className={cx('text-xs', t.status === 'open' ? 'text-amber-700' : 'text-green-700')}>{t.status === 'open' ? '접수됨' : '답변 완료'}</span></div>
                <div className="text-xs text-ink-3">{fmtDateTime(t.created_at)}</div>
                {t.answer && <p className="mt-1 whitespace-pre-wrap rounded bg-green-50 p-2 text-ink-2">{t.answer}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-card border border-line bg-white p-4 shadow-card">
        <h2 className="text-sm font-semibold">업데이트 소식</h2>
        <ul className="mt-2 space-y-1 text-sm">{NEWS.map(([d, t], i) => <li key={i}><span className="mr-2 text-xs text-ink-3">{d}</span>{t}</li>)}</ul>
      </section>
    </div>
  );
}
