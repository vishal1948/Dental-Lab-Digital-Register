import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';
import { todayIST, prevMonth, isValidDate, isValidMonth } from '../lib/dates.js';
import { monthLabel } from '../lib/format.js';

const router = Router();
const cents = (v) => Math.round(Number(v) * 100);

const intParam = (v, label, status = 400) => {
  const n = Number(v);
  if (v === undefined || v === '' || !Number.isInteger(n) || n < 1 || n > 2147483647) {
    throw new HttpError(status, `${label} is invalid`);
  }
  return n;
};
const monthParam = (v) => {
  if (!isValidMonth(v)) throw new HttpError(400, 'Month is invalid (use YYYY-MM)');
  return v;
};

/*
 * What an invoice for (doctor, month) would contain:
 *   lines            = this doctor's UNBILLED cases that were DELIVERED (put on a delivery challan)
 *                      by the end of that month. Work still in the lab is not billed yet, and
 *                      anything delivered earlier but not yet billed is carried forward.
 *   previous balance = everything invoiced before - payments received before the month starts
 *   payments         = payments received during the month
 *   total balance    = previous + this bill - payments
 */
async function compute(db, doctorId, month, { lock = false } = {}) {
  const start = `${month}-01`;
  const { rows: cases } = await db.query(
    `SELECT c.id, c.total
       FROM cases c
       JOIN delivery_challans dc ON dc.id = c.delivery_challan_id
      WHERE c.doctor_id = $1 AND c.invoice_id IS NULL
        AND dc.challan_date < ($2::date + INTERVAL '1 month')
      ORDER BY dc.challan_date, c.case_date, c.sr_no ${lock ? 'FOR UPDATE OF c' : ''}`,
    [doctorId, start]
  );
  // this doctor's unbilled work that is NOT delivered yet (informational; billed after its challan)
  const { rows: [waiting] } = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM cases c LEFT JOIN delivery_challans dc ON dc.id = c.delivery_challan_id
      WHERE c.doctor_id = $1 AND c.invoice_id IS NULL
        AND (dc.id IS NULL OR dc.challan_date >= ($2::date + INTERVAL '1 month'))`,
    [doctorId, start]
  );
  const { rows: [m] } = await db.query(
    `SELECT
       (SELECT COALESCE(SUM(bill_total), 0) FROM invoices WHERE doctor_id = $1)
       - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE doctor_id = $1 AND paid_on < $2::date) AS previous_balance,
       (SELECT COALESCE(SUM(amount), 0) FROM payments
         WHERE doctor_id = $1 AND paid_on >= $2::date AND paid_on < ($2::date + INTERVAL '1 month')) AS payments_total,
       (SELECT COUNT(*)::int FROM payments
         WHERE doctor_id = $1 AND paid_on >= $2::date AND paid_on < ($2::date + INTERVAL '1 month')) AS payment_count`,
    [doctorId, start]
  );
  const prev = cents(m.previous_balance);
  const bill = cases.reduce((s, c) => s + cents(c.total), 0);
  const paid = cents(m.payments_total);
  return {
    ids: cases.map((c) => c.id),
    case_count: cases.length,
    waiting_count: waiting.n,
    previous_balance: prev / 100,
    bill_total: bill / 100,
    payments_total: paid / 100,
    payment_count: m.payment_count,
    total_balance: (prev + bill - paid) / 100,
  };
}

// Why an invoice can't be issued (null = it can)
async function problemFor(db, doctorId, month, d) {
  const { rows: [later] } = await db.query(
    `SELECT invoice_no, period_month FROM invoices
      WHERE doctor_id = $1 AND period_month >= $2::date
      ORDER BY period_month DESC LIMIT 1`,
    [doctorId, `${month}-01`]
  );
  if (later) {
    return later.period_month.slice(0, 7) === month
      ? `Invoice ${later.invoice_no} already exists for ${monthLabel(month)}.`
      : `Invoice ${later.invoice_no} for ${monthLabel(later.period_month)} already exists. Invoices go in month order, so cancel it first.`;
  }
  if (d.case_count === 0) {
    return `No delivered, unbilled cases for this doctor up to the end of ${monthLabel(month)}. Cases are billed once they are on a delivery challan.`;
  }
  return null;
}

// Preview the numbers before issuing (admin: it drives the "New invoice" dialog)
router.get('/api/invoices/preview', requireAdmin, async (req, res) => {
  const doctorId = intParam(req.query.doctor_id, 'Doctor');
  const month = monthParam(req.query.month);
  const { rows: [doctor] } = await pool.query('SELECT id, name FROM doctors WHERE id = $1', [doctorId]);
  if (!doctor) throw new HttpError(404, 'Doctor not found');
  const { ids, ...d } = await compute(pool, doctorId, month);
  const problem = await problemFor(pool, doctorId, month, d);
  res.json({ ...d, doctor: doctor.name, month, problem, can_issue: !problem });
});

router.post('/api/invoices', requireAdmin, async (req, res) => {
  const doctorId = intParam(req.body?.doctor_id, 'Doctor');
  const month = monthParam(req.body?.month);
  const invoice_date = req.body.invoice_date ? String(req.body.invoice_date) : todayIST();
  if (!isValidDate(invoice_date)) throw new HttpError(400, 'Invoice date is invalid');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // serialise invoicing per doctor, then lock the cases being billed
    const { rows: [doctor] } = await client.query('SELECT id FROM doctors WHERE id = $1 FOR UPDATE', [doctorId]);
    if (!doctor) throw new HttpError(404, 'Doctor not found');
    const d = await compute(client, doctorId, month, { lock: true });
    const problem = await problemFor(client, doctorId, month, d);
    if (problem) throw new HttpError(409, problem);

    const { rows: [inv] } = await client.query(
      `INSERT INTO invoices (doctor_id, period_month, invoice_date, previous_balance, bill_total,
                             payments_total, payment_count, total_balance, case_count)
       VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9)
       RETURNING id, invoice_no`,
      [doctorId, `${month}-01`, invoice_date, d.previous_balance, d.bill_total, d.payments_total,
       d.payment_count, d.total_balance, d.case_count]
    );
    await client.query('UPDATE cases SET invoice_id = $1 WHERE id = ANY($2::int[])', [inv.id, d.ids]);
    await client.query('COMMIT');
    res.status(201).json(inv);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Cancel: only a doctor's LATEST invoice, so balances stay consistent. The number is not reused.
router.delete('/api/invoices/:id', requireAdmin, async (req, res) => {
  const id = intParam(req.params.id, 'Invoice', 404);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [inv] } = await client.query(
      'SELECT id, doctor_id, period_month FROM invoices WHERE id = $1 FOR UPDATE', [id]);
    if (!inv) throw new HttpError(404, 'Invoice not found');
    const { rows: [newer] } = await client.query(
      'SELECT invoice_no FROM invoices WHERE doctor_id = $1 AND period_month > $2::date LIMIT 1',
      [inv.doctor_id, inv.period_month]
    );
    if (newer) {
      throw new HttpError(409, `Only a doctor's latest invoice can be cancelled. Cancel invoice ${newer.invoice_no} first.`);
    }
    await client.query('DELETE FROM invoices WHERE id = $1', [id]); // cases.invoice_id -> NULL
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Page: invoice list (optional doctor / billing-month filters)
router.get('/invoices', requireLogin, async (req, res) => {
  const doctorId = req.query.doctor_id ? intParam(req.query.doctor_id, 'Doctor') : null;
  const month = req.query.month ? monthParam(req.query.month) : '';
  const [{ rows: invoices }, { rows: doctors }] = await Promise.all([
    pool.query(
      `SELECT i.id, i.invoice_no, i.period_month, i.invoice_date, i.case_count, i.previous_balance,
              i.bill_total, i.payments_total, i.total_balance, d.name AS doctor
         FROM invoices i JOIN doctors d ON d.id = i.doctor_id
        WHERE ($1::int IS NULL OR i.doctor_id = $1)
          AND ($2::date IS NULL OR i.period_month = $2::date)
        ORDER BY i.period_month DESC, i.invoice_no DESC
        LIMIT 300`,
      [doctorId, month ? `${month}-01` : null]
    ),
    pool.query('SELECT id, name FROM doctors ORDER BY name'),
  ]);
  const today = todayIST();
  res.render('invoice-list', {
    user: req.session.user, active: 'invoices', invoices, doctors,
    doctorId, month, canEdit: req.session.user.role === 'admin',
    today, defaultMonth: prevMonth(today),
  });
});

// Page: one printable invoice
router.get('/invoices/:id', requireLogin, async (req, res) => {
  const id = intParam(req.params.id, 'Invoice', 404);
  const { rows: [invoice] } = await pool.query(
    `SELECT i.*, d.name AS doctor, d.clinic, d.phone
       FROM invoices i JOIN doctors d ON d.id = i.doctor_id WHERE i.id = $1`,
    [id]
  );
  if (!invoice) throw new HttpError(404, 'Invoice not found');
  const { rows: cases } = await pool.query(
    `SELECT c.sr_no, c.case_date, c.model_no, c.patient_name, c.teeth, c.qty, c.rate, c.total,
            w.name AS work_type, dc.challan_no
       FROM cases c
       LEFT JOIN work_types w ON w.id = c.work_type_id
       LEFT JOIN delivery_challans dc ON dc.id = c.delivery_challan_id
      WHERE c.invoice_id = $1
      ORDER BY dc.challan_date, c.case_date, c.sr_no`,
    [id]
  );
  res.render('invoice', { user: req.session.user, active: 'invoices', invoice, cases });
});

export default router;
