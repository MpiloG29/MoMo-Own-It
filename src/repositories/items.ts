import { pool, type Queryable } from '../db/pool.js';
import type { Item, Mode } from '../domain/types.js';
import { toItem } from './rows.js';

export interface CreateItemInput {
  supplierId: string;
  title: string;
  imageUrl?: string | null;
  priceCents: number;
  mode: Mode;
  minWeeklyCents: number;
  maxWeeks: number;
}

export async function create(input: CreateItemInput, db: Queryable = pool): Promise<Item> {
  const { rows } = await db.query(
    `INSERT INTO items (supplier_id, title, image_url, price_cents, mode, min_weekly_cents, max_weeks)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [
      input.supplierId,
      input.title,
      input.imageUrl ?? null,
      input.priceCents,
      input.mode,
      input.minWeeklyCents,
      input.maxWeeks,
    ],
  );
  return toItem(rows[0]);
}

export async function findById(id: string, db: Queryable = pool): Promise<Item | null> {
  const { rows } = await db.query('SELECT * FROM items WHERE id = $1', [id]);
  return rows[0] ? toItem(rows[0]) : null;
}

export async function list(
  filter: { mode?: Mode; supplierId?: string } = {},
  db: Queryable = pool,
): Promise<Item[]> {
  const { rows } = await db.query(
    `SELECT * FROM items
     WHERE active = TRUE
       AND ($1::text IS NULL OR mode = $1)
       AND ($2::uuid IS NULL OR supplier_id = $2)
     ORDER BY created_at DESC`,
    [filter.mode ?? null, filter.supplierId ?? null],
  );
  return rows.map(toItem);
}
