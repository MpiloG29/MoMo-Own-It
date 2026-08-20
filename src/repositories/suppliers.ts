import { pool, type Queryable } from '../db/pool.js';
import type { Supplier } from '../domain/types.js';
import { toSupplier } from './rows.js';

export async function create(
  input: { name: string; msisdn: string },
  db: Queryable = pool,
): Promise<Supplier> {
  const { rows } = await db.query(
    'INSERT INTO suppliers (name, msisdn) VALUES ($1, $2) RETURNING *',
    [input.name, input.msisdn],
  );
  return toSupplier(rows[0]);
}

export async function findById(id: string, db: Queryable = pool): Promise<Supplier | null> {
  const { rows } = await db.query('SELECT * FROM suppliers WHERE id = $1', [id]);
  return rows[0] ? toSupplier(rows[0]) : null;
}

export async function list(db: Queryable = pool): Promise<Supplier[]> {
  const { rows } = await db.query('SELECT * FROM suppliers ORDER BY created_at');
  return rows.map(toSupplier);
}
