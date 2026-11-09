import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { cleanTeeth } from '../lib/teeth.js';
import { todayIST, isValidDate, isValidMonth } from '../lib/dates.js';

const router = Router();
const MAX_TOTAL = 99_999_999.99; // NUMERIC(10,2)

const text = (v, label, { max = 200, required = false } = {}) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  if (s.length > max) throw new HttpError(400, `${label} is too long`);
  return s;
};

const intId = (v, label, required = false) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${label} is required`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw new HttpError(400, `${label} is invalid`);
  return n;
};

const amount = (v, label) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999) throw new HttpError(400, `${label} must be a valid amount`);
  return Math.round(n * 100) / 100;
};

async function cleanCase(b = {}) {
  const case_date = b.case_date ? String(b.case_date) : todayIST();
  if (!isValidDate(case_date)) throw new HttpError(400, 'Date is invalid');

  const delivery_date = text(b.delivery_date, 'Delivery date', { max: 10 });
  if (delivery_date) {
    if (!isValidDate(delivery_date)) throw new HttpError(400, 'Delivery date is invalid');
    if (delivery_date < case_date) throw new HttpError(400, 'Delivery date cannot be before the case date');
  }

  const doctor_id = intId(b.doctor_id, 'Doctor', true);
  const work_type_id = intId(b.work_type_id, 'Work type');
  const patient_name = text(b.patient_name, 'Patient name', { required: true });
  const model_no = text(b.model_no, 'Model no', { max: 50 });
  const notes = text(b.notes, 'Notes', { max: 1000 });
  const teeth = cleanTeeth(b.teeth ?? {});

  const qty = b.qty === undefined || b.qty === null || b.qty === '' ? 1 : Number(b.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 999) throw new HttpError(400, 'Quantity must be between 1 and 999');

  let rate = amount(b.rate, 'Rate');
  if (rate === null && work_type_id) {
    // doctor's own rate first, then the work type's default
    const { rows: [w] } = await pool.query(
      `SELECT COALESCE(dr.rate, w.default_rate) AS rate
         FROM work_types w
         LEFT JOIN doctor_rates dr ON dr.work_type_id = w.id AND dr.doctor_id = $1
        WHERE w.id = $2`,
      [doctor_id, work_type_id]
    );
    if (w) rate = Number(w.rate);
  }
  if (rate === null) throw new HttpError(400, 'Rate is required');
  if (qty * rate > MAX_TOTAL) throw new HttpError(400, 'Total amount is too large');

  return { case_date, doctor_id, patient_name, model_no, teeth, work_type_id, qty, rate, delivery_date, notes };
}

const values = (c) => [
  c.case_date, c.doctor_id, c.patient_name, c.model_no, JSON.stringify(c.teeth),
  c.work_type_id, c.qty, c.rate, c.delivery_date, c.notes,
];

const mapPgError = (err) =>
  err.code === '23503' ? new HttpError(400, 'Selected doctor or work type no longer exists') : err;

// GET /api/cases?month=2026-11[&doctor_id=3]  -> one month of the register
router.get('/', requireLogin, async (req, res) => {
  const month = req.query.month ?? todayIST().slice(0, 7);
  if (!isValidMonth(month)) throw new HttpError(400, 'Month is invalid (use YYYY-MM)');

  const params = [`${month}-01`];
  let doctorFilter = '';
  if (req.query.doctor_id) {
    params.push(intId(req.query.doctor_id, 'Doctor'));
    doctorFilter = 'AND c.doctor_id = $2';
  }

  const { rows } = await pool.query(
    `SELECT c.id, c.sr_no, c.case_date, c.delivery_date, c.model_no, c.teeth,
            c.qty, c.rate, c.total, c.notes, c.patient_name,
            c.doctor_id, d.name AS doctor, c.work_type_id, w.name AS work_type,
            c.delivery_challan_id, dc.challan_no AS delivery_challan_no, dc.challan_date AS delivery_challan_date,
            c.invoice_id, inv.invoice_no
       FROM cases c
       JOIN doctors d ON d.id = c.doctor_id
       LEFT JOIN work_types w ON w.id = c.work_type_id
       LEFT JOIN delivery_challans dc ON dc.id = c.delivery_challan_id
       LEFT JOIN invoices inv ON inv.id = c.invoice_id
      WHERE c.case_date >= $1::date
        AND c.case_date <  ($1::date + INTERVAL '1 month')
        ${doctorFilter}
      ORDER BY c.case_date, c.sr_no`,
    params
  );
  res.json(rows);
});

router.post('/', requireAdmin, async (req, res) => {
  const c = await cleanCase(req.body);
  try {
    const { rows: [row] } = await pool.query(
      `INSERT INTO cases (case_date, doctor_id, patient_name, model_no, teeth,
                          work_type_id, qty, rate, delivery_date, notes)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
       RETURNING id, sr_no`,
      values(c)
    );
    res.status(201).json(row);
  } catch (err) {
    throw mapPgError(err);
  }
});

router.put('/:id', requireAdmin, async (req, res) => {
  const id = intId(req.params.id, 'Id', true);
  const c = await cleanCase(req.body);

  const { rows: [cur] } = await pool.query(
    `SELECT c.doctor_id, c.case_date, c.work_type_id, c.qty, c.rate, c.delivery_challan_id, c.invoice_id, i.invoice_no
       FROM cases c LEFT JOIN invoices i ON i.id = c.invoice_id WHERE c.id = $1`,
    [id]
  );
  if (!cur) throw new HttpError(404, 'Case not found');
  if (cur.invoice_id) {
    // once billed, what the doctor is charged must not change under the issued invoice
    const same = c.case_date === cur.case_date && c.doctor_id === cur.doctor_id
      && (c.work_type_id ?? null) === (cur.work_type_id ?? null) && c.qty === cur.qty
      && Number(c.rate) === Number(cur.rate);
    if (!same) {
      throw new HttpError(400, `This case is on invoice ${cur.invoice_no}, so its date, doctor, work type, quantity and rate are locked. Cancel the invoice first.`);
    }
  }
  if (cur.delivery_challan_id && cur.doctor_id !== c.doctor_id) {
    throw new HttpError(400, 'This case is on a delivery challan, so its doctor cannot be changed. Cancel the challan first.');
  }

  try {
    const { rows: [row] } = await pool.query(
      `UPDATE cases
          SET case_date = $1, doctor_id = $2, patient_name = $3, model_no = $4, teeth = $5::jsonb,
              work_type_id = $6, qty = $7, rate = $8, delivery_date = $9, notes = $10
        WHERE id = $11
        RETURNING id, sr_no`,
      [...values(c), id]
    );
    if (!row) throw new HttpError(404, 'Case not found');
    res.json(row);
  } catch (err) {
    throw mapPgError(err);
  }
});

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = intId(req.params.id, 'Id', true);
  const { rows: [row] } = await pool.query(
    'DELETE FROM cases WHERE id = $1 AND delivery_challan_id IS NULL AND invoice_id IS NULL RETURNING id',
    [id]
  );
  if (!row) {
    const { rows: [cur] } = await pool.query('SELECT delivery_challan_id, invoice_id FROM cases WHERE id = $1', [id]);
    if (!cur) throw new HttpError(404, 'Case not found');
    throw new HttpError(409, cur.invoice_id
      ? 'This case is on an invoice. Cancel the invoice first.'
      : 'This case is on a delivery challan. Cancel the challan first.');
  }
  res.json({ ok: true });
});

export default router;
