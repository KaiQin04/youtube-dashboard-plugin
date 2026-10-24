import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile } from 'node:fs/promises';

/** Async D1 binding shape backed by SQLite, using the generated migrations. */
export async function migratedD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../sites/drizzle/', import.meta.url);
  const migrations = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
  assert.ok(migrations.length > 0, 'D1 schema migrations must exist');
  for (const file of migrations) sqlite.exec(await readFile(new URL(file, directory), 'utf8'));
  const execute = (sql, bindings) => {
    const results = sqlite.prepare(sql).all(...bindings);
    return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() AS n').get().n } };
  };
  const prepare = (sql, bindings = []) => {
    assert.doesNotMatch(sql, /\b(?:CREATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|PRAGMA)\b/i, 'Runtime D1 operations must use pre-migrated schema and binding batches');
    return {
      bind(...values) { return prepare(sql, values); },
      async all() { await Promise.resolve(); return execute(sql, bindings); },
      async run() { await Promise.resolve(); return execute(sql, bindings); },
      async first() { await Promise.resolve(); return execute(sql, bindings).results[0] ?? null; },
      execute() { return execute(sql, bindings); },
    };
  };
  return {
    prepare,
    async batch(statements) {
      await Promise.resolve();
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => statement.execute());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    close() { sqlite.close(); },
  };
}
