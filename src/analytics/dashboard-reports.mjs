import { AppError } from '../errors.mjs';
import { assertDate, dateSequence } from './contracts.mjs';
import { REPORTS } from '../dashboard-catalog.mjs';
import { isProviderBudgetError } from '../provider-budget.mjs';

const fail = () => new AppError('INVALID_UPSTREAM_DATA', 'Invalid supplemental analytics report.', 502);
function parse(report, fields, maxRows) {
  const columns = report?.columnHeaders?.map(column => column?.name);
  if (!Array.isArray(columns) || columns.some(column => typeof column !== 'string') || new Set(columns).size !== columns.length || fields.some(field => !columns.includes(field))) throw fail();
  const rows = report.rows ?? [];
  if (!Array.isArray(rows) || rows.length > maxRows || rows.some(row => !Array.isArray(row) || row.length !== columns.length)) throw fail();
  return rows.map(row => Object.fromEntries(fields.map(field => [field, row[columns.indexOf(field)]])));
}
function numeric(value, fractional = false) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || (!fractional && !Number.isSafeInteger(value))) throw fail();
  return value;
}
/** Five fixed reports, sequential and bounded; optional failures never masquerade as zero. */
export async function readDashboardReports(get, { channelId, startDate, endDate }) {
  const dates = dateSequence(startDate, endDate);
  if (!dates.length || dates.length > 31) throw new AppError('INVALID_RANGE', 'Supplemental reports require one to thirty-one days.');
  const output = {}, base = { requestedStartDate: startDate, requestedEndDate: endDate, source: 'YouTube Analytics API', availableThrough: null };
  for (const definition of [{ id: 'engagement', dimension: 'day' }, ...REPORTS]) {
    const daily = definition.id === 'engagement';
    const fields = daily ? ['day', 'likes', 'comments', 'shares'] : [definition.dimension, 'views', 'estimatedMinutesWatched'];
    try {
      const response = await get({ ids: `channel==${channelId}`, startDate, endDate, dimensions: definition.dimension,
        metrics: fields.slice(1).join(','), sort: daily ? 'day' : '-views', maxResults: daily ? 31 : 21 });
      const rows = parse(response, fields, daily ? 31 : 21), seen = new Set();
      const sanitized = rows.map(row => {
        const label = row[fields[0]];
        if (typeof label !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(label) || seen.has(label)) throw fail();
        seen.add(label);
        if (daily) { assertDate(label); if (label < startDate || label > endDate) throw fail();
          return { date: label, likes: numeric(row.likes), comments: numeric(row.comments), shares: numeric(row.shares) }; }
        return { label, views: numeric(row.views), watchMinutes: numeric(row.estimatedMinutesWatched, true) };
      });
      if (daily) sanitized.sort((a, b) => a.date.localeCompare(b.date));
      output[definition.id] = { ...base, status: !rows.length ? 'empty' : daily && rows.length < dates.length ? 'partial' : 'available',
        rows: sanitized.slice(0, daily ? 31 : 20), availableThrough: daily ? sanitized.at(-1)?.date ?? null : null,
        rowLimit: daily ? 31 : 20, truncated: !daily && rows.length > 20,
        coverageNote: daily ? 'Missing days and null values remain unknown.' : 'Top twenty API-returned categories; privacy thresholds, omitted categories and provider lag may affect coverage. Requested end is not an observed watermark.' };
    } catch (error) {
      if (isProviderBudgetError(error) || error instanceof AppError && ['REAUTH_REQUIRED', 'CONNECTION_CHANGED', 'SYNC_BUDGET_EXCEEDED'].includes(error.code)) throw error;
      output[definition.id] = { ...base, status: 'unavailable', rows: [], code: 'REPORT_UNAVAILABLE', rowLimit: daily ? 31 : 20, truncated: false };
    }
  }
  return output;
}
