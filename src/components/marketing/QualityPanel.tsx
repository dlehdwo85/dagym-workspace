'use client';
import { Button, cx } from '@/components/ui';
import { MODE_HINT, MODE_LABEL, ModeToggle, asMode, type Mode } from './ModeToggle';

/** #426 글 품질 엔진 화면 조각 — 사람다움·훅 점수, 훅 후보 3개, 채널 검사, '더 보기' 전 미리보기, 초 단위 장면표 (승인함 상세·제작의뢰실 공용) */
export type HookS = { text: string; score: number; pass: boolean; fails: string[]; parts?: Record<string, number>; notes?: string[] };
export type Timing = { rows: { line: string; from: number; to: number; sec: number; over?: boolean }[]; total: number; warnings: string[] };
export type QReport = { v?: number; human: { score: number; pass: boolean; issues: string[] }; needsPolish: boolean; hook: HookS | null; hooks?: HookS[];
  channel?: { level: 'error' | 'warn'; msg: string }[]; preview?: string | null; timing?: Timing | null; voice?: string[]; notes?: string[]; mode?: Mode;
  /** 로컬 QA 10/24 ②: 올리기 전 자동 검사(빈 글·끊긴 문장·해시태그·권유·연락처·형식·틀 문구·다른 브랜드) — 걸린 줄. 없으면 검사 전 글 */
  preflight?: string[] };
const PART: Record<string, string> = { front: '앞부분', specific: '구체성', stakes: '걸린 것', callout: '대상 호명', curiosity: '궁금증', offer: '제안' };
const weak = (h: HookS) => Object.entries(h.parts ?? {}).filter(([, v]) => !v).map(([k]) => PART[k] ?? k).join('·');

export const ScoreChip = ({ label, score, pass, testId }: { label: string; score: number; pass: boolean; testId?: string }) => (
  <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-semibold', pass ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-800')} data-testid={testId} data-pass={pass || undefined}>{label ? `${label} ` : ''}{score}점</span>
);

/** 대본 → 초 단위 구성표(분당 300음절). 넘친 장면은 빨강 */
/** secs(#454 영상 v2): 장면 실제 길이 — 있으면 '읽는 시간 / 장면 길이'로 보여 주고, 대사가 장면보다 길면 빨갛게 */
export function TimingTable({ t, visuals, secs }: { t: Timing; visuals?: string[]; secs?: number[] }) {
  const has = !!secs?.length && secs.every((x) => x > 0);
  return (
    <div className="mt-2" data-testid="quality-timing">
      <div className="font-medium text-ink-2">장면 구성 <span className="font-normal text-ink-3">{has ? `장면 ${secs!.reduce((a, x) => a + x, 0)}초(끝 화면 따로) · 대사 읽는 시간 ${t.total}초` : `전체 ${t.total}초 · 첫 장면 3초·한 장면 4초 안`}</span></div>
      <table className="mt-1 w-full text-left text-[11px]"><tbody>{t.rows.map((r, k) => { const tight = has && r.sec > (secs![k] ?? 0) - 0.3; return (
        <tr key={k} className={cx('border-t border-line align-top', (has ? tight : r.over) && 'bg-red-50 text-red-800')} data-testid="quality-timing-row" data-over={(has ? tight : r.over) || undefined}>
          <td className="w-20 py-0.5 pr-2 font-mono tabular-nums">{has ? `장면 ${k + 1}` : `${r.from.toFixed(1)}~${r.to.toFixed(1)}초`}</td>
          <td className="py-0.5">{r.line}{visuals?.[k] && <span className="block text-ink-3">{visuals[k]}</span>}</td>
          <td className="w-20 py-0.5 text-right tabular-nums">{has ? `${r.sec} / ${secs![k]}초` : `${r.sec}초`}</td></tr>); })}</tbody></table>
      {t.warnings.length > 0 && <ul className="mt-1 space-y-0.5 text-amber-800" data-testid="quality-timing-warn">{t.warnings.map((w) => <li key={w}>· {w}</li>)}</ul>}
    </div>
  );
}

/** onMode(#499-1): 관리자는 채점 기준(콘텐츠형/광고형)을 바꿀 수 있음 — 바꾸면 같은 훅 후보로 다시 채점 */
export function QualityPanel({ r, channel, onPolish, onPickHook, onMode, busy }: { r: QReport; channel?: string; onPolish?: () => void; onPickHook?: (text: string) => void; onMode?: (m: Mode) => void; busy?: boolean }) {
  const errs = (r.channel ?? []).filter((x) => x.level === 'error'); const warns = (r.channel ?? []).filter((x) => x.level === 'warn');
  const mode = asMode(r.mode);
  return (
    <section className="rounded-input border border-line p-3 text-xs" data-testid="quality-panel">
      <div className="flex flex-wrap items-center gap-1.5">
        <b className="text-ink-2">글 품질</b>
        <ScoreChip label="사람다움" score={r.human.score} pass={r.human.pass} testId="quality-human" />
        {r.needsPolish && <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-semibold text-white" data-testid="quality-needs-polish">다듬기 필요</span>}
        {r.hook && <ScoreChip label="훅" score={r.hook.score} pass={r.hook.pass} testId="quality-hook" />}
        {r.preflight && <span className={cx('rounded-full border px-2 py-0.5 text-[11px] font-semibold', r.preflight.length ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800')} data-testid="quality-preflight-chip" data-pass={!r.preflight.length || undefined}>{r.preflight.length ? `올리기 전 검사 ${r.preflight.length}건` : '올리기 전 검사 통과'}</span>}
        {onMode ? <ModeToggle value={mode} onChange={onMode} disabled={busy} testId="quality-mode" />
          : <span className="text-[11px] text-ink-3" title={MODE_HINT[mode]} data-testid="quality-mode-label">{MODE_LABEL[mode]} 기준</span>}
        {onPolish && <Button size="sm" variant={r.needsPolish ? 'primary' : 'secondary'} className="ml-auto" onClick={onPolish} disabled={busy} data-testid="quality-polish">{busy ? '다듬는 중…' : 'AI로 다듬기'}</Button>}
      </div>
      {!!r.preflight?.length && <ul className="mt-1.5 space-y-0.5 rounded-input bg-red-50 px-2 py-1.5 text-red-800" data-testid="quality-preflight">{r.preflight.map((x) => <li key={x}>· {x}</li>)}</ul>}
      {r.human.issues.length > 0 && <p className="mt-1 text-ink-2" data-testid="quality-human-issues">{r.human.issues.join(' · ')}</p>}
      {r.hook && !r.hook.pass && <p className="mt-1 text-amber-800" data-testid="quality-hook-why">첫 훅 «{r.hook.text}» — {r.hook.fails.length ? r.hook.fails.join(' · ') : `약한 항목: ${weak(r.hook) || '전반'}`}</p>}
      {!!r.hook?.notes?.length && <p className="mt-1 text-amber-800" data-testid="quality-hook-notes">{r.hook.notes.join(' · ')}</p>}
      {!!r.hooks?.length && (
        <div className="mt-2" data-testid="quality-hooks">
          <div className="font-medium text-ink-2">훅 후보 <span className="font-normal text-ink-3">점수는 나쁜 훅 거르기용 — 통과한 훅끼리는 실제 성과로 고릅니다</span></div>
          <ul className="mt-1 space-y-1">{r.hooks.map((h, k) => (
            <li key={k} className="flex items-center gap-1.5" data-testid="quality-hook-row"><span className="w-3 shrink-0 text-right text-ink-3">{k + 1}</span><ScoreChip label="" score={h.score} pass={h.pass} /><span className={cx('min-w-0 flex-1', h.text === r.hook?.text && 'font-semibold')}>{h.text}</span>
              {onPickHook && h.pass && h.text !== r.hook?.text && <button type="button" className="shrink-0 rounded-input border border-line px-2 py-0.5 text-[11px] hover:bg-slate-50" onClick={() => onPickHook(h.text)} disabled={busy} data-testid="quality-hook-pick">이 훅으로</button>}</li>))}</ul>
        </div>)}
      {(errs.length > 0 || warns.length > 0) && <ul className="mt-2 space-y-0.5" data-testid="quality-channel">
        {errs.map((e) => <li key={e.msg} className="text-red-700"><b>막음</b> {e.msg}</li>)}{warns.map((e) => <li key={e.msg} className="text-ink-2"><b className="text-amber-800">권장</b> {e.msg}</li>)}</ul>}
      {r.preview && (channel === 'instagram' || channel === 'facebook') && <div className="mt-2" data-testid="quality-preview"><div className="text-ink-3">&lsquo;더 보기&rsquo; 전 미리보기</div>
        <p className="mt-0.5 whitespace-pre-wrap rounded-input bg-slate-50 p-2">{r.preview}<span className="text-ink-3"> … 더 보기</span></p></div>}
      {r.timing && <TimingTable t={r.timing} />}
      {!!r.voice?.length && <p className="mt-1 text-amber-800" data-testid="quality-voice">{r.voice.join(' · ')}</p>}
      {!!r.notes?.length && <p className="mt-1 text-ink-3" data-testid="quality-notes">자동 수정: {r.notes.join(' · ')}</p>}
    </section>
  );
}
