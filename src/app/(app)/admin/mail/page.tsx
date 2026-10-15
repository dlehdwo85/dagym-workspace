'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Mail, Plug, Trash2 } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { Button, ErrorBox, Field, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';

type Preset = { key: string; label: string; host: string; port: number; secure: boolean; help: string; steps?: [string, string][] };
type Account = { provider: string; providerLabel: string; host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName: string | null; lastOkAt: string | null; lastError: string | null };
type Sig = { key: string; name: string; isDefault: boolean; sigIntro: string | null; sigDisclaimer: string | null; sigDisclaimerEn: string | null; hasLogo: boolean; html: string };

/** V21 메일 계정 연결(SMTP)·메일 명함 — 회사(조직)마다 자기 값. 비밀번호는 화면에 다시 보이지 않는다 */
export default function MailSettingsPage() {
  const acc = useApi<{ account: Account | null; presets: Preset[]; mode: 'auto' | 'workin' | 'smtp'; channel: string | null; workin: { enabled: boolean; from: string | null } }>('/api/org/mail-account');
  const sig = useApi<{ me: { name: string; title: string | null; phone: string | null; email: string }; companies: Sig[] }>('/api/org/mail-signature');
  if (acc.error) return <ErrorBox error={acc.error} retry={acc.reload} />;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="메일 계정·명함" icon={Mail} sub="업무에서 고객에게 보내는 메일은 설정 없이 워크인 발송으로, 또는 여기 연결한 회사 메일 계정(보낸메일함에도 남음)으로 나갑니다. AI 는 초안만 만들고 실제 발송은 사람이 [보내기]를 눌러야 합니다." />
      {acc.data && <SendMode data={acc.data} reload={acc.reload} />}
      {acc.loading && !acc.data ? <Skeleton rows={3} /> : acc.data && <AccountCard data={acc.data} reload={acc.reload} />}
      {sig.error ? <ErrorBox error={sig.error} retry={sig.reload} /> : sig.loading && !sig.data ? <Skeleton rows={3} /> : sig.data && <Signatures data={sig.data} reload={sig.reload} />}
    </div>
  );
}

function AccountCard({ data, reload }: { data: { account: Account | null; presets: Preset[] }; reload: () => void }) {
  const a = data.account;
  const [edit, setEdit] = useState(!a);
  const [f, setF] = useState({ provider: a?.provider ?? 'naver', host: a?.host ?? '', port: String(a?.port ?? 465), secure: a?.secure ?? true, username: a?.username ?? '', fromEmail: a?.fromEmail ?? '', fromName: a?.fromName ?? '', password: '' });
  const [busy, setBusy] = useState(false);
  const preset = data.presets.find((p) => p.key === f.provider);
  function pick(key: string) {
    const p = data.presets.find((x) => x.key === key)!;
    setF({ ...f, provider: key, host: key === 'custom' ? f.host : p.host, port: String(p.port), secure: p.secure });
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api('/api/org/mail-account', { method: 'PUT', body: { provider: f.provider, host: f.host || undefined, port: Number(f.port) || undefined, secure: f.secure,
        username: f.username.trim(), fromEmail: f.fromEmail.trim(), fromName: f.fromName.trim() || null, password: f.password || undefined } });
      toast.ok(`연결됐습니다 — ${r.testSentTo} 로 시험 메일을 보냈습니다. 받은편지함·보낸메일함을 확인해 주세요.`);
      setF({ ...f, password: '' }); setEdit(false); reload();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!confirm('메일 계정 연결을 끊을까요? 끊으면 업무에서 메일을 보낼 수 없습니다.')) return;
    try { await api('/api/org/mail-account', { method: 'DELETE' }); reload(); setEdit(true); } catch (er: any) { toast.error(er.message); }
  }
  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card" data-testid="mail-account">
      <h2 className="flex items-center gap-2 font-semibold"><Plug className="size-4" />메일 계정 연결</h2>
      {a && !edit && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700" data-testid="mail-connected"><CheckCircle2 className="size-4" />연결됨</span>
          <span><b>{a.fromName ? `${a.fromName} <${a.fromEmail}>` : a.fromEmail}</b> · {a.providerLabel}</span>
          {a.lastOkAt && <span className="text-ink-3">마지막 성공 {fmtDateTime(a.lastOkAt)}</span>}
          {a.lastError && <span className="text-red-600" data-testid="mail-last-error">최근 오류: {a.lastError}</span>}
          <span className="ml-auto flex gap-1.5"><Button size="sm" variant="secondary" onClick={() => setEdit(true)}>바꾸기·다시 시험</Button>
            <Button size="sm" variant="ghost" className="text-red-600" onClick={remove} aria-label="연결 끊기"><Trash2 /></Button></span>
        </div>
      )}
      {edit && (
        <form onSubmit={save} className="space-y-3" data-testid="mail-account-form">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="메일 업체">
            {data.presets.map((p) => (
              <button key={p.key} type="button" role="radio" aria-checked={f.provider === p.key} onClick={() => pick(p.key)}
                className={cx('rounded-full border px-3 py-1 text-sm', f.provider === p.key ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:bg-slate-50')}>{p.label}</button>
            ))}
          </div>
          {preset && (preset.steps?.length
            ? <ol className="list-decimal space-y-1 rounded-input bg-slate-50 py-2 pl-7 pr-3 text-xs text-ink-2" data-testid="mail-steps">{preset.steps.map(([t, url], k) => <li key={k}>{t}{url && <> — <a href={url} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">바로가기</a></>}</li>)}</ol>
            : <p className="rounded-input bg-slate-50 px-3 py-2 text-xs text-ink-2">{preset.help}</p>)}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="보내는 주소"><input className={inputCls} type="email" required value={f.fromEmail} onChange={(e) => setF({ ...f, fromEmail: e.target.value, username: f.username || e.target.value })} placeholder="예: info@회사도메인" data-testid="mail-from" /></Field>
            <Field label="보내는 이름 (받는 사람에게 보임)"><input className={inputCls} value={f.fromName} onChange={(e) => setF({ ...f, fromName: e.target.value })} placeholder="예: 회사명" /></Field>
            <Field label="로그인 아이디"><input className={inputCls} required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="off" data-testid="mail-user" /></Field>
            <Field label={a ? '앱 비밀번호 (비우면 저장된 값으로 시험)' : '앱 비밀번호'}><input className={inputCls} type="password" required={!a} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" data-testid="mail-pass" /></Field>
            {f.provider === 'custom' && <>
              <Field label="SMTP 서버"><input className={inputCls} required value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.example.com" data-testid="mail-host" /></Field>
              <Field label="포트·암호화"><span className="flex items-center gap-2"><input className={cx(inputCls, 'w-24')} inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value })} data-testid="mail-port" />
                <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} data-testid="mail-secure" />SSL(465)</label></span></Field>
            </>}
          </div>
          <p className="text-xs text-ink-3">[연결 시험]을 누르면 보내는 주소로 시험 메일 1통을 보내고, 성공해야 저장합니다. 비밀번호는 암호화해 서버에만 두고 화면에 다시 보이지 않습니다.</p>
          <div className="flex justify-end gap-2">{a && <Button type="button" variant="secondary" onClick={() => setEdit(false)}>취소</Button>}<Button type="submit" disabled={busy} data-testid="mail-test-save">{busy ? '시험 중…' : '연결 시험 후 저장'}</Button></div>
        </form>
      )}
    </section>
  );
}

function Signatures({ data, reload }: { data: { me: { name: string; title: string | null; phone: string | null; email: string }; companies: Sig[] }; reload: () => void }) {
  const [key, setKey] = useState(data.companies.find((c) => c.isDefault)?.key ?? data.companies[0]?.key ?? '');
  const cur = data.companies.find((c) => c.key === key);
  const [f, setF] = useState({ sigIntro: '', sigDisclaimer: '', sigDisclaimerEn: '' });
  useEffect(() => { if (cur) setF({ sigIntro: cur.sigIntro ?? '', sigDisclaimer: cur.sigDisclaimer ?? '', sigDisclaimerEn: cur.sigDisclaimerEn ?? '' }); }, [cur?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try { await api('/api/org/mail-signature', { method: 'PUT', body: { key, sigIntro: f.sigIntro || null, sigDisclaimer: f.sigDisclaimer || null, sigDisclaimerEn: f.sigDisclaimerEn || null } }); toast.ok('명함을 저장했습니다'); reload(); }
    catch (er: any) { toast.error(er.message); }
  }
  return (
    <section className="space-y-3 rounded-card border border-line bg-white p-4 shadow-card" data-testid="mail-signature">
      <h2 className="font-semibold">메일 명함</h2>
      <p className="text-xs text-ink-2">메일 맨 아래에 붙는 명함입니다. 로고·회사명·대표 전화·주소·웹사이트는 <Link href="/admin/company" className="text-brand-700 underline">회사 정보·디자인</Link>에서, 이름·직급·휴대폰은 보내는 사람 프로필에서, 이메일은 업무 이메일(없으면 이 회사 메일 계정 주소)로 채웁니다 — 로그인 이메일은 쓰지 않습니다.</p>
      {!data.companies.length ? <p className="text-sm text-ink-3">먼저 회사 정보·디자인에서 회사를 추가해 주세요.</p> : <>
        <div className="flex flex-wrap gap-1.5">{data.companies.map((c) => (
          <button key={c.key} type="button" onClick={() => setKey(c.key)} aria-pressed={key === c.key} className={cx('rounded-full border px-3 py-1 text-sm', key === c.key ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-line hover:bg-slate-50')}>{c.name}</button>
        ))}</div>
        {cur && <div className="grid gap-4 lg:grid-cols-2">
          <form onSubmit={save} className="space-y-3">
            <Field label="회사 소개 한 줄"><input className={inputCls} value={f.sigIntro} onChange={(e) => setF({ ...f, sigIntro: e.target.value })} maxLength={300} data-testid="sig-intro" /></Field>
            <Field label="비밀유지 안내문 (국문)"><textarea className={inputCls} rows={3} value={f.sigDisclaimer} onChange={(e) => setF({ ...f, sigDisclaimer: e.target.value })} maxLength={1000} /></Field>
            <Field label="비밀유지 안내문 (영문)"><textarea className={inputCls} rows={3} value={f.sigDisclaimerEn} onChange={(e) => setF({ ...f, sigDisclaimerEn: e.target.value })} maxLength={1000} /></Field>
            {!cur.hasLogo && <p className="text-xs text-amber-700">로고가 없습니다 — 회사 정보·디자인에서 로고를 올리면 명함 왼쪽에 들어갑니다.</p>}
            {(!data.me.title || !data.me.phone) && <p className="text-xs text-ink-3">내 프로필에 {[!data.me.title && '직급', !data.me.phone && '휴대폰'].filter(Boolean).join('·')}이 비어 있어 명함에서 빠집니다(첫 발송 때 물어서 저장).</p>}
            <div className="flex justify-end"><Button type="submit" data-testid="sig-save">저장</Button></div>
          </form>
          <div>
            <p className="mb-1 text-xs text-ink-3">미리보기 (내 정보 기준, 저장 후 반영)</p>
            <iframe title="명함 미리보기" className="h-72 w-full rounded-input border border-line bg-white" srcDoc={`<body style="margin:12px">${cur.html}</body>`} data-testid="sig-preview" />
          </div>
        </div>}
      </>}
    </section>
  );
}

/** V29 발송 방식: 워크인 발송(설정 없이) · 회사 메일 계정 · 자동 */
function SendMode({ data, reload }: { data: { mode: 'auto' | 'workin' | 'smtp'; channel: string | null; account: Account | null; workin: { enabled: boolean; from: string | null } }; reload: () => void }) {
  async function pick(mode: string) {
    try { await api('/api/org/mail-mode', { method: 'PUT', body: { mode } }); reload(); toast.ok('발송 방식을 바꿨습니다'); } catch (e: any) { toast.error(e.message); }
  }
  const opts: [string, string, string][] = [
    ['auto', '자동', '회사 메일 계정이 있으면 그것으로, 없으면 워크인 발송'],
    ['workin', '워크인 발송', data.workin.enabled ? `설정 없이 바로 — ${data.workin.from} 에서 "이름 직급 (회사)" 이름으로, 답장은 직원 업무 이메일로. 회사 보낸메일함에는 안 남고 워크인 발송 기록에 남음` : '준비 중(운영팀 도메인 인증 후 켜짐)'],
    ['smtp', '회사 메일 계정', data.account ? `${data.account.fromEmail} 으로 보내고 회사 보낸메일함에도 남음` : '아래에서 계정을 먼저 연결하세요'],
  ];
  return (
    <section className="rounded-card border border-line bg-white p-4 shadow-card" data-testid="mail-mode">
      <h2 className="text-sm font-semibold">보내는 방식 <span className="ml-1 text-xs font-normal text-ink-3">지금: {data.channel === 'email:workin' ? '워크인 발송' : data.channel === 'email:smtp' ? '회사 메일 계정' : '보낼 수 없음(계정 연결 필요)'}</span></h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="보내는 방식">
        {opts.map(([k, l, d]) => (
          <button key={k} type="button" role="radio" aria-checked={data.mode === k} onClick={() => pick(k)} disabled={k === 'workin' && !data.workin.enabled} data-testid={`mail-mode-${k}`}
            className={cx('rounded-input border p-2.5 text-left text-sm disabled:opacity-50', data.mode === k ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-600' : 'border-line hover:bg-slate-50')}>
            <b className="font-semibold">{l}</b><span className="mt-0.5 block text-xs text-ink-2">{d}</span></button>
        ))}
      </div>
    </section>
  );
}
