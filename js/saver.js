// Automatic saving. Edits are collected and written 3 seconds after the last edit (adjustable), never two uploads at once.
// Important actions save at once. The status label always says what is going on.
export class Saver {
  constructor({ storage, getData, getDelay, onStatus, onConflict, onAuth, onBackupDue }) {
    Object.assign(this, { storage, getData, getDelay, onStatus, onConflict, onAuth, onBackupDue });
    this.timer = null; this.busy = false; this.again = false; this.dirty = false; this.readOnly = false; this.lastSaved = null; this.error = null;
  }
  setStatus(s, extra = {}) { this.status = s; this.onStatus?.({ status: s, ...extra }); }
  markDirty({ now = false } = {}) {
    if (this.readOnly) return;
    this.dirty = true; this.setStatus('unsaved');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), now ? 0 : this.getDelay() * 1000);
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.readOnly) return false;
    if (this.busy) { this.again = true; return false; }
    if (!this.dirty) return true;
    this.busy = true; this.setStatus('saving');
    try {
      this.dirty = false;
      const data = this.getData(); data.meta.savedAt = new Date().toISOString();
      const r = await this.storage.save(data);
      if (!r.ok) { this.dirty = true; this.readOnly = true; this.setStatus('conflict'); this.onConflict?.(); return false; }
      this.lastSaved = new Date(); this.error = null;
      this.setStatus(this.again || this.dirty ? 'unsaved' : 'saved', { at: this.lastSaved });
      this.onBackupDue?.();
      return true;
    } catch (e) {
      this.dirty = true; this.error = e;
      if (e.auth) { this.setStatus('reconnect'); this.onAuth?.(e); } else this.setStatus('failed', { message: e.message });
      return false;
    } finally {
      this.busy = false;
      if ((this.again || this.dirty) && !this.readOnly && !this.error) { this.again = false; this.timer = setTimeout(() => this.flush(), 0); }
      else this.again = false;
    }
  }
  hasUnsaved() { return this.dirty || this.busy; }
}
