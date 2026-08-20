import { pool, type Queryable } from '../db/pool.js';
import type { RepaymentRecord } from '../domain/types.js';

/**
 * The record is derived, never authored. It is a view over what actually
 * happened — which is exactly why the customer can trust it and take it away.
 */
export async function forBuyer(msisdn: string, db: Queryable = pool): Promise<RepaymentRecord> {
  const { rows } = await db.query(
    `WITH plan_stats AS (
       SELECT
         COUNT(*) FILTER (WHERE status = 'complete')            AS completed,
         COUNT(*) FILTER (WHERE status IN ('active','behind'))  AS active,
         MIN(started_at)                                        AS first_at,
         MAX(started_at)                                        AS last_at
       FROM plans WHERE buyer_msisdn = $1
     ),
     payment_stats AS (
       SELECT
         COUNT(*) FILTER (WHERE pm.status = 'successful' AND (pm.due_at IS NULL OR pm.settled_at <= pm.due_at + INTERVAL '1 day')) AS on_time,
         COUNT(*) FILTER (WHERE pm.status = 'successful' AND pm.due_at IS NOT NULL AND pm.settled_at > pm.due_at + INTERVAL '1 day') AS late,
         COALESCE(SUM(pm.amount_cents) FILTER (WHERE pm.status = 'successful'), 0) AS total_repaid
       FROM payments pm
       JOIN plans p ON p.id = pm.plan_id
       WHERE p.buyer_msisdn = $1
     )
     SELECT * FROM plan_stats, payment_stats`,
    [msisdn],
  );

  const r = rows[0] ?? {};
  const onTime = Number(r.on_time ?? 0);
  const late = Number(r.late ?? 0);
  const total = onTime + late;

  return {
    buyerMsisdn: msisdn,
    plansCompleted: Number(r.completed ?? 0),
    plansActive: Number(r.active ?? 0),
    paymentsOnTime: onTime,
    paymentsLate: late,
    onTimeRate: total === 0 ? 0 : Math.round((onTime / total) * 100) / 100,
    totalRepaidCents: Number(r.total_repaid ?? 0),
    firstPlanAt: r.first_at ? new Date(r.first_at).toISOString() : null,
    lastPlanAt: r.last_at ? new Date(r.last_at).toISOString() : null,
  };
}
