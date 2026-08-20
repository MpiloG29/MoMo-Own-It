import { pool, type Queryable } from '../db/pool.js';
import type { Disbursement } from '../domain/types.js';
import { toDisbursement } from './rows.js';

/** ON CONFLICT DO NOTHING is the guard: a plan is never paid out twice. */
export async function create(
  input: { planId: string; supplierId: string; amountCents: number; momoReference: string },
  db: Queryable = pool,
): Promise<Disbursement | null> {
  const { rows } = await db.query(
    `INSERT INTO disbursements (plan_id, supplier_id, amount_cents, momo_reference, status)
     VALUES ($1, $2, $3, $4, 'pending')
     ON CONFLICT (plan_id) DO NOTHING
     RETURNING *`,
    [input.planId, input.supplierId, input.amountCents, input.momoReference],
  );
  return rows[0] ? toDisbursement(rows[0]) : null;
}

/** Only a pending row transitions — a replayed callback or reconciler hit is a no-op. */
export async function settle(
  input: { momoReference: string; status: 'successful' | 'failed'; failureReason?: string | null },
  db: Queryable = pool,
): Promise<Disbursement | null> {
  const { rows } = await db.query(
    `UPDATE disbursements
       SET status = $2, failure_reason = $3, settled_at = now()
     WHERE momo_reference = $1 AND status = 'pending'
     RETURNING *`,
    [input.momoReference, input.status, input.failureReason ?? null],
  );
  return rows[0] ? toDisbursement(rows[0]) : null;
}

/** Poll fallback target: disbursements still pending after the transfer callback should have landed. */
export async function listPending(olderThanMs = 0, db: Queryable = pool): Promise<Disbursement[]> {
  const { rows } = await db.query(
    `SELECT * FROM disbursements
     WHERE status = 'pending' AND created_at <= now() - ($1 || ' milliseconds')::interval
     ORDER BY created_at
     LIMIT 100`,
    [olderThanMs],
  );
  return rows.map(toDisbursement);
}

export async function findByPlan(planId: string, db: Queryable = pool): Promise<Disbursement | null> {
  const { rows } = await db.query('SELECT * FROM disbursements WHERE plan_id = $1', [planId]);
  return rows[0] ? toDisbursement(rows[0]) : null;
}

/** The supplier's payout ledger — every disbursement ever raised against them. */
export async function listBySupplier(supplierId: string, db: Queryable = pool): Promise<Disbursement[]> {
  const { rows } = await db.query(
    'SELECT * FROM disbursements WHERE supplier_id = $1 ORDER BY created_at DESC',
    [supplierId],
  );
  return rows.map(toDisbursement);
}
