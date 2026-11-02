// Storage back ends. The program talks only to this interface:
//   open() -> { data|null }, save(data), lockInfo(), acquireLock(force), renewLock(), releaseLock(),
//   writeBackup(kind, data), listBackups(), readBackup(id), deleteBackup(id), describe()
// DriveStorage keeps ONE readable JSON file in the user's own Google Drive. MemoryStorage is the "try without Google" mode: nothing is kept.

export const LOCK_MINUTES = 3;
const FOLDER_DEFAULT = 'Trade Journal';
export const FILE_NAME = 'TradeJournal.json';
const LOCK_NAME = 'TradeJournal.lock.json';
const BACKUP_FOLDER = 'Backups';

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

// ------------------------------------------------------------------ memory (demo) ----
export class MemoryStorage {
  constructor() { this.kind = 'memory'; this.data = null; this.backups = []; this.lock = null; this.session = Math.random().toString(36).slice(2); }
  describe() { return { account: 'none (nothing is saved)', folder: '–', file: '–', demo: true }; }
  async open() { return { data: this.data ? structuredClone(this.data) : null }; }
  async save(data) { this.data = structuredClone(data); return { ok: true }; }
  async lockInfo() { return this.lock && this.lock.session !== this.session && Date.now() - this.lock.renewedAt < LOCK_MINUTES * 60000 ? this.lock : null; }
  async acquireLock() { this.lock = { session: this.session, since: Date.now(), renewedAt: Date.now() }; return true; }
  async renewLock() { if (this.lock) this.lock.renewedAt = Date.now(); }
  async releaseLock() { this.lock = null; }
  async writeBackup(kind, data) { const id = `backup-${stamp()}-${kind}-${this.backups.length}`; this.backups.push({ id, kind, name: id + '.json', time: new Date().toISOString(), data: structuredClone(data) }); return id; }
  async listBackups() { return this.backups.map(({ id, kind, name, time }) => ({ id, kind, name, time })); }
  async readBackup(id) { const b = this.backups.find((x) => x.id === id); return b ? structuredClone(b.data) : null; }
  async deleteBackup(id) { this.backups = this.backups.filter((x) => x.id !== id); }
}

// ------------------------------------------------------------------ Google Drive ----
export class DriveError extends Error { constructor(msg, status, auth = false) { super(msg); this.status = status; this.auth = auth; } }

export class DriveStorage {
  // auth: { token(): string, expiresAt(): ms, reconnect(): Promise }  fetchImpl is injectable for tests
  constructor({ auth, folderName = FOLDER_DEFAULT, account = '', fetchImpl = (...a) => fetch(...a), session }) {
    this.kind = 'drive'; this.auth = auth; this.folderName = folderName; this.account = account; this.f = fetchImpl;
    this.session = session || Math.random().toString(36).slice(2); this.ids = {}; this.version = null;
  }
  describe() { return { account: this.account || 'Google account', folder: this.folderName, file: FILE_NAME, demo: false }; }
  async _req(url, opts = {}) {
    if (this.auth.expiresAt() - Date.now() < 30000) throw new DriveError('The Google connection has ended. Reconnect to continue.', 401, true);
    const res = await this.f(url, { ...opts, headers: { Authorization: 'Bearer ' + this.auth.token(), ...(opts.headers || {}) } });
    if (res.status === 401) throw new DriveError('The Google connection has ended. Reconnect to continue.', 401, true);
    if (!res.ok) { let m = ''; try { m = (await res.json()).error?.message || ''; } catch { /* ignore */ } throw new DriveError(`Google Drive answered ${res.status}. ${m}`, res.status); }
    return res;
  }
  async _json(url, opts) { return (await this._req(url, opts)).json(); }
  _q(q) { return 'https://www.googleapis.com/drive/v3/files?spaces=drive&fields=files(id,name,version,modifiedTime,createdTime,appProperties)&pageSize=200&q=' + encodeURIComponent(q); }
  async _find(name, parent, mime) {
    const esc = name.replace(/'/g, "\\'");
    const q = `name='${esc}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '') + (mime ? ` and mimeType='${mime}'` : '');
    const r = await this._json(this._q(q)); return r.files?.[0] ?? null;
  }
  async _ensureFolder(name, parent) {
    const mime = 'application/vnd.google-apps.folder';
    const ex = await this._find(name, parent, mime); if (ex) return ex.id;
    const body = { name, mimeType: mime, ...(parent ? { parents: [parent] } : {}) };
    const r = await this._json('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return r.id;
  }
  async _folders() {
    if (!this.ids.root) this.ids.root = await this._ensureFolder(this.folderName, null);
    if (!this.ids.backups) this.ids.backups = await this._ensureFolder(BACKUP_FOLDER, this.ids.root);
    return this.ids;
  }
  async _create(name, parent, obj, appProps) {
    const meta = { name, parents: [parent], mimeType: 'application/json', ...(appProps ? { appProperties: appProps } : {}) };
    const boundary = 'tj' + Math.random().toString(36).slice(2);
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`;
    return this._json('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,version,modifiedTime', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body });
  }
  async _update(id, obj) {
    return this._json(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,version,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  }
  async _read(id) { return (await this._req(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json(); }

  async open() {
    const { root } = await this._folders();
    const f = await this._find(FILE_NAME, root);
    if (!f) return { data: null };
    this.ids.data = f.id; this.version = f.version;
    return { data: await this._read(f.id) };
  }
  // Before every save: check the Drive file is still the one we loaded (never overwrite newer data).
  async save(data) {
    const { root } = await this._folders();
    if (!this.ids.data) { const c = await this._create(FILE_NAME, root, data); this.ids.data = c.id; this.version = c.version; return { ok: true }; }
    const cur = await this._json(`https://www.googleapis.com/drive/v3/files/${this.ids.data}?fields=version`);
    if (this.version !== null && cur.version !== this.version) return { ok: false, conflict: true };
    const r = await this._update(this.ids.data, data); this.version = r.version; return { ok: true };
  }
  async lockInfo() {
    const { root } = await this._folders(); const f = await this._find(LOCK_NAME, root); if (!f) return null;
    this.ids.lock = f.id; const l = await this._read(f.id);
    return l.session && l.session !== this.session && Date.now() - l.renewedAt < LOCK_MINUTES * 60000 ? l : null;
  }
  async acquireLock() {
    const { root } = await this._folders(); const l = { session: this.session, since: Date.now(), renewedAt: Date.now() };
    if (this.ids.lock) await this._update(this.ids.lock, l); else { const f = await this._find(LOCK_NAME, root); if (f) { this.ids.lock = f.id; await this._update(f.id, l); } else this.ids.lock = (await this._create(LOCK_NAME, root, l)).id; }
    this.lockSince = l.since; return true;
  }
  async renewLock() { if (this.ids.lock) await this._update(this.ids.lock, { session: this.session, since: this.lockSince ?? Date.now(), renewedAt: Date.now() }); }
  async releaseLock() { if (this.ids.lock) await this._update(this.ids.lock, { session: null, since: 0, renewedAt: 0 }); }
  // Called when the page is closed or reloaded: frees the lock at once (best effort; the lock also expires by itself).
  releaseLockOnExit() {
    if (!this.ids.lock || !this.auth.token() || this.auth.expiresAt() < Date.now()) return;
    try { this.f(`https://www.googleapis.com/upload/drive/v3/files/${this.ids.lock}?uploadType=media`, { method: 'PATCH', keepalive: true, headers: { Authorization: 'Bearer ' + this.auth.token(), 'Content-Type': 'application/json' }, body: JSON.stringify({ session: null, since: 0, renewedAt: 0 }) }); } catch { /* ignore */ }
  }
  async stillMine() { if (!this.ids.lock) return true; const l = await this._read(this.ids.lock); return l.session === this.session; }

  async writeBackup(kind, data) {
    const { backups } = await this._folders(); const name = `backup-${stamp()}-${kind}.json`;
    const c = await this._create(name, backups, data, { tjKind: kind }); return c.id;
  }
  async listBackups() {
    const { backups } = await this._folders(); const r = await this._json(this._q(`'${backups}' in parents and trashed=false`));
    return (r.files || []).map((f) => ({ id: f.id, name: f.name, kind: f.appProperties?.tjKind || (/-([a-z-]+)\.json$/.exec(f.name)?.[1] ?? 'auto'), time: f.createdTime })).sort((a, b) => (a.time < b.time ? 1 : -1));
  }
  async readBackup(id) { return this._read(id); }
  async deleteBackup(id) { await this._req(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }); }
}

// ------------------------------------------------------------------ backup policy (B4) ----
const SAFETY = new Set(['before-update', 'before-restore', 'before-replace']);
// Keep: last 10 + 1 per day for 30 days + 1 per month for a year. Safety copies are never counted and are removed after 90 days.
export function backupsToDelete(list, now = Date.now()) {
  const keep = new Set(); const normal = list.filter((b) => !SAFETY.has(b.kind)).sort((a, b) => (a.time < b.time ? 1 : -1));
  normal.slice(0, 10).forEach((b) => keep.add(b.id));
  const perDay = new Map(), perMonth = new Map();
  for (const b of normal) {
    const age = (now - Date.parse(b.time)) / 86400000;
    const day = b.time.slice(0, 10), month = b.time.slice(0, 7);
    if (age <= 30 && !perDay.has(day)) { perDay.set(day, b.id); keep.add(b.id); }
    if (age <= 366 && !perMonth.has(month)) { perMonth.set(month, b.id); keep.add(b.id); }
  }
  const del = normal.filter((b) => !keep.has(b.id)).map((b) => b.id);
  for (const b of list) if (SAFETY.has(b.kind) && (now - Date.parse(b.time)) / 86400000 > 90) del.push(b.id);
  return del;
}
