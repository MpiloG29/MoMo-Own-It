import { invalid } from './errors.js';
import type { Item, Mode, Plan, Possession } from './types.js';

/**
 * The engine.
 *
 * Reserve (layby) and Use It (pay-as-you-go) share one Plan object and one
 * collection loop. The mode forks the logic in exactly two places:
 *
 *   1. possessionFor()   — at plan start, does the item release now or is it held?
 *   2. onMissedPayment() — on a miss, does something switch off, or does the plan stretch?
 *
 * Everything below that line — schedule, ledger, progress, completion, record —
 * is identical for both modes. Keep it that way.
 */

export interface PlanEvent {
  type:
    | 'plan.started'
    | 'plan.behind'
    | 'plan.completed'
    | 'unlock.issue'
    | 'unlock.permanent'
    | 'supplier.disburse'
    | 'collection.code';
  planId: string;
  payload?: Record<string, unknown>;
}

export interface PlanQuote {
  weeklyAmountCents: number;
  weeks: number;
  totalCents: number;
  /** Last instalment absorbs the rounding remainder so the buyer never overpays. */
  finalInstalmentCents: number;
}

// ---------------------------------------------------------------------------
// Fork 1 of 2: possession
// ---------------------------------------------------------------------------
export function possessionFor(mode: Mode): Possession {
  return mode === 'use_it' ? 'immediate' : 'on_completion';
}

// ---------------------------------------------------------------------------
// Quoting — the buyer picks any plan inside the supplier's limits
// ---------------------------------------------------------------------------
export function quotePlan(item: Item, weeklyAmountCents: number): PlanQuote {
  if (!Number.isInteger(weeklyAmountCents) || weeklyAmountCents <= 0) {
    throw invalid('WEEKLY_AMOUNT_INVALID', 'Weekly amount must be a positive integer (cents).');
  }
  if (!item.active) {
    throw invalid('ITEM_INACTIVE', 'This item is no longer listed.');
  }
  if (weeklyAmountCents < item.minWeeklyCents) {
    throw invalid(
      'WEEKLY_BELOW_MINIMUM',
      `Supplier's minimum instalment is ${item.minWeeklyCents} cents.`,
      { minWeeklyCents: item.minWeeklyCents },
    );
  }
  if (weeklyAmountCents > item.priceCents) {
    // Paying the whole thing in one go is fine, but call it one instalment.
    weeklyAmountCents = item.priceCents;
  }

  const weeks = Math.ceil(item.priceCents / weeklyAmountCents);
  if (weeks > item.maxWeeks) {
    throw invalid(
      'EXCEEDS_MAX_WEEKS',
      `Supplier allows at most ${item.maxWeeks} weeks; that plan needs ${weeks}.`,
      { maxWeeks: item.maxWeeks, requestedWeeks: weeks },
    );
  }

  const remainder = item.priceCents - weeklyAmountCents * (weeks - 1);
  return {
    weeklyAmountCents,
    weeks,
    totalCents: item.priceCents,
    finalInstalmentCents: remainder,
  };
}

/** Every plan the supplier's limits allow, so the buyer can see real options. */
export function planOptions(item: Item, steps = 6): PlanQuote[] {
  const out: PlanQuote[] = [];
  const seen = new Set<number>();
  for (let weeks = item.maxWeeks; weeks >= 1 && out.length < steps; weeks--) {
    const weekly = Math.ceil(item.priceCents / weeks);
    if (weekly < item.minWeeklyCents || seen.has(weekly)) continue;
    seen.add(weekly);
    out.push(quotePlan(item, weekly));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan creation
// ---------------------------------------------------------------------------
export function startPlan(args: {
  id: string;
  item: Item;
  buyerMsisdn: string;
  quote: PlanQuote;
  now: Date;
  periodSeconds: number;
}): { plan: Plan; events: PlanEvent[] } {
  const { id, item, buyerMsisdn, quote, now, periodSeconds } = args;

  const plan: Plan = {
    id,
    itemId: item.id,
    supplierId: item.supplierId,
    buyerMsisdn,
    mode: item.mode,
    possession: possessionFor(item.mode),
    totalCents: quote.totalCents,
    weeklyAmountCents: quote.weeklyAmountCents,
    weeks: quote.weeks,
    paidCents: 0,
    periodsCovered: 0,
    missedCount: 0,
    status: 'active',
    // First instalment is due immediately — the plan starts when money moves.
    nextDueAt: now.toISOString(),
    startedAt: now.toISOString(),
    completedAt: null,
    collectionCode: null,
  };

  const events: PlanEvent[] = [
    { type: 'plan.started', planId: id, payload: { mode: plan.mode, possession: plan.possession } },
  ];

  void periodSeconds;
  return { plan, events };
}

// ---------------------------------------------------------------------------
// Ledger — one code path for both modes
// ---------------------------------------------------------------------------
export function applyPayment(args: {
  plan: Plan;
  amountCents: number;
  now: Date;
  periodSeconds: number;
  daysPerPeriod: number;
}): { plan: Plan; events: PlanEvent[]; appliedCents: number } {
  const { plan, amountCents, now, periodSeconds, daysPerPeriod } = args;

  if (plan.status === 'complete' || plan.status === 'cancelled') {
    throw invalid('PLAN_NOT_COLLECTABLE', `Plan is ${plan.status}.`);
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw invalid('AMOUNT_INVALID', 'Payment amount must be a positive integer (cents).');
  }

  const remainingBefore = plan.totalCents - plan.paidCents;
  const applied = Math.min(amountCents, remainingBefore);
  const periods = Math.max(1, Math.floor(applied / plan.weeklyAmountCents));

  const next: Plan = {
    ...plan,
    paidCents: plan.paidCents + applied,
    periodsCovered: plan.periodsCovered + periods,
    status: 'active',
  };

  const events: PlanEvent[] = [];

  if (next.paidCents >= next.totalCents) {
    next.status = 'complete';
    next.completedAt = now.toISOString();
    next.nextDueAt = null;
    events.push({ type: 'plan.completed', planId: next.id });

    if (next.mode === 'reserve') {
      // Supplier is paid once, on completion; buyer collects with a code.
      events.push({
        type: 'supplier.disburse',
        planId: next.id,
        payload: { amountCents: next.totalCents, supplierId: next.supplierId },
      });
      events.push({ type: 'collection.code', planId: next.id });
    } else {
      // Device unlocks permanently. No more codes, ever.
      events.push({ type: 'unlock.permanent', planId: next.id });
    }
  } else {
    const base = Math.max(now.getTime(), Date.parse(plan.nextDueAt ?? now.toISOString()));
    next.nextDueAt = new Date(base + periods * periodSeconds * 1000).toISOString();

    if (next.mode === 'use_it') {
      events.push({
        type: 'unlock.issue',
        planId: next.id,
        payload: { days: periods * daysPerPeriod },
      });
    }
  }

  return { plan: next, events, appliedCents: applied };
}

// ---------------------------------------------------------------------------
// Fork 2 of 2: what a miss costs you
// ---------------------------------------------------------------------------
export function onMissedPayment(args: {
  plan: Plan;
  now: Date;
  periodSeconds: number;
}): { plan: Plan; events: PlanEvent[] } {
  const { plan, now, periodSeconds } = args;

  if (plan.status === 'complete' || plan.status === 'cancelled') {
    return { plan, events: [] };
  }

  const next: Plan = {
    ...plan,
    status: 'behind',
    missedCount: plan.missedCount + 1,
    // Reserve: the plan simply stretches, nothing is lost.
    // Use It: the plan also stretches, but the live unlock code runs out and
    // the device goes dark until the next successful payment. No rollover debt
    // and no penalty in either mode — the item itself is the only security.
    nextDueAt: new Date(
      Math.max(now.getTime(), Date.parse(plan.nextDueAt ?? now.toISOString())) + periodSeconds * 1000,
    ).toISOString(),
  };

  return {
    plan: next,
    events: [
      {
        type: 'plan.behind',
        planId: next.id,
        payload: { mode: next.mode, locks: next.mode === 'use_it', missedCount: next.missedCount },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Progress — what the buyer sees
// ---------------------------------------------------------------------------
export function progress(plan: Plan) {
  const remainingCents = Math.max(0, plan.totalCents - plan.paidCents);
  const weeksRemaining =
    remainingCents === 0 ? 0 : Math.ceil(remainingCents / plan.weeklyAmountCents);
  return {
    paidCents: plan.paidCents,
    remainingCents,
    weeksRemaining,
    percent: plan.totalCents === 0 ? 100 : Math.round((plan.paidCents / plan.totalCents) * 100),
    nextDueAt: plan.nextDueAt,
    status: plan.status,
  };
}

/** The amount the scheduler should request next: never more than what is owed. */
export function nextInstalmentCents(plan: Plan): number {
  return Math.min(plan.weeklyAmountCents, plan.totalCents - plan.paidCents);
}

export function isDue(plan: Plan, now: Date): boolean {
  if (plan.status !== 'active' && plan.status !== 'behind') return false;
  if (!plan.nextDueAt) return false;
  return Date.parse(plan.nextDueAt) <= now.getTime();
}
