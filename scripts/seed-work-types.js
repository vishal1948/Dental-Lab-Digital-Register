// Adds the work types from the lab's paper delivery note, with DEMO default prices (₹ per unit).
// Safe to re-run: existing work types are skipped and their prices are never overwritten.
// Replace the demo prices with real ones on the Work types page.
import 'dotenv/config';
import { pool } from '../src/db.js';

const WORK_TYPES = [
  // Metal free - Zirconia
  ['Zircodont Layering', 3500],
  ['Zircodont Monolith', 3000],
  // Metal free - Press technique
  ['IPS E-Max', 4500],
  // PFM
  ['IPS Classic', 1200],
  ['IPS d.SIGN', 1400],
  ['PFM CAD/CAM', 1300],
  ['DMLS PFM', 1100],
  ['PFM Facing', 900],
  // Removable denture
  ['Flexible Denture', 8000],
  ['Denture', 4000],
  // Full metal
  ['Full Metal', 600],
  ['Ceramic Metal', 1000],
];

const { rows } = await pool.query(
  `INSERT INTO work_types (name, default_rate)
   SELECT * FROM unnest($1::text[], $2::numeric[])
   ON CONFLICT (name) DO NOTHING
   RETURNING name`,
  [WORK_TYPES.map(([name]) => name), WORK_TYPES.map(([, rate]) => rate)]
);

console.log(`Added ${rows.length} work type(s); skipped ${WORK_TYPES.length - rows.length} that already existed (prices untouched).`);
await pool.end();
