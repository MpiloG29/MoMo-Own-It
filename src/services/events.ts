import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import type { PlanEvent } from '../domain/plan.js';
import type { Plan } from '../domain/types.js';
import type { Queryable } from '../db/pool.js';
import { logger } from '../logger.js';
import { momo, newReferenceId } from '../momo/index.js';
import * as disbursementsRepo from '../repositories/disbursements.js';
import * as plansRepo from '../repositories/plans.js';
import * as suppliersRepo from '../repositories/suppliers.js';
import { collectionCode } from '../unlock/codes.js';
import * as unlockService from './unlockService.js';

/**
 * The domain decides what should happen; this decides how.
 *
 * Side effects that touch MoMo are recorded in the same transaction that
 * changed the plan, then dispatched. If dispatch fails the row stays pending
 * and the reconciler retries — we never lose a disbursement to a dropped call.
 */
export async function applyEvents(
  events: PlanEvent[],
  ctx: { plan: Plan; now: Date },
  db: Queryable,
): Promise<{ deferred: Array<() => Promise<void>> }> {
  const deferred: Array<() => Promise<void>> = [];

  for (const event of events) {
    switch (event.type) {
      case 'plan.started': {
        if (ctx.plan.mode === 'take_it_now') {
          // Possession is immediate, but the device stays dark until payment one.
          logger.info('plan.started.take_it_now', { planId: ctx.plan.id });
        }
        break;
      }

      case 'unlock.issue': {
        const days = Number(event.payload?.days ?? env.UNLOCK_DAYS_PER_PERIOD);
        await unlockService.issueForPlan({ planId: ctx.plan.id, days, now: ctx.now }, db);
        break;
      }

      case 'unlock.permanent': {
        await unlockService.issueForPlan(
          { planId: ctx.plan.id, days: 0, permanent: true, now: ctx.now },
          db,
        );
        break;
      }

      case 'collection.code': {
        const code = collectionCode(env.UNLOCK_HMAC_SECRET, ctx.plan.id);
        ctx.plan.collectionCode = code;
        await plansRepo.save({ ...ctx.plan, collectionCode: code }, db);
        break;
      }

      case 'supplier.disburse': {
        const supplier = await suppliersRepo.findById(ctx.plan.supplierId, db);
        if (!supplier) {
          logger.error('disburse.supplier_missing', { planId: ctx.plan.id });
          break;
        }
        const reference = newReferenceId();
        const row = await disbursementsRepo.create(
          {
            planId: ctx.plan.id,
            supplierId: supplier.id,
            amountCents: Number(event.payload?.amountCents ?? ctx.plan.totalCents),
            momoReference: reference,
          },
          db,
        );
        if (!row) break; // already disbursed — idempotent by design

        deferred.push(async () => {
          await momo().transfer({
            referenceId: reference,
            amountCents: row.amountCents,
            payeeMsisdn: supplier.msisdn,
            externalId: `plan-${ctx.plan.id}`,
            payerMessage: 'MoMo Own It payout',
            payeeNote: `Plan ${ctx.plan.id} completed`,
          });
        });
        break;
      }

      case 'plan.behind': {
        logger.info('plan.behind', {
          planId: ctx.plan.id,
          locks: event.payload?.locks,
          missedCount: event.payload?.missedCount,
        });
        break;
      }

      case 'plan.completed': {
        logger.info('plan.completed', { planId: ctx.plan.id, mode: ctx.plan.mode });
        break;
      }

      default: {
        logger.warn('event.unhandled', { type: (event as PlanEvent).type, id: randomUUID() });
      }
    }
  }

  return { deferred };
}
