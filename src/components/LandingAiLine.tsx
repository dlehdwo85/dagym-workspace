'use client';
import { useEffect, useState } from 'react';

/** #412: 소개 사이트 요금 카드의 AI 한 줄 — 고객 화면 기준표와 같은 데이터(/api/public/ai-plans, 무료 요금제 줄). 못 받으면 기본 문구
 *  #466(대표 10/23): 무료 5명 줄을 요금표에서 내려(188) 지금은 기본 문구 — 체험 한도 숫자는 대표 결정 뒤 */
export function LandingAiLine() {
  const [text, setText] = useState('AI 비서(회사 월 한도) · 앱 알림');
  useEffect(() => {
    fetch('/api/public/ai-plans').then((r) => (r.ok ? r.json() : null)).then((m) => {
      const free = m?.plans?.find((p: any) => p.code === 'w_free' || p.code === 'free');
      const n = free?.work?.aiRequests ?? null;
      if (n) setText(`AI 비서·AI 세일즈 회사 월 ${n}회(업무·영업 공유) · 앱 알림`);
    }).catch(() => {});
  }, []);
  return <span data-testid="landing-ai-line">{text}</span>;
}
