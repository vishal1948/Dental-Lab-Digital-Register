import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { todayIST, isValidDate, isValidMonth } from '../lib/dates.js';
import { dmy } from '../lib/format.js';

const router = Router();

const parseId = (raw) => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(404, 'Challan not found');
  return n;
};

// POST /api/challans  { case_ids: [..], challan_date?: 'YYYY-MM-DD' }  -> issues ONE challan for those cases
router.post('/api/challans', requireAdmin, async (req, res) => {
  const ids = req.body?.case_ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200) {
    throw new HttpError(400, 'Select between 1 and 200 cases');
  }
  const caseIds = [...new Set(ids.map(Number))];
  if (caseIds.some((n) => !Number.isInteger(n) || n < 1 || n > 2147483647)) {
    throw new HttpError(400, 'Case selection is invalid');
  }
  const challan_date = req.body.challan_date ? String(req.body.challan_date) : todayIST();
  if (!isValidDate(challan_date)) throw new HttpError(400, 'Challan date is invalid');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // lock the rows so two people can't put the same case on two challans
    const { rows } = await client.query(
      'SELECT id, doctor_id, case_date, delivery_challan_id FROM cases WHERE id = ANY($1::int[]) FOR UPDATE',
      [caseIds]
    );
    if (rows.length !== caseIds.length) throw new HttpError(404, 'Some selected cases no longer exist');
    if (rows.some((r) => r.delivery_challan_id !== null)) {
      throw new HttpError(409, 'Some selected cases are already on a delivery challan');
    }
    if (new Set(rows.map((r) => r.doctor_id)).size !== 1) {
      throw new HttpError(400, 'A challan can only include cases of one doctor');
    }
    const latest = rows.map((r) => r.case_date).sort().at(-1);
    if (challan_date < latest) {
      throw new HttpError(400, `Challan date cannot be before the latest case date (${dmy(latest)})`);
    }

    const { rows: [challan] } = await client.query(
      'INSERT INTO delivery_challans (challan_date, doctor_id) VALUES ($1, $2) RETURNING id, challan_no',
      [challan_date, rows[0].doctor_id]
    );
    await client.query(
      `UPDATE cases
          SET delivery_challan_id = $1, delivery_date = COALESCE(delivery_date, $2::date)
        WHERE id = ANY($3::int[])`,
      [challan.id, challan_date, caseIds]
    );
    await client.query('COMMIT');
    res.status(201).json(challan);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// DELETE /api/challans/:id  -> cancel: cases are released; the number is NOT reused
router.delete('/api/challans/:id', requireAdmin, async (req, res) => {
  const id = parseId(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [challan] } = await client.query(
      'SELECT id, challan_date FROM delivery_challans WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (!challan) throw new HttpError(404, 'Challan not found');
    const { rows: [billed] } = await client.query(
      `SELECT i.invoice_no FROM cases c JOIN invoices i ON i.id = c.invoice_id
        WHERE c.delivery_challan_id = $1 LIMIT 1`,
      [id]
    );
    if (billed) {
      throw new HttpError(409, `Cases on this challan are already billed on invoice ${billed.invoice_no}. Cancel the invoice first.`);
    }
    // undo the delivery date we auto-set at issue time (a date typed by hand to something else is kept)
    await client.query(
      'UPDATE cases SET delivery_date = NULL WHERE delivery_challan_id = $1 AND delivery_date = $2::date',
      [id, challan.challan_date]
    );
    await client.query('DELETE FROM delivery_challans WHERE id = $1', [id]); // cases.delivery_challan_id -> NULL
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Page: challans of a month
router.get('/challans', requireLogin, async (req, res) => {
  const month = req.query.month ?? todayIST().slice(0, 7);
  if (!isValidMonth(month)) throw new HttpError(400, 'Month is invalid (use YYYY-MM)');
  const { rows } = await pool.query(
    `SELECT dc.id, dc.challan_no, dc.challan_date, d.name AS doctor,
            COUNT(c.id)::int AS cases, COALESCE(SUM(c.total), 0) AS total
       FROM delivery_challans dc
       JOIN doctors d ON d.id = dc.doctor_id
       LEFT JOIN cases c ON c.delivery_challan_id = dc.id
      WHERE dc.challan_date >= $1::date AND dc.challan_date < ($1::date + INTERVAL '1 month')
      GROUP BY dc.id, d.name
      ORDER BY dc.challan_no DESC`,
    [`${month}-01`]
  );
  res.render('challan-list', { user: req.session.user, active: 'challans', month, challans: rows });
});

// Page: one printable challan
router.get('/challans/:id', requireLogin, async (req, res) => {
  const id = parseId(req.params.id);
  const { rows: [challan] } = await pool.query(
    `SELECT dc.id, dc.challan_no, dc.challan_date, d.name AS doctor, d.clinic, d.phone
       FROM delivery_challans dc JOIN doctors d ON d.id = dc.doctor_id
      WHERE dc.id = $1`,
    [id]
  );
  if (!challan) throw new HttpError(404, 'Challan not found');

  const { rows: cases } = await pool.query(
    `SELECT c.sr_no, c.case_date, c.model_no, c.patient_name, c.teeth, c.qty, c.rate, c.total,
            w.name AS work_type
       FROM cases c LEFT JOIN work_types w ON w.id = c.work_type_id
      WHERE c.delivery_challan_id = $1
      ORDER BY c.case_date, c.sr_no`,
    [id]
  );
  const totalCents = cases.reduce((s, c) => s + Math.round(Number(c.total) * 100), 0);
  const totalQty = cases.reduce((s, c) => s + c.qty, 0);
  res.render('challan', {
    user: req.session.user, active: 'challans', challan, cases, total: totalCents / 100, totalQty,
  });
});

export default router;
