import { Router } from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../db.js';

const router = Router();

// Compared against when the username doesn't exist, so response time doesn't reveal valid usernames
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

const regenerate = (req) =>
  new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve()))
  );

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const body = req.body ?? {};
  const username = String(body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  const { rows: [user] } = await pool.query(
    'SELECT id, username, password_hash, role FROM users WHERE username = $1',
    [username]
  );

  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    return res.status(401).render('login', { error: 'Invalid username or password' });
  }

  await regenerate(req); // new session id on login (prevents session fixation)
  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect('/');
});

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.redirect('/login');
  });
});

export default router;
