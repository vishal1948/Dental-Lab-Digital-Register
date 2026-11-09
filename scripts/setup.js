// Creates .env (with a generated SESSION_SECRET) and .gitignore if they don't exist.
// Usage: npm run setup            -> then paste your Neon URL into .env
//        node scripts/setup.js "<neon pooled url>"
import fs from 'node:fs';
import crypto from 'node:crypto';

const root = new URL('../', import.meta.url);
const envPath = new URL('.env', root);
const gitignorePath = new URL('.gitignore', root);
const dbUrl = process.argv[2] ?? 'PASTE_YOUR_NEON_POOLED_URL_HERE';

if (fs.existsSync(envPath)) {
  console.log('.env already exists - left unchanged');
} else {
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(envPath, `DATABASE_URL=${dbUrl}\nSESSION_SECRET=${secret}\nPORT=3000\n`);
  console.log('.env created. Open it and paste your Neon DATABASE_URL.');
}

if (!fs.existsSync(gitignorePath)) {
  fs.writeFileSync(gitignorePath, 'node_modules\n.env\n');
  console.log('.gitignore created');
}
