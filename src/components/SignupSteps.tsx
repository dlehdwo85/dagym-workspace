'use client';
import { cx } from './ui';

/** V32 3 가입 진행 표시: ① 계정 → ② 회사 → ③ 연락 채널 → ④ 동료 초대 */
export const SIGNUP_STEP_LABELS = ['계정', '회사', '연락 채널', '동료 초대'];
export function SignupSteps({ at }: { at: number }) {
  return (
    <div className="mb-4" data-testid="signup-steps" aria-label={`가입 ${at}/4 단계`}>
      <div className="flex items-center justify-between text-xs text-ink-3"><span className="font-semibold text-brand-700">{at}/4 · {SIGNUP_STEP_LABELS[at - 1]}</span><span>{SIGNUP_STEP_LABELS.slice(at).join(' → ')}</span></div>
      <ol className="mt-1.5 flex gap-1">{SIGNUP_STEP_LABELS.map((l, i) => <li key={l} className={cx('h-1.5 flex-1 rounded-full', i < at ? 'bg-brand-600' : 'bg-slate-200')} />)}</ol>
    </div>
  );
}
