// Continue your paper numbering. Examples:
//   node scripts/set-next-number.js sr 292        -> the next case gets Sr. No. 292
//   node scripts/set-next-number.js challan 230   -> the next delivery challan is No. 230
//   node scripts/set-next-number.js invoice 120   -> the next invoice is No. 120
import 'dotenv/config';
import { pool } from '../src/db.js';

const TARGETS = {
  sr: { seq: 'sr_seq', table: 'cases', col: 'sr_no', label: 'Sr. No.' },
  challan: { seq: 'delivery_challan_seq', table: 'delivery_challans', col: 'challan_no', label: 'Delivery challan no.' },
  invoice: { seq: 'invoice_seq', table: 'invoices', col: 'invoice_no', label: 'Invoice no.' },
};

async function main() {
  const [what, raw] = process.argv.slice(2);
  const t = TARGETS[what];
  const n = Number(raw);
  if (!t || !Number.isInteger(n) || n < 1) {
    console.error('Usage: node scripts/set-next-number.js <sr|challan|invoice> <next number>');
    process.exitCode = 1;
    return;
  }
  // table/column names come from the constant above, never from user input
  const { rows: [r] } = await pool.query(`SELECT COALESCE(MAX(${t.col}), 0) AS max FROM ${t.table}`);
  if (n <= Number(r.max)) {
    console.error(`${t.label} ${n} would clash: the highest in use is ${r.max}. Use ${Number(r.max) + 1} or higher.`);
    process.exitCode = 1;
    return;
  }
  await pool.query('SELECT setval($1::regclass, $2, false)', [t.seq, n]);
  console.log(`Next ${t.label} will be ${n}`);
}

await main();
await pool.end();
