const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// This scaffold uses SQLite as the default embedded database so the
// project runs with zero external setup. The schema below is written
// in a Postgres-compatible style (explicit types, TEXT for UUIDs,
// ISO timestamps) so migrating to real PostgreSQL means:
//   1. Provide a Postgres DATABASE_URL
//   2. Swap this file for a `pg` Pool-based adapter with the same
//      exported `db` query helpers (get/all/run)
//   3. Run database/schema.sql (Postgres DDL) instead of schema.js
// No business logic elsewhere depends on SQLite-specific behavior.

const dbPath = config.databaseUrl.startsWith('postgres')
  ? (() => { throw new Error('DATABASE_URL points to Postgres, but this scaffold ships the SQLite adapter. See README "Migrating to PostgreSQL".'); })()
  : config.databaseUrl;

const resolvedPath = path.resolve(__dirname, '../../', dbPath);
fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });

const sqlite = new Database(resolvedPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

module.exports = {
  raw: sqlite,
  get: (sql, params = []) => sqlite.prepare(sql).get(...params),
  all: (sql, params = []) => sqlite.prepare(sql).all(...params),
  run: (sql, params = []) => sqlite.prepare(sql).run(...params),
  transaction: (fn) => sqlite.transaction(fn),
};
