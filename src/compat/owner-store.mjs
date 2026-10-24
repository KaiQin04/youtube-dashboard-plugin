import {AppError,randomString} from './security.mjs';
import {normalizeSnapshot} from '../analytics/contracts.mjs';
import {normalizeCoverage} from '../analytics/storage.mjs';
/** All statements are fixed SQL. Tables are installed by deployment migrations, never request handlers. */
export class D1Store {
 constructor(db,{now=()=>Date.now()}={}) { if(!db?.prepare)throw new AppError('STORAGE_NOT_CONFIGURED','Durable database binding is unavailable.',503);this.db=db;this.now=now; }
 async putState({stateHash,ownerId,channelId,browserHash,encryptedPayload,expiresAt}) { await this.db.prepare('INSERT INTO analytics_oauth_states(state_hash,owner_id,channel_id,browser_hash,encrypted_payload,expires_at) VALUES(?,?,?,?,?,?)').bind(stateHash,ownerId,channelId,browserHash,encryptedPayload,expiresAt).run(); }
 async consumeState(stateHash) { return this.db.prepare('DELETE FROM analytics_oauth_states WHERE state_hash=? RETURNING owner_id,channel_id,browser_hash,encrypted_payload,expires_at').bind(stateHash).first(); }
 async saveGrant(ownerId,channelId,encryptedPayload) { await this.db.prepare('INSERT INTO analytics_grants(owner_id,channel_id,encrypted_payload,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,channel_id) DO UPDATE SET encrypted_payload=excluded.encrypted_payload,updated_at=excluded.updated_at').bind(ownerId,channelId,encryptedPayload,this.now()).run(); }
 async readGrant(ownerId,channelId) { const row=await this.db.prepare('SELECT encrypted_payload FROM analytics_grants WHERE owner_id=? AND channel_id=?').bind(ownerId,channelId).first();return row?.encrypted_payload??null; }
 async readSnapshot(ownerId,channelId) {const row=await this.db.prepare('SELECT snapshot_json FROM analytics_snapshots WHERE owner_id=? AND channel_id=?').bind(ownerId,channelId).first();return row?JSON.parse(row.snapshot_json):null;}
 async saveSnapshot(ownerId,channelId,snapshot,lockId) {
  if(snapshot?.mode!=='real'||snapshot?.channel?.id!==channelId)throw new AppError('SNAPSHOT_BINDING','Only real data for the bound channel can be stored.');
  if(typeof lockId!=='string'||!lockId)throw new AppError('SYNC_LOCK_REQUIRED','A current synchronization lock is required.',409);
  const now=this.now();
  const normalized=normalizeSnapshot(snapshot,{now:new Date(now)});
  const coverage=normalizeCoverage(snapshot.coverage);if(coverage)normalized.coverage=coverage;
  const payload=JSON.stringify(normalized);
  if(new TextEncoder().encode(payload).byteLength>1_800_000)throw new AppError('SNAPSHOT_TOO_LARGE','The complete snapshot exceeds storage capacity; previous data was preserved.',409);
  const result=await this.db.prepare('INSERT INTO analytics_snapshots(owner_id,channel_id,snapshot_json,observed_at) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM analytics_sync_locks WHERE owner_id=? AND channel_id=? AND lock_id=? AND expires_at>?) ON CONFLICT(owner_id,channel_id) DO UPDATE SET snapshot_json=excluded.snapshot_json,observed_at=excluded.observed_at').bind(ownerId,channelId,payload,now,ownerId,channelId,lockId,now).run();
  if((result.meta?.changes??result.changes)!==1)throw new AppError('SYNC_LOCK_EXPIRED','Synchronization lock expired; existing data was preserved.',409);
  return normalized;
 }

 async acquireLock(ownerId,channelId,ttlMs=120000) {if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>600000)throw new AppError('INVALID_LOCK_TTL','Lock duration is out of bounds.');const now=this.now(),id=randomString();const row=await this.db.prepare('INSERT INTO analytics_sync_locks(owner_id,channel_id,lock_id,expires_at) VALUES(?,?,?,?) ON CONFLICT(owner_id,channel_id) DO UPDATE SET lock_id=excluded.lock_id,expires_at=excluded.expires_at WHERE analytics_sync_locks.expires_at<=? RETURNING lock_id').bind(ownerId,channelId,id,now+ttlMs,now).first();if(row?.lock_id!==id)throw new AppError('SYNC_IN_PROGRESS','Another synchronization is running.',409);return id;}
 async releaseLock(ownerId,channelId,lockId) {await this.db.prepare('DELETE FROM analytics_sync_locks WHERE owner_id=? AND channel_id=? AND lock_id=?').bind(ownerId,channelId,lockId).run();}
}
