// The one place that holds the data while the program runs.
// run(action) works on a copy; only when the action succeeds does the copy replace the data (nothing half-changed).
// Undo returns to the state before the last change (one step, as decided). The change log is never erased.
import { checkFile, migrate } from './model.js';

export class Store {
  constructor(state, { onChange, onSave } = {}) {
    this.state = state; this.prev = null; this.prevLabel = ''; this.listeners = new Set();
    if (onChange) this.listeners.add(onChange);
    this.onSave = onSave;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(kind, label) { for (const fn of this.listeners) fn(kind, label); }
  // action: (draft) => {ok, error?, data?}. opts: { label, now (save at once), noUndo }
  run(action, { label = 'Change', now = false, noUndo = false } = {}) {
    const draft = structuredClone(this.state);
    const res = action(draft);
    if (!res || !res.ok) return res || { ok: false, error: 'Nothing happened.' };
    if (!noUndo) { this.prev = this.state; this.prevLabel = label; }
    // review fix 2026-11-09: a change saved without Undo (reminder answer, History "seen", Trash emptying) is also applied to the
    // Undo copy, so a later Undo of an earlier change never throws it away
    else if (this.prev) { try { const p2 = structuredClone(this.prev); const r2 = action(p2); if (r2 && r2.ok) this.prev = p2; } catch { /* keep the Undo copy as it was */ } }
    this.state = draft; this.state.meta.changedAt = new Date().toISOString();
    this.onSave?.({ now });
    this._emit('change', label);
    return res;
  }
  canUndo() { return !!this.prev; }
  undoLabel() { return this.prevLabel; }
  undo() {
    if (!this.prev) return false;
    // The change log is never erased: keep it and record the undo.
    const log = this.state.changeLog.slice(); const cur = this.state;
    this.state = this.prev; this.state.changeLog = log;
    this.state.changeLog.push({ ts: new Date().toISOString(), type: 'undo', label: this.prevLabel });
    void cur; this.prev = null; this.prevLabel = '';
    this.onSave?.({ now: true }); this._emit('undo', ''); return true;
  }
  // replace everything (open file, restore, import). Undo is cleared.
  replace(state, label = 'Replace') {
    this.state = state; this.prev = null; this.prevLabel = '';
    this.onSave?.({ now: true }); this._emit('replace', label);
  }
  load(raw) { const c = checkFile(raw); if (!c.ok) return c; this.state = migrate(raw); this.prev = null; this._emit('load', ''); return { ok: true }; }
}
