import { pool, type Queryable } from '../db/pool.js';
import type { Payment, PaymentStatus } from '../domain/types.js';
import { toPayment } from './rows.js';

export async function create(
  input: { planId: string; amountCents: number; momoReference: string; dueAt: string | null },
  db: Queryable = pool,
): Promise<Payment> {
  const { rows } = await db.query(
    `INSERT INTO payments (plan_id, amount_cents, momo_reference, status, due_at)
     VALUES ($1, $2, $3, 'pending', $4) RETURNING *`,
    [input.planId, input.amountCents, input.momoReference, input.dueAt],
  );
  return toPayment(rows[0]);
}

export async function settle(
  input: {
    momoReference: string;
    status: Exclude<PaymentStatus, 'pending'>;
    financialTransactionId?: string | null;
    failureReason?: string | null;
  },
  db: Queryable = pool,
): Promise<Payment | null> {
  // Only a pending row transitions — a replayed callback is a no-op.
  const { rows } = await db.query(
    `UPDATE payments
       SET status = $2, financial_transaction_id = $3, failure_reason = $4, settled_at = now()
     WHERE momo_reference = $1 AND status = 'pending'
     RETURNING *`,
    [
      input.momoReference,
      input.status,
      input.financialTransactionId ?? null,
      input.failureReason ?? null,
    ],
  );
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function findByReference(
  momoReference: string,
  db: Queryable = pool,
): Promise<Payment | null> {
  const { rows } = await db.query('SELECT * FROM payments WHERE momo_reference = $1', [
    momoReference,
  ]);
  return rows[0] ? toPayment(rows[0]) : null;
}

export async function listByPlan(planId: string, db: Queryable = pool): Promise<Payment[]> {
  const { rows } = await db.query(
    'SELECT * FROM payments WHERE plan_id = $1 ORDER BY created_at',
    [planId],
  );
  return rows.map(toPayment);
}

export async function listPending(olderThanMs = 0, db: Queryable = pool): Promise<Payment[]> {
  const { rows } = await db.query(
    `SELECT * FROM payments
     WHERE status = 'pending' AND created_at <= now() - ($1 || ' milliseconds')::interval
     ORDER BY created_at
     LIMIT 100`,
    [olderThanMs],
  );
  return rows.map(toPayment);
}
