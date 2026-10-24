import { DatabaseSync } from 'node:sqlite';
import { AppError } from './errors.mjs';
import { providerReservation, requireProviderReservation } from './provider-budget.mjs';

/** Local/self-host storage. SQL always scopes operations to a verified tenant. */
export class SqliteStore {
  #db;
  constructor(filename) {
    this.#db = new DatabaseSync(filename);
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS provider_usage (scope TEXT PRIMARY KEY, used INTEGER NOT NULL, reset_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_permits (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connections (
        user_id TEXT NOT NULL, id TEXT NOT NULL, status TEXT NOT NULL,
        channel_id TEXT, channels_json TEXT NOT NULL DEFAULT '[]',
        grant_cipher TEXT, version INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER, created_at INTEGER NOT NULL,
        PRIMARY KEY(user_id,id)
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, connection_id TEXT NOT NULL,
        browser_hash TEXT NOT NULL, payload_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id,connection_id) REFERENCES connections(user_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS snapshots (
        user_id TEXT NOT NULL, connection_id TEXT NOT NULL, channel_id TEXT NOT NULL,
        payload TEXT NOT NULL, observed_at INTEGER NOT NULL,
        PRIMARY KEY(user_id,connection_id),
        FOREIGN KEY(user_id,connection_id) REFERENCES connections(user_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS leases (
        user_id TEXT NOT NULL, connection_id TEXT NOT NULL, purpose TEXT NOT NULL,
        id TEXT NOT NULL, expires_at INTEGER NOT NULL,
        PRIMARY KEY(user_id,connection_id,purpose),
        FOREIGN KEY(user_id,connection_id) REFERENCES connections(user_id,id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS layouts (
        user_id TEXT NOT NULL, connection_id TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(user_id,connection_id),
        FOREIGN KEY(user_id,connection_id) REFERENCES connections(user_id,id) ON DELETE CASCADE
      );`);
  }
  close() { this.#db.close(); }
  reserveProviderWork(args) {
    const reservation = providerReservation(args);
    return this.transaction(() => requireProviderReservation(reservation, reservation.statements.map(({ sql, values }) => ({ results: this.#db.prepare(sql).all(...values) }))));
  }
  releaseProviderWork(id) { this.#db.prepare('DELETE FROM provider_permits WHERE id=?').run(id); }
  transaction(operation) {
    this.#db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.#db.exec('COMMIT'); return result; }
    catch (error) { this.#db.exec('ROLLBACK'); throw error; }
  }
  prune(now) {
    this.#db.prepare('DELETE FROM connections WHERE expires_at IS NOT NULL AND expires_at<=?').run(now);
    this.#db.prepare('DELETE FROM oauth_states WHERE expires_at<=?').run(now);
  }
  begin({ userId, id, stateHash, browserHash, payload, now }) {
    this.transaction(() => {
      this.prune(now);
      const count = this.#db.prepare('SELECT COUNT(*) AS n FROM connections WHERE user_id=?').get(userId).n;
      if (count >= 5) throw new AppError('CONNECTION_LIMIT', 'Remove an unused connection before adding another.', 429);
      this.#db.prepare('INSERT INTO connections(user_id,id,status,expires_at,created_at) VALUES(?,?,?,?,?)').run(userId,id,'authorizing',now+600000,now);
      this.#db.prepare('INSERT INTO oauth_states VALUES(?,?,?,?,?,?)').run(stateHash,userId,id,browserHash,payload,now+600000);
    });
  }
  consumeState(stateHash, browserHash, now) {
    return this.#db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *').get(stateHash,browserHash,now);
  }
  consumeStateForUser(stateHash, browserHash, now, userId) {
    return this.#db.prepare('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? AND user_id=? RETURNING *').get(stateHash,browserHash,now,userId);
  }
  get(userId, id) {
    const row = this.#db.prepare('SELECT * FROM connections WHERE user_id=? AND id=?').get(userId,id);
    if (!row) throw new AppError('NOT_FOUND', 'Connection not found.', 404);
    return row;
  }
  list(userId) { return this.#db.prepare('SELECT * FROM connections WHERE user_id=? ORDER BY created_at,id').all(userId); }
  complete(userId,id,channels,grant,now) {
    const result = this.#db.prepare("UPDATE connections SET status='select_channel',channels_json=?,grant_cipher=?,version=version+1,expires_at=? WHERE user_id=? AND id=? AND status='authorizing' AND expires_at>?").run(JSON.stringify(channels),grant,now+600000,userId,id,now);
    if (result.changes !== 1) throw new AppError('CONNECTION_CHANGED', 'The authorization is no longer active.', 409);
  }
  select(userId,id,channelId,grant,version) {
    const result = this.#db.prepare("UPDATE connections SET status='connected',channel_id=?,grant_cipher=?,version=version+1,expires_at=NULL WHERE user_id=? AND id=? AND status='select_channel' AND version=?").run(channelId,grant,userId,id,version);
    if (result.changes !== 1) throw new AppError('CONNECTION_CHANGED', 'The connection changed; retry with current state.', 409);
  }
  snapshot(userId,id) { return this.#db.prepare('SELECT payload FROM snapshots WHERE user_id=? AND connection_id=?').get(userId,id)?.payload ?? null; }
  layout(userId,id) { return this.#db.prepare('SELECT payload FROM layouts WHERE user_id=? AND connection_id=?').get(userId,id)?.payload ?? null; }
  saveLayout(userId,id,payload) {
    this.#db.prepare('INSERT INTO layouts(user_id,connection_id,payload) VALUES(?,?,?) ON CONFLICT(user_id,connection_id) DO UPDATE SET payload=excluded.payload').run(userId,id,payload);
  }
  remove(userId,id) {
    const row=this.#db.prepare('DELETE FROM connections WHERE user_id=? AND id=? RETURNING *').get(userId,id);
    if (!row) throw new AppError('NOT_FOUND','Connection not found.',404);
    return row;
  }
  acquire(userId,id,purpose,leaseId,now,ttl) {
    const row=this.#db.prepare("INSERT INTO leases(user_id,connection_id,purpose,id,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE user_id=? AND id=? AND status='connected') ON CONFLICT(user_id,connection_id,purpose) DO UPDATE SET id=excluded.id,expires_at=excluded.expires_at WHERE leases.expires_at<=? RETURNING id").get(userId,id,purpose,leaseId,now+ttl,userId,id,now);
    if (!row) throw new AppError('OPERATION_BUSY','This connection is busy or no longer authorized.',409);
    return leaseId;
  }
  release(userId,id,purpose,leaseId) {
    this.#db.prepare('DELETE FROM leases WHERE user_id=? AND connection_id=? AND purpose=? AND id=?').run(userId,id,purpose,leaseId);
  }
  replaceGrant(userId,id,version,grant,leaseId,now) {
    const result=this.#db.prepare("UPDATE connections SET grant_cipher=?,version=version+1 WHERE user_id=? AND id=? AND version=? AND status='connected' AND EXISTS(SELECT 1 FROM leases WHERE user_id=? AND connection_id=? AND purpose='grant' AND id=? AND expires_at>?)").run(grant,userId,id,version,userId,id,leaseId,now);
    if (result.changes!==1) throw new AppError('CONNECTION_CHANGED','The connection changed while refreshing authorization.',409);
  }
  markReauth(userId,id,version) {
    this.#db.prepare("UPDATE connections SET status='reauth_required',version=version+1 WHERE user_id=? AND id=? AND version=? AND status='connected'").run(userId,id,version);
  }
  saveSnapshot(userId,id,channelId,payload,leaseId,now) {
    if (Buffer.byteLength(payload)>1_800_000) throw new AppError('SNAPSHOT_LIMIT','The bounded snapshot is too large; previous data was preserved.',409);
    const result=this.#db.prepare("INSERT INTO snapshots(user_id,connection_id,channel_id,payload,observed_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connections c JOIN leases l ON c.user_id=l.user_id AND c.id=l.connection_id WHERE c.user_id=? AND c.id=? AND c.channel_id=? AND c.status='connected' AND l.purpose='sync' AND l.id=? AND l.expires_at>?) ON CONFLICT(user_id,connection_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at").run(userId,id,channelId,payload,now,userId,id,channelId,leaseId,now);
    if (result.changes!==1) throw new AppError('CONNECTION_CHANGED','Synchronization expired or the connection was removed; data was not saved.',409);
  }
}
