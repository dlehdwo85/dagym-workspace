'use client';
import { Field, inputCls } from './ui';

export const SIZES: [string, string][] = [['2-10', '2~10명'], ['11-30', '11~30명'], ['31-100', '31~100명'], ['100+', '100명 넘게']];
import { INDUSTRIES } from '@/lib/industries';
export { INDUSTRIES };

/** V29 가입 2단계 "회사 만들기": 회사 이름·인원 규모·업종(규모·업종은 선택 — 맞춤 안내용) */
export function CompanyFields({ v, onChange }: { v: { company: string; size: string; industry: string }; onChange: (v: { company: string; size: string; industry: string }) => void }) {
  return (
    <div className="space-y-3">
      <Field label="회사(팀) 이름"><input className={inputCls + ' h-11'} value={v.company} onChange={(e) => onChange({ ...v, company: e.target.value })} required maxLength={60} placeholder="예: 우리상사" aria-label="회사 이름" /></Field>
      {/* V32 3: 규모는 버튼으로 고름(선택), 업종은 목록 */}
      <div>
        <p className="mb-1.5 text-sm font-medium text-ink-2">인원 규모 <span className="text-xs font-normal text-ink-3">(선택)</span></p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="인원 규모" data-testid="signup-size">
          {SIZES.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={v.size === k} onClick={() => onChange({ ...v, size: v.size === k ? '' : k })}
              className={'h-11 rounded-input border text-sm ' + (v.size === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700 ring-1 ring-brand-600' : 'border-line hover:bg-slate-50')}>{l}</button>
          ))}
        </div>
      </div>
      {/* 상용화: 업종에 맞춰 AI 비서·시작 템플릿을 준비 — 필수 */}
      <Field label="업종"><select className={inputCls + ' h-11'} value={v.industry} onChange={(e) => onChange({ ...v, industry: e.target.value })} aria-label="업종" data-testid="signup-industry" required>
        <option value="">업종을 고르세요</option>{INDUSTRIES.map((x) => <option key={x}>{x}</option>)}</select></Field>
      <p className="-mt-1 text-xs text-ink-3">AI 비서가 이 업종에 맞춰 처음부터 준비됩니다. 회사 소개·말투는 나중에 [관리 › 회사 정보]에서 더 알려 줄 수 있어요.</p>
    </div>
  );
}
