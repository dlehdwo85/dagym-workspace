'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Search, Sparkles, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type T = { id: string; title: string; user_id: string; user_name: string; task_id: string | null; updated_at: string; cost_usd: number; turns: number; blocked: number; deleted_by_user: boolean };

/** V14 6번 AI 사용 내역 (메뉴 권한 "AI 사용 내역": 조회 / 편집). 열람은 감사 기록에 남는다 */
export default function AiLogsPage() {
  const { dir, menus } = useSession() as any;
  const canEdit = (menus?.ai_logs ?? 'none') === 'edit';
  const [userId, setUserId] = useState('');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useApi<{ threads: T[]; settings: any }>(`/api/ai/logs?${new URLSearchParams({ ...(userId ? { userId } : {}), ...(query ? { q: query } : {}) })}`, [userId, query]);
  const [open, setOpen] = useState<{ thread: any; messages: any[] } | null>(null);
  const [set, setSet] = useState<any>(null);
  async function view(id: string) { try { setOpen(await api(`/api/ai/logs/${id}`)); } catch (e: any) { toast.error(e.message); } }
  async function remove(t: T) {
    if (!confirm(`${t.user_name}님의 "${t.title}" 대화를 완전히 지울까요? (되돌릴 수 없음)`)) return;
    try { await api(`/api/ai/logs/${t.id}`, { method: 'DELETE' }); setOpen(null); reload(); } catch (e: any) { toast.error(e.message); }
  }
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/ai/settings', { method: 'PUT', body: { retentionDays: Number(set.retention_days), dailyLimit: Number(set.daily_limit), inputMax: Number(set.input_max), topicFilter: !!set.topic_filter, webTools: !!set.web_tools, docEngine: !!set.doc_engine, nightScope: set.night_scope ?? {} } }); setSet(null); reload(); toast.ok('저장했습니다'); }
    catch (er: any) { toast.error(er.message); }
  }
  if (error) return <ErrorBox error={error} retry={reload} />;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="AI 사용 내역" icon={Sparkles} sub="누가·언제·무슨 질문을 했는지와 비용. 열어 본 기록은 감사 기록에 남습니다."
        actions={canEdit && data && <Button variant="secondary" onClick={() => setSet({ ...data.settings })} data-testid="ai-settings-open">보관·한도 설정</Button>} />
      {data && <p className="text-xs text-ink-2" data-testid="ai-settings-line">보관 {data.settings.retention_days ? `${data.settings.retention_days}일` : '무기한'} · 1인 하루 {data.settings.daily_limit}회 · 1회 {data.settings.input_max.toLocaleString('ko-KR')}자 · 업무 무관 질문 {data.settings.topic_filter ? '차단' : '허용'} · 웹 검색 {data.settings.web_tools ? '켜짐' : '꺼짐'} · 문서 작업 {data.settings.doc_engine ? '켜짐' : '꺼짐'}</p>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select className={cx(inputCls, 'sm:w-48')} value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="사람">
          <option value="">모든 사람</option>{dir.users.map((u: any) => <option key={u.id} value={u.id}>{u.name}{u.title ? ` · ${u.title}` : ''}</option>)}
        </select>
        <form className="relative flex-1" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <input className={cx(inputCls, 'pl-9')} placeholder="질문·답 내용 검색" value={q} onChange={(e) => setQ(e.target.value)} aria-label="내역 검색" />
        </form>
      </div>
      {loading && !data ? <Skeleton rows={5} /> : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="ai-logs">
          {data!.threads.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <button className="min-w-0 flex-1 text-left" onClick={() => view(t.id)}>
                <div className="truncate font-medium">{t.title}{t.deleted_by_user && <span className="ml-1 text-xs text-ink-3">(본인이 목록에서 지움)</span>}</div>
                <div className="truncate text-xs text-ink-3">{t.user_name} · {fmtDateTime(t.updated_at)} · 질문 {t.turns}번{t.blocked ? ` · 차단 ${t.blocked}` : ''} · ${t.cost_usd.toFixed(3)}</div>
              </button>
              {canEdit && <button className="inline-flex size-8 items-center justify-center rounded-input text-red-600 hover:bg-red-50" onClick={() => remove(t)} aria-label={`${t.title} 지우기`}><Trash2 className="size-4" /></button>}
            </li>
          ))}
          {!data!.threads.length && <li className="px-3 py-6 text-center text-sm text-ink-3">내역이 없습니다</li>}
        </ul>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.thread.user_name} · ${open.thread.title}` : ''}>
        {open && (
          <div className="max-h-[70vh] space-y-2 overflow-y-auto" data-testid="ai-log-detail">
            {open.thread.task_id && <Link href={`/tasks/${open.thread.task_id}`} className="text-xs text-accent-600 underline">연결된 업무 보기</Link>}
            {open.messages.map((m: any) => (
              <div key={m.id} className={cx('rounded-input px-3 py-2 text-sm', m.role === 'user' ? 'bg-brand-50' : m.status === 'blocked' ? 'bg-amber-50' : 'bg-slate-50')}>
                <div className="mb-0.5 text-[11px] text-ink-3">{m.role === 'user' ? '질문' : 'AI'} · {fmtDateTime(m.created_at)}{m.status === 'blocked' && ' · 차단됨'}{m.cost_usd > 0 && ` · $${m.cost_usd.toFixed(4)}`}{m.file_names?.length ? ` · 📎 ${m.file_names.join(', ')}` : ''}</div>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.proposals?.map((p: any) => <div key={p.id} className="mt-1 text-xs text-ink-2">✨ 제안: {p.summary} — {p.status === 'done' ? '실행됨' : p.status === 'cancelled' ? '취소됨' : '대기'}</div>)}
              </div>
            ))}
          </div>
        )}
      </Modal>
      <Modal open={!!set} onClose={() => setSet(null)} title="AI 보관·한도 설정">
        {set && (
          <form onSubmit={saveSettings} className="space-y-3">
            <Field label="대화 보관 기간">
              <select className={inputCls} value={set.retention_days} onChange={(e) => setSet({ ...set, retention_days: Number(e.target.value) })} aria-label="보관 기간">
                {[[30, '30일'], [90, '90일 (기본)'], [365, '1년'], [0, '무기한']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </Field>
            <Field label="1인 하루 요청 수"><input type="number" min={1} max={1000} className={inputCls} value={set.daily_limit} onChange={(e) => setSet({ ...set, daily_limit: e.target.value })} aria-label="1인 하루 요청 수" /></Field>
            <Field label="1회 입력 글자 수"><input type="number" min={200} max={20000} className={inputCls} value={set.input_max} onChange={(e) => setSet({ ...set, input_max: e.target.value })} aria-label="1회 입력 글자 수" /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!set.topic_filter} onChange={(e) => setSet({ ...set, topic_filter: e.target.checked })} />업무와 무관한 질문 차단 (가벼운 AI 로 먼저 판정)</label>
            {/* V22 */}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!set.web_tools} onChange={(e) => setSet({ ...set, web_tools: e.target.checked })} data-testid="ai-web-tools" />웹 검색·페이지 읽기 (출처 링크 표시)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!set.doc_engine} onChange={(e) => setSet({ ...set, doc_engine: e.target.checked })} data-testid="ai-doc-engine" />문서 작업 (엑셀·워드·PPT·PDF 만들기·디자인·데이터 분석 — 코드 실행, 사용량 더 듦)</label>
            {/* ⑥ 밤사이 비서(대표 승인 10/20 오후): 22시~06시에 승인된 범위만 — 기본 모두 끔. 돈·외부 발송은 절대 자동 아님 */}
            <fieldset className="rounded-input border border-line p-2" data-testid="ai-night-scope"><legend className="px-1 text-xs text-ink-2">🌙 밤사이 비서 (22시~06시, 기본 끔 — 결과는 아침 마케팅 홈·브리핑에)</legend>
              {([['draft', '원고 초안 — 3일 안 게시할 자동 제작 시안을 밤에 미리'], ['lead_next', '리드 다음 연락 제안 (준비 중)'], ['bid_summary', '입찰 요약 (준비 중)'], ['report', '보고서 초안 (준비 중)'], ['goal', '마케팅 목표 설정·주간 계획·리뷰 — 밤에도 돌림(기본은 낮 09~22시)']] as [string, string][]).map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!set.night_scope?.[k]} onChange={(e) => setSet({ ...set, night_scope: { ...(set.night_scope ?? {}), [k]: e.target.checked } })} data-testid={`ai-night-${k}`} />{l}</label>))}
            </fieldset>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setSet(null)}>취소</Button><Button type="submit">저장</Button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
