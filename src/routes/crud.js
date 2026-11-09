import { Router } from 'express';
import { pool } from '../db.js';
import { requireLogin, requireAdmin } from '../middleware/auth.js';
import { HttpError } from '../middleware/errors.js';

const MAX_TEXT = 200;
const MAX_AMOUNT = 9_999_999;

// Validates the request body against the column config; returns values in column order
const cleanBody = (columns, body = {}) =>
  columns.map((col) => {
    let v = body[col.name];
    if (typeof v === 'string') v = v.trim();

    if (v === undefined || v === null || v === '') {
      if (col.required) throw new HttpError(400, `${col.label} is required`);
      return col.default ?? null;
    }
    if (col.type === 'number') {
      v = Number(v);
      if (!Number.isFinite(v) || v < 0 || v > MAX_AMOUNT) {
        throw new HttpError(400, `${col.label} must be a valid amount`);
      }
      return Math.round(v * 100) / 100;
    }
    v = String(v);
    if (v.length > MAX_TEXT) throw new HttpError(400, `${col.label} is too long`);
    return v;
  });

const parseId = (raw) => {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new HttpError(400, 'Invalid id');
  return id;
};

const mapPgError = (err) => {
  if (err.code === '23505') return new HttpError(409, 'This name already exists');
  if (err.code === '23503') return new HttpError(409, 'Cannot delete: it is used by existing records');
  return err;
};

// table/column names come from masters.js (never from user input), so interpolation is safe
export default function crudRouter({ table, columns, orderBy }) {
  const router = Router();
  const names = columns.map((c) => c.name);

  router.get('/', requireLogin, async (_req, res) => {
    const { rows } = await pool.query(`SELECT * FROM ${table} ORDER BY ${orderBy}`);
    res.json(rows);
  });

  router.post('/', requireAdmin, async (req, res) => {
    const values = cleanBody(columns, req.body);
    try {
      const { rows: [row] } = await pool.query(
        `INSERT INTO ${table} (${names.join(', ')})
         VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        values
      );
      res.status(201).json(row);
    } catch (err) {
      throw mapPgError(err);
    }
  });

  router.put('/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    const values = cleanBody(columns, req.body);
    try {
      const { rows: [row] } = await pool.query(
        `UPDATE ${table} SET ${names.map((n, i) => `${n} = $${i + 1}`).join(', ')}
         WHERE id = $${names.length + 1} RETURNING *`,
        [...values, id]
      );
      if (!row) throw new HttpError(404, 'Not found');
      res.json(row);
    } catch (err) {
      throw mapPgError(err);
    }
  });

  router.delete('/:id', requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    try {
      const { rows: [row] } = await pool.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]);
      if (!row) throw new HttpError(404, 'Not found');
      res.json({ ok: true });
    } catch (err) {
      throw mapPgError(err);
    }
  });

  return router;
}
