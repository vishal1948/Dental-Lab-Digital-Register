import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin } from '../middleware/auth.js';

const router = Router();
const cents = (v) => Math.round(Number(v) * 100);

// One line per doctor: what has been invoiced, what has been received, what is still owed,
// plus work that is delivered-but-not-invoiced and work still in the lab.
router.get('/balances', requireLogin, async (req, res) => {
  const onlyDue = req.query.only === 'due';
  const { rows } = await pool.query(
    `SELECT d.id, d.name,
            COALESCE(inv.invoiced, 0) AS invoiced,
            COALESCE(pay.received, 0) AS received,
            COALESCE(inv.invoiced, 0) - COALESCE(pay.received, 0) AS balance,
            COALESCE(cs.delivered_unbilled, 0) AS delivered_unbilled,
            COALESCE(cs.pending, 0) AS pending,
            inv.last_invoice, pay.last_payment
       FROM doctors d
       LEFT JOIN (SELECT doctor_id, SUM(bill_total) AS invoiced, MAX(period_month) AS last_invoice
                    FROM invoices GROUP BY doctor_id) inv ON inv.doctor_id = d.id
       LEFT JOIN (SELECT doctor_id, SUM(amount) AS received, MAX(paid_on) AS last_payment
                    FROM payments GROUP BY doctor_id) pay ON pay.doctor_id = d.id
       LEFT JOIN (SELECT doctor_id,
                         SUM(total) FILTER (WHERE invoice_id IS NULL AND delivery_challan_id IS NOT NULL) AS delivered_unbilled,
                         SUM(total) FILTER (WHERE invoice_id IS NULL AND delivery_challan_id IS NULL) AS pending
                    FROM cases GROUP BY doctor_id) cs ON cs.doctor_id = d.id
      ORDER BY (COALESCE(inv.invoiced, 0) - COALESCE(pay.received, 0)) DESC, d.name`
  );
  const list = onlyDue ? rows.filter((r) => cents(r.balance) > 0) : rows;
  const sum = (k) => list.reduce((s, r) => s + cents(r[k]), 0) / 100;
  res.render('balances', {
    user: req.session.user, active: 'balances', rows: list, onlyDue,
    totals: {
      invoiced: sum('invoiced'), received: sum('received'), balance: sum('balance'),
      delivered_unbilled: sum('delivered_unbilled'), pending: sum('pending'),
    },
  });
});

export default router;
