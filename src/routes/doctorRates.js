import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

// Mounted at /api/doctors/:id/rates
const router = Router({ mergeParams: true });

const parseId = (raw, label = 'Id') => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(400, `${label} is invalid`);
  return n;
};

// Every work type, with the default rate and this doctor's override (rate = null means "use default")
router.get('/', requireLogin, async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [doctor] } = await pool.query('SELECT id, name FROM doctors WHERE id = $1', [id]);
  if (!doctor) throw new HttpError(404, 'Doctor not found');

  const { rows } = await pool.query(
    `SELECT w.id AS work_type_id, w.name, w.default_rate, dr.rate
       FROM work_types w
       LEFT JOIN doctor_rates dr ON dr.work_type_id = w.id AND dr.doctor_id = $1
      ORDER BY w.name`,
    [id]
  );
  res.json({ doctor, rates: rows });
});

// Body: { rates: [{ work_type_id, rate }] }  — blank rate removes the override. All-or-nothing.
router.put('/', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const list = req.body?.rates;
  if (!Array.isArray(list) || list.length > 500) throw new HttpError(400, 'Rates list is invalid');

  const setIds = [];
  const setRates = [];
  const clearIds = [];
  const seen = new Set();
  for (const item of list) {
    const wt = parseId(item?.work_type_id, 'Work type');
    if (seen.has(wt)) throw new HttpError(400, 'Duplicate work type in rates list');
    seen.add(wt);

    const raw = item.rate;
    if (raw === '' || raw === null || raw === undefined) {
      clearIds.push(wt);
      continue;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 9_999_999) throw new HttpError(400, 'Rate must be a valid amount');
    setIds.push(wt);
    setRates.push(Math.round(n * 100) / 100);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [doctor] } = await client.query('SELECT id FROM doctors WHERE id = $1', [id]);
    if (!doctor) throw new HttpError(404, 'Doctor not found');

    if (clearIds.length) {
      await client.query(
        'DELETE FROM doctor_rates WHERE doctor_id = $1 AND work_type_id = ANY($2::int[])',
        [id, clearIds]
      );
    }
    if (setIds.length) {
      await client.query(
        `INSERT INTO doctor_rates (doctor_id, work_type_id, rate)
         SELECT $1, t.wt, t.rate FROM unnest($2::int[], $3::numeric[]) AS t(wt, rate)
         ON CONFLICT (doctor_id, work_type_id)
         DO UPDATE SET rate = EXCLUDED.rate, updated_at = now()`,
        [id, setIds, setRates]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, set: setIds.length, cleared: clearIds.length });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err.code === '23503' ? new HttpError(400, 'A selected work type no longer exists') : err;
  } finally {
    client.release();
  }
});

export default router;
