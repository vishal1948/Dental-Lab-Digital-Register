import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { todayIST, isValidDate, isValidMonth } from '../lib/dates.js';

const router = Router();

const intId = (v, label, required = true) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(400, `${label} is invalid`);
  return n;
};

// -> [paid_on, doctor_id, amount, note]
function clean(b = {}) {
  const paid_on = b.paid_on ? String(b.paid_on) : todayIST();
  if (!isValidDate(paid_on)) throw new HttpError(400, 'Date is invalid');
  const doctor_id = intId(b.doctor_id, 'Doctor');
  const amount = Number(b.amount);
  if (b.amount === undefined || b.amount === null || b.amount === '' || !Number.isFinite(amount) || amount <= 0 || amount > 9_999_999) {
    throw new HttpError(400, 'Amount must be greater than 0');
  }
  const note = b.note === undefined || b.note === null ? '' : String(b.note).trim();
  if (note.length > 200) throw new HttpError(400, 'Note is too long');
  return [paid_on, doctor_id, Math.round(amount * 100) / 100, note || null];
}

const mapPgError = (err) =>
  err.code === '23503' ? new HttpError(400, 'Selected doctor no longer exists') : err;

router.get('/payments', requireLogin, async (req, res) => {
  const { rows: doctors } = await pool.query('SELECT id, name FROM doctors ORDER BY name');
  const doctorId = req.query.doctor_id ? intId(req.query.doctor_id, 'Doctor') : null; // e.g. linked from Balances
  const cfg = { canEdit: req.session.user.role === 'admin', doctors, today: todayIST(), doctorId };
  res.render('payments', { user: req.session.user, active: 'payments', cfg });
});

router.get('/api/payments', requireLogin, async (req, res) => {
  const month = req.query.month ?? todayIST().slice(0, 7);
  if (!isValidMonth(month)) throw new HttpError(400, 'Month is invalid (use YYYY-MM)');
  const params = [`${month}-01`];
  let doctorFilter = '';
  if (req.query.doctor_id) {
    params.push(intId(req.query.doctor_id, 'Doctor'));
    doctorFilter = 'AND p.doctor_id = $2';
  }
  const { rows } = await pool.query(
    `SELECT p.id, p.paid_on, p.doctor_id, d.name AS doctor, p.amount, p.note
       FROM payments p JOIN doctors d ON d.id = p.doctor_id
      WHERE p.paid_on >= $1::date AND p.paid_on < ($1::date + INTERVAL '1 month') ${doctorFilter}
      ORDER BY p.paid_on DESC, p.id DESC`,
    params
  );
  res.json(rows);
});

router.post('/api/payments', requireAdmin, async (req, res) => {
  const v = clean(req.body);
  try {
    const { rows: [row] } = await pool.query(
      'INSERT INTO payments (paid_on, doctor_id, amount, note) VALUES ($1, $2, $3, $4) RETURNING id', v);
    res.status(201).json(row);
  } catch (err) {
    throw mapPgError(err);
  }
});

router.put('/api/payments/:id', requireAdmin, async (req, res) => {
  const id = intId(req.params.id, 'Id');
  const v = clean(req.body);
  try {
    const { rows: [row] } = await pool.query(
      'UPDATE payments SET paid_on = $1, doctor_id = $2, amount = $3, note = $4 WHERE id = $5 RETURNING id',
      [...v, id]
    );
    if (!row) throw new HttpError(404, 'Payment not found');
    res.json(row);
  } catch (err) {
    throw mapPgError(err);
  }
});

router.delete('/api/payments/:id', requireAdmin, async (req, res) => {
  const id = intId(req.params.id, 'Id');
  const { rows: [row] } = await pool.query('DELETE FROM payments WHERE id = $1 RETURNING id', [id]);
  if (!row) throw new HttpError(404, 'Payment not found');
  res.json({ ok: true });
});

export default router;
