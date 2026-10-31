import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_kind ON records(kind);
      CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, operation TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.listeners = new Set();
  }
  list(kind) { return this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.data)); }
  get(kind, id) {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(row.data) : null;
  }
  put(kind, data) {
    this.db.prepare('INSERT INTO records(id,kind,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(data.id, kind, JSON.stringify(data));
    return data;
  }
  meta(key, value) {
    if (value !== undefined) this.db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
    return this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key)?.value;
  }
  atomic(fn) {
    const before = this.db.prepare('SELECT total_changes() AS count').get().count;
    this.db.exec('BEGIN IMMEDIATE');
    let result;
    try { result = fn(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    const changed = this.db.prepare('SELECT total_changes() AS count').get().count !== before;
    if (changed) for (const listener of this.listeners) { try { listener(); } catch { /* disconnected SSE subscriber */ } }
    return result;
  }
  audit(message, entityId, actor = 'Coordinator', severity = 'info') {
    return this.put('events', { id: randomUUID(), message, entityId, actor, severity, createdAt: new Date().toISOString() });
  }
  close() { this.db.close(); }
}
