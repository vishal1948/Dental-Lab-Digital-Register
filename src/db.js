import 'dotenv/config';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || url.startsWith('PASTE_')) {
  throw new Error('DATABASE_URL is not set in .env (run "npm run setup", then paste your Neon URL)');
}

// Keep DATE columns as plain 'YYYY-MM-DD' strings. The default parser makes JS Dates,
// which shift by a day when serialized in a non-UTC timezone (e.g. IST).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: url,
  max: 5,
  idleTimeoutMillis: 30000,
});

// Neon drops idle connections; without this handler the process would crash
pool.on('error', (err) => {
  console.error('Idle DB client error:', err.message);
});
