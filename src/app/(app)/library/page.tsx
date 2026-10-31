'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MediaFull, MediaThumb } from '@/components/MediaView';
import { useBackClose } from '@/components/backClose';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ChevronRight, Download, ExternalLink, FilePenLine, FileSpreadsheet, FileText, Folder, FolderInput, FolderPlus, Home, Image as ImageIcon, LayoutGrid, Library, List, Loader2, Lock,
  Check, Pencil, Search, ShieldAlert, Sparkles, Trash2, Undo2, Upload, X } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { DropZone, UploadProgress, fileHash, putFile } from '@/components/upload';
import { ROLE_LABEL } from '@/lib/types';
import { Button, ErrorBox, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Sec = 'public' | 'internal' | 'confidential';
type F = { id: string; folder: string; title: string; file_name: string; mime_type: string; size_bytes: number; tags: string[]; description: string | null;
  created_at: string; updated_at: string; created_by: string; created_by_name: string; has_text: boolean; text_error: string | null; text_tried_at: string | null; snippet: string | null;
  organized_by: 'ai' | 'rule' | null; ai_confidence: number | null; needs_review: boolean; can_undo: boolean; level: string; organize_status: string | null; organize_error: string | null;
  security: Sec; security_suggested: Sec | null; security_confirmed: boolean; effective_security: Sec;
  vision?: { caption?: string; scene?: string; kind?: string; text?: string; promo?: boolean; faces?: boolean; people?: number; error?: string } | null; // #235 ⓒ 마케팅 사진 AI 설명 · #615 ④ faces = 얼굴 나온 실사(촬영 동의 확인)
  /** 292차 #804·#814 회사 전체 · 팀 · 내 파일 */ scope?: Scope; team_id?: string | null; team_name?: string | null; space?: string };
type Scope = 'company' | 'team' | 'mine';
type Fo = { folder: string; n: number; security: Sec; level: string };
type Data = { files: F[]; folders: Fo[]; review: number; level: string; aiOrganize: boolean; confEdit: boolean; spaces?: string[]; spaceCounts?: Record<string, number>; myTeams?: { id: string; name: string }[] };
const RANK: Record<string, number> = { none: 0, view: 1, edit: 2, delete: 3 };
const SEC: Record<Sec, { label: string; cls: string }> = {
  public: { label: '일반', cls: 'bg-green-50 text-green-700' }, internal: { label: '내부', cls: 'bg-slate-100 text-ink-2' }, confidential: { label: '기밀', cls: 'bg-red-50 text-red-700' } };
const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
const isImg = (f: F) => /^image\/(png|jpe?g|gif|webp)$/.test(f.mime_type);
const isVid = (f: F) => /^video\//.test(f.mime_type); // 대표 10/21 02:00: 영상은 미리보기(첫 프레임)·브라우저 재생
// 10/19 워크인 문서(공동 편집): 저장 파일 없이 Yjs 상태로 — 열면 편집 화면, 내려받기는 .docx 내보내기
const isDoc = (f: F) => f.mime_type === 'application/x-workin-doc';
const openHref = (f: F) => (isDoc(f) ? `/library/doc/${f.id}` : `/api/library/${f.id}/download${isImg(f) || isVid(f) ? '?inline=1' : ''}`);
const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');
const nameOf = (p: string) => p.split('/').pop() || '최상위';
const DRAG = 'application/x-workin-files';
const pref = (k: string, d: string) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const setPref = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

function SecBadge({ s, suggested }: { s: Sec; suggested?: boolean }) {
  return <span className={cx('inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 text-[11px] font-semibold', SEC[s].cls)} data-testid="sec-badge" data-sec={s}>
    {s === 'confidential' && <Lock className="size-3" />}{SEC[s].label}{suggested && ' 제안'}</span>;
}

/** V9 회사 자료실 → V14 18번 폴더 탐색기: PC 왼쪽 폴더 나무 + 오른쪽 내용(경로·목록/격자·정렬), 휴대폰은 폴더를 눌러 들어감. 내용 영역 전체가 끌어 놓기 영역 */
export default function LibraryPage() {
  const { user } = useSession();
  const admin = user.role === 'owner' || user.role === 'admin';
  const sp = useSearchParams();
  const [cur, setCur] = useState(sp.get('folder') ?? '');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [review, setReview] = useState(false);
  // 대표 지시(10/18): 공간별 자료실(저장소는 하나) — 사이드바에서 온 공간이 기본, [전체]로 모두
  const [libSpace, setLibSpace] = useState(['work', 'sales', 'marketing', 'all'].includes(sp.get('space') ?? '') ? sp.get('space')! : 'work');
  // 292차 #804·#814(대표 10/29): 업무 공간 자료실 = 전체 · 회사 전체 · 우리 팀 · 내 파일 — 전체 = 볼 수 있는 것 모두(팀·내 파일은 표시)
  const [scope, setScope] = useState<'all' | Scope>(['company', 'team', 'mine'].includes(sp.get('scope') ?? '') ? sp.get('scope') as Scope : 'all');
  const [teamPick, setTeamPick] = useState('');
  const scoped = libSpace === 'work' && scope !== 'all' ? scope : null;
  const url = `/api/library?${new URLSearchParams({ limit: '500', space: libSpace, ...(scoped ? { scope: scoped } : {}), ...(scoped === 'team' && teamPick ? { teamId: teamPick } : {}), ...(query ? { q: query } : {}), ...(review ? { review: '1' } : {}) })}`;
  const { data, error, loading, reload } = useApi<Data>(url);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [sort, setSort] = useState('name');
  useEffect(() => { setView(pref('wos_lib_view', 'list') as 'list' | 'grid'); setSort(pref('wos_lib_sort', 'name')); }, []);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [recent, setRecent] = useState<Set<string>>(new Set()); // 방금 올린 파일은 AI 가 다른 폴더로 정리해도 이 화면에 남겨 "→ ○○로 정리됨 · 바꾸기"를 보여 준다
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<F | null>(null);
  const [dlg, setDlg] = useState<null | { kind: 'new' | 'rename' | 'move' | 'doc'; value: string }>(null);
  const router = useRouter();
  const [permFolder, setPermFolder] = useState<string | null>(null);
  const [preview, setPreview] = useState<any[] | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hi = sp.get('file');
  // #615 ②(대표 10/25 '파일 상세에서 뒤로가기 단추가 없어 헤맴'): 사진·영상은 새 탭 대신 앱 안 보기창 — [← 목록]·뒤로가기로 닫히고, 목록의 폴더·스크롤·강조는 그대로
  const [viewer, setViewer] = useState<F | null>(null);
  useBackClose(!!viewer, () => setViewer(null), ['file', viewer?.id ?? '']);
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => { if (!hi || !data || scrolledTo.current === hi) return; const el = document.querySelector(`[data-file="${hi}"]`); if (el) { scrolledTo.current = hi; el.scrollIntoView({ block: 'center' }); } }, [hi, data]);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setSel(new Set()); }, [cur, query]);
  useEffect(() => { if (review && data && !data.review) setReview(false); }, [review, data]); // 210차: 다 확인하면 '정리 필요' 보기에서 나옴
  const canUpload = RANK[data?.level ?? 'edit'] >= RANK.edit;

  // 폴더 나무: 보이는 폴더 + 그 상위 경로
  const folders = data?.folders ?? [];
  const allPaths = useMemo(() => {
    const s = new Set<string>();
    for (const f of folders) { const parts = f.folder.split('/').filter(Boolean); for (let i = 1; i <= parts.length; i++) s.add(parts.slice(0, i).join('/')); }
    return [...s].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [folders]);
  const children = (p: string) => allPaths.filter((x) => parentOf(x) === p);
  const folderInfo = (p: string) => folders.find((f) => f.folder === p);
  const countUnder = (p: string) => folders.filter((f) => f.folder === p || f.folder.startsWith(p + '/')).reduce((a, f) => a + f.n, 0);
  const secOf = (p: string) => folderInfo(p)?.security ?? 'public';
  const files = useMemo(() => {
    const list = (data?.files ?? []).filter((f) => (query || review ? true : f.folder === cur || recent.has(f.id)));
    const by: Record<string, (a: F, b: F) => number> = {
      name: (a, b) => a.title.localeCompare(b.title, 'ko'), updated: (a, b) => b.updated_at.localeCompare(a.updated_at), size: (a, b) => Number(b.size_bytes) - Number(a.size_bytes) };
    return [...list].sort(by[sort] ?? by.name);
  }, [data, cur, query, review, sort, recent]);
  const sub = query || review ? [] : children(cur);
  const crumbs = cur ? cur.split('/').map((_, i, a) => a.slice(0, i + 1).join('/')) : [];

  // ---- 올리기 (현재 폴더 또는 놓은 폴더) ----
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string; note?: string; onOpen?: () => void }[]>([]);
  // 292차 올릴 곳: 업무 공간이면 기본 = 지금 탭(전체·우리 팀 탭은 주 팀, 팀이 없으면 회사 전체) — 바꿀 수 있음
  const teams = data?.myTeams ?? [];
  const [upPick, setUpPick] = useState<string | null>(null);
  useEffect(() => { setUpPick(null); }, [scope, teamPick, libSpace]);
  // 293차 #837(대표 10/31 '대표자가 올리는 자료가 기밀자료가 많을 수 있음'): 대표·관리자도 직원과 같게 기본 = 주 팀(292차 '관리자는 회사 전체' 해석 바꿈)
  const upDefault = libSpace !== 'work' ? 'company' : scope === 'company' ? 'company' : scope === 'mine' ? 'mine' : teams.length ? `team:${(scope === 'team' && teamPick) || teams[0].id}` : 'company';
  const upTo = upPick ?? upDefault;
  const destOf = (v: string) => (v.startsWith('team:') ? { scope: 'team' as const, teamId: v.slice(5) } : v === 'mine' ? { scope: 'mine' as const } : {});
  const scopeBody = scoped === 'mine' ? { scope: 'mine' } : scoped === 'team' ? { scope: 'team', ...(teamPick ? { teamId: teamPick } : {}) } : {}; // 새 폴더·이름 바꾸기·옮기기는 지금 탭 범위
  async function upload(list0: FileList | File[] | null, folder = cur) {
    if (!list0 || !list0.length) return;
    const list = Array.from(list0);
    setProg(list.map((f) => ({ name: f.name, pct: 0 })));
    const upd = (i: number, patch: Partial<{ pct: number; error: string; note: string; onOpen: () => void }>) => setProg((x) => x.map((y, j) => (j === i ? { ...y, ...patch } : y)));
    let ok = 0;
    const went: Record<string, number> = {}; // V14 32-보정: 여러 개면 "5개 정리: 근로계약 3 · 업무 보고 2"
    for (const [n, file] of list.entries()) {
      setBusy(`${list.length > 1 ? `${n + 1}/${list.length} ` : ''}${file.name} 올리는 중…`);
      try {
        const meta = { fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size, folder, contentHash: await fileHash(file), space: libSpace === 'all' ? 'work' : libSpace, ...(libSpace === 'work' ? destOf(upTo) : {}) };
        const r = await api('/api/library', { body: meta }).catch(async (e: any) => {
          if (e.code !== 'duplicate' || !confirm(`${e.message}\n그래도 한 번 더 올릴까요?`)) throw e;
          return api('/api/library', { body: { ...meta, allowDuplicate: true } });
        });
        // 210차 #619: 영상은 장면 사진 2장(처음 쪽·가운데)으로 무엇을 찍었는지 보고 정리 — 올리는 동안 뽑음, 영상 자체는 AI 에 안 보냄
        const shots = /^video\//.test(file.type) ? import('@/components/videoDigest').then((m) => m.twoFrames(file)).catch(() => [] as string[]) : null;
        await putFile(r.upload, file, (pct) => upd(n, { pct }));
        setBusy(`${file.name} AI 정리 중…`);
        const frames = (await shots) ?? [];
        const c = await api(`/api/library/${r.id}/complete`, { body: frames.length ? { frames } : {} });
        setRecent((s) => new Set(s).add(r.id));
        const dest = c.organized?.folder ?? folder;
        const open = () => { setQ(''); setReview(false); setCur(dest); history.replaceState(null, '', `/library?folder=${encodeURIComponent(dest)}&file=${r.id}`); };
        if (c.organized?.by === 'ai') {
          went[dest || '최상위'] = (went[dest || '최상위'] ?? 0) + 1;
          if (list.length === 1) toast.ok(`${file.name} → ${dest || '최상위'} 으로 정리했어요`, { label: '열기', run: open });
          upd(n, { pct: 100, note: `→ ${dest || '최상위'} 으로 정리했어요`, onOpen: open });
        } else {
          if (c.organized?.error) toast.error(`AI 정리 못 함 — ${c.organized.error} (파일명 규칙으로 정리)`);
          upd(n, { pct: 100, note: c.organized?.error ? undefined : `→ ${dest || '최상위'}` });
        }
        ok++;
      } catch (e: any) { upd(n, { error: e.message }); toast.error(`${file.name}: ${e.message}`); }
    }
    setBusy(''); if (fileRef.current) fileRef.current.value = '';
    const kinds = Object.entries(went).sort((a, b) => b[1] - a[1]);
    if (list.length > 1 && kinds.length) toast.ok(`${ok}개 정리: ${kinds.slice(0, 4).map(([k, n]) => `${nameOf(k)} ${n}`).join(' · ')}`, { label: '열기', run: () => { setQ(''); setReview(false); setCur(kinds[0][0] === '최상위' ? '' : kinds[0][0]); } });
    else if (ok && list.length > 1) toast.ok(`${ok}개 올렸습니다${folder ? ` — ${folder}` : ''}`);
    if (ok === list.length) setTimeout(() => setProg([]), kinds.length ? 8000 : 1500); // 어디로 갔는지 읽을 시간
    reload();
  }
  // ---- 옮기기 (파일을 폴더 위에 끌어 놓기 / 여러 개 선택) ----
  async function move(ids: string[], folder: string) {
    try {
      const r = await api('/api/library/move', { body: { ids, folder, ...scopeBody } });
      toast.ok(`${r.moved}개를 "${folder || '최상위'}"로 옮겼습니다`);
      if (r.skipped.length) toast.error(`${r.skipped.length}개는 못 옮김: ${r.skipped[0].reason}`);
      setSel(new Set()); reload();
    } catch (e: any) { toast.error(e.message); }
  }
  const dropProps = (folder: string) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG) || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation(); (e.currentTarget as HTMLElement).dataset.over = '1'; } },
    onDragLeave: (e: React.DragEvent) => { delete (e.currentTarget as HTMLElement).dataset.over; },
    onDrop: (e: React.DragEvent) => {
      delete (e.currentTarget as HTMLElement).dataset.over;
      const ids = e.dataTransfer.getData(DRAG);
      if (ids) { e.preventDefault(); e.stopPropagation(); move(JSON.parse(ids), folder); return; }
      if (e.dataTransfer.files?.length) { e.preventDefault(); e.stopPropagation(); upload(e.dataTransfer.files, folder); } // 폴더 위에 놓으면 그 폴더에 고정
    },
  });
  const dragFile = (f: F) => (e: React.DragEvent) => {
    const ids = sel.has(f.id) ? [...sel] : [f.id];
    e.dataTransfer.setData(DRAG, JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move';
  };
  // ---- 폴더 만들기·이름 바꾸기·삭제 ----
  async function folderDialog(e: React.FormEvent) {
    e.preventDefault(); if (!dlg) return;
    const v = dlg.value.trim().replace(/^\/+|\/+$/g, '');
    try {
      if (dlg.kind === 'new') { const p = cur ? `${cur}/${v}` : v; await api('/api/library/folders', { body: { path: p, ...scopeBody } }); setCur(p); }
      if (dlg.kind === 'rename') { const to = parentOf(cur) ? `${parentOf(cur)}/${v}` : v; const r = await api('/api/library/folders', { method: 'PATCH', body: { from: cur, to, ...scopeBody } }); setCur(to); toast.ok(`이름을 바꿨습니다 (자료 ${r.moved}개)`); }
      if (dlg.kind === 'move') await move([...sel], v);
      if (dlg.kind === 'doc') { const r = await api('/api/library/docs', { body: { title: dlg.value.trim(), folder: cur, space: libSpace === 'all' ? 'work' : libSpace, ...(libSpace === 'work' ? destOf(upTo) : {}) } }); setDlg(null); router.push(r.link); return; }
      setDlg(null); reload();
    } catch (er: any) { toast.error(er.message); }
  }
  async function deleteFolder() {
    if (!confirm(`"${cur}" 폴더를 지울까요? (빈 폴더만 지울 수 있습니다)`)) return;
    try { await api('/api/library/folders', { method: 'DELETE', body: { path: cur, ...scopeBody } }); setCur(parentOf(cur)); reload(); toast.ok('폴더를 지웠습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function setFolderSec(security: string) {
    try { await api('/api/library/folder-security', { method: 'PUT', body: { folder: cur, security: security || null } }); reload(); toast.ok('폴더 등급을 바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  }
  // ---- 파일 ----
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!edit) return;
    try {
      await api(`/api/library/${edit.id}`, { method: 'PATCH', body: { title: edit.title, folder: edit.folder, description: edit.description || null, security: edit.security,
        tags: String(edit.tags).split(/[,\s]+/).map((t) => t.replace(/^#/, '')).filter(Boolean), ...(edit.scope ? { scope: edit.scope, ...(edit.scope === 'team' && edit.team_id ? { teamId: edit.team_id } : {}) } : {}) } });
      setEdit(null); reload(); toast.ok('저장했습니다');
    } catch (e: any) { toast.error(e.message); }
  }
  async function patchSec(f: F, security: Sec) {
    try { await api(`/api/library/${f.id}`, { method: 'PATCH', body: { security } }); reload(); toast.ok(security === 'confidential' ? '기밀로 정했습니다' : '등급을 확인했습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function remove(ids: string[]) {
    if (!confirm(ids.length > 1 ? `${ids.length}개 자료를 지울까요?` : '이 자료를 지울까요? (이미 업무에 첨부한 파일은 그대로 남습니다)')) return;
    let ok = 0;
    for (const id of ids) { try { await api(`/api/library/${id}`, { method: 'DELETE' }); ok++; } catch (e: any) { toast.error(e.message); } }
    if (ok) toast.ok(`${ok}개 지웠습니다`);
    setSel(new Set()); reload();
  }
  async function organize(f: F, action: 'undo' | 'redo') {
    try {
      const frames = action === 'redo' && isVid(f) ? await (await import('@/components/videoDigest')).twoFrames(`/api/library/${f.id}/download?inline=1`) : []; // 210차: 영상은 장면 사진 2장(못 읽으면 없이)
      await api(`/api/library/${f.id}/organize`, { body: { action, ...(frames.length ? { frames } : {}) } }); reload(); toast.ok(action === 'undo' ? '정리 전으로 되돌렸습니다' : '다시 정리했습니다');
    } catch (e: any) { toast.error(e.message); }
  }
  // 210차 #619: '정리 필요' 묶어서 확인 — 폴더·태그가 맞으면 그대로 확인 표시(틀리면 [옮기기] → 회사 학습 예시로 남음)
  async function approve(ids: string[]) {
    let ok = 0;
    for (const id of ids) { try { await api(`/api/library/${id}`, { method: 'PATCH', body: {} }); ok++; } catch (e: any) { toast.error(e.message); } }
    if (ok) toast.ok(`${ok}개 정리를 확인했습니다`);
    setSel(new Set()); reload();
  }
  // ---- 관리자 전체 정리: 미리보기 → 고른 것만 적용 ----
  const [allBusy, setAllBusy] = useState('');
  async function previewAll() {
    const out: any[] = [];
    try {
      for (let i = 0; i < 5; i++) {
        setAllBusy(`미리보기 만드는 중… ${out.length}개`);
        const r = await api('/api/library/organize-all', { body: { preview: true } });
        out.push(...r.preview);
        if (r.preview.length < 10) break;
      }
      if (!out.length) toast.ok('정리할 파일이 없습니다'); else setPreview(out.map((p) => ({ ...p, on: true })));
    } catch (e: any) { toast.error(e.message); } finally { setAllBusy(''); }
  }
  async function applyPreview() {
    try { const r = await api('/api/library/organize-all', { body: { apply: preview!.filter((p) => p.on).map((p) => p.id) } }); toast.ok(`${r.applied}개 적용했습니다`); setPreview(null); reload(); }
    catch (e: any) { toast.error(e.message); }
  }
  const curInfo = folderInfo(cur);
  const canEditFolder = cur && RANK[curInfo?.level ?? data?.level ?? 'none'] >= RANK.edit;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const Tree = ({ p, depth }: { p: string; depth: number }) => (
    <>
      {children(p).map((c) => (
        <li key={c}>
          <button role="treeitem" aria-selected={cur === c} onClick={() => setCur(c)} {...dropProps(c)} data-folder={c}
            className={cx('flex w-full items-center gap-1.5 rounded-input py-1.5 pr-2 text-left text-sm data-[over]:bg-accent-100 data-[over]:ring-2 data-[over]:ring-accent-500',
              cur === c ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-2 hover:bg-slate-100')} style={{ paddingLeft: 8 + depth * 14 }}>
            <Folder className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{nameOf(c)}</span>
            {secOf(c) === 'confidential' && <Lock className="size-3 shrink-0 text-red-600" aria-label="기밀 폴더" />}
            <span className="text-[11px] text-ink-3">{countUnder(c)}</span>
          </button>
          {(cur === c || cur.startsWith(c + '/')) && children(c).length > 0 && <ul><Tree p={c} depth={depth + 1} /></ul>}
        </li>
      ))}
    </>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-3">
      <PageHeader title="자료실" icon={Library} sub="폴더로 정리하고, 업무에 바로 첨부하고, AI 비서가 찾아 씁니다. 🔒 기밀 자료는 권한 있는 사람만 봅니다."
        actions={<>
          {data?.confEdit && <Button variant="ghost" onClick={() => setLogOpen(true)} data-testid="conf-log-open"><ShieldAlert />기밀 열람 기록</Button>}
          {canUpload && admin && <Button variant="secondary" onClick={previewAll} disabled={!!allBusy} data-testid="library-organize-all">{allBusy ? <><Loader2 className="animate-spin" />{allBusy}</> : <><Sparkles />전체 정리</>}</Button>}
          {canUpload && <Button variant="secondary" onClick={() => setDlg({ kind: 'doc', value: '' })} data-testid="library-new-doc"><FilePenLine />새 문서</Button>}
          {canUpload && libSpace === 'work' && (
            <select className={cx(inputCls, 'h-9 !w-auto text-sm')} value={upTo} onChange={(e) => setUpPick(e.target.value)} aria-label="올릴 곳" title="새로 올리는 파일·새 문서가 들어갈 곳" data-testid="library-upload-to">
              {teams.map((t) => <option key={t.id} value={`team:${t.id}`}>올릴 곳: {t.name}(우리 팀)</option>)}
              <option value="company">올릴 곳: 회사 전체</option><option value="mine">올릴 곳: 내 파일(나만)</option>
            </select>)}
          {canUpload && <Button onClick={() => fileRef.current?.click()} disabled={!!busy} data-testid="library-upload">{busy ? <Loader2 className="animate-spin" /> : <Upload />}올리기</Button>}
        </>} />
      {(data?.spaces?.length ?? 0) > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="공간별 자료실" data-testid="library-spaces">
          {[...(data!.spaces as string[]), 'all'].map((k) => (
            <button key={k} role="tab" aria-selected={libSpace === k} onClick={() => { setLibSpace(k); setCur(''); }} data-testid={`library-space-${k}`}
              className={cx('rounded-full border px-3 py-1 text-xs font-medium', libSpace === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-line bg-white text-ink-2 hover:bg-slate-50')}>
              {{ work: '업무', sales: '영업', marketing: '마케팅', all: '전체' }[k as 'work']}{k !== 'all' && data!.spaceCounts?.[k] ? ` ${data!.spaceCounts[k]}` : ''}
            </button>))}
        </div>
      )}
      {libSpace === 'work' && (
        <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="보관 범위" data-testid="library-scopes">
          {([['all', '전체'], ['company', '회사 전체'], ['team', '우리 팀'], ['mine', '내 파일']] as const).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={scope === k} onClick={() => { setScope(k); setCur(''); setSel(new Set()); }} data-testid={`library-scope-${k}`}
              className={cx('rounded-full border px-3 py-1 text-xs font-medium', scope === k ? 'border-ink bg-ink text-white' : 'border-line bg-white text-ink-2 hover:bg-slate-50')}>{label}</button>))}
          {scope === 'team' && teams.length > 1 && (
            <select className={cx(inputCls, 'h-8 !w-auto py-0 text-xs')} value={teamPick} onChange={(e) => { setTeamPick(e.target.value); setCur(''); }} aria-label="팀 고르기" data-testid="library-team-pick">
              <option value="">내가 볼 수 있는 팀 모두</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>)}
          <span className="text-xs text-ink-3">{scope === 'team' ? '우리 팀 자료 — 팀 구성원과 위 부서·사업부·본사 구성원, 대표·관리자가 봅니다' : scope === 'mine' ? '내 파일 — 나만 봅니다(대표·관리자도 못 봄)' : scope === 'company' ? '회사 전체 자료 — 폴더 권한·보안 등급대로' : ''}</span>
        </div>
      )}
      <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} data-testid="library-file" />
      <div className="flex gap-4">
        {/* PC 폴더 나무 */}
        <aside className="hidden w-60 shrink-0 md:block" aria-label="폴더">
          <ul role="tree" className="space-y-0.5 rounded-card border border-line bg-white p-1.5 shadow-card" data-testid="library-tree">
            <li><button role="treeitem" aria-selected={cur === ''} onClick={() => setCur('')} {...dropProps('')}
              className={cx('flex w-full items-center gap-1.5 rounded-input px-2 py-1.5 text-sm data-[over]:bg-accent-100', cur === '' ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-2 hover:bg-slate-100')}>
              <Home className="size-4" />자료실</button></li>
            <Tree p="" depth={0} />
          </ul>
        </aside>
        <section className="min-w-0 flex-1 space-y-2">
          {/* 경로 · 검색 · 보기 */}
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="경로" className="flex min-w-0 flex-1 items-center gap-0.5 text-sm" data-testid="library-path">
              <button onClick={() => setCur('')} className="hit rounded px-1 font-medium text-ink-2 hover:bg-slate-100" {...dropProps('')}>자료실</button>
              {crumbs.map((c) => <span key={c} className="flex min-w-0 items-center gap-0.5"><ChevronRight className="size-3.5 shrink-0 text-ink-3" />
                <button onClick={() => setCur(c)} className={cx('hit truncate rounded px-1 hover:bg-slate-100', c === cur ? 'font-semibold text-ink' : 'text-ink-2')} {...dropProps(c)}>{nameOf(c)}</button></span>)}
              {cur && <SecBadge s={secOf(cur)} />}
            </nav>
            <label className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
              <input className={cx(inputCls, 'h-9 pl-9')} placeholder="자료 검색" title="제목·태그·본문에서 찾습니다" value={q} onChange={(e) => setQ(e.target.value)} aria-label="자료 검색" />
            </label>
            <select className={cx(inputCls, 'h-9 !w-auto')} value={sort} onChange={(e) => { setSort(e.target.value); setPref('wos_lib_sort', e.target.value); }} aria-label="정렬">
              <option value="name">이름순</option><option value="updated">최근 바뀐 순</option><option value="size">큰 파일 순</option>
            </select>
            <div className="flex rounded-input border border-line" role="group" aria-label="보기">
              {([['list', List, '목록'], ['grid', LayoutGrid, '격자']] as const).map(([k, I, l]) => (
                <button key={k} onClick={() => { setView(k); setPref('wos_lib_view', k); }} aria-pressed={view === k} aria-label={`${l} 보기`}
                  className={cx('inline-flex size-9 items-center justify-center', view === k ? 'bg-slate-100 text-ink' : 'text-ink-3')}><I className="size-4" /></button>
              ))}
            </div>
          </div>
          {/* 현재 폴더 도구 */}
          <div className="flex flex-wrap items-center gap-1.5">
            {canUpload && <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'new', value: '' })} data-testid="folder-new"><FolderPlus />새 폴더</Button>}
            {canEditFolder && RANK[curInfo?.level ?? 'none'] >= RANK.delete && <Button size="sm" variant="ghost" onClick={() => setDlg({ kind: 'rename', value: nameOf(cur) })} data-testid="folder-rename"><Pencil />이름 바꾸기</Button>}
            {canEditFolder && RANK[curInfo?.level ?? 'none'] >= RANK.delete && <Button size="sm" variant="ghost" onClick={deleteFolder}><Trash2 />폴더 지우기</Button>}
            {cur && user.role === 'owner' && <Button size="sm" variant="ghost" onClick={() => setPermFolder(cur)} data-testid="folder-perms-open"><Lock />폴더 권한</Button>}
            {cur && (admin || data?.confEdit) && (
              <select className={cx(inputCls, 'h-8 !w-auto text-xs')} value={folders.find((f) => f.folder === cur) ? (secOf(cur) === 'public' ? '' : secOf(cur)) : ''} onChange={(e) => setFolderSec(e.target.value)} aria-label="폴더 보안 등급">
                <option value="">등급: 상속·일반</option><option value="internal">등급: 내부</option><option value="confidential">등급: 🔒 기밀</option>
              </select>
            )}
            {!!data?.review && <button onClick={() => setReview(!review)} aria-pressed={review} data-testid="library-review"
              className={cx('hit ml-auto rounded-full border px-3 py-1 text-xs', review ? 'border-amber-500 bg-amber-50 font-semibold text-amber-800' : 'border-amber-200 text-amber-800')}>정리 필요 {data.review}</button>}
          </div>
          {review && files.length > 0 && ( // 210차 #619: AI 확신 70% 미만(library.ts REVIEW_BELOW)만 여기 — 묶어서 확인
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="library-review-bar">
              <span>AI 확신이 70% 아래라 사람 확인이 필요한 자료입니다. 폴더가 맞으면 <b>[정리 맞음]</b>, 아니면 <b>[옮기기]</b> — 옮긴 것은 다음 정리에 배웁니다.</span>
              <button className="hit ml-auto font-semibold underline" onClick={() => setSel(new Set(files.map((f) => f.id)))} data-testid="library-review-all">보이는 {files.length}개 모두 선택</button>
            </div>
          )}
          {sel.size > 0 && (
            <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-card border border-brand-200 bg-brand-50 px-3 py-2 text-sm shadow-card" data-testid="library-bulk">
              <b>{sel.size}개 선택</b>
              {review && <Button size="sm" onClick={() => approve([...sel])} data-testid="library-bulk-approve"><Check />정리 맞음</Button>}
              <Button size="sm" variant="secondary" onClick={() => setDlg({ kind: 'move', value: cur })}><FolderInput />옮기기</Button>
              <Button size="sm" variant="secondary" onClick={() => remove([...sel])}><Trash2 />지우기</Button>
              <button className="ml-auto inline-flex size-8 items-center justify-center rounded-input hover:bg-white" onClick={() => setSel(new Set())} aria-label="선택 해제"><X className="size-4" /></button>
            </div>
          )}
          <UploadProgress items={prog} />
          {busy && <p className="text-sm text-ink-2">{busy}</p>}
          {/* 내용 영역 전체가 끌어 놓기 영역 — 안내 줄 상시 */}
          <DropZone onFiles={(f) => upload(f)} disabled={!!busy || !canUpload} label={`놓으면 "${cur || '자료실'}"에 올라갑니다`} testid="library-drop" className="min-h-[50vh] rounded-card">
            {canUpload && (
              <button type="button" onClick={() => fileRef.current?.click()} className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-card border border-dashed border-slate-300 bg-slate-50/60 px-3 py-2 text-xs text-ink-2 hover:border-accent-500" data-testid="library-drop-hint">
                <Upload className="size-3.5" /><span className="hidden sm:inline">파일을 이 영역 어디든 끌어다 놓으면 <b className="text-ink">&ldquo;{cur || '자료실'}&rdquo;</b>에 올라갑니다 · 폴더 위에 놓으면 그 폴더로</span>
                <span className="sm:hidden">눌러서 <b className="text-ink">&ldquo;{nameOf(cur)}&rdquo;</b>에 올리기</span>
              </button>
            )}
            {error ? <ErrorBox error={error} retry={reload} /> : loading && !data ? <Skeleton rows={5} /> : (
              <>
                {sub.length > 0 && (
                  <ul className={cx('mb-2 grid gap-2', view === 'grid' ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2')} data-testid="library-subfolders">
                    {sub.map((c) => (
                      <li key={c}><button onClick={() => setCur(c)} {...dropProps(c)} data-folder={c}
                        className="flex w-full items-center gap-2 rounded-card border border-line bg-white px-3 py-2.5 text-left text-sm shadow-card hover:border-slate-400 data-[over]:border-accent-500 data-[over]:bg-accent-50">
                        <Folder className="size-5 text-amber-500" /><span className="min-w-0 flex-1 truncate font-medium">{nameOf(c)}</span>
                        {secOf(c) === 'confidential' && <Lock className="size-3.5 text-red-600" />}<span className="text-xs text-ink-3">{countUnder(c)}</span>
                      </button></li>
                    ))}
                  </ul>
                )}
                {!files.length && !sub.length ? (
                  <div className="flex flex-col items-center justify-center gap-1 py-14 text-center text-sm text-ink-3" data-testid="library-empty">
                    <Library className="size-8" />{query ? '찾는 자료가 없습니다' : '이 폴더는 비어 있습니다'}
                  </div>
                ) : view === 'list' ? (
                  <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="library-list">
                    {files.map((f) => <FileRow key={f.id} f={f} hi={hi === f.id} sel={sel.has(f.id)} onSel={() => toggle(f.id)} onDrag={dragFile(f)} user={user.id} admin={admin} confEdit={!!data?.confEdit} onView={isImg(f) || isVid(f) ? () => setViewer(f) : undefined}
                      showFolder={!!(query || review) || f.folder !== cur} onEdit={() => setEdit({ ...f, tags: f.tags.join(', ') as never })} onRemove={() => remove([f.id])} onOrganize={(a) => organize(f, a)} onSec={(s) => patchSec(f, s)} onOpenFolder={() => { setQ(''); setCur(f.folder); }} onRetext={async () => { try { const r = await api<{ hasText: boolean; chars: number; error: string | null }>(`/api/library/${f.id}/retext`, { method: 'POST', body: {} }); toast[r.hasText ? 'ok' : 'error'](r.hasText ? `본문 ${r.chars.toLocaleString('ko-KR')}자 추출` : `추출 못 함 — ${r.error ?? '이유 모름'}`); reload(); } catch (e: any) { toast.error(e.message); } }} />)}
                  </ul>
                ) : (
                  <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" data-testid="library-list">
                    {files.map((f) => (
                      <li key={f.id} draggable onDragStart={dragFile(f)} className={cx('group relative overflow-hidden rounded-card border bg-white shadow-card', sel.has(f.id) ? 'border-brand-600 ring-1 ring-brand-600' : 'border-line', hi === f.id && 'ring-2 ring-amber-400')}>
                        <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)} className="absolute left-2 top-2 z-10" aria-label={`${f.title} 선택`} />
                        <a href={openHref(f)} target={isDoc(f) ? undefined : '_blank'} rel="noreferrer" className="flex aspect-[4/3] items-center justify-center bg-slate-50" onClick={(e) => { if (isImg(f) || isVid(f)) { e.preventDefault(); setViewer(f); } }} data-testid="library-grid-open">
                          {isImg(f) ? <img src={`/api/library/${f.id}/download?inline=1`} alt="" className="size-full object-contain" loading="lazy" /> : isVid(f) ? <MediaThumb src={`/api/library/${f.id}/download?inline=1`} mime={f.mime_type} className="size-full" /> : <FileIcon f={f} big />}
                        </a>
                        <div className="p-2"><div className="flex items-center gap-1 text-sm font-medium"><span className="min-w-0 flex-1 truncate">{f.title}</span>{f.effective_security !== 'internal' && <SecBadge s={f.effective_security} />}</div>
                          <div className="truncate text-[11px] text-ink-3">{fmtSize(Number(f.size_bytes))} · {f.created_by_name}</div></div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </DropZone>
          {data && !data.aiOrganize && <p className="text-xs text-ink-3">올린 파일은 회사가 고친 정리 규칙(파일명)으로 자동 정리됩니다. 내장 AI 가 켜지면 내용까지 보고 정리합니다.</p>}
        </section>
      </div>

      <Modal open={!!dlg} onClose={() => setDlg(null)} title={dlg?.kind === 'new' ? `새 폴더 — ${cur || '자료실'} 안에` : dlg?.kind === 'doc' ? `새 문서 — ${cur || '자료실'} 안에` : dlg?.kind === 'rename' ? '폴더 이름 바꾸기' : `${sel.size}개 옮기기`}>
        {dlg && (
          <form onSubmit={folderDialog} className="space-y-3">
            {dlg.kind === 'move' ? (
              <Field label="옮길 폴더"><select className={inputCls} value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} aria-label="옮길 폴더">
                <option value="">자료실(최상위)</option>{allPaths.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
            ) : dlg.kind === 'doc' ? (
              <Field label="문서 제목" hint="여러 명이 동시에 고칠 수 있는 워크인 문서(워드 대체). 자료실 검색·AI 비서·Word 내보내기가 됩니다">
                <input className={inputCls} value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} autoFocus required maxLength={200} aria-label="문서 제목" /></Field>
            ) : (
              <Field label="폴더 이름" hint={dlg.kind === 'rename' ? '하위 폴더·자료·권한·등급이 함께 옮겨집니다' : '/ 로 하위 폴더까지 한 번에 (예: 브랜드/로고)'}>
                <input className={inputCls} value={dlg.value} onChange={(e) => setDlg({ ...dlg, value: e.target.value })} autoFocus required aria-label="폴더 이름" /></Field>
            )}
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setDlg(null)}>취소</Button><Button type="submit" data-testid="folder-save">확인</Button></div>
          </form>
        )}
      </Modal>
      {permFolder && <FolderPerms folder={permFolder} onClose={() => setPermFolder(null)} />}
      <Modal open={!!viewer} onClose={() => setViewer(null)} title={viewer?.title ?? '자료'} wide>
        {viewer && (
          <div className="space-y-2" data-testid="library-viewer">
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setViewer(null)} data-testid="library-viewer-back"><ArrowLeft />목록</Button>
              <a href={`/api/library/${viewer.id}/download`} className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-sm text-ink-2 hover:bg-slate-50"><Download className="size-4" />내려받기</a>
              <a href={openHref(viewer)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1 rounded-input border border-line bg-white px-2.5 text-sm text-ink-2 hover:bg-slate-50"><ExternalLink className="size-4" />새 탭</a>
              <span className="ml-auto text-xs text-ink-3">{viewer.folder || '최상위'} · {fmtSize(Number(viewer.size_bytes))} · {viewer.created_by_name}</span>
            </div>
            {viewer.vision?.faces && <p className="rounded-input border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900" data-testid="library-viewer-faces">얼굴이 나온 실사 사진입니다 — 홍보 글·시안에 쓰려면 촬영·게시 동의를 받았는지 먼저 확인하세요.</p>}
            <MediaFull src={`/api/library/${viewer.id}/download?inline=1`} mime={viewer.mime_type} className="max-h-[70vh] w-full rounded-input bg-slate-50 object-contain" alt={viewer.title} />
            {viewer.vision?.caption && <p className="text-xs text-ink-2">AI 사진 설명: {viewer.vision.caption}</p>}
          </div>
        )}
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="자료 고치기">
        {edit && (
          <form onSubmit={save} className="space-y-3">
            <Field label="제목"><input className={inputCls} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required /></Field>
            <Field label="폴더" hint="/ 로 하위 폴더 (예: 브랜드/로고)"><input className={inputCls} value={edit.folder} onChange={(e) => setEdit({ ...edit, folder: e.target.value })} aria-label="폴더" /></Field>
            <Field label="태그" hint="쉼표로 구분"><input className={inputCls} value={edit.tags as never} onChange={(e) => setEdit({ ...edit, tags: e.target.value as never })} /></Field>
            <Field label="보안 등급" hint="폴더 등급보다 낮출 수는 없습니다. 기밀을 내리려면 기밀 편집 권한이 필요합니다">
              <select className={inputCls} value={edit.security} onChange={(e) => setEdit({ ...edit, security: e.target.value as Sec })} aria-label="보안 등급">
                <option value="public">일반 — 전 직원</option><option value="internal">내부 — 내부 자료 열람 권한</option><option value="confidential">🔒 기밀 — 기밀 열람 권한자만</option></select></Field>
            {(edit.space ?? 'work') === 'work' && !(edit as F & { task_id?: string | null }).task_id && (edit.created_by === user.id || admin) && (
              <Field label="보관 범위" hint="우리 팀 = 팀과 위 부서·대표·관리자 · 내 파일 = 나만(올린 사람만 고를 수 있음)">
                <select className={inputCls} value={edit.scope === 'team' ? `team:${edit.team_id ?? ''}` : edit.scope ?? 'company'} aria-label="보관 범위" data-testid="library-edit-scope"
                  onChange={(e) => { const v = e.target.value; setEdit({ ...edit, scope: v.startsWith('team:') ? 'team' : (v as Scope), team_id: v.startsWith('team:') ? v.slice(5) : null }); }}>
                  <option value="company">회사 전체</option>
                  {edit.scope === 'team' && edit.team_id && !teams.some((t) => t.id === edit.team_id) && <option value={`team:${edit.team_id}`}>{edit.team_name ?? '팀'}(우리 팀)</option>}
                  {teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}(우리 팀)</option>)}
                  {edit.created_by === user.id && <option value="mine">내 파일(나만)</option>}
                </select></Field>)}
            <Field label="설명"><textarea className={inputCls} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setEdit(null)}>취소</Button><Button type="submit">저장</Button></div>
          </form>
        )}
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title="전체 정리 미리보기" wide>
        {preview && (
          <div className="space-y-3" data-testid="organize-preview">
            <p className="text-sm text-ink-2">AI 가 제안한 정리입니다. 적용할 것만 남기고 [적용]을 누르세요. 적용 전에는 아무것도 바뀌지 않습니다.</p>
            <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-input border border-line text-sm">
              {preview.map((p, i) => (
                <li key={p.id} className="flex items-start gap-2 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={p.on} onChange={(e) => setPreview(preview.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} aria-label={`${p.from?.title} 적용`} />
                  <div className="min-w-0 flex-1"><div className="truncate font-medium">{p.from?.title} → {p.title}</div>
                    <div className="text-xs text-ink-3">{p.from?.folder || '최상위'} → <b className="text-ink">{p.folder || '최상위'}</b> · {p.tags.slice(0, 4).map((t: string) => '#' + t).join(' ')}
                      {p.suggestedSecurity === 'confidential' && <span className="ml-1 text-red-700">🔒 기밀 제안</span>}{p.error && <span className="ml-1 text-amber-700">({p.error})</span>}</div></div>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setPreview(null)}>닫기</Button><Button onClick={applyPreview} data-testid="organize-apply">적용 ({preview.filter((p) => p.on).length})</Button></div>
          </div>
        )}
      </Modal>
      {logOpen && <ConfLog onClose={() => setLogOpen(false)} />}
    </div>
  );
}

function FileIcon({ f, big }: { f: F; big?: boolean }) {
  const c = big ? 'size-8' : 'size-5';
  return isDoc(f) ? <FilePenLine className={cx(c, 'text-brand-600')} /> : /sheet|excel|csv/.test(f.mime_type + f.file_name) ? <FileSpreadsheet className={cx(c, 'text-green-600')} /> : /^image\//.test(f.mime_type) ? <ImageIcon className={cx(c, 'text-ink-3')} /> : <FileText className={cx(c, 'text-ink-3')} />;
}

function FileRow({ f, hi, sel, onSel, onDrag, user, admin, confEdit, showFolder, onEdit, onRemove, onOrganize, onSec, onOpenFolder, onRetext, onView }: {
  f: F; hi: boolean; sel: boolean; onSel: () => void; onDrag: (e: React.DragEvent) => void; user: string; admin: boolean; confEdit: boolean; showFolder: boolean;
  onEdit: () => void; onRemove: () => void; onOrganize: (a: 'undo' | 'redo') => void; onSec: (s: Sec) => void; onOpenFolder: () => void; onRetext?: () => void; onView?: () => void }) {
  const view = onView ? (e: React.MouseEvent) => { e.preventDefault(); onView(); } : undefined; // #615 ②: 사진·영상은 앱 안 보기창(새 탭 X)
  const mine = f.created_by === user;
  const suggestConf = f.security_suggested === 'confidential' && f.effective_security !== 'confidential' && !f.security_confirmed;
  return (
    <li draggable onDragStart={onDrag} className={cx('flex items-center gap-3 px-3 py-2.5', hi && 'bg-amber-50', sel && 'bg-brand-50/60')} data-file={f.id}>
      <input type="checkbox" checked={sel} onChange={onSel} aria-label={`${f.title} 선택`} />
      <a href={openHref(f)} target={isDoc(f) || onView ? undefined : '_blank'} rel="noreferrer" onClick={view} className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-input border border-line bg-slate-50" data-testid="library-row-open">
        {isImg(f) ? <img src={`/api/library/${f.id}/download?inline=1`} alt="" className="size-full object-contain" loading="lazy" /> : isVid(f) ? <MediaThumb src={`/api/library/${f.id}/download?inline=1`} mime={f.mime_type} className="size-full" /> : <FileIcon f={f} />}
      </a>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">{isDoc(f) ? <a href={openHref(f)} className="min-w-0 truncate hover:underline" data-testid="doc-open">{f.title}</a> : onView ? <a href={openHref(f)} onClick={view} className="min-w-0 truncate hover:underline" data-testid="media-open">{f.title}</a> : <span className="min-w-0 truncate">{f.title}</span>}
          {f.vision?.faces && <span className="inline-flex shrink-0 items-center rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800" title="얼굴이 나온 실사 — 홍보에 쓰려면 촬영·게시 동의를 받았는지 확인" data-testid="photo-faces">얼굴 · 동의 확인</span>}
          {f.effective_security !== 'internal' && <SecBadge s={f.effective_security} />}
          {f.scope === 'team' && <span className="inline-flex shrink-0 items-center rounded bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-800" data-testid="scope-team">{f.team_name ?? '팀'}</span>}
          {f.scope === 'mine' && <span className="inline-flex shrink-0 items-center rounded bg-slate-800 px-1.5 text-[11px] font-semibold text-white" data-testid="scope-mine">내 파일</span>}
          {f.organized_by && <span className={cx('inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 text-[11px] font-semibold', f.needs_review ? 'bg-amber-100 text-amber-800' : 'bg-violet-100 text-violet-700')}
            title={f.ai_confidence !== null ? `확신 ${Math.round(f.ai_confidence * 100)}%` : undefined} data-testid="ai-organized"><Sparkles className="size-3" />{f.organized_by === 'ai' ? 'AI 정리됨' : '규칙 정리'}{f.needs_review && ' · 확인 필요'}</span>}
        </div>
        <div className="truncate text-xs text-ink-3">
          {showFolder && <button onClick={onOpenFolder} className="mr-1.5 hover:underline"><Folder className="mr-0.5 inline size-3" />{f.folder || '최상위'}</button>}
          {f.tags.map((t) => <span key={t} className="mr-1 text-brand-600">#{t}</span>)}
          {fmtSize(Number(f.size_bytes))} · {f.created_by_name} · {fmtDateTime(f.created_at)}
        </div>
        {f.snippet && <div className="mt-0.5 line-clamp-1 text-xs text-ink-2">…{f.snippet}…</div>}
        {f.vision?.caption && <div className="mt-0.5 truncate text-xs text-ink-2" title={f.vision.scene} data-testid="photo-vision">AI 사진 설명: {f.vision.caption}{f.vision.promo || (f.vision.kind && f.vision.kind !== 'photo') ? ' · 글자 든 그래픽(시안·블로그에 안 씀)' : f.vision.text === 'much' ? ' · 글자 많은 실사(블로그 본문에만 씀)' : f.vision.text === 'none' ? ' · 글자 없는 실사' : ''}</div>}
        {f.organize_status === 'pending' && <div className="mt-0.5 flex items-center gap-1 text-xs text-violet-700" data-testid="organize-pending"><Loader2 className="size-3 animate-spin" />AI 정리 중…</div>}
        {f.organize_status === 'done' && f.organized_by === 'ai' && (
          <div className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-violet-700" data-testid="organize-done">
            <span className="truncate">AI 정리됨 → {f.folder || '최상위'}{f.tags.length > 0 && ` · ${f.tags.slice(0, 4).map((t) => '#' + t).join(' ')}`}</span>
            {(mine || admin) && <button className="shrink-0 font-semibold underline" onClick={onEdit}>바꾸기</button>}
          </div>
        )}
        {f.organize_status === 'failed' && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-amber-800" data-testid="organize-failed">
            <span className="min-w-0 truncate">AI 정리 못 함 — {f.organize_error ?? '이유 모름'}</span>
            {(mine || admin) && <button className="shrink-0 font-semibold underline" onClick={() => onOrganize('redo')} data-testid="organize-retry">다시 정리</button>}
          </div>
        )}
        {!f.has_text && f.text_error && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-amber-800" data-testid="text-failed" title={f.text_error}>
            <span className="min-w-0 truncate">본문 추출 못 함 — {f.text_error}</span>
            {(mine || admin) && onRetext && <button className="shrink-0 font-semibold underline" onClick={onRetext} data-testid="text-retry">다시 추출</button>}
          </div>
        )}
        {suggestConf && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-red-700" data-testid="sec-suggest"><Lock className="size-3" />AI·규칙이 기밀을 제안했습니다
            {confEdit ? <><button className="font-semibold underline" onClick={() => onSec('confidential')} data-testid="sec-confirm">기밀로 정하기</button><button className="text-ink-3 underline" onClick={() => onSec(f.security)}>지금 등급 유지</button></>
              : <span className="text-ink-3">(기밀 관리자 확인 대기 — 그때까지 내부)</span>}
          </div>
        )}
      </div>
      <a href={`/api/library/${f.id}/download`} className="inline-flex size-9 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 내려받기`}><Download className="size-4" /></a>
      {f.can_undo && (mine || admin) && <button onClick={() => onOrganize('undo')} className="hidden size-9 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100 sm:inline-flex" aria-label={`${f.title} 정리 되돌리기`} title="AI 정리 되돌리기"><Undo2 className="size-4" /></button>}
      {(mine || admin) && RANK[f.level] >= RANK.edit && <>
        <button onClick={onEdit} className="inline-flex size-9 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label={`${f.title} 고치기`}><Pencil className="size-4" /></button>
        {(RANK[f.level] >= RANK.delete || mine) && <button onClick={onRemove} className="hidden size-9 items-center justify-center rounded-input text-red-600 hover:bg-red-50 sm:inline-flex" aria-label={`${f.title} 지우기`}><Trash2 className="size-4" /></button>}
      </>}
    </li>
  );
}

/** 기밀 자료 열람·내려받기·AI 참조 기록 */
function ConfLog({ onClose }: { onClose: () => void }) {
  const { data } = useApi<{ logs: { id: number; action: string; detail: any; created_at: string; user_name: string }[] }>('/api/library/confidential-log');
  const L: Record<string, string> = { 'library.confidential_open': '열람', 'library.confidential_download': '내려받기', 'library.confidential_ai': 'AI 참조' };
  return (
    <Modal open onClose={onClose} title="🔒 기밀 자료 열람 기록" wide>
      <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto text-sm" data-testid="conf-log">
        {data?.logs.map((l) => <li key={l.id} className="flex gap-2 py-1.5"><span className="w-20 shrink-0 font-medium">{L[l.action] ?? l.action}</span><span className="min-w-0 flex-1 truncate">{l.detail?.title}</span>
          <span className="shrink-0 text-xs text-ink-3">{l.user_name} · {fmtDateTime(l.created_at)}</span></li>)}
        {data && !data.logs.length && <li className="py-3 text-ink-3">기록이 없습니다</li>}
      </ul>
    </Modal>
  );
}

/** V13 4번 폴더 권한 (대표만): 등급마다 이 폴더(와 하위 폴더)를 좁힌다. "상속" = 상위 폴더·메뉴 권한을 따름 */
function FolderPerms({ folder, onClose }: { folder: string; onClose: () => void }) {
  const { data, reload } = useApi<{ perms: { folder: string; role: string; level: string }[] }>('/api/library/folder-perms');
  const roles = ['admin', 'dept_lead', 'site_manager', 'staff'] as const;
  const inherited = (role: string) => { const parts = folder.split('/'); for (let n = parts.length - 1; n >= 1; n--) { const p = data?.perms.find((x) => x.role === role && x.folder === parts.slice(0, n).join('/')); if (p) return `${p.folder} 설정`; } return '메뉴 권한'; };
  async function set(role: string, level: string) {
    try { await api('/api/library/folder-perms', { method: 'PUT', body: { folder, role, level: level || null } }); reload(); toast.ok('바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open onClose={onClose} title={`"${folder}" 폴더 권한`}>
      <div className="space-y-2" data-testid="folder-perms">
        <p className="text-xs text-ink-2">하위 폴더는 이 설정을 그대로 따릅니다. 메뉴 권한(사용자 관리 → 메뉴 권한)보다 넓힐 수는 없습니다. 대표는 항상 모든 폴더를 봅니다.</p>
        {roles.map((r) => (
          <label key={r} className="flex items-center justify-between gap-2 text-sm">{ROLE_LABEL[r]}
            <select className={cx(inputCls, 'h-9 w-44')} value={data?.perms.find((x) => x.folder === folder && x.role === r)?.level ?? ''} onChange={(e) => set(r, e.target.value)} aria-label={`${ROLE_LABEL[r]} 폴더 권한`}>
              <option value="">상속 ({inherited(r)})</option><option value="none">안 보임</option><option value="view">보기</option><option value="edit">올리기·수정</option><option value="delete">삭제까지</option>
            </select>
          </label>
        ))}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>닫기</Button></div>
      </div>
    </Modal>
  );
}
