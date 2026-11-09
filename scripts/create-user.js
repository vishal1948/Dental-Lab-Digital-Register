import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from '../src/db.js';

const [username, password, role = 'viewer'] = process.argv.slice(2);

if (!username || !password || !['admin', 'viewer'].includes(role)) {
  console.error('Usage: node scripts/create-user.js <username> <password> [admin|viewer]');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const name = username.trim().toLowerCase();

// Upsert: running again with the same username resets the password/role
await pool.query(
  `INSERT INTO users (username, password_hash, role)
   VALUES ($1, $2, $3)
   ON CONFLICT (username)
   DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role`,
  [name, hash, role]
);

console.log(`User "${name}" saved as ${role}`);
await pool.end();
