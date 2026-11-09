import 'dotenv/config';
import fs from 'node:fs/promises';
import { pool } from '../src/db.js';

const dir = new URL('../sql/migrations/', import.meta.url);
const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
const { rows } = await pool.query('SELECT name FROM schema_migrations');
const done = new Set(rows.map((r) => r.name));

let applied = 0;
for (const file of files) {
  if (done.has(file)) continue;
  const sql = await fs.readFile(new URL(file, dir), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`Applied ${file}`);
    applied++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`FAILED ${file}: ${err.message}`);
    process.exitCode = 1;
    break;
  } finally {
    client.release();
  }
}
if (!process.exitCode) console.log(applied ? 'Migrations complete' : 'Already up to date');
await pool.end();
