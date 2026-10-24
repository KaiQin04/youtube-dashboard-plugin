import { AppError } from './errors.mjs';

/** D1 storage for a pre-migrated binding; every connection operation is tenant-scoped. */
export class D1Store {
  #db;

  constructor(database) {
    if (!database?.prepare || !database?.batch) throw new AppError('CONFIGURATION', 'The dashboard database is not configured.', 503);
    this.#db = database;
  }

  #statement(sql, ...values) { return this.#db.prepare(sql).bind(...values); }

  async prune(now) {
    await this.#db.batch([
      this.#statement('DELETE FROM connections WHERE expires_at IS NOT NULL AND expires_at<=?', now),
      this.#statement('DELETE FROM oauth_states WHERE expires_at<=?', now),
    ]);
  }

  async begin({ userId, id, stateHash, browserHash, payload, now }) {
    // D1 batches are atomic and execute these statements sequentially. The state
    // insert is conditional on the preceding connection insert affecting a row.
    const results = await this.#db.batch([
      this.#statement('DELETE FROM connections WHERE expires_at IS NOT NULL AND expires_at<=?', now),
      this.#statement('DELETE FROM oauth_states WHERE expires_at<=?', now),
      this.#statement("INSERT INTO connections(user_id,id,status,expires_at,created_at) SELECT ?,?,'authorizing',?,? WHERE (SELECT COUNT(*) FROM connections WHERE user_id=?)<5", userId, id, now + 600000, now, userId),
      this.#statement('INSERT INTO oauth_states(state_hash,user_id,connection_id,browser_hash,payload_cipher,expires_at) SELECT ?,?,?,?,?,? WHERE changes()=1', stateHash, userId, id, browserHash, payload, now + 600000),
    ]);
    if (results[2].meta.changes !== 1) throw new AppError('CONNECTION_LIMIT', 'Remove an unused connection before adding another.', 429);
  }

  async consumeState(stateHash, browserHash, now) {
    return this.#statement('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? RETURNING *', stateHash, browserHash, now).first();
  }

  async consumeStateForUser(stateHash, browserHash, now, userId) {
    return this.#statement('DELETE FROM oauth_states WHERE state_hash=? AND browser_hash=? AND expires_at>? AND user_id=? RETURNING *', stateHash, browserHash, now, userId).first();
  }

  async get(userId, id) {
    const row = await this.#statement('SELECT * FROM connections WHERE user_id=? AND id=?', userId, id).first();
    if (!row) throw new AppError('NOT_FOUND', 'Connection not found.', 404);
    return row;
  }

  async list(userId) {
    return (await this.#statement('SELECT * FROM connections WHERE user_id=? ORDER BY created_at,id', userId).all()).results;
  }

  async complete(userId, id, channels, grant, now) {
    const result = await this.#statement("UPDATE connections SET status='select_channel',channels_json=?,grant_cipher=?,version=version+1,expires_at=? WHERE user_id=? AND id=? AND status='authorizing' AND expires_at>?", JSON.stringify(channels), grant, now + 600000, userId, id, now).run();
    if (result.meta.changes !== 1) throw new AppError('CONNECTION_CHANGED', 'The authorization is no longer active.', 409);
  }

  async select(userId, id, channelId, grant, version) {
    const result = await this.#statement("UPDATE connections SET status='connected',channel_id=?,grant_cipher=?,version=version+1,expires_at=NULL WHERE user_id=? AND id=? AND status='select_channel' AND version=?", channelId, grant, userId, id, version).run();
    if (result.meta.changes !== 1) throw new AppError('CONNECTION_CHANGED', 'The connection changed; retry with current state.', 409);
  }

  async snapshot(userId, id) {
    return (await this.#statement('SELECT payload FROM snapshots WHERE user_id=? AND connection_id=?', userId, id).first())?.payload ?? null;
  }

  async layout(userId, id) {
    return (await this.#statement('SELECT payload FROM layouts WHERE user_id=? AND connection_id=?', userId, id).first())?.payload ?? null;
  }

  async saveLayout(userId, id, payload) {
    const result = await this.#statement('INSERT INTO layouts(user_id,connection_id,payload) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE user_id=? AND id=?) ON CONFLICT(user_id,connection_id) DO UPDATE SET payload=excluded.payload', userId, id, payload, userId, id).run();
    if (result.meta.changes !== 1) throw new AppError('NOT_FOUND', 'Connection not found.', 404);
  }

  async remove(userId, id) {
    const row = await this.#statement('DELETE FROM connections WHERE user_id=? AND id=? RETURNING *', userId, id).first();
    if (!row) throw new AppError('NOT_FOUND', 'Connection not found.', 404);
    return row;
  }

  async acquire(userId, id, purpose, leaseId, now, ttl) {
    const row = await this.#statement("INSERT INTO leases(user_id,connection_id,purpose,id,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connections WHERE user_id=? AND id=? AND status='connected') ON CONFLICT(user_id,connection_id,purpose) DO UPDATE SET id=excluded.id,expires_at=excluded.expires_at WHERE leases.expires_at<=? RETURNING id", userId, id, purpose, leaseId, now + ttl, userId, id, now).first();
    if (!row) throw new AppError('OPERATION_BUSY', 'This connection is busy or no longer authorized.', 409);
    return leaseId;
  }

  async release(userId, id, purpose, leaseId) {
    await this.#statement('DELETE FROM leases WHERE user_id=? AND connection_id=? AND purpose=? AND id=?', userId, id, purpose, leaseId).run();
  }

  async replaceGrant(userId, id, version, grant, leaseId, now) {
    const result = await this.#statement("UPDATE connections SET grant_cipher=?,version=version+1 WHERE user_id=? AND id=? AND version=? AND status='connected' AND EXISTS(SELECT 1 FROM leases WHERE user_id=? AND connection_id=? AND purpose='grant' AND id=? AND expires_at>?)", grant, userId, id, version, userId, id, leaseId, now).run();
    if (result.meta.changes !== 1) throw new AppError('CONNECTION_CHANGED', 'The connection changed while refreshing authorization.', 409);
  }

  async markReauth(userId, id, version) {
    await this.#statement("UPDATE connections SET status='reauth_required',version=version+1 WHERE user_id=? AND id=? AND version=? AND status='connected'", userId, id, version).run();
  }

  async saveSnapshot(userId, id, channelId, payload, leaseId, now) {
    // Keep headroom below D1's 2 MB row limit, including UTF-8 and row metadata.
    if (new TextEncoder().encode(payload).byteLength > 1_800_000) throw new AppError('SNAPSHOT_LIMIT', 'The bounded snapshot is too large; previous data was preserved.', 409);
    const result = await this.#statement("INSERT INTO snapshots(user_id,connection_id,channel_id,payload,observed_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connections c JOIN leases l ON c.user_id=l.user_id AND c.id=l.connection_id WHERE c.user_id=? AND c.id=? AND c.channel_id=? AND c.status='connected' AND l.purpose='sync' AND l.id=? AND l.expires_at>?) ON CONFLICT(user_id,connection_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at", userId, id, channelId, payload, now, userId, id, channelId, leaseId, now).run();
    if (result.meta.changes !== 1) throw new AppError('CONNECTION_CHANGED', 'Synchronization expired or the connection was removed; data was not saved.', 409);
  }
}
