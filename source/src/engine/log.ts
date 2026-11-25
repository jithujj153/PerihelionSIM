import { sha256 } from './sha';
import type { Role } from './types';
export interface LogEntry { i: number; t: number; role: Role; kind: string; text: string; subject: string; prev: string; hash: string }
export interface Anchor { upTo: number; hash: string; t: number }
export interface Verify { ok: boolean; count: number; broken: number | null; anchor: { who: string; upTo: number } | null }
const hashEntry = (e: LogEntry) => sha256(JSON.stringify([e.i, e.t.toFixed(3), e.role, e.kind, e.text, e.subject, e.prev]));
/** Append-only, hash-chained log. Every tenth head hash is also held by both parties. */
export class TamperLog {
  entries: LogEntry[] = [];
  anchors: { governingBody: Anchor[]; vendor: Anchor[] } = { governingBody: [], vendor: [] };
  add(t: number, role: Role, kind: string, text: string, subject = ''): LogEntry {
    const prev = this.entries.length ? this.entries[this.entries.length - 1].hash : '0'.repeat(64);
    const e: LogEntry = { i: this.entries.length, t, role, kind, text, subject, prev, hash: '' };
    e.hash = hashEntry(e); this.entries.push(e);
    if (this.entries.length % 10 === 0) {
      const a = { upTo: e.i, hash: e.hash, t };
      this.anchors.governingBody.push({ ...a }); this.anchors.vendor.push({ ...a });
    }
    return e;
  }
  verify(): Verify {
    const res: Verify = { ok: true, count: this.entries.length, broken: null, anchor: null };
    let prev = '0'.repeat(64);
    for (const e of this.entries) {
      if (e.prev !== prev || hashEntry(e) !== e.hash) { res.ok = false; res.broken = e.i; return res; }
      prev = e.hash;
    }
    for (const [who, list] of [['Governing Body', this.anchors.governingBody], ['Vendor', this.anchors.vendor]] as const)
      for (const a of list) {
        const e = this.entries[a.upTo];
        if (!e || e.hash !== a.hash) { res.ok = false; res.anchor = { who, upTo: a.upTo }; return res; }
      }
    return res;
  }
  /** Demo attacks on the record itself. */
  edit(i: number, text: string) { if (this.entries[i]) this.entries[i].text = text; }
  rewriteFrom(i: number) {
    let prev = i ? this.entries[i - 1].hash : '0'.repeat(64);
    for (let k = i; k < this.entries.length; k++) { const e = this.entries[k]; e.prev = prev; e.hash = hashEntry(e); prev = e.hash; }
  }
}
