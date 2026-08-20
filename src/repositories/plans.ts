import { pool, type Queryable } from '../db/pool.js';
import type { Plan } from '../domain/types.js';
import { toPlan } from './rows.js';

export async function insert(plan: Plan, db: Queryable = pool): Promise<Plan> {
  const { rows } = await db.query(
    `INSERT INTO plans (
       id, item_id, supplier_id, buyer_msisdn, mode, possession,
       total_cents, weekly_amount_cents, weeks, paid_cents, periods_covered,
       missed_count, status, next_due_at, started_at, completed_at, collection_code
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [
      plan.id,
      plan.itemId,
      plan.supplierId,
      plan.buyerMsisdn,
      plan.mode,
      plan.possession,
      plan.totalCents,
      plan.weeklyAmountCents,
      plan.weeks,
      plan.paidCents,
      plan.periodsCovered,
      plan.missedCount,
      plan.status,
      plan.nextDueAt,
      plan.startedAt,
      plan.completedAt,
      plan.collectionCode,
    ],
  );
  return toPlan(rows[0]);
}

export async function save(plan: Plan, db: Queryable = pool): Promise<Plan> {
  const { rows } = await db.query(
    `UPDATE plans SET
       paid_cents = $2, periods_covered = $3, missed_count = $4, status = $5,
       next_due_at = $6, completed_at = $7, collection_code = $8
     WHERE id = $1 RETURNING *`,
    [
      plan.id,
      plan.paidCents,
      plan.periodsCovered,
      plan.missedCount,
      plan.status,
      plan.nextDueAt,
      plan.completedAt,
      plan.collectionCode,
    ],
  );
  return toPlan(rows[0]);
}

export async function findById(id: string, db: Queryable = pool): Promise<Plan | null> {
  const { rows } = await db.query('SELECT * FROM plans WHERE id = $1', [id]);
  return rows[0] ? toPlan(rows[0]) : null;
}

/** Row lock: the scheduler and a manual pay-ahead must never race on one plan. */
export async function findByIdForUpdate(id: string, db: Queryable): Promise<Plan | null> {
  const { rows } = await db.query('SELECT * FROM plans WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] ? toPlan(rows[0]) : null;
}

export async function listByBuyer(msisdn: string, db: Queryable = pool): Promise<Plan[]> {
  const { rows } = await db.query(
    'SELECT * FROM plans WHERE buyer_msisdn = $1 ORDER BY started_at DESC',
    [msisdn],
  );
  return rows.map(toPlan);
}

export async function listBySupplier(supplierId: string, db: Queryable = pool): Promise<Plan[]> {
  const { rows } = await db.query(
    'SELECT * FROM plans WHERE supplier_id = $1 ORDER BY started_at DESC',
    [supplierId],
  );
  return rows.map(toPlan);
}

/** Plans whose next instalment is due, skipping any the scheduler already holds. */
export async function listDue(now: Date, limit = 50, db: Queryable = pool): Promise<Plan[]> {
  const { rows } = await db.query(
    `SELECT * FROM plans
     WHERE status IN ('active', 'behind')
       AND next_due_at IS NOT NULL
       AND next_due_at <= $1
       AND NOT EXISTS (
         SELECT 1 FROM payments p WHERE p.plan_id = plans.id AND p.status = 'pending'
       )
     ORDER BY next_due_at
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    [now.toISOString(), limit],
  );
  return rows.map(toPlan);
}
