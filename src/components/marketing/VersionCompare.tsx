'use client';
import { MediaThumb } from '@/components/MediaView';
import { useApi } from '@/components/client';
import { Skeleton, cx } from '@/components/ui';

/** 로컬 10/24: 수정본이 요청을 실제로 반영했는지(서버 checkRevision) — 반영한 요청 / 일부 반영 / 요청(이미 충족) / 반영 안 됨 */
export type RevisionCheck = { status: 'applied' | 'partial' | 'already' | 'unmet' | 'unknown'; detail?: string };
export type Revision = { ai?: boolean; n?: number; max?: number; from?: number; request?: string; by?: string | null; parts?: string[]; backdrop?: string | null; check?: RevisionCheck | null };
export const requestLabel = (r?: Revision | null) => (r?.check?.status === 'unmet' ? '반영 안 됨' : r?.check?.status === 'partial' ? '일부 반영' : r?.check?.status === 'already' ? '요청(이미 충족)' : '반영한 요청');
/** 반영 안 됨·일부만이면 한 줄 설명(무엇이 그대로인지) */
export const requestNote = (r?: Revision | null) => (r?.check?.detail && r.check.status !== 'applied' && r.check.status !== 'unknown' ? r.check.detail : '');
type Ver = { version: number; body: string | null; media_ids: string[]; note: string | null; revision?: Revision | null };
const PART: Record<string, string> = { text: '글', visual: '시안' };
export const partsLabel = (p?: string[]) => (p ?? []).map((x) => PART[x] ?? x).join('·');

/** #545(대표 10/24) 이전 버전과 나란히: 왼쪽 = 수정 요청을 받은 버전, 오른쪽 = 수정본 — 시안 첫 장 + 글(바뀐 줄 표시). 승인함 카드·콘텐츠 상세 공용 */
export function VersionCompare({ id, from, to }: { id: string; from?: number | null; to: number }) {
  const { data, error } = useApi<{ versions: Ver[]; media: { id: string; mime_type: string | null }[] }>(`/api/marketing/contents/${id}`);
  if (error) return <p className="mt-2 text-xs text-red-700">비교할 버전을 불러오지 못했습니다</p>;
  if (!data) return <div className="mt-2"><Skeleton rows={3} /></div>;
  const b = data.versions.find((v) => v.version === to);
  const a = data.versions.find((v) => v.version === (from ?? to - 1)) ?? data.versions.find((v) => v.version < to);
  if (!a || !b) return <p className="mt-2 text-xs text-ink-3">비교할 이전 버전이 없습니다</p>;
  const lines = (s: string | null) => String(s ?? '').split('\n');
  const set = (s: string | null) => new Set(lines(s).map((l) => l.trim()).filter(Boolean));
  const A = set(a.body), B = set(b.body);
  const mime = (m: string) => data.media.find((x) => x.id === m)?.mime_type ?? null;
  const cols = [{ v: a, label: '수정 요청 전', other: B, side: 'old' }, { v: b, label: '수정본', other: A, side: 'new' }] as const;
  return (
    <div className="mt-2 rounded-input border border-violet-200 bg-violet-50/30 p-2 text-xs" data-testid="version-compare">
      <div className="grid grid-cols-2 gap-2">
        {cols.map(({ v, label, other, side }) => (
          <div key={side} className="min-w-0" data-testid={`compare-${side}`}>
            <p className="font-semibold text-ink">v{v.version} <span className="font-normal text-ink-3">{label}</span></p>
            <div className="mt-1 aspect-[4/5] w-full overflow-hidden rounded-input border border-line bg-slate-100">
              {v.media_ids?.[0] ? <MediaThumb src={`/api/library/${v.media_ids[0]}/download?inline=1`} mime={mime(v.media_ids[0])} className="size-full object-cover" alt={`v${v.version} 시안`} />
                : <span className="flex size-full items-center justify-center text-ink-3">시안 없음</span>}
            </div>
            <div className="mt-1 space-y-0.5 break-words">{lines(v.body).map((l, k) => { const changed = !!l.trim() && !other.has(l.trim());
              return <p key={k} className={cx('whitespace-pre-wrap', changed && (side === 'new' ? 'rounded bg-emerald-100 text-emerald-950' : 'rounded bg-red-50 text-red-900 line-through decoration-red-300'))} data-changed={changed || undefined}>{l || ' '}</p>; })}</div>
          </div>))}
      </div>
      {b.revision?.request && <p className={cx('mt-2', b.revision.check?.status === 'unmet' ? 'text-red-800' : 'text-ink-2')} data-testid="compare-request">{requestLabel(b.revision)}: <b className="text-ink">{b.revision.request}</b>{b.revision.parts?.length ? ` · 바뀐 것: ${partsLabel(b.revision.parts)}` : ''}{b.revision.backdrop ? ` · 바탕: ${b.revision.backdrop}` : ''}{b.revision.check?.detail ? ` · 확인: ${b.revision.check.detail}` : ''}</p>}
    </div>
  );
}
