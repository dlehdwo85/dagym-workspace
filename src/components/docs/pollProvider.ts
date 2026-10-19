// 대표 결정 10/19: 자료실 문서 공동 편집 — 외부 실시간 서비스 없이 워크인 API 짧은 폴링으로 Yjs 조각·커서를 주고받는다.
// 보내기(0.3초 모아서)와 받기를 한 번의 왕복(POST /api/library/docs/:id/sync)으로. 고치는 중 1초·조용하면 3초·화면 숨으면 멈춤.
// 오프라인 조각은 IndexedDB(y-indexeddb)에 남겨 다시 연결되면 합쳐진다(CRDT).
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { api } from '@/components/client';

const toB64 = (u: Uint8Array) => { let s = ''; u.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export type PollStatus = 'connecting' | 'online' | 'offline' | 'readonly';
type Listener = (s: PollStatus) => void;

export class PollProvider {
  doc: Y.Doc;
  awareness: Awareness;
  since = 0;
  canEdit: boolean;
  status: PollStatus = 'connecting';
  private pending: Uint8Array[] = [];
  private awarenessDirty = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight = false;
  private lastActivity = 0; // 마지막으로 누가 고친 시각(간격 결정)
  private listeners = new Set<Listener>();
  private destroyed = false;
  private idb: { destroy(): void } | null = null;
  private onVis = () => { if (document.visibilityState === 'visible') { this.schedule(0); } else this.stop(); };
  private onUpdate = (u: Uint8Array, origin: unknown) => { if (origin === this) return; this.pending.push(u); this.lastActivity = Date.now(); this.schedule(300); };
  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    const me = this.doc.clientID;
    if ([...added, ...updated, ...removed].includes(me)) { this.awarenessDirty = true; this.schedule(300); }
  };
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(public id: string, init: { snapshot: string; updates: string[]; seq: number; canEdit: boolean }, public user: { id: string; name: string; color: string }) {
    this.doc = new Y.Doc();
    this.canEdit = init.canEdit;
    Y.applyUpdate(this.doc, fromB64(init.snapshot), this);
    for (const u of init.updates) { try { Y.applyUpdate(this.doc, fromB64(u), this); } catch { /* 깨진 조각 */ } }
    this.since = init.seq;
    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalStateField('user', { name: user.name, color: user.color, id: user.id });
    this.doc.on('update', this.onUpdate);
    this.awareness.on('update', this.onAwareness);
    // 다른 사람 커서는 y-protocols 가 30초 동안 갱신이 없으면 지우므로 10초마다 내 상태를 새로 찍어 보낸다
    this.heartbeat = setInterval(() => this.awareness.setLocalStateField('t', Date.now()), 10_000);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVis);
    this.connectIdb();
    this.schedule(0);
  }
  private async connectIdb() {
    try { const { IndexeddbPersistence } = await import('y-indexeddb'); this.idb = new IndexeddbPersistence(`wos-doc-${this.id}`, this.doc); } catch { /* 사생활 모드 등 */ }
  }
  on(fn: Listener) { this.listeners.add(fn); fn(this.status); return () => { this.listeners.delete(fn); }; }
  private set(s: PollStatus) { if (this.status !== s) { this.status = s; this.listeners.forEach((f) => f(s)); } }
  private stop() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  private schedule(ms: number) {
    if (this.destroyed || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) return;
    if (this.timer) { if (ms === 0) { clearTimeout(this.timer); this.timer = null; } else return; }
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, ms);
  }
  /** 보내기 + 받기 한 번. 끝나면 다음 왕복 예약(고친 지 10초 안이면 1초, 아니면 3초) */
  async flush() {
    if (this.destroyed || this.inflight) { if (this.inflight) this.schedule(500); return; }
    this.inflight = true;
    const batch = this.pending.length ? Y.mergeUpdates(this.pending) : null;
    const sentCount = this.pending.length;
    const body: Record<string, unknown> = { since: this.since, clientId: this.doc.clientID };
    if (batch && this.canEdit) body.update = toB64(batch);
    if (this.awarenessDirty) { body.awareness = toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])); }
    try {
      const r = await api<{ seq: number; updates: string[]; presence: { clientId: number; state: string }[]; canEdit: boolean }>(`/api/library/docs/${this.id}/sync`, { method: 'POST', body });
      if (batch && this.canEdit) this.pending.splice(0, sentCount);
      this.awarenessDirty = false;
      for (const u of r.updates) { try { Y.applyUpdate(this.doc, fromB64(u), this); this.lastActivity = Date.now(); } catch { /* 깨진 조각 */ } }
      this.since = Math.max(this.since, r.seq);
      const seen = new Set<number>();
      for (const p of r.presence) { try { applyAwarenessUpdate(this.awareness, fromB64(p.state), this); seen.add(p.clientId); } catch { /* 무시 */ } }
      const gone = [...this.awareness.getStates().keys()].filter((c) => c !== this.doc.clientID && !seen.has(c));
      if (gone.length) removeAwarenessStates(this.awareness, gone, this);
      if (this.canEdit !== r.canEdit) { this.canEdit = r.canEdit; }
      this.set(this.canEdit ? 'online' : 'readonly');
    } catch (e: any) {
      if (e?.status === 403 && batch) { this.canEdit = false; this.pending = []; this.set('readonly'); }
      else if (e?.status === 401 || e?.status === 404) { this.set('offline'); this.destroy(); return; }
      else this.set('offline');
    } finally { this.inflight = false; }
    const busy = Date.now() - this.lastActivity < 10_000 || this.pending.length > 0;
    this.schedule(this.status === 'offline' ? 5000 : busy ? 1000 : 3000);
  }
  /** 화면을 떠날 때: 내 커서 지우고(서버) 남은 조각은 IndexedDB 에 남는다 */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stop();
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVis);
    this.doc.off('update', this.onUpdate);
    this.awareness.off('update', this.onAwareness);
    try { navigator.sendBeacon?.(`/api/library/docs/${this.id}/sync`, new Blob([JSON.stringify({ since: this.since, clientId: this.doc.clientID, leave: true })], { type: 'application/json' })); } catch { /* 무시 */ }
    removeAwarenessStates(this.awareness, [this.doc.clientID], this);
    this.idb?.destroy();
  }
}

export const PRESENCE_COLORS = ['#0d9488', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#059669', '#4f46e5'];
export const colorFor = (id: string) => PRESENCE_COLORS[[...id].reduce((n, c) => (n + c.charCodeAt(0)) % PRESENCE_COLORS.length, 0)];
