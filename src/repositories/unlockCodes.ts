import { pool, type Queryable } from '../db/pool.js';
import type { UnlockCode } from '../domain/types.js';
import { toUnlockCode } from './rows.js';

export async function insert(
  input: {
    planId: string;
    code: string;
    sequence: number;
    daysGranted: number;
    permanent: boolean;
    expiresAt: string | null;
  },
  db: Queryable = pool,
): Promise<UnlockCode> {
  const { rows } = await db.query(
    `INSERT INTO unlock_codes (plan_id, code, sequence, days_granted, permanent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [input.planId, input.code, input.sequence, input.daysGranted, input.permanent, input.expiresAt],
  );
  return toUnlockCode(rows[0]);
}

export async function nextSequence(planId: string, db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ next: string }>(
    'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM unlock_codes WHERE plan_id = $1',
    [planId],
  );
  return Number(rows[0]!.next);
}

export async function latest(planId: string, db: Queryable = pool): Promise<UnlockCode | null> {
  const { rows } = await db.query(
    'SELECT * FROM unlock_codes WHERE plan_id = $1 ORDER BY sequence DESC LIMIT 1',
    [planId],
  );
  return rows[0] ? toUnlockCode(rows[0]) : null;
}

export async function listByPlan(planId: string, db: Queryable = pool): Promise<UnlockCode[]> {
  const { rows } = await db.query(
    'SELECT * FROM unlock_codes WHERE plan_id = $1 ORDER BY sequence',
    [planId],
  );
  return rows.map(toUnlockCode);
}
