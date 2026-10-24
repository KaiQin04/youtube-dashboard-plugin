import { randomString, sha256 } from './crypto.mjs';
import { AppError } from './errors.mjs';

const policies = {
  sync: { window: 900000, tenant: 5, channel: 5, service: 30 },
  report: { window: 60000, tenant: 20, channel: 20, service: 200 },
  request: { window: 900000, tenant: 1200, channel: 900, service: 6000 },
};

/** One atomic SQLite/D1 reservation; failures still spend budget, deletion never resets it. */
export function providerReservation({ userId, channelId = null, kind, now }) {
  const policy = policies[kind];
  if (!policy || typeof userId !== 'string' || !userId || !Number.isSafeInteger(now)) throw new AppError('CONFIGURATION', 'Provider budget is unavailable.', 503);
  const scopes = [[kind + ':service', policy.service], [kind + ':tenant:' + sha256(userId), policy.tenant]];
  if (channelId) scopes.push([kind + ':channel:' + sha256(channelId), policy.channel]);
  if (kind === 'sync') scopes.push(['sync:owner-channel:' + sha256(JSON.stringify([userId, channelId])), 1]);
  const id = randomString(), statements = [];
  const add = (sql, ...values) => statements.push({ sql, values });
  add('DELETE FROM provider_usage WHERE reset_at<=?', now);
  add('DELETE FROM provider_permits WHERE expires_at<=?', now);
  const guards = scopes.map(() => 'NOT EXISTS(SELECT 1 FROM provider_usage WHERE scope=? AND used>=? AND reset_at>?)');
  const active = kind === 'request' ? 1 : 0;
  if (active) guards.push('(SELECT COUNT(*) FROM provider_permits WHERE active=1)<12');
  add('INSERT INTO provider_permits(id,expires_at,active) SELECT ?,?,? WHERE ' + guards.join(' AND ') + ' RETURNING id', id, now + 30000, active, ...scopes.flatMap(([scope, limit]) => [scope, limit, now]));
  for (const [scope] of scopes) {
    add('INSERT INTO provider_usage(scope,used,reset_at) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM provider_permits WHERE id=?) ON CONFLICT(scope) DO UPDATE SET used=provider_usage.used+1', scope, now + policy.window, id);
  }
  if (!active) add('DELETE FROM provider_permits WHERE id=?', id);
  return { id, kind, retryAfterSeconds: policy.window / 1000, statements };
}

export function requireProviderReservation(reservation, results) {
  if (results[2]?.results?.[0]?.id === reservation.id) return reservation.id;
  const sync = reservation.kind === 'sync';
  const error = new AppError(sync ? 'REFRESH_COOLDOWN' : 'PROVIDER_BUDGET_EXCEEDED', sync
    ? 'Wait fifteen minutes between synchronization attempts, including failed attempts.'
    : 'The shared Google request budget is busy or exhausted. Retry after ' + reservation.retryAfterSeconds + ' seconds.', 429);
  error.retryAfterSeconds = reservation.retryAfterSeconds;
  throw error;
}

export const isProviderBudgetError = error => error instanceof AppError && ['PROVIDER_BUDGET_EXCEEDED', 'REFRESH_COOLDOWN'].includes(error.code);
