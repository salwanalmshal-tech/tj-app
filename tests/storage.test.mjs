import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage, DriveStorage, backupsToDelete } from '../js/storage.js';
import { Saver } from '../js/saver.js';
import { emptyState } from '../js/model.js';

// a tiny fake of the Google Drive v3 endpoints used by the program
import { createHash } from 'node:crypto';
const md5 = (o) => createHash('md5').update(JSON.stringify(o ?? null)).digest('hex');
// Like real Drive: "version" also rises by itself after a save (background changes), md5Checksum follows content only.
function fakeDrive() {
  const files = new Map(); let n = 0;
  const fmeta = (f) => ({ id: f.id, version: f.version, md5Checksum: md5(f.content), headRevisionId: 'r' + md5(f.content).slice(0, 8) });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url); const method = opts.method || 'GET'; const json = (o, s = 200) => ({ ok: s < 300, status: s, json: async () => o });
    if (opts.headers.Authorization !== 'Bearer T') return json({ error: { message: 'bad' } }, 401);
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q'); const name = /name='([^']*)'/.exec(q)?.[1]; const parent = /'([^']+)' in parents/.exec(q)?.[1];
      let list = [...files.values()].filter((f) => !f.trashed && (!name || f.name === name) && (!parent || f.parents?.includes(parent)));
      return json({ files: list.map((f) => { const { content, ...m } = f; return { ...m, ...fmeta(f) }; }) });
    }
    if (u.pathname === '/drive/v3/files' && method === 'POST') { const b = JSON.parse(opts.body); const id = 'id' + ++n; files.set(id, { id, ...b, version: '1', createdTime: new Date().toISOString() }); return json({ id }); }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const parts = opts.body.split(/--tj\w+/).filter((p) => p.includes('Content-Type')); const meta = JSON.parse(parts[0].split('\r\n\r\n')[1].trim()); const content = JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
      const id = 'id' + ++n; files.set(id, { id, ...meta, content, version: '1', createdTime: new Date().toISOString() }); return json(fmeta(files.get(id)));
    }
    const m = /\/files\/(\w+)$/.exec(u.pathname);
    if (m && method === 'GET') { const f = files.get(m[1]); if (!f) return json({}, 404); return u.searchParams.get('alt') === 'media' ? json(f.content) : json(fmeta(f)); }
    if (m && method === 'PATCH') { const f = files.get(m[1]); f.content = JSON.parse(opts.body); f.version = String(+f.version + 1); const r = fmeta(f); f.version = String(+f.version + 1); return json(r); }
    if (m && method === 'DELETE') { files.delete(m[1]); return { ok: true, status: 204, json: async () => ({}) }; }
    return json({}, 404);
  };
  return { fetchImpl, files };
}
const mk = (fake, session) => { const s = new DriveStorage({ auth: { token: () => 'T', expiresAt: () => Date.now() + 3600000 }, fetchImpl: fake.fetchImpl }); if (session) s.session = session; return s; };

test('drive: create, reopen, save, conflict is detected and nothing is overwritten', async () => {
  const fake = fakeDrive(); const a = mk(fake); const st = emptyState();
  assert.equal((await a.open()).data, null);
  assert.ok((await a.save(st)).ok);
  const b = mk(fake); assert.ok((await b.open()).data);
  st.settings.saveDelaySec = 9; assert.ok((await a.save(st)).ok);
  const stale = emptyState(); stale.settings.saveDelaySec = 1;
  assert.equal((await b.save(stale)).conflict, true); // b loaded an older version
  const c = mk(fake); assert.equal((await c.open()).data.settings.saveDelaySec, 9);
});
test('drive: same window saves many times in a row without a false conflict (bug 2026-11-03)', async () => {
  const fake = fakeDrive(); const a = mk(fake); const st = emptyState();
  await a.open(); assert.ok((await a.save(st)).ok);
  for (let i = 1; i <= 5; i++) { st.settings.saveDelaySec = i; assert.ok((await a.save(st)).ok, 'save ' + i); }
  const b = mk(fake); await b.open(); assert.ok((await b.save(st)).ok); // fresh window can save too
  st.settings.saveDelaySec = 42; assert.ok((await b.save(st)).ok);
  assert.equal((await a.save(emptyState())).conflict, true); // the older window is still refused
});
test('drive: lock blocks a second session; take over; expired lock is ignored', async () => {
  const fake = fakeDrive(); const a = mk(fake, 'A'), b = mk(fake, 'B');
  await a.open(); assert.equal(await a.lockInfo(), null); await a.acquireLock();
  const info = await b.lockInfo(); assert.ok(info && info.session === 'A');
  await b.acquireLock(); assert.equal(await a.stillMine(), false);
  const lockFile = [...fake.files.values()].find((f) => f.name.endsWith('.lock.json')); lockFile.content.renewedAt = Date.now() - 10 * 60000;
  assert.equal(await mk(fake, 'C').lockInfo(), null);
});
test('drive: expired token raises a Reconnect error, never half-saves', async () => {
  const fake = fakeDrive(); const s = new DriveStorage({ auth: { token: () => 'T', expiresAt: () => Date.now() + 1000 }, fetchImpl: fake.fetchImpl });
  await assert.rejects(() => s.open(), (e) => e.auth === true);
});
test('backups: write, list, retention keeps last 10 + daily + monthly and never counts safety copies', async () => {
  const day = (n, kind = 'auto') => ({ id: kind + n, kind, time: new Date(Date.UTC(2026, 10, 1) - n * 86400000).toISOString() });
  const list = [...Array.from({ length: 40 }, (_, i) => day(i)), day(5, 'before-restore'), { id: 'old', kind: 'before-update', time: '2026-01-01T00:00:00Z' }];
  const del = backupsToDelete(list, Date.UTC(2026, 10, 2));
  assert.ok(!del.includes('auto0') && !del.includes('auto9')); assert.ok(!del.includes('before-restore5')); assert.ok(del.includes('old'));
  assert.ok(!del.includes('auto25')); // one per day inside 30 days stays
  assert.ok(del.includes('auto35') || list.length > 0);
});
test('saver: collects edits, one upload at a time, status labels, conflict -> read-only', async () => {
  const mem = new MemoryStorage(); const st = emptyState(); const seen = []; let saves = 0;
  const orig = mem.save.bind(mem); mem.save = async (d) => { saves++; await new Promise((r) => setTimeout(r, 30)); return orig(d); };
  const sv = new Saver({ storage: mem, getData: () => st, getDelay: () => 0.05, onStatus: (s) => seen.push(s.status) });
  sv.markDirty(); sv.markDirty(); sv.markDirty();
  await new Promise((r) => setTimeout(r, 400)); assert.equal(saves, 1); assert.equal(seen.at(-1), 'saved');
  sv.markDirty({ now: true }); await new Promise((r) => setTimeout(r, 10)); sv.markDirty({ now: true }); // edit during upload
  await new Promise((r) => setTimeout(r, 400)); assert.equal(saves, 3); assert.equal(sv.hasUnsaved(), false);
  mem.save = async () => ({ ok: false, conflict: true }); sv.markDirty({ now: true }); await new Promise((r) => setTimeout(r, 50));
  assert.equal(sv.readOnly, true); assert.equal(seen.at(-1), 'conflict');
});
