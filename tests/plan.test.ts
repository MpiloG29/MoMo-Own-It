import { describe, expect, it } from 'vitest';
import { AppError } from '../src/domain/errors.js';
import {
  applyPayment,
  isDue,
  nextInstalmentCents,
  onMissedPayment,
  planOptions,
  possessionFor,
  progress,
  quotePlan,
  startPlan,
} from '../src/domain/plan.js';
import type { Plan } from '../src/domain/types.js';
import { at, makeItem, WEEK } from './factories.js';

const NOW = at('2026-03-01T08:00:00.000Z');

function newPlan(overrides: Parameters<typeof makeItem>[0] = {}, weekly = 15_000): Plan {
  const item = makeItem(overrides);
  return startPlan({
    id: '33333333-3333-4333-8333-333333333333',
    item,
    buyerMsisdn: '27821234567',
    quote: quotePlan(item, weekly),
    now: NOW,
    periodSeconds: WEEK,
  }).plan;
}

describe('quoting inside supplier limits', () => {
  it('derives weeks from the buyer-chosen instalment', () => {
    const q = quotePlan(makeItem(), 15_000); // R150/week on R3,000
    expect(q.weeks).toBe(20);
    expect(q.totalCents).toBe(300_000);
    expect(q.finalInstalmentCents).toBe(15_000);
  });

  it('puts the rounding remainder in the last instalment so nobody overpays', () => {
    const q = quotePlan(makeItem({ priceCents: 100_000 }), 30_000);
    expect(q.weeks).toBe(4);
    expect(q.weeklyAmountCents * (q.weeks - 1) + q.finalInstalmentCents).toBe(100_000);
    expect(q.finalInstalmentCents).toBe(10_000);
  });

  it('rejects an instalment below the supplier minimum', () => {
    expect(() => quotePlan(makeItem(), 5_000)).toThrowError(AppError);
    try {
      quotePlan(makeItem(), 5_000);
    } catch (err) {
      expect((err as AppError).code).toBe('WEEKLY_BELOW_MINIMUM');
    }
  });

  it('rejects a plan longer than the supplier allows', () => {
    try {
      quotePlan(makeItem({ maxWeeks: 10, minWeeklyCents: 1_000 }), 10_000);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as AppError).code).toBe('EXCEEDS_MAX_WEEKS');
    }
  });

  it('only offers options that satisfy both limits', () => {
    const item = makeItem({ maxWeeks: 30 });
    for (const option of planOptions(item)) {
      expect(option.weeklyAmountCents).toBeGreaterThanOrEqual(item.minWeeklyCents);
      expect(option.weeks).toBeLessThanOrEqual(item.maxWeeks);
    }
  });

  it('refuses a delisted item', () => {
    expect(() => quotePlan(makeItem({ active: false }), 15_000)).toThrowError(AppError);
  });
});

describe('fork 1 of 2: possession', () => {
  it('holds the item for Reserve and releases it for Use It', () => {
    expect(possessionFor('reserve')).toBe('on_completion');
    expect(possessionFor('use_it')).toBe('immediate');
    expect(newPlan().possession).toBe('on_completion');
    expect(newPlan({ mode: 'use_it' }).possession).toBe('immediate');
  });

  it('makes the first instalment due immediately', () => {
    const plan = newPlan();
    expect(isDue(plan, NOW)).toBe(true);
  });
});

describe('the ledger is identical for both modes', () => {
  it('advances the due date one period per instalment', () => {
    const plan = newPlan();
    const { plan: after } = applyPayment({
      plan,
      amountCents: 15_000,
      now: NOW,
      periodSeconds: WEEK,
      daysPerPeriod: 7,
    });
    expect(after.paidCents).toBe(15_000);
    expect(after.periodsCovered).toBe(1);
    expect(Date.parse(after.nextDueAt!)).toBe(NOW.getTime() + WEEK * 1000);
    expect(progress(after).weeksRemaining).toBe(19);
    expect(progress(after).percent).toBe(5);
  });

  it('credits a pay-ahead across the periods it actually covers', () => {
    const plan = newPlan();
    const { plan: after } = applyPayment({
      plan,
      amountCents: 60_000, // four weeks in one go
      now: NOW,
      periodSeconds: WEEK,
      daysPerPeriod: 7,
    });
    expect(after.periodsCovered).toBe(4);
    expect(Date.parse(after.nextDueAt!)).toBe(NOW.getTime() + 4 * WEEK * 1000);
  });

  it('never collects more than what is owed', () => {
    let plan = newPlan();
    plan = { ...plan, paidCents: 295_000 };
    expect(nextInstalmentCents(plan)).toBe(5_000);

    const { plan: after, appliedCents } = applyPayment({
      plan,
      amountCents: 15_000,
      now: NOW,
      periodSeconds: WEEK,
      daysPerPeriod: 7,
    });
    expect(appliedCents).toBe(5_000);
    expect(after.paidCents).toBe(300_000);
    expect(after.status).toBe('complete');
  });

  it('clears "behind" as soon as a payment lands', () => {
    const behind = { ...newPlan(), status: 'behind' as const };
    const { plan: after } = applyPayment({
      plan: behind,
      amountCents: 15_000,
      now: NOW,
      periodSeconds: WEEK,
      daysPerPeriod: 7,
    });
    expect(after.status).toBe('active');
  });

  it('refuses to collect against a finished plan', () => {
    const done = { ...newPlan(), status: 'complete' as const };
    expect(() =>
      applyPayment({ plan: done, amountCents: 100, now: NOW, periodSeconds: WEEK, daysPerPeriod: 7 }),
    ).toThrowError(AppError);
  });
});

describe('completion', () => {
  const runToCompletion = (mode: 'reserve' | 'use_it') => {
    let plan = newPlan({ mode });
    const events = [];
    for (let i = 0; i < plan.weeks; i++) {
      const out = applyPayment({
        plan,
        amountCents: plan.weeklyAmountCents,
        now: new Date(NOW.getTime() + i * WEEK * 1000),
        periodSeconds: WEEK,
        daysPerPeriod: 7,
      });
      plan = out.plan;
      events.push(...out.events);
    }
    return { plan, events };
  };

  it('Reserve pays the supplier once and issues a collection code', () => {
    const { plan, events } = runToCompletion('reserve');
    expect(plan.status).toBe('complete');
    expect(plan.paidCents).toBe(plan.totalCents);
    expect(plan.nextDueAt).toBeNull();

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'supplier.disburse')).toHaveLength(1);
    expect(types).toContain('collection.code');
    expect(types).not.toContain('unlock.issue');
  });

  it('Use It issues a code every period, then unlocks permanently', () => {
    const { plan, events } = runToCompletion('use_it');
    expect(plan.status).toBe('complete');

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === 'unlock.issue')).toHaveLength(plan.weeks - 1);
    expect(types.filter((t) => t === 'unlock.permanent')).toHaveLength(1);
    // The supplier was paid up front on Use It — never on completion.
    expect(types).not.toContain('supplier.disburse');
  });
});

describe('fork 2 of 2: what a miss costs you', () => {
  it('Reserve stretches and loses nothing', () => {
    const plan = newPlan();
    const { plan: after, events } = onMissedPayment({ plan, now: NOW, periodSeconds: WEEK });
    expect(after.status).toBe('behind');
    expect(after.paidCents).toBe(plan.paidCents);
    expect(after.missedCount).toBe(1);
    expect(events[0]!.payload!.locks).toBe(false);
  });

  it('Use It stretches too, but the device locks', () => {
    const plan = newPlan({ mode: 'use_it' });
    const { plan: after, events } = onMissedPayment({ plan, now: NOW, periodSeconds: WEEK });
    expect(after.status).toBe('behind');
    expect(events[0]!.payload!.locks).toBe(true);
  });

  it('adds no penalty and no rollover debt in either mode', () => {
    for (const mode of ['reserve', 'use_it'] as const) {
      const plan = newPlan({ mode });
      const { plan: after } = onMissedPayment({ plan, now: NOW, periodSeconds: WEEK });
      expect(after.totalCents).toBe(plan.totalCents);
      expect(after.weeklyAmountCents).toBe(plan.weeklyAmountCents);
    }
  });

  it('leaves a completed plan alone', () => {
    const done = { ...newPlan(), status: 'complete' as const };
    const { plan: after, events } = onMissedPayment({ plan: done, now: NOW, periodSeconds: WEEK });
    expect(after).toBe(done);
    expect(events).toHaveLength(0);
  });
});
