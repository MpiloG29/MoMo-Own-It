import { env } from '../config/env.js';
import { withTransaction } from '../db/pool.js';
import { conflict, invalid, notFound } from '../domain/errors.js';
import { applyPayment, isDue, nextInstalmentCents, onMissedPayment } from '../domain/plan.js';
import type { Payment, Plan } from '../domain/types.js';
import { logger } from '../logger.js';
import { momo, newReferenceId } from '../momo/index.js';
import * as paymentsRepo from '../repositories/payments.js';
import * as plansRepo from '../repositories/plans.js';
import { applyEvents } from './events.js';

/**
 * The collection loop. Both modes go through here — there is no second path.
 *
 *   1. find plans with an instalment due
 *   2. write a pending payment row (X-Reference-Id is the idempotency key)
 *   3. requestToPay
 *   4. settle on callback, or on poll if the callback never lands
 */

export interface CollectionResult {
  planId: string;
  paymentId: string;
  momoReference: string;
  amountCents: number;
}

/** Step 2 + 3. Safe to call twice: the pending-payment guard blocks a double request. */
export async function requestInstalment(
  planId: string,
  overrideAmountCents?: number,
): Promise<CollectionResult> {
  const prepared = await withTransaction(async (client) => {
    const plan = await plansRepo.findByIdForUpdate(planId, client);
    if (!plan) throw notFound('Plan');
    if (plan.status === 'complete') throw conflict('PLAN_COMPLETE', 'Plan is already paid off.');
    if (plan.status === 'cancelled') throw conflict('PLAN_CANCELLED', 'Plan was cancelled.');

    const outstanding = plan.totalCents - plan.paidCents;
    const amountCents = Math.min(overrideAmountCents ?? nextInstalmentCents(plan), outstanding);
    if (amountCents <= 0) throw conflict('NOTHING_DUE', 'Nothing outstanding on this plan.');

    const existing = await paymentsRepo.listByPlan(planId, client);
    if (existing.some((p) => p.status === 'pending')) {
      throw conflict('COLLECTION_IN_FLIGHT', 'A collection is already awaiting confirmation.');
    }

    const payment = await paymentsRepo.create(
      {
        planId,
        amountCents,
        momoReference: newReferenceId(),
        dueAt: plan.nextDueAt,
      },
      client,
    );

    return { plan, payment };
  });

  const { plan, payment } = prepared;

  try {
    await momo().requestToPay({
      referenceId: payment.momoReference,
      amountCents: payment.amountCents,
      payerMsisdn: plan.buyerMsisdn,
      externalId: `plan-${plan.id}`,
      payerMessage: 'MoMo Own It instalment',
      payeeNote: `Instalment for plan ${plan.id}`,
    });
  } catch (err) {
    // The request never reached MoMo — release the slot so the next tick retries.
    await paymentsRepo.settle({
      momoReference: payment.momoReference,
      status: 'failed',
      failureReason: `REQUEST_FAILED: ${(err as Error).message}`,
    });
    throw err;
  }

  return {
    planId: plan.id,
    paymentId: payment.id,
    momoReference: payment.momoReference,
    amountCents: payment.amountCents,
  };
}

/** Step 4. Idempotent: only a pending payment transitions, so replays are free. */
export async function settlePayment(
  momoReference: string,
  outcome: { status: 'successful' | 'failed'; financialTransactionId?: string | null; reason?: string | null },
): Promise<{ plan: Plan | null; payment: Payment | null }> {
  const now = new Date();

  const result = await withTransaction(async (client) => {
    const payment = await paymentsRepo.settle(
      {
        momoReference,
        status: outcome.status,
        financialTransactionId: outcome.financialTransactionId ?? null,
        failureReason: outcome.reason ?? null,
      },
      client,
    );

    if (!payment) return { plan: null, payment: null, deferred: [] };

    const plan = await plansRepo.findByIdForUpdate(payment.planId, client);
    if (!plan) return { plan: null, payment, deferred: [] };

    const outcomeOfPlan =
      outcome.status === 'successful'
        ? applyPayment({
            plan,
            amountCents: payment.amountCents,
            now,
            periodSeconds: env.BILLING_PERIOD_SECONDS,
            daysPerPeriod: env.UNLOCK_DAYS_PER_PERIOD,
          })
        : onMissedPayment({ plan, now, periodSeconds: env.BILLING_PERIOD_SECONDS });

    const saved = await plansRepo.save(outcomeOfPlan.plan, client);
    const { deferred } = await applyEvents(outcomeOfPlan.events, { plan: saved, now }, client);

    return { plan: saved, payment, deferred };
  });

  // Outbound MoMo calls happen after commit, never inside the transaction.
  for (const run of result.deferred) {
    try {
      await run();
    } catch (err) {
      logger.error('deferred.effect.failed', { error: (err as Error).message, momoReference });
    }
  }

  return { plan: result.plan, payment: result.payment };
}

/** Poll fallback for every pending payment — callbacks are best-effort. */
export async function reconcilePending(minAgeMs = 5_000): Promise<number> {
  return settleFromProvider(await paymentsRepo.listPending(minAgeMs));
}

/**
 * The same reconcile, narrowed to one plan. A caller who has just started a
 * collection can ask how it resolved without touching every other plan's
 * schedule the way a full tick does.
 */
export async function reconcilePlan(planId: string): Promise<number> {
  const payments = await paymentsRepo.listByPlan(planId);
  return settleFromProvider(payments.filter((p) => p.status === 'pending'));
}

async function settleFromProvider(pending: Payment[]): Promise<number> {
  let settled = 0;

  for (const payment of pending) {
    try {
      const status = await momo().getRequestToPayStatus(payment.momoReference);
      if (status.status === 'PENDING') continue;
      await settlePayment(payment.momoReference, {
        status: status.status === 'SUCCESSFUL' ? 'successful' : 'failed',
        financialTransactionId: status.financialTransactionId,
        reason: status.reason,
      });
      settled++;
    } catch (err) {
      logger.warn('reconcile.failed', {
        momoReference: payment.momoReference,
        error: (err as Error).message,
      });
    }
  }

  return settled;
}

/** One scheduler tick: collect everything due, then reconcile what is in flight. */
export async function runDueCollections(now = new Date()): Promise<CollectionResult[]> {
  const due = await withTransaction((client) => plansRepo.listDue(now, 50, client));
  const results: CollectionResult[] = [];

  for (const plan of due) {
    if (!isDue(plan, now)) continue;
    try {
      results.push(await requestInstalment(plan.id));
    } catch (err) {
      logger.warn('collection.skipped', { planId: plan.id, error: (err as Error).message });
    }
  }

  return results;
}

/** Buyer pays ahead. Same engine, just not waiting for the schedule. */
export async function payAhead(planId: string, amountCents?: number): Promise<CollectionResult> {
  if (amountCents !== undefined && (!Number.isInteger(amountCents) || amountCents <= 0)) {
    throw invalid('AMOUNT_INVALID', 'Amount must be a positive integer (cents).');
  }
  return requestInstalment(planId, amountCents);
}

/** Demo control: mark the in-flight collection as missed so the lamp goes dark. */
export async function forceMiss(planId: string): Promise<Plan | null> {
  const payments = await paymentsRepo.listByPlan(planId);
  const pending = payments.find((p) => p.status === 'pending');

  if (pending) {
    const { plan } = await settlePayment(pending.momoReference, {
      status: 'failed',
      reason: 'DEMO_FORCED_MISS',
    });
    return plan;
  }

  const now = new Date();
  return withTransaction(async (client) => {
    const plan = await plansRepo.findByIdForUpdate(planId, client);
    if (!plan) throw notFound('Plan');
    const { plan: next, events } = onMissedPayment({
      plan,
      now,
      periodSeconds: env.BILLING_PERIOD_SECONDS,
    });
    const saved = await plansRepo.save(next, client);
    await applyEvents(events, { plan: saved, now }, client);
    return saved;
  });
}
